"""
Lending Pool Contract — Cadencia Credit

Single unified liquidity pool holding native ALGO.
Lenders deposit ALGO → receive LP share tokens (ASA).
Borrowers draw from this pool via the LoanManager contract.

Key mechanics:
    - Pro-rata share minting: shares = (deposit * total_shares) / total_liquidity
    - Utilization cap: disbursements halt at 90%
    - 7-day minimum lock period for lender deposits
    - Only the authorized LoanManager app can call disburse()

All amounts are in microALGO (1 ALGO = 1_000_000 microALGO).
"""

from algopy import (
    ARC4Contract,
    Account,
    Asset,
    Global,
    GlobalState,
    Txn,
    UInt64,
    arc4,
    gtxn,
    itxn,
    op,
    subroutine,
    BoxMap,
)

# Pool parameters (plain int — Puya forbids UInt64 at module level)
UTILIZATION_CAP_BPS = 9000   # 90% in basis points
BPS_DENOMINATOR = 10000
MIN_LOCK_ROUNDS = 37800       # ~7 days at 16 rounds/min
MIN_DEPOSIT = 1_000_000       # 1 ALGO minimum deposit

# Fixed interest rate table (basis points APR by tenure in days)
# Applied off-chain by oracle; stored here for on-chain reference
RATE_7_DAYS = 800
RATE_15_DAYS = 900
RATE_30_DAYS = 1000
RATE_60_DAYS = 1100
RATE_90_DAYS = 1200


class DepositRecord(arc4.Struct):
    """Per-lender deposit metadata stored in box storage."""
    shares: arc4.UInt64              # LP share token balance (tracked in box, not ASA)
    deposited_at: arc4.UInt64        # Round number of deposit (for lock period)
    total_deposited: arc4.UInt64     # Cumulative ALGO deposited (lifetime)
    total_withdrawn: arc4.UInt64     # Cumulative ALGO withdrawn (lifetime)


class LendingPool(ARC4Contract):
    """
    Single unified ALGO lending pool.

    Access control:
        - deposit / withdraw: any KYC-verified lender
        - disburse: LoanManager contract only (inner app call)
        - return_funds: LoanManager / RepaymentEscrow (inner app call)
        - admin methods: admin only
    """

    def __init__(self) -> None:
        self.admin = GlobalState(Account)
        self.oracle = GlobalState(Account)
        # The LoanManager app ID that's allowed to call disburse
        self.loan_manager_id = GlobalState(UInt64, key="loan_mgr")
        # The RepaymentEscrow app ID that can return funds
        self.escrow_id = GlobalState(UInt64, key="escrow_id")

        # Pool accounting (all in microALGO)
        self.total_liquidity = GlobalState(UInt64, key="total_liq")
        self.outstanding_loans = GlobalState(UInt64, key="out_loans")
        self.total_shares = GlobalState(UInt64, key="total_shares")

        # Platform stats
        self.total_depositors = GlobalState(UInt64, key="depositors")
        self.total_loans_disbursed = GlobalState(UInt64, key="loans_out")

        # Emergency pause flag
        self.paused = GlobalState(UInt64, key="paused")  # 0=active, 1=paused

        # Per-lender deposit records
        self.deposits = BoxMap(Account, DepositRecord, key_prefix=b"dep_")

    @arc4.abimethod(create="require")
    def create(self, admin: Account, oracle: Account) -> None:
        """Initialize the pool. Called once at deployment."""
        self.admin.value = admin
        self.oracle.value = oracle
        self.loan_manager_id.value = UInt64(0)
        self.escrow_id.value = UInt64(0)
        self.total_liquidity.value = UInt64(0)
        self.outstanding_loans.value = UInt64(0)
        self.total_shares.value = UInt64(0)
        self.total_depositors.value = UInt64(0)
        self.total_loans_disbursed.value = UInt64(0)
        self.paused.value = UInt64(0)

    @arc4.abimethod
    def set_loan_manager(self, app_id: UInt64) -> None:
        """Set the authorized LoanManager app ID. Admin-only."""
        assert Txn.sender == self.admin.value, "only admin"
        self.loan_manager_id.value = app_id

    @arc4.abimethod
    def set_escrow(self, app_id: UInt64) -> None:
        """Set the RepaymentEscrow app ID. Admin-only."""
        assert Txn.sender == self.admin.value, "only admin"
        self.escrow_id.value = app_id

    @arc4.abimethod
    def set_paused(self, paused: arc4.Bool) -> None:
        """Emergency pause/unpause. Admin-only. Halts new disbursements."""
        assert Txn.sender == self.admin.value, "only admin"
        self.paused.value = UInt64(1) if paused.native else UInt64(0)

    @arc4.abimethod
    def deposit(self, payment: gtxn.PaymentTransaction) -> None:
        """
        Deposit ALGO into the pool.

        The lender must include a PaymentTransaction to this app address
        as a preceding transaction in the atomic group.
        Shares are minted pro-rata.
        """
        assert self.paused.value == UInt64(0), "pool is paused"
        assert payment.receiver == Global.current_application_address, "pay to pool"
        assert payment.amount >= MIN_DEPOSIT, "below minimum deposit"

        deposit_amount = payment.amount

        # Calculate shares to mint
        if self.total_shares.value == UInt64(0):
            # First deposit: 1:1 shares
            new_shares = deposit_amount
        else:
            # Pro-rata: new_shares = deposit * total_shares / total_liquidity
            new_shares = (deposit_amount * self.total_shares.value) // self.total_liquidity.value

        assert new_shares > UInt64(0), "deposit too small for shares"

        # Update pool totals
        self.total_liquidity.value += deposit_amount
        self.total_shares.value += new_shares

        # Update or create lender record
        depositor = payment.sender
        if depositor in self.deposits:
            record = self.deposits[depositor].copy()
            record.shares = arc4.UInt64(record.shares.native + new_shares)
            record.deposited_at = arc4.UInt64(Global.round)  # Reset lock timer
            record.total_deposited = arc4.UInt64(
                record.total_deposited.native + deposit_amount
            )
            self.deposits[depositor] = record.copy()
        else:
            record = DepositRecord(
                shares=arc4.UInt64(new_shares),
                deposited_at=arc4.UInt64(Global.round),
                total_deposited=arc4.UInt64(deposit_amount),
                total_withdrawn=arc4.UInt64(0),
            )
            self.deposits[depositor] = record.copy()
            self.total_depositors.value += UInt64(1)

    @arc4.abimethod
    def withdraw(self, share_amount: UInt64) -> None:
        """
        Withdraw ALGO by burning shares.
        Enforces 7-day lock period from last deposit.
        """
        assert self.paused.value == UInt64(0), "pool is paused"
        depositor = Txn.sender
        assert depositor in self.deposits, "no deposit found"

        record = self.deposits[depositor].copy()
        assert record.shares.native >= share_amount, "insufficient shares"

        # Enforce lock period
        assert (
            Global.round >= record.deposited_at.native + MIN_LOCK_ROUNDS
        ), "deposit still locked (7-day minimum)"

        # Calculate ALGO to return: algo = shares * total_liquidity / total_shares
        available_liquidity = self.total_liquidity.value - self.outstanding_loans.value
        algo_amount = (share_amount * self.total_liquidity.value) // self.total_shares.value
        assert algo_amount <= available_liquidity, "insufficient pool liquidity"

        # Burn shares
        record.shares = arc4.UInt64(record.shares.native - share_amount)
        record.total_withdrawn = arc4.UInt64(
            record.total_withdrawn.native + algo_amount
        )
        self.deposits[depositor] = record.copy()

        self.total_shares.value -= share_amount
        self.total_liquidity.value -= algo_amount

        # Send ALGO back to lender
        itxn.Payment(
            receiver=depositor,
            amount=algo_amount,
            fee=0,
        ).submit()

    @arc4.abimethod
    def disburse(self, borrower: arc4.Address, amount: UInt64) -> None:
        """
        Disburse ALGO to a borrower. LoanManager only (inner app call).
        Enforces utilization cap at 90%.

        Uses arc4.Address (32-byte raw address) instead of ABI Account type
        so that inner application calls from LoanManager work correctly —
        the ABI Account type (uint8 index) cannot be used across inner calls
        because the callee cannot resolve the caller's accounts array.
        """
        assert self.paused.value == UInt64(0), "pool is paused"
        assert (
            Global.caller_application_id == self.loan_manager_id.value
        ), "only LoanManager can disburse"

        # Check utilization cap
        new_outstanding = self.outstanding_loans.value + amount
        utilization = (new_outstanding * BPS_DENOMINATOR) // self.total_liquidity.value
        assert utilization < UTILIZATION_CAP_BPS, "utilization cap reached (90%)"

        # Check available balance
        available = self.total_liquidity.value - self.outstanding_loans.value
        assert amount <= available, "insufficient pool funds"

        self.outstanding_loans.value = new_outstanding
        self.total_loans_disbursed.value += UInt64(1)

        # Send ALGO to borrower — convert arc4.Address to native Account
        itxn.Payment(
            receiver=borrower.native,
            amount=amount,
            fee=0,
        ).submit()

    @arc4.abimethod
    def return_funds(self, amount: UInt64) -> None:
        """
        Return repaid ALGO to the pool. Called by RepaymentEscrow
        as part of the repayment split.
        """
        assert (
            Global.caller_application_id == self.escrow_id.value
            or Global.caller_application_id == self.loan_manager_id.value
        ), "unauthorized caller"

        # Reduce outstanding loans
        if amount > self.outstanding_loans.value:
            self.outstanding_loans.value = UInt64(0)
        else:
            self.outstanding_loans.value -= amount

    # ── Read-only methods ──

    @arc4.abimethod(readonly=True)
    def get_utilization_bps(self) -> arc4.UInt64:
        """Current utilization rate in basis points."""
        if self.total_liquidity.value == UInt64(0):
            return arc4.UInt64(0)
        util = (self.outstanding_loans.value * BPS_DENOMINATOR) // self.total_liquidity.value
        return arc4.UInt64(util)

    @arc4.abimethod(readonly=True)
    def get_pool_stats(self) -> arc4.Tuple[arc4.UInt64, arc4.UInt64, arc4.UInt64, arc4.UInt64]:
        """Return (total_liquidity, outstanding_loans, total_shares, total_depositors)."""
        return arc4.Tuple(
            (
                arc4.UInt64(self.total_liquidity.value),
                arc4.UInt64(self.outstanding_loans.value),
                arc4.UInt64(self.total_shares.value),
                arc4.UInt64(self.total_depositors.value),
            )
        )

    @arc4.abimethod(readonly=True)
    def get_deposit(self, depositor: Account) -> DepositRecord:
        """Get deposit record for a lender. Reverts if not found."""
        assert depositor in self.deposits, "no deposit found"
        return self.deposits[depositor]

    @arc4.abimethod(readonly=True)
    def get_share_value(self, shares: UInt64) -> arc4.UInt64:
        """Calculate the ALGO value of a given number of shares."""
        if self.total_shares.value == UInt64(0):
            return arc4.UInt64(0)
        value = (shares * self.total_liquidity.value) // self.total_shares.value
        return arc4.UInt64(value)

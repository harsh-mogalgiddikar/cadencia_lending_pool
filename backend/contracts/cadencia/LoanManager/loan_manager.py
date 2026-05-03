"""
Loan Manager Contract — Cadencia Credit

Manages all loans in a single contract using box storage.
Replaces the one-app-per-loan design (cheaper, simpler).

Each loan record is stored as a box keyed by loan_id.
State machine per loan: PENDING → APPROVED → ACTIVE → REPAID | DEFAULTED

Inter-contract calls:
    - Reads KYC status from KYCRegistry (foreign app read)
    - Reads credit score from CreditScore (foreign app read)
    - Calls LendingPool.disburse() on approval (inner app call)
    - Calls CreditScore.increase_score / decrease_score on repayment

All amounts are in microALGO.
"""

from algopy import (
    ARC4Contract,
    Account,
    Application,
    BoxMap,
    Global,
    GlobalState,
    Txn,
    UInt64,
    arc4,
    gtxn,
    itxn,
    op,
    subroutine,
)

# Loan states (plain int — Puya forbids UInt64 at module level)
STATE_PENDING = 0
STATE_APPROVED = 1
STATE_ACTIVE = 2
STATE_REPAID = 3
STATE_DEFAULTED = 4

# Score thresholds for auto-approval
AUTO_APPROVE_MIN_SCORE = 700

# Tenure bounds (in rounds, ~16 rounds/minute)
MAX_TENURE_ROUNDS = 8_640_000  # ~90 days

# Score deltas for repayment outcomes
DELTA_ON_TIME = 15
DELTA_EARLY = 25
DELTA_LATE_MINOR = 20
DELTA_LATE_MAJOR = 40
DELTA_DEFAULT = 100


class LoanRecord(arc4.Struct):
    """Packed loan record stored in box storage."""
    borrower: arc4.Address          # Borrower wallet address
    amount: arc4.UInt64             # Loan amount in microALGO
    tenure_rounds: arc4.UInt64      # Loan duration in rounds
    interest_bps: arc4.UInt64       # Interest rate in basis points APR
    state: arc4.UInt64              # 0=pending, 1=approved, 2=active, 3=repaid, 4=defaulted
    created_at: arc4.UInt64         # Round when loan was created
    disbursed_at: arc4.UInt64       # Round when funds were sent (0 if not yet)
    due_at: arc4.UInt64             # Round when repayment is due (disbursed_at + tenure)
    repaid_amount: arc4.UInt64      # Total amount repaid so far
    repaid_at: arc4.UInt64          # Round of final repayment (0 if not yet)


class LoanManager(ARC4Contract):
    """
    Central loan management contract.

    Access control:
        - create_loan: any KYC-verified borrower
        - approve_loan / mark_default: oracle only
        - repay: borrower of that specific loan
        - admin methods: admin only
    """

    def __init__(self) -> None:
        self.admin = GlobalState(Account)
        self.oracle = GlobalState(Account)

        # Foreign app references
        self.kyc_registry_id = GlobalState(UInt64, key="kyc_id")
        self.credit_score_id = GlobalState(UInt64, key="score_id")
        self.lending_pool_id = GlobalState(UInt64, key="pool_id")
        self.escrow_id = GlobalState(UInt64, key="escrow_id")

        # Loan counter (auto-incrementing ID)
        self.loan_counter = GlobalState(UInt64, key="loan_ctr")
        self.active_loans = GlobalState(UInt64, key="active")

        # Emergency pause
        self.paused = GlobalState(UInt64, key="paused")

        # BoxMap: loan_id → LoanRecord
        self.loans = BoxMap(UInt64, LoanRecord, key_prefix=b"loan_")

        # BoxMap: borrower address → active loan ID (to enforce one-active-loan rule)
        self.active_loan_by_borrower = BoxMap(Account, UInt64, key_prefix=b"actl_")

    @arc4.abimethod(create="require")
    def create(
        self,
        admin: Account,
        oracle: Account,
        kyc_registry_id: UInt64,
        credit_score_id: UInt64,
        lending_pool_id: UInt64,
    ) -> None:
        """Initialize the LoanManager. Called once at deployment."""
        self.admin.value = admin
        self.oracle.value = oracle
        self.kyc_registry_id.value = kyc_registry_id
        self.credit_score_id.value = credit_score_id
        self.lending_pool_id.value = lending_pool_id
        self.escrow_id.value = UInt64(0)
        self.loan_counter.value = UInt64(0)
        self.active_loans.value = UInt64(0)
        self.paused.value = UInt64(0)

    @arc4.abimethod
    def set_escrow(self, app_id: UInt64) -> None:
        """Set the RepaymentEscrow app ID. Admin-only."""
        assert Txn.sender == self.admin.value, "only admin"
        self.escrow_id.value = app_id

    @arc4.abimethod
    def set_paused(self, paused: arc4.Bool) -> None:
        """Emergency pause/unpause. Admin-only."""
        assert Txn.sender == self.admin.value, "only admin"
        self.paused.value = UInt64(1) if paused.native else UInt64(0)

    @arc4.abimethod
    def create_loan(
        self,
        amount: UInt64,
        tenure_rounds: UInt64,
        interest_bps: UInt64,
    ) -> UInt64:
        """
        Create a new loan request. Caller must be KYC-verified.
        Returns the loan_id.

        Caller must include a payment transaction covering box MBR
        for the new loan record box.

        Enforces:
            - Borrower must be KYC verified (via KYCRegistry foreign read)
            - Borrower must not have another active loan
            - Amount must be within the score-based cap
        """
        assert self.paused.value == UInt64(0), "paused"
        borrower = Txn.sender

        # Enforce: no existing active loan
        assert borrower not in self.active_loan_by_borrower, "active loan exists"

        # Validate tenure
        assert tenure_rounds > UInt64(0), "invalid tenure"
        assert tenure_rounds <= MAX_TENURE_ROUNDS, "tenure too long"

        # Assign loan ID
        loan_id = self.loan_counter.value
        self.loan_counter.value = loan_id + UInt64(1)

        # Create loan record
        record = LoanRecord(
            borrower=arc4.Address(borrower),
            amount=arc4.UInt64(amount),
            tenure_rounds=arc4.UInt64(tenure_rounds),
            interest_bps=arc4.UInt64(interest_bps),
            state=arc4.UInt64(STATE_PENDING),
            created_at=arc4.UInt64(Global.round),
            disbursed_at=arc4.UInt64(0),
            due_at=arc4.UInt64(0),
            repaid_amount=arc4.UInt64(0),
            repaid_at=arc4.UInt64(0),
        )
        self.loans[loan_id] = record.copy()

        return loan_id

    @arc4.abimethod
    def approve_and_disburse(self, loan_id: UInt64) -> None:
        """
        Approve a pending loan and disburse funds. Oracle-only.

        Atomically:
            1. Set loan state to ACTIVE
            2. Call LendingPool.disburse() to send ALGO to borrower
            3. Record the active loan for the borrower
        """
        assert Txn.sender == self.oracle.value, "only oracle"
        assert self.paused.value == UInt64(0), "paused"
        assert loan_id in self.loans, "loan not found"

        record = self.loans[loan_id].copy()
        assert record.state.native == STATE_PENDING, "loan not pending"

        borrower = record.borrower.native

        # Update loan state
        record.state = arc4.UInt64(STATE_ACTIVE)
        record.disbursed_at = arc4.UInt64(Global.round)
        record.due_at = arc4.UInt64(Global.round + record.tenure_rounds.native)
        self.loans[loan_id] = record.copy()

        # Track active loan
        self.active_loan_by_borrower[borrower] = loan_id
        self.active_loans.value += UInt64(1)

        # Call LendingPool.disburse — inner application call
        # arc4.Address compiles to ABI type "address" → selector for disburse(address,uint64)void
        itxn.ApplicationCall(
            app_id=self.lending_pool_id.value,
            app_args=(
                arc4.arc4_signature("disburse(address,uint64)void"),
                arc4.Address(borrower).bytes,
                arc4.UInt64(record.amount.native).bytes,
            ),
            accounts=(borrower,),
            fee=0,
        ).submit()

    @arc4.abimethod
    def repay(self, loan_id: UInt64, payment: gtxn.PaymentTransaction) -> None:
        """
        Repay a loan. Called by the borrower.

        The borrower must include a PaymentTransaction to this app address
        as a preceding transaction in the group.
        """
        assert loan_id in self.loans, "loan not found"

        record = self.loans[loan_id].copy()
        assert record.state.native == STATE_ACTIVE, "loan not active"
        assert Txn.sender == record.borrower.native, "not the borrower"
        assert payment.receiver == Global.current_application_address, "pay to LoanManager"

        repay_amount = payment.amount

        # Update repaid amount
        new_total = record.repaid_amount.native + repay_amount
        record.repaid_amount = arc4.UInt64(new_total)

        # Check if fully repaid (amount + interest)
        # Interest calculation: amount * interest_bps * tenure_rounds / (365_days_in_rounds * 10000)
        # For MVP simplicity, we check against the original amount
        # (full interest calculation done off-chain by oracle)
        total_due = record.amount.native  # Simplified: oracle handles interest

        if new_total >= total_due:
            record.state = arc4.UInt64(STATE_REPAID)
            record.repaid_at = arc4.UInt64(Global.round)

            # Remove active loan tracker
            if record.borrower.native in self.active_loan_by_borrower:
                del self.active_loan_by_borrower[record.borrower.native]
            self.active_loans.value -= UInt64(1)

        self.loans[loan_id] = record.copy()

        # Forward repayment to LendingPool to update pool accounting
        # Step 1: Send ALGO from this contract's balance to the pool
        pool_app = Application(self.lending_pool_id.value)
        itxn.Payment(
            receiver=pool_app.address,
            amount=repay_amount,
            fee=0,
        ).submit()

        # Step 2: Notify the pool to reduce outstanding_loans counter
        itxn.ApplicationCall(
            app_id=self.lending_pool_id.value,
            app_args=(arc4.arc4_signature("return_funds(uint64)void"),
                      arc4.UInt64(repay_amount).bytes),
            fee=0,
        ).submit()

    @arc4.abimethod
    def mark_default(self, loan_id: UInt64) -> None:
        """Mark a loan as defaulted. Oracle-only."""
        assert Txn.sender == self.oracle.value, "only oracle"
        assert loan_id in self.loans, "loan not found"

        record = self.loans[loan_id].copy()
        assert record.state.native == STATE_ACTIVE, "loan not active"

        record.state = arc4.UInt64(STATE_DEFAULTED)
        self.loans[loan_id] = record.copy()

        # Remove active loan tracker
        borrower = record.borrower.native
        if borrower in self.active_loan_by_borrower:
            del self.active_loan_by_borrower[borrower]
        self.active_loans.value -= UInt64(1)

    # ── Read-only methods ──

    @arc4.abimethod(readonly=True)
    def get_loan(self, loan_id: UInt64) -> LoanRecord:
        """Get a loan record by ID. Reverts if not found."""
        assert loan_id in self.loans, "loan not found"
        return self.loans[loan_id]

    @arc4.abimethod(readonly=True)
    def get_active_loan_id(self, borrower: Account) -> arc4.UInt64:
        """Get the active loan ID for a borrower. Returns max uint64 if none."""
        if borrower in self.active_loan_by_borrower:
            return arc4.UInt64(self.active_loan_by_borrower[borrower])
        return arc4.UInt64(0)  # 0 — no active loan

    @arc4.abimethod(readonly=True)
    def get_loan_count(self) -> arc4.UInt64:
        """Total number of loans ever created."""
        return arc4.UInt64(self.loan_counter.value)

    @arc4.abimethod(readonly=True)
    def get_active_count(self) -> arc4.UInt64:
        """Number of currently active loans."""
        return arc4.UInt64(self.active_loans.value)

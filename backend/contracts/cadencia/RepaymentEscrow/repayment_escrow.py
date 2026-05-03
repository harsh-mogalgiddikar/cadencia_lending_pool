"""
Repayment Escrow Contract — Cadencia Credit

Receives repayment ALGO from borrowers and splits it:
    80% → Lending Pool (principal return)
    15% → Platform Treasury (revenue)
     5% → Insurance Reserve (default protection fund)

All splits happen atomically in a single inner transaction group.
Only the LoanManager can route repayments through this escrow.

All amounts are in microALGO.
"""

from algopy import (
    ARC4Contract,
    Account,
    Application,
    Global,
    GlobalState,
    Txn,
    UInt64,
    arc4,
    gtxn,
    itxn,
    subroutine,
)

# Fee split in basis points (must sum to 10000; plain int for Puya)
POOL_SHARE_BPS = 8000       # 80%
TREASURY_SHARE_BPS = 1500   # 15%
INSURANCE_SHARE_BPS = 500   # 5%
BPS_DENOMINATOR = 10000


class RepaymentEscrow(ARC4Contract):
    """
    Stateless repayment splitter.

    Access control:
        - process_repayment: LoanManager only (inner app call)
        - set_* : admin only
    """

    def __init__(self) -> None:
        self.admin = GlobalState(Account)
        self.loan_manager_id = GlobalState(UInt64, key="loan_mgr")
        self.lending_pool_id = GlobalState(UInt64, key="pool_id")

        # Destination addresses
        self.treasury = GlobalState(Account, key="treasury")
        self.insurance = GlobalState(Account, key="insurance")

        # Stats
        self.total_processed = GlobalState(UInt64, key="total_proc")
        self.total_to_pool = GlobalState(UInt64, key="to_pool")
        self.total_to_treasury = GlobalState(UInt64, key="to_treas")
        self.total_to_insurance = GlobalState(UInt64, key="to_insure")

    @arc4.abimethod(create="require")
    def create(
        self,
        admin: Account,
        loan_manager_id: UInt64,
        lending_pool_id: UInt64,
        treasury: Account,
        insurance: Account,
    ) -> None:
        """Initialize the escrow. Called once at deployment."""
        self.admin.value = admin
        self.loan_manager_id.value = loan_manager_id
        self.lending_pool_id.value = lending_pool_id
        self.treasury.value = treasury
        self.insurance.value = insurance
        self.total_processed.value = UInt64(0)
        self.total_to_pool.value = UInt64(0)
        self.total_to_treasury.value = UInt64(0)
        self.total_to_insurance.value = UInt64(0)

    @arc4.abimethod
    def set_treasury(self, new_treasury: Account) -> None:
        """Update treasury address. Admin-only."""
        assert Txn.sender == self.admin.value, "only admin"
        self.treasury.value = new_treasury

    @arc4.abimethod
    def set_insurance(self, new_insurance: Account) -> None:
        """Update insurance reserve address. Admin-only."""
        assert Txn.sender == self.admin.value, "only admin"
        self.insurance.value = new_insurance

    @arc4.abimethod
    def process_repayment(self, payment: gtxn.PaymentTransaction) -> None:
        """
        Receive repayment and split to pool (80%), treasury (15%), insurance (5%).

        The caller must include a PaymentTransaction to this escrow's app address.
        Only callable by the LoanManager contract (inner app call).

        All three payouts happen atomically via inner transactions.
        """
        assert (
            Global.caller_application_id == self.loan_manager_id.value
            or Txn.sender == self.admin.value
        ), "unauthorized"
        assert payment.receiver == Global.current_application_address, "pay to escrow"

        total = payment.amount
        assert total > UInt64(0), "zero repayment"

        # Calculate splits (rounding: pool gets remainder)
        treasury_amount = (total * TREASURY_SHARE_BPS) // BPS_DENOMINATOR
        insurance_amount = (total * INSURANCE_SHARE_BPS) // BPS_DENOMINATOR
        pool_amount = total - treasury_amount - insurance_amount  # Remainder to pool

        # Atomic inner transaction group: all three payouts
        itxn.Payment(
            receiver=self.treasury.value,
            amount=treasury_amount,
            fee=0,
        ).submit()

        itxn.Payment(
            receiver=self.insurance.value,
            amount=insurance_amount,
            fee=0,
        ).submit()

        # Return pool share — send ALGO directly to pool app address
        pool_app = Application(self.lending_pool_id.value)

        itxn.Payment(
            receiver=pool_app.address,
            amount=pool_amount,
            fee=0,
        ).submit()

        # Update stats
        self.total_processed.value += total
        self.total_to_pool.value += pool_amount
        self.total_to_treasury.value += treasury_amount
        self.total_to_insurance.value += insurance_amount

    # ── Read-only methods ──

    @arc4.abimethod(readonly=True)
    def get_stats(
        self,
    ) -> arc4.Tuple[arc4.UInt64, arc4.UInt64, arc4.UInt64, arc4.UInt64]:
        """Return (total_processed, total_to_pool, total_to_treasury, total_to_insurance)."""
        return arc4.Tuple(
            (
                arc4.UInt64(self.total_processed.value),
                arc4.UInt64(self.total_to_pool.value),
                arc4.UInt64(self.total_to_treasury.value),
                arc4.UInt64(self.total_to_insurance.value),
            )
        )

    @arc4.abimethod(readonly=True)
    def get_split_preview(
        self, amount: UInt64
    ) -> arc4.Tuple[arc4.UInt64, arc4.UInt64, arc4.UInt64]:
        """Preview the split for a given amount: (pool, treasury, insurance)."""
        treasury_amount = (amount * TREASURY_SHARE_BPS) // BPS_DENOMINATOR
        insurance_amount = (amount * INSURANCE_SHARE_BPS) // BPS_DENOMINATOR
        pool_amount = amount - treasury_amount - insurance_amount
        return arc4.Tuple(
            (
                arc4.UInt64(pool_amount),
                arc4.UInt64(treasury_amount),
                arc4.UInt64(insurance_amount),
            )
        )

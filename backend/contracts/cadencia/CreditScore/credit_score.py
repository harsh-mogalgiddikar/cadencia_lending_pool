"""
Credit Score Contract — Cadencia Credit

On-chain credit scoring for borrowers. Scores are stored in box storage
(no opt-in required from borrowers).

Score range: 300–900, initialized at 600.
Only the oracle or authorized app IDs (e.g., LoanManager) can mutate scores.

Delta rules:
    +25  early repayment
    +15  on-time repayment
    -20  late (≤7 days)
    -40  late (>7 days)
    -100 default
    +10  Cadencia trade history (Phase 2, stubbed)
"""

from algopy import (
    ARC4Contract,
    Account,
    BoxMap,
    Global,
    GlobalState,
    Txn,
    UInt64,
    arc4,
    op,
    subroutine,
)

# Score boundaries (plain int — UInt64 not allowed at module level in Puya)
SCORE_MIN = 300
SCORE_MAX = 900
SCORE_INITIAL = 600

# Score delta constants
DELTA_ON_TIME = 15
DELTA_EARLY = 25
DELTA_LATE_7 = 20
DELTA_LATE_7_PLUS = 40
DELTA_DEFAULT = 100
DELTA_CADENCIA_TRADE = 10


class ScoreRecord(arc4.Struct):
    """Packed credit score record stored per borrower address."""
    score: arc4.UInt64              # Current score (300–900)
    total_loans: arc4.UInt64        # Lifetime loan count
    successful_repayments: arc4.UInt64
    defaults: arc4.UInt64
    last_updated: arc4.UInt64       # Round number of last score change
    initialized_at: arc4.UInt64     # Round number of score creation


class CreditScore(ARC4Contract):
    """
    On-chain credit score registry.

    Access control:
        - initialize_score / update_score / increment_loans: oracle + authorized apps
        - get_score / get_record: anyone (read-only)
    """

    def __init__(self) -> None:
        self.admin = GlobalState(Account)
        self.oracle = GlobalState(Account)
        # Authorized app IDs that can call mutating methods (e.g., LoanManager)
        self.authorized_app = GlobalState(UInt64, key="auth_app")
        self.total_borrowers = GlobalState(UInt64, key="total_borrowers")

        # BoxMap: borrower address → ScoreRecord
        self.scores = BoxMap(Account, ScoreRecord, key_prefix=b"score_")

    @arc4.abimethod(create="require")
    def create(self, admin: Account, oracle: Account) -> None:
        """Initialize the contract. Called once at deployment."""
        self.admin.value = admin
        self.oracle.value = oracle
        self.authorized_app.value = UInt64(0)
        self.total_borrowers.value = UInt64(0)

    @arc4.abimethod
    def set_authorized_app(self, app_id: UInt64) -> None:
        """Set the authorized app ID (e.g., LoanManager). Admin-only."""
        assert Txn.sender == self.admin.value, "only admin"
        self.authorized_app.value = app_id

    @arc4.abimethod
    def set_oracle(self, new_oracle: Account) -> None:
        """Update the oracle address. Admin-only."""
        assert Txn.sender == self.admin.value, "only admin"
        self.oracle.value = new_oracle

    @arc4.abimethod
    def initialize_score(self, borrower: Account) -> None:
        """
        Create a new credit score box for a borrower. Oracle-only.
        Rejects if score already exists (no double-init).

        Caller must include a payment transaction covering box MBR.
        """
        self._assert_authorized()
        assert borrower not in self.scores, "score already initialized"

        record = ScoreRecord(
            score=arc4.UInt64(SCORE_INITIAL),
            total_loans=arc4.UInt64(0),
            successful_repayments=arc4.UInt64(0),
            defaults=arc4.UInt64(0),
            last_updated=arc4.UInt64(Global.round),
            initialized_at=arc4.UInt64(Global.round),
        )
        self.scores[borrower] = record.copy()
        self.total_borrowers.value += UInt64(1)

    @arc4.abimethod
    def increase_score(self, borrower: Account, delta: UInt64) -> None:
        """
        Increase a borrower's score by delta. Oracle/authorized app only.
        Score is clamped to SCORE_MAX (900).
        """
        self._assert_authorized()
        assert borrower in self.scores, "score not initialized"

        record = self.scores[borrower].copy()
        current = record.score.native
        new_score = current + delta

        # Clamp to max
        if new_score > UInt64(SCORE_MAX):
            new_score = UInt64(SCORE_MAX)

        record.score = arc4.UInt64(new_score)
        record.last_updated = arc4.UInt64(Global.round)
        self.scores[borrower] = record.copy()

    @arc4.abimethod
    def decrease_score(self, borrower: Account, delta: UInt64) -> None:
        """
        Decrease a borrower's score by delta. Oracle/authorized app only.
        Score is clamped to SCORE_MIN (300).
        """
        self._assert_authorized()
        assert borrower in self.scores, "score not initialized"

        record = self.scores[borrower].copy()
        current = record.score.native

        # Prevent underflow: if delta > current - SCORE_MIN, clamp to SCORE_MIN
        if delta >= current - UInt64(SCORE_MIN):
            new_score = UInt64(SCORE_MIN)
        else:
            new_score = current - delta

        record.score = arc4.UInt64(new_score)
        record.last_updated = arc4.UInt64(Global.round)
        self.scores[borrower] = record.copy()

    @arc4.abimethod
    def record_repayment(self, borrower: Account, is_successful: arc4.Bool) -> None:
        """
        Record a loan repayment outcome. Oracle/authorized app only.
        Increments successful_repayments or defaults counter.
        """
        self._assert_authorized()
        assert borrower in self.scores, "score not initialized"

        record = self.scores[borrower].copy()
        if is_successful.native:
            record.successful_repayments = arc4.UInt64(
                record.successful_repayments.native + UInt64(1)
            )
        else:
            record.defaults = arc4.UInt64(record.defaults.native + UInt64(1))

        record.last_updated = arc4.UInt64(Global.round)
        self.scores[borrower] = record.copy()

    @arc4.abimethod
    def increment_total_loans(self, borrower: Account) -> None:
        """Increment the total loans counter. Oracle/authorized app only."""
        self._assert_authorized()
        assert borrower in self.scores, "score not initialized"

        record = self.scores[borrower].copy()
        record.total_loans = arc4.UInt64(record.total_loans.native + UInt64(1))
        self.scores[borrower] = record.copy()

    # ── Read-only methods ──

    @arc4.abimethod(readonly=True)
    def get_score(self, borrower: Account) -> arc4.UInt64:
        """Get the current score for a borrower. Returns 0 if not initialized."""
        if borrower in self.scores:
            return self.scores[borrower].score
        return arc4.UInt64(0)

    @arc4.abimethod(readonly=True)
    def get_record(self, borrower: Account) -> ScoreRecord:
        """Get the full score record. Reverts if not initialized."""
        assert borrower in self.scores, "score not initialized"
        return self.scores[borrower]

    @arc4.abimethod(readonly=True)
    def has_score(self, borrower: Account) -> arc4.Bool:
        """Check if a borrower has an initialized score."""
        return arc4.Bool(borrower in self.scores)

    # ── Internal helpers ──

    @subroutine
    def _assert_authorized(self) -> None:
        """Check that the caller is the oracle or an authorized inner app call."""
        is_oracle = Txn.sender == self.oracle.value
        is_authorized_app = (
            Global.caller_application_id != UInt64(0)
            and Global.caller_application_id == self.authorized_app.value
        )
        assert is_oracle or is_authorized_app, "unauthorized"

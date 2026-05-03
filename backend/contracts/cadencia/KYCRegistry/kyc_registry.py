"""
KYC Registry Contract — Cadencia Credit

Manages KYC verification status for all platform participants.
Only the designated oracle wallet can write KYC records.

Storage: Box storage (BoxMap) keyed by wallet address.
    - No opt-in required from users.
    - Scales to unlimited addresses.

MVP: KYC is mocked — backend auto-approves immediately.
     This contract's interface is production-ready; only the oracle
     trigger path changes when a real KYC provider is integrated.
"""

import typing as t

from algopy import (
    ARC4Contract,
    Account,
    Bytes,
    BoxMap,
    Global,
    GlobalState,
    Txn,
    UInt64,
    arc4,
    op,
    subroutine,
)

# Role constants (plain int — UInt64 not allowed at module level in Puya)
ROLE_BORROWER = 1
ROLE_LENDER = 2
ROLE_BOTH = 3

# KYC tier constants
TIER_NONE = 0
TIER_BASIC = 1      # Mock KYC — name + GSTIN only
TIER_ENHANCED = 2   # Future: document-verified via Signzy/IDfy


# Type alias for 32-byte hash
Hash32: t.TypeAlias = arc4.StaticArray[arc4.Byte, t.Literal[32]]


class KYCRecord(arc4.Struct):
    """Packed KYC record stored in box storage per wallet address."""
    kyc_tier: arc4.UInt8        # 0=none, 1=basic (mock), 2=enhanced
    role: arc4.UInt8            # 1=borrower, 2=lender, 3=both
    verified_at: arc4.UInt64    # Round number when KYC was approved
    kyc_hash: Hash32            # SHA256 of KYC data (zero-filled for mock)


class KYCRegistry(ARC4Contract):
    """
    On-chain KYC status registry.

    Access control:
        - register / update_tier: oracle only
        - revoke: admin only
        - is_verified / get_record: anyone (read-only)
    """

    def __init__(self) -> None:
        # Admin address — can revoke KYC and update oracle address
        self.admin = GlobalState(Account)
        # Oracle address — the only account allowed to write KYC records
        self.oracle = GlobalState(Account)
        # Total number of verified accounts (for stats)
        self.total_verified = GlobalState(UInt64, key="total_verified")

        # BoxMap: wallet address → KYCRecord
        # Each box costs ~0.0025 ALGO MBR (2500 + 400 * box_size microALGO)
        self.records = BoxMap(Account, KYCRecord, key_prefix=b"kyc_")

    @arc4.abimethod(create="require")
    def create(self, admin: Account, oracle: Account) -> None:
        """Initialize the contract. Called once at deployment."""
        self.admin.value = admin
        self.oracle.value = oracle
        self.total_verified.value = UInt64(0)

    @arc4.abimethod
    def register(
        self,
        address: Account,
        role: arc4.UInt8,
        kyc_hash: Hash32,
    ) -> None:
        """
        Register or update a KYC record. Oracle-only.

        The caller must include a payment transaction covering the box MBR
        if this is a new registration (box doesn't exist yet).
        """
        assert Txn.sender == self.oracle.value, "only oracle can register"

        role_val = role.native
        assert role_val >= 1 and role_val <= 3, "invalid role"

        record = KYCRecord(
            kyc_tier=arc4.UInt8(1),  # TIER_BASIC for MVP
            role=role,
            verified_at=arc4.UInt64(Global.round),
            kyc_hash=kyc_hash.copy(),
        )

        is_new = address not in self.records
        self.records[address] = record.copy()

        if is_new:
            self.total_verified.value += UInt64(1)

    @arc4.abimethod
    def update_tier(self, address: Account, new_tier: arc4.UInt8) -> None:
        """Upgrade KYC tier (e.g., basic → enhanced). Oracle-only."""
        assert Txn.sender == self.oracle.value, "only oracle can update tier"
        assert address in self.records, "address not registered"

        record = self.records[address].copy()
        record.kyc_tier = new_tier
        self.records[address] = record.copy()

    @arc4.abimethod
    def revoke(self, address: Account) -> None:
        """Revoke KYC for an address. Admin-only."""
        assert Txn.sender == self.admin.value, "only admin can revoke"
        assert address in self.records, "address not registered"

        del self.records[address]
        self.total_verified.value -= UInt64(1)

    @arc4.abimethod
    def set_oracle(self, new_oracle: Account) -> None:
        """Update the oracle address. Admin-only."""
        assert Txn.sender == self.admin.value, "only admin can set oracle"
        self.oracle.value = new_oracle

    @arc4.abimethod(readonly=True)
    def is_verified(self, address: Account) -> arc4.Bool:
        """Check if an address has a valid KYC record."""
        return arc4.Bool(address in self.records)

    @arc4.abimethod(readonly=True)
    def get_record(self, address: Account) -> KYCRecord:
        """Get the full KYC record for an address. Reverts if not found."""
        assert address in self.records, "address not registered"
        return self.records[address]

    @arc4.abimethod(readonly=True)
    def get_role(self, address: Account) -> arc4.UInt8:
        """Get the role for an address. Returns 0 if not registered."""
        if address in self.records:
            return self.records[address].role
        return arc4.UInt8(0)

    @arc4.abimethod(readonly=True)
    def get_stats(self) -> arc4.UInt64:
        """Return the total number of verified accounts."""
        return arc4.UInt64(self.total_verified.value)

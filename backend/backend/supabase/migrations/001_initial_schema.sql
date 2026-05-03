-- ============================================
-- Cadencia CreditFlow — Supabase Schema
-- Run via: supabase db push  (or paste in Supabase SQL editor)
-- ============================================

-- ── Users table ──
-- Stores wallet-level identity, role, and KYC status.
-- Primary key is the Algorand wallet address (public, on-chain).
CREATE TABLE IF NOT EXISTS users (
  wallet_address  TEXT PRIMARY KEY,
  role            TEXT NOT NULL CHECK (role IN ('lender', 'borrower', 'both')),
  kyc_tier        INT DEFAULT 0,
  kyc_status      TEXT DEFAULT 'pending' CHECK (kyc_status IN ('pending', 'verified', 'rejected')),
  business_name   TEXT,
  gstin           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-update updated_at on row change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- ── Loan Applications table ──
-- Off-chain loan request tracking. Maps to on-chain LoanManager boxes.
CREATE TABLE IF NOT EXISTS loan_applications (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address  TEXT REFERENCES users(wallet_address) ON DELETE CASCADE,
  amount_algo     BIGINT NOT NULL,          -- in microALGO
  tenure_days     INT NOT NULL,
  interest_bps    INT DEFAULT 1000,         -- basis points APR
  purpose         TEXT,
  status          TEXT DEFAULT 'pending'
                  CHECK (status IN ('pending', 'approved', 'active', 'repaid', 'defaulted', 'rejected')),
  on_chain_loan_id BIGINT,                  -- LoanManager box key (set after on-chain creation)
  on_chain_app_id  BIGINT,                  -- deprecated: kept for backward compat
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TRIGGER loan_applications_updated_at
  BEFORE UPDATE ON loan_applications
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();

-- Index for fast borrower lookups
CREATE INDEX IF NOT EXISTS idx_loans_wallet ON loan_applications(wallet_address);
CREATE INDEX IF NOT EXISTS idx_loans_status ON loan_applications(status);

-- ── Deposits table (off-chain shadow of on-chain pool state) ──
-- Optional: used for faster dashboard queries without on-chain reads.
CREATE TABLE IF NOT EXISTS deposits (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  wallet_address  TEXT REFERENCES users(wallet_address) ON DELETE CASCADE,
  amount_algo     BIGINT NOT NULL,          -- in microALGO
  shares          BIGINT DEFAULT 0,
  tx_id           TEXT,                     -- Algorand transaction ID
  action          TEXT CHECK (action IN ('deposit', 'withdraw')),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deposits_wallet ON deposits(wallet_address);

-- ── Row Level Security ──
-- Enable RLS but allow service-role key full access (backend).
-- Frontend uses anon key and can only read their own data.

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE loan_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE deposits ENABLE ROW LEVEL SECURITY;

-- Service role bypasses RLS automatically.
-- Anon key policies (for frontend direct reads, if ever used):
CREATE POLICY "Users can read own data"
  ON users FOR SELECT
  USING (wallet_address = current_setting('request.jwt.claim.sub', true));

CREATE POLICY "Users can read own loans"
  ON loan_applications FOR SELECT
  USING (wallet_address = current_setting('request.jwt.claim.sub', true));

CREATE POLICY "Users can read own deposits"
  ON deposits FOR SELECT
  USING (wallet_address = current_setting('request.jwt.claim.sub', true));

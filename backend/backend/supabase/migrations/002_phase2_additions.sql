-- ============================================
-- Migration 002 — Phase 1 & 2 additions
-- Cadencia CreditFlow
-- Run via: supabase db push  OR paste in Supabase SQL editor
-- ============================================

-- ── Add rejection_reason to users ──
-- Stores why KYC was rejected so borrowers can see feedback.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS rejection_reason TEXT DEFAULT NULL;

-- ── Add disbursement_tx_id to loan_applications ──
-- Tracks the Algorand txId of the oracle disbursement payment.
ALTER TABLE loan_applications
  ADD COLUMN IF NOT EXISTS disbursement_tx_id TEXT DEFAULT NULL;

-- ── Add repayment_tx_id to loan_applications ──
-- Tracks the Algorand txId of the borrower's repayment transaction.
ALTER TABLE loan_applications
  ADD COLUMN IF NOT EXISTS repayment_tx_id TEXT DEFAULT NULL;

-- ── Update RLS: allow reading rejection_reason (already covered by existing policy) ──
-- No changes needed; existing "Users can read own data" policy covers new columns.

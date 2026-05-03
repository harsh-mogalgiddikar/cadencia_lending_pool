export type KycStatus = 'not_found' | 'pending' | 'verified' | 'rejected';
export type Role = 'borrower' | 'lender' | 'both';
export type LoanStatus = 'pending' | 'approved' | 'active' | 'repaid' | 'defaulted' | 'rejected';

export interface KycUser {
  wallet_address: string;
  role: Role;
  kyc_status: KycStatus;
  kyc_tier: 0 | 1;
  business_name?: string;
  gstin?: string;
  created_at: string;
}

export interface Loan {
  id: string;
  wallet_address: string;
  amount_algo: number;     // microALGO
  tenure_days: number;
  interest_bps: number;
  purpose?: string;
  status: LoanStatus;
  on_chain_loan_id?: number;
  created_at: string;
  updated_at: string;
}

export interface PoolStats {
  totalLiquidity: number;       // microALGO
  outstandingLoans: number;
  availableLiquidity: number;
  utilizationBps: number;
  totalShares: number;
  totalDepositors: number;
}

export interface ScoreData {
  score: number;
  totalLoans: number;
  successfulRepayments: number;
  defaults: number;
  initialized: boolean;
}

export const TENURE_RATES: Record<number, number> = {
  7: 800, 15: 900, 30: 1000, 60: 1100, 90: 1200,
};

/**
 * Mock backend layer for Cadencia. Mirrors Express endpoints described in the handoff doc.
 * Swap calls to real fetch(`${VITE_API_URL}/api/...`, { credentials: 'include' }) when ready.
 */
import type { KycUser, Loan, PoolStats, ScoreData, Role } from './types';
import { TENURE_RATES } from './types';

const STORE_KEY = 'cadencia.mock.v1';

interface Store {
  users: Record<string, KycUser>;
  loans: Loan[];
  scores: Record<string, ScoreData>;
  pool: PoolStats;
}

const seedAddr = (i: number) =>
  'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.repeat(2).slice(0, 52) + i;

const seed = (): Store => ({
  users: {
    [seedAddr(1)]: {
      wallet_address: seedAddr(1), role: 'borrower', kyc_status: 'pending',
      kyc_tier: 0, business_name: 'Aurora Coffee Roasters', gstin: '27AABCU9603R1ZM',
      created_at: new Date(Date.now() - 1000 * 60 * 6).toISOString(),
    },
    [seedAddr(2)]: {
      wallet_address: seedAddr(2), role: 'lender', kyc_status: 'pending',
      kyc_tier: 0, business_name: 'Helix Capital LLC',
      created_at: new Date(Date.now() - 1000 * 60 * 22).toISOString(),
    },
    [seedAddr(3)]: {
      wallet_address: seedAddr(3), role: 'both', kyc_status: 'verified',
      kyc_tier: 1, business_name: 'Mosaic Studios',
      created_at: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
    },
  },
  loans: [
    {
      id: 'l-001', wallet_address: seedAddr(3),
      amount_algo: 12_000_000, tenure_days: 30, interest_bps: 1000,
      purpose: 'inventory restock', status: 'pending',
      created_at: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
      updated_at: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    },
    {
      id: 'l-002', wallet_address: seedAddr(1),
      amount_algo: 5_500_000, tenure_days: 15, interest_bps: 900,
      purpose: 'short-term cashflow', status: 'pending',
      created_at: new Date(Date.now() - 1000 * 60 * 38).toISOString(),
      updated_at: new Date(Date.now() - 1000 * 60 * 38).toISOString(),
    },
  ],
  scores: {},
  pool: {
    totalLiquidity:    248_500_000_000,
    outstandingLoans:  101_400_000_000,
    availableLiquidity:147_100_000_000,
    utilizationBps: 4080,
    totalShares: 248_500_000_000,
    totalDepositors: 312,
  },
});

const load = (): Store => {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) { const s = seed(); save(s); return s; }
    return JSON.parse(raw);
  } catch { const s = seed(); save(s); return s; }
};
const save = (s: Store) => localStorage.setItem(STORE_KEY, JSON.stringify(s));
const delay = (ms = 320) => new Promise(r => setTimeout(r, ms));

export const mockApi = {
  // ---- AUTH ----
  async authMe(address: string | null) {
    await delay(120);
    if (!address) return { authenticated: false as const };
    return { authenticated: true as const, address, isAdmin: address.endsWith('1') || address === 'ADMIN' };
  },
  async logout() { await delay(80); return { ok: true }; },

  // ---- KYC ----
  async kycStatus(address: string): Promise<KycUser | { status: 'not_found' }> {
    await delay();
    const s = load();
    return s.users[address] ?? { status: 'not_found' as const };
  },
  async kycSubmit(address: string, body: { businessName: string; gstin?: string; role: Role }) {
    await delay(500);
    const s = load();
    s.users[address] = {
      wallet_address: address,
      role: body.role,
      kyc_status: 'pending',
      kyc_tier: 0,
      business_name: body.businessName,
      gstin: body.gstin,
      created_at: new Date().toISOString(),
    };
    save(s);
    // Mock auto-approval after 6s
    setTimeout(() => {
      const s2 = load();
      if (s2.users[address]?.kyc_status === 'pending') {
        s2.users[address].kyc_status = 'verified';
        s2.users[address].kyc_tier = 1;
        save(s2);
      }
    }, 6000);
    return { ok: true, status: 'pending' as const, user: s.users[address] };
  },
  async kycAdminPending() {
    await delay();
    const s = load();
    return { users: Object.values(s.users).filter(u => u.kyc_status === 'pending') };
  },
  async kycAdminApprove(address: string) {
    await delay(300);
    const s = load();
    if (s.users[address]) { s.users[address].kyc_status = 'verified'; s.users[address].kyc_tier = 1; save(s); }
    return { ok: true };
  },
  async kycAdminReject(address: string) {
    await delay(300);
    const s = load();
    if (s.users[address]) { s.users[address].kyc_status = 'rejected'; save(s); }
    return { ok: true };
  },

  // ---- LOANS ----
  async loansMy(address: string): Promise<{ loans: Loan[] }> {
    await delay();
    const s = load();
    return { loans: s.loans.filter(l => l.wallet_address === address).sort((a,b)=>b.created_at.localeCompare(a.created_at)) };
  },
  async loanApply(address: string, body: { amountAlgo: number; tenureDays: number; purpose?: string }) {
    await delay(500);
    const s = load();
    const user = s.users[address];
    if (!user || user.kyc_status !== 'verified') throw new Error('KYC verification required');
    if (user.role === 'lender') throw new Error('Only borrowers can apply');
    if (s.loans.some(l => l.wallet_address === address && ['pending','approved','active'].includes(l.status)))
      throw new Error('You already have an active or pending loan');
    const bps = TENURE_RATES[body.tenureDays] ?? 1000;
    const loan: Loan = {
      id: 'l-' + Math.random().toString(36).slice(2, 8),
      wallet_address: address,
      amount_algo: Math.round(body.amountAlgo * 1_000_000),
      tenure_days: body.tenureDays,
      interest_bps: bps,
      purpose: body.purpose,
      status: 'pending',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    s.loans.unshift(loan);
    save(s);
    return { ok: true, loan };
  },
  async loansAdminPending() {
    await delay();
    const s = load();
    return { loans: s.loans.filter(l => l.status === 'pending') };
  },
  async loanAdminApprove(id: string) {
    await delay(300);
    const s = load();
    const l = s.loans.find(x => x.id === id);
    if (l) { l.status = 'active'; l.on_chain_loan_id = Math.floor(Math.random()*1e6); l.updated_at = new Date().toISOString(); save(s); }
    return { ok: true };
  },
  async loanAdminReject(id: string) {
    await delay(300);
    const s = load();
    const l = s.loans.find(x => x.id === id);
    if (l) { l.status = 'rejected'; l.updated_at = new Date().toISOString(); save(s); }
    return { ok: true };
  },

  // ---- POOL ----
  async poolStats(): Promise<PoolStats> {
    await delay(200);
    const s = load();
    // tiny live drift
    s.pool.utilizationBps = Math.max(2500, Math.min(7800, s.pool.utilizationBps + (Math.random()*60-30)|0));
    save(s);
    return s.pool;
  },
  async poolScore(address: string): Promise<ScoreData> {
    await delay();
    const s = load();
    if (s.scores[address]) return s.scores[address];
    const user = s.users[address];
    const base = user?.kyc_status === 'verified' ? 720 : 480;
    const data: ScoreData = { score: base, totalLoans: 0, successfulRepayments: 0, defaults: 0, initialized: !!user };
    s.scores[address] = data; save(s);
    return data;
  },

  // ---- ON-CHAIN (simulated) ----
  async chainDeposit(address: string, amountAlgo: number) {
    await delay(900);
    const s = load();
    s.pool.totalLiquidity += Math.round(amountAlgo * 1_000_000);
    s.pool.availableLiquidity += Math.round(amountAlgo * 1_000_000);
    s.pool.totalDepositors += 1;
    save(s);
    return { txId: 'TX' + Math.random().toString(36).slice(2, 14).toUpperCase() };
  },
  async chainWithdraw(address: string, amountAlgo: number) {
    await delay(900);
    const s = load();
    const micro = Math.round(amountAlgo * 1_000_000);
    s.pool.totalLiquidity = Math.max(0, s.pool.totalLiquidity - micro);
    s.pool.availableLiquidity = Math.max(0, s.pool.availableLiquidity - micro);
    save(s);
    return { txId: 'TX' + Math.random().toString(36).slice(2, 14).toUpperCase() };
  },
  async chainRepay(address: string, loanId: string) {
    await delay(900);
    const s = load();
    const l = s.loans.find(x => x.id === loanId);
    if (l) { l.status = 'repaid'; l.updated_at = new Date().toISOString(); save(s); }
    const sc = s.scores[address] ?? { score: 720, totalLoans: 0, successfulRepayments: 0, defaults: 0, initialized: true };
    sc.totalLoans += 1; sc.successfulRepayments += 1; sc.score = Math.min(1000, sc.score + 50);
    s.scores[address] = sc; save(s);
    return { txId: 'TX' + Math.random().toString(36).slice(2, 14).toUpperCase() };
  },
};

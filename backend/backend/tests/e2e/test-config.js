/**
 * Cadencia CreditFlow — E2E Test Configuration
 *
 * Contains test wallet addresses/mnemonics and API settings.
 * NEVER commit real production mnemonics. These are testnet-only.
 */

'use strict';

const config = {
  // ── API ──
  apiBaseUrl: 'http://localhost:3001',

  // ── Lender Wallet (testnet) ──
  lender: {
    address: 'A2EGSHGIZMU7X6YRSLSC7GVDTXE6MAQCZODAWHWOVHLW6HCLOBJSTWLOFY',
    mnemonic: 'exotic minute runway eager trim develop trade talent bacon music rebuild shrimp oppose join key level eight fine bicycle seek faculty supreme speak above bracket',
    role: 'lender',
  },

  // ── Borrower Wallet (testnet) ──
  borrower: {
    address: 'L22MEYNJK47WT3WWLK2NX3PCS6SGTXZ2LHR43QRWGF2AAHTPIB46RND4GQ',
    mnemonic: 'accuse huge illegal tuition boat lemon wise creek chair spare bulk weekend wall virus sniff bamboo pair clump bonus cloud caution prefer pioneer ability rate',
    role: 'borrower',
  },

  // ── Admin — lender wallet doubles as admin for tests ──
  // ADMIN_ADDRESSES env var in .env must include lender address
  adminAddress: 'A2EGSHGIZMU7X6YRSLSC7GVDTXE6MAQCZODAWHWOVHLW6HCLOBJSTWLOFY',

  // ── Test Timeouts ──
  oracleJobTimeoutMs: 45000,   // Wait up to 45s for oracle to process a job
  pollIntervalMs: 2000,        // Poll DB status every 2s
  requestTimeoutMs: 10000,     // Per-request HTTP timeout

  // ── Test Loan Params ──
  loanAmountAlgo: 5,           // 5 ALGO
  loanTenureDays: 30,          // 30 day tenure
  loanPurpose: 'E2E Test Loan - Automated Testing',
};

module.exports = config;

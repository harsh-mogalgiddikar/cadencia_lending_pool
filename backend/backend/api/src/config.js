/**
 * Centralized configuration — loaded from environment variables.
 * Used by all 3 backend processes (api, oracle-worker, job-worker).
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });

const config = {
  // ── Algorand ──
  algorand: {
    network: process.env.ALGORAND_NETWORK || 'testnet',
    algodServer: process.env.ALGOD_SERVER || 'https://testnet-api.algonode.cloud',
    algodToken: process.env.ALGOD_TOKEN || '',
    algodPort: parseInt(process.env.ALGOD_PORT || '443'),
    indexerServer: process.env.INDEXER_SERVER || 'https://testnet-idx.algonode.cloud',
    indexerToken: process.env.INDEXER_TOKEN || '',
    indexerPort: parseInt(process.env.INDEXER_PORT || '443'),
  },

  // ── Oracle ──
  oracle: {
    mnemonic: process.env.ORACLE_MNEMONIC || '',
  },

  // ── Contract App IDs ──
  contracts: {
    kycRegistryAppId: parseInt(process.env.KYC_REGISTRY_APP_ID || '0'),
    creditScoreAppId: parseInt(process.env.CREDIT_SCORE_APP_ID || '0'),
    lendingPoolAppId: parseInt(process.env.LENDING_POOL_APP_ID || '0'),
    loanManagerAppId: parseInt(process.env.LOAN_MANAGER_APP_ID || '0'),
    repaymentEscrowAppId: parseInt(process.env.REPAYMENT_ESCROW_APP_ID || '0'),
  },

  // ── Supabase ──
  supabase: {
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
    serviceKey: process.env.SUPABASE_SERVICE_KEY || '',
  },

  // ── Redis ──
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
  },

  // ── Session ──
  session: {
    secret: (function () {
      const s = process.env.SESSION_SECRET;
      if (!s || s === 'dev-secret-change-me') {
        if (process.env.NODE_ENV !== 'test') {
          throw new Error(
            '[config] SESSION_SECRET is not set or is the insecure default. ' +
            'Set a strong random value in .env before starting the server.'
          );
        }
        return 'dev-secret-change-me';
      }
      return s;
    })(),
  },

  // ── Feature Flags ──
  flags: {
    mockKyc: process.env.MOCK_KYC === 'true',
  },

  // ── Server ──
  port: parseInt(process.env.PORT || '3001'),
  nodeEnv: process.env.NODE_ENV || 'development',
};

module.exports = config;

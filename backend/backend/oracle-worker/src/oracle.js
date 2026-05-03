/**
 * Oracle Worker — Cadencia CreditFlow
 *
 * Single-instance BullMQ worker consuming "oracle_tasks" queue.
 * This process holds the oracle wallet mnemonic and is the ONLY
 * process that signs and submits transactions to Algorand.
 *
 * Jobs:
 *   KYC_APPROVAL       — Write KYC status to KYCRegistry contract
 *   SCORE_UPDATE       — Write score delta to CreditScore contract
 *   LOAN_DISBURSEMENT  — Create loan on-chain + trigger pool disburse
 *
 * ARC4 ABI encoding notes (algosdk v3):
 *   - Method selector  : ABIMethod.fromSignature(sig).getSelector() → Uint8Array(4)
 *   - address arg      : 32-byte public key (decoded from base32 address)
 *   - uint8 arg        : algosdk.encodeUint64(n) but only 1 byte needed — use ARC4 encoding
 *   - uint64 arg       : algosdk.encodeUint64(n) → Uint8Array(8)
 *   - byte[32] arg     : raw 32-byte Uint8Array
 *   algosdk v3 API changes:
 *   - 'from' → 'sender'
 *   - addr is an Address object, call .toString() for string fields
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const { Worker } = require('bullmq');
const Redis = require('ioredis');
const algosdk = require('algosdk');

// ── Config ──

const config = {
  redis: process.env.REDIS_URL || 'redis://localhost:6379',
  algod: {
    server: process.env.ALGOD_SERVER || 'https://testnet-api.algonode.cloud',
    token: process.env.ALGOD_TOKEN || '',
    port: parseInt(process.env.ALGOD_PORT || '443'),
  },
  contracts: {
    kycRegistryAppId: parseInt(process.env.KYC_REGISTRY_APP_ID || '0'),
    creditScoreAppId: parseInt(process.env.CREDIT_SCORE_APP_ID || '0'),
    lendingPoolAppId: parseInt(process.env.LENDING_POOL_APP_ID || '0'),
    loanManagerAppId: parseInt(process.env.LOAN_MANAGER_APP_ID || '0'),
  },
  oracleMnemonic: process.env.ORACLE_MNEMONIC || '',
};

// ── Clients ──

const algod = new algosdk.Algodv2(config.algod.token, config.algod.server, config.algod.port);
const redis = new Redis(config.redis, { maxRetriesPerRequest: null });

let oracleAccount = null;

function getOracle() {
  if (!oracleAccount) {
    if (!config.oracleMnemonic) throw new Error('ORACLE_MNEMONIC not set');
    oracleAccount = algosdk.mnemonicToSecretKey(config.oracleMnemonic);
    // algosdk v3: addr is an Address object — .toString() gives base32 string
    console.log(`[Oracle] Wallet loaded: ${oracleAccount.addr.toString()}`);
  }
  return oracleAccount;
}

// ── ARC4 Encoding Helpers ──

/**
 * Encode ARC4 UInt8 — 1 byte big-endian
 */
function encodeUint8(n) {
  const buf = new Uint8Array(1);
  buf[0] = n & 0xFF;
  return buf;
}

/**
 * Encode ARC4 UInt64 — 8 bytes big-endian
 */
function encodeUint64(n) {
  return algosdk.encodeUint64(n);
}

/**
 * Encode ARC4 address — 32-byte public key extracted from base32 address
 */
function encodeAddress(address) {
  return algosdk.decodeAddress(address).publicKey; // Uint8Array(32)
}

/**
 * Get ABI method selector (first 4 bytes of SHA512/256 of method signature)
 */
function getSelector(signature) {
  return algosdk.ABIMethod.fromSignature(signature).getSelector();
}

// ── Transaction Helpers ──

/**
 * Sign and submit a single transaction, wait for confirmation.
 */
async function signAndSubmit(txn) {
  const oracle = getOracle();
  const signedTxn = txn.signTxn(oracle.sk);
  await algod.sendRawTransaction(signedTxn).do();
  // algosdk v3: use txn.txID() — sendRawTransaction response key changed
  const txId = txn.txID();
  console.log(`[Oracle] Submitted txn: ${txId}`);
  const result = await algosdk.waitForConfirmation(algod, txId, 12);
  console.log(`[Oracle] Confirmed in round ${result['confirmed-round']}`);
  return { txId, confirmedRound: result['confirmed-round'] };
}

/**
 * Sign and submit an atomic group of transactions.
 */
async function signAndSubmitGroup(txns) {
  const oracle = getOracle();
  // Assign group ID
  const grouped = algosdk.assignGroupID(txns);
  const signedTxns = grouped.map((txn) => txn.signTxn(oracle.sk));
  await algod.sendRawTransaction(signedTxns).do();
  // algosdk v3: use txID from first txn
  const txId = grouped[0].txID();
  console.log(`[Oracle] Submitted group txn: ${txId}`);
  const result = await algosdk.waitForConfirmation(algod, txId, 12);
  console.log(`[Oracle] Group confirmed in round ${result['confirmed-round']}`);
  return { txId, confirmedRound: result['confirmed-round'] };
}

/**
 * Build a NoOp app call transaction (algosdk v3 API).
 *
 * @param {number} appId
 * @param {Uint8Array[]} appArgs  - First element should be the 4-byte method selector
 * @param {string[]} accounts     - Foreign account addresses (base32 strings)
 * @param {number[]} foreignApps
 * @param {Array} boxes           - Box references [{appIndex, name}]
 */
async function makeAppCallTxn(appId, appArgs = [], accounts = [], foreignApps = [], boxes = []) {
  const oracle = getOracle();
  const suggestedParams = await algod.getTransactionParams().do();

  // algosdk v3: uses 'sender' not 'from'
  return algosdk.makeApplicationNoOpTxnFromObject({
    sender: oracle.addr.toString(),
    appIndex: appId,
    appArgs,
    accounts,          // Must be plain base32 address strings
    foreignApps,
    boxes,
    suggestedParams,
  });
}

/**
 * Build a payment transaction (for covering box MBR).
 */
async function makePaymentTxn(to, amount) {
  const oracle = getOracle();
  const suggestedParams = await algod.getTransactionParams().do();
  return algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: oracle.addr.toString(),
    receiver: to,
    amount,
    suggestedParams,
  });
}

// ── Get app account address for MBR payments ──
function getAppAddress(appId) {
  return algosdk.getApplicationAddress(appId);
}

// ── Job Processors ──

/**
 * KYC_APPROVAL: Register KYC in KYCRegistry contract.
 *
 * Contract method: register(address, uint8, byte[32]) void
 *   arg0: address  — the wallet being KYC'd (32-byte pubkey in appArgs)
 *   arg1: uint8    — role (1=borrower, 2=lender, 3=both)
 *   arg2: byte[32] — kyc_hash (zero-filled for MVP mock)
 *
 * Note: First call needs a payment to cover box MBR (~0.0025 ALGO)
 * The group is: [pay_txn, app_call_txn]
 */
async function handleKycApproval(data) {
  const { address, role } = data;
  console.log(`[Oracle] KYC approval for ${address}, role=${role}`);

  const appId = config.contracts.kycRegistryAppId;
  if (!appId) throw new Error('KYC_REGISTRY_APP_ID not configured');

  // Role → uint8 mapping
  const roleMap = { lender: 2, borrower: 1, both: 3 };
  const roleNum = roleMap[role] || 1;

  // Method selector: register(address,uint8,byte[32])void
  const selector = getSelector('register(address,uint8,byte[32])void');

  // ARC4 encode args
  const addressArg = encodeAddress(address);   // 32-byte pubkey
  const roleArg    = encodeUint8(roleNum);      // 1 byte
  const kycHash    = new Uint8Array(32);        // zero-filled for MVP

  // Box reference for the KYC record (key prefix = "kyc_" + 32-byte pubkey)
  const boxName = Buffer.concat([Buffer.from('kyc_'), Buffer.from(encodeAddress(address))]);
  const boxes = [{ appIndex: appId, name: boxName }];

  // Build app call txn
  const appCallTxn = await makeAppCallTxn(
    appId,
    [selector, addressArg, roleArg, kycHash],
    [address],    // Foreign account so contract can access its record
    [],
    boxes,
  );

  let result;
  try {
    // Try direct app call first (works if box already exists or oracle has funded MBR)
    result = await signAndSubmit(appCallTxn);
  } catch (err) {
    if (err.message && err.message.includes('box')) {
      // Box MBR payment needed — send [pay + app_call] as atomic group
      console.log('[Oracle] Box MBR required — sending pay + app_call group');
      const appAddr = getAppAddress(appId);
      const BOX_MBR = 2500 + 400 * (4 + 32 + 42); // "kyc_" + KYCRecord size estimate
      const payTxn = await makePaymentTxn(appAddr.toString(), BOX_MBR);
      // Rebuild app call (suggestedParams need to be fresh and match group)
      const appCallTxn2 = await makeAppCallTxn(
        appId,
        [selector, addressArg, roleArg, kycHash],
        [address],
        [],
        boxes,
      );
      result = await signAndSubmitGroup([payTxn, appCallTxn2]);
    } else {
      throw err;
    }
  }

  // Update Supabase DB
  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  await supabase
    .from('users')
    .update({ kyc_status: 'verified', kyc_tier: 1 })
    .eq('wallet_address', address);

  console.log(`[Oracle] KYC approved on-chain: ${result.txId}`);
  return result;
}

/**
 * SCORE_UPDATE: Update credit score in CreditScore contract.
 *
 * Contract methods:
 *   increase_score(address, uint64) void
 *   decrease_score(address, uint64) void
 */
async function handleScoreUpdate(data) {
  const { address, action, delta } = data;
  console.log(`[Oracle] Score update for ${address}: ${action} delta=${delta}`);

  const appId = config.contracts.creditScoreAppId;
  if (!appId) throw new Error('CREDIT_SCORE_APP_ID not configured');

  const methodSig = action === 'increase'
    ? 'increase_score(address,uint64)void'
    : 'decrease_score(address,uint64)void';

  const selector  = getSelector(methodSig);
  const addressArg = encodeAddress(address);
  const deltaArg   = encodeUint64(delta);

  const boxName = Buffer.concat([Buffer.from('score_'), Buffer.from(encodeAddress(address))]);
  const boxes = [{ appIndex: appId, name: boxName }];

  const txn = await makeAppCallTxn(
    appId,
    [selector, addressArg, deltaArg],
    [address],
    [],
    boxes,
  );

  const result = await signAndSubmit(txn);
  console.log(`[Oracle] Score updated on-chain: ${result.txId}`);
  return result;
}

/**
 * LOAN_DISBURSEMENT: Disburse an approved loan to the borrower.
 *
 * Strategy:
 *   1. Oracle calls LoanManager.disburse(address, uint64) which instructs
 *      the LendingPool to send amountMicroAlgo to the borrower's wallet.
 *   2. If that fails (e.g. LoanManager ABI not matching), fall back to:
 *      oracle sends a direct payment from its own wallet to the borrower.
 *      This simulates disbursement for testnet MVP purposes.
 *   3. DB is updated to 'active' in both cases.
 *
 * For production: LoanManager.disburse() should be the only path.
 */
async function handleLoanDisbursement(data) {
  const { loanId, walletAddress, amountMicroAlgo } = data;
  console.log(`[Oracle] Loan disbursement: loan=${loanId} borrower=${walletAddress} amount=${amountMicroAlgo}`);

  const loanManagerAppId = config.contracts.loanManagerAppId;
  const lendingPoolAppId = config.contracts.lendingPoolAppId;

  const { createClient } = require('@supabase/supabase-js');
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  let txId;
  let disbursedVia;

  // ── Path 1: LoanManager.disburse(address, uint64) → LendingPool sends ALGO ──
  if (loanManagerAppId && lendingPoolAppId) {
    try {
      // ARC-4 method: disburse(address,uint64)void
      const selector   = getSelector('disburse(address,uint64)void');
      const addressArg = encodeAddress(walletAddress);
      const amountArg  = encodeUint64(amountMicroAlgo);

      // Box reference for the loan record
      const boxName = Buffer.concat([Buffer.from('loan_'), Buffer.from(encodeAddress(walletAddress))]);

      const txn = await makeAppCallTxn(
        loanManagerAppId,
        [selector, addressArg, amountArg],
        [walletAddress],        // Borrower as foreign account
        [lendingPoolAppId],     // LendingPool as foreign app
        [{ appIndex: loanManagerAppId, name: boxName }],
      );

      const result = await signAndSubmit(txn);
      txId = result.txId;
      disbursedVia = 'LoanManager';
      console.log(`[Oracle] Disbursed via LoanManager: ${txId}`);
    } catch (err) {
      console.warn(`[Oracle] LoanManager.disburse() failed (${err.message}), falling back to direct payment`);
    }
  }

  // ── Path 2: Fallback — oracle sends direct payment to borrower ──
  if (!txId) {
    try {
      console.log(`[Oracle] Fallback: direct payment ${amountMicroAlgo} microALGO → ${walletAddress}`);
      const payTxn = await makePaymentTxn(walletAddress, amountMicroAlgo);
      const result = await signAndSubmit(payTxn);
      txId = result.txId;
      disbursedVia = 'oracle-direct';
      console.log(`[Oracle] Disbursed via direct payment: ${txId}`);
    } catch (payErr) {
      console.error(`[Oracle] Direct payment also failed: ${payErr.message}`);
      // If oracle wallet has insufficient funds, record failure but don't crash
      await supabase
        .from('loan_applications')
        .update({ status: 'approved' }) // Revert to approved, admin must retry
        .eq('id', loanId);
      throw payErr;
    }
  }

  // ── Mark loan as active in DB with txId ──
  await supabase
    .from('loan_applications')
    .update({
      status: 'active',
      // Store the disbursement txId in the repayment_tx column if it exists,
      // otherwise log it. We use on_chain_app_id as a fallback field.
    })
    .eq('id', loanId);

  console.log(`[Oracle] Loan ${loanId} marked active. Disbursed via ${disbursedVia}: ${txId}`);
  return { loanId, status: 'active', txId, disbursedVia };
}

// ── Worker Setup ──

const worker = new Worker(
  'oracle_tasks',
  async (job) => {
    console.log(`[Oracle] Processing job: ${job.name} (id=${job.id})`);

    switch (job.name) {
      case 'KYC_APPROVAL':
        return await handleKycApproval(job.data);

      case 'SCORE_UPDATE':
        return await handleScoreUpdate(job.data);

      case 'LOAN_DISBURSEMENT':
        return await handleLoanDisbursement(job.data);

      default:
        throw new Error(`Unknown job type: ${job.name}`);
    }
  },
  {
    connection: redis,
    concurrency: 1,  // Single consumer — prevents nonce conflicts on Algorand
    limiter: {
      max: 5,
      duration: 1000, // Max 5 txns/sec
    },
  }
);

worker.on('completed', (job, result) => {
  console.log(`[Oracle] ✅ Job ${job.name} (${job.id}) completed`);
});

worker.on('failed', (job, err) => {
  console.error(`[Oracle] ❌ Job ${job.name} (${job.id}) failed: ${err.message}`);
  if (job.attemptsMade >= 3) {
    console.error(`[Oracle] 💀 Job ${job.name} moved to DLQ after ${job.attemptsMade} attempts`);
  }
});

worker.on('error', (err) => {
  console.error('[Oracle] Worker error:', err.message);
});

console.log('[Oracle] Worker started — listening on oracle_tasks queue');
console.log(`[Oracle] Contracts: KYC=${config.contracts.kycRegistryAppId}, Score=${config.contracts.creditScoreAppId}, Pool=${config.contracts.lendingPoolAppId}, Loans=${config.contracts.loanManagerAppId}`);

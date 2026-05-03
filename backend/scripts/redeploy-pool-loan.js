/**
 * Redeploy ONLY LendingPool + LoanManager with the fixed disburse(address,uint64)void ABI.
 * Preserves existing KYCRegistry, CreditScore, RepaymentEscrow app IDs.
 *
 * Usage:  node scripts/redeploy-pool-loan.js
 */

'use strict';

const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');

const backendDir = path.resolve(__dirname, '../backend');
module.paths.unshift(path.join(backendDir, 'node_modules'));

const algosdk = require('algosdk');
require('dotenv').config({ path: path.resolve(backendDir, '.env') });

const algod      = new algosdk.Algodv2('', 'https://testnet-api.algonode.cloud', 443);
const deployer   = algosdk.mnemonicToSecretKey(process.env.ORACLE_MNEMONIC);
const deployAddr = deployer.addr.toString();

// ── Helpers ─────────────────────────────────────────────────────────────────

function methodSel(sig) {
  return crypto.createHash('sha512-256').update(sig).digest().slice(0, 4);
}
function encAddr(a) { return algosdk.decodeAddress(a).publicKey; }
function encU64(v)  {
  const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(v)); return new Uint8Array(b);
}

function readTeal(contract, file) {
  return fs.readFileSync(
    path.resolve(__dirname, `../contracts/cadencia/${contract}/${file}`), 'utf8'
  );
}
function readArc56(contract) {
  return JSON.parse(fs.readFileSync(
    path.resolve(__dirname, `../contracts/cadencia/${contract}/${contract}.arc56.json`), 'utf8'
  ));
}

async function compile(src) {
  const r = await algod.compile(Buffer.from(src)).do();
  return new Uint8Array(Buffer.from(r.result, 'base64'));
}

async function deployContract(name, methodSig, abiArgs) {
  console.log(`\n── Deploying ${name} ──`);
  const arc    = readArc56(name);
  const schema = arc.state.schema;
  const approval = await compile(readTeal(name, `${name}.approval.teal`));
  const clear    = await compile(readTeal(name, `${name}.clear.teal`));
  console.log(`  TEAL: ${approval.length}b approval | Schema: ${schema.global.ints}i ${schema.global.bytes}b`);

  const sp  = await algod.getTransactionParams().do();
  const txn = algosdk.makeApplicationCreateTxnFromObject({
    sender            : deployAddr,
    approvalProgram   : approval,
    clearProgram      : clear,
    numGlobalByteSlices: schema.global.bytes,
    numGlobalInts     : schema.global.ints,
    numLocalByteSlices: schema.local.bytes,
    numLocalInts      : schema.local.ints,
    suggestedParams   : sp,
    onComplete        : algosdk.OnApplicationComplete.NoOpOC,
    appArgs           : [methodSel(methodSig), ...abiArgs],
    extraPages        : approval.length > 2048 ? 1 : 0,
  });

  const signed = txn.signTxn(deployer.sk);
  const res    = await algod.sendRawTransaction(signed).do();
  const txId   = res.txid || txn.txID();
  const conf   = await algosdk.waitForConfirmation(algod, txId, 6);
  const appId  = Number(conf.applicationIndex);
  console.log(`  ✅ ${name} App ID: ${appId}  (txId: ${txId})`);
  return appId;
}

async function callMethod(appId, methodSig, abiArgs, accounts, foreignApps) {
  const sp  = await algod.getTransactionParams().do();
  const txn = algosdk.makeApplicationNoOpTxnFromObject({
    sender         : deployAddr,
    appIndex       : appId,
    appArgs        : [methodSel(methodSig), ...abiArgs],
    accounts       : accounts || [],
    foreignApps    : foreignApps || [],
    suggestedParams: sp,
  });
  const signed = txn.signTxn(deployer.sk);
  const res    = await algod.sendRawTransaction(signed).do();
  const txId   = res.txid || txn.txID();
  await algosdk.waitForConfirmation(algod, txId, 6);
  console.log(`  ✅ ${methodSig.split('(')[0]}() confirmed  (txId: ${txId})`);
}

function updateEnv(updates) {
  const envPath = path.resolve(backendDir, '.env');
  let content   = fs.readFileSync(envPath, 'utf8');
  for (const [key, val] of Object.entries(updates)) {
    if (new RegExp(`^${key}=`, 'm').test(content)) {
      content = content.replace(new RegExp(`^(${key}=).*$`, 'm'), `$1${val}`);
    } else {
      content += `\n${key}=${val}`;
    }
  }
  fs.writeFileSync(envPath, content);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('=== Cadencia — Partial Redeploy: LendingPool + LoanManager ===\n');

  const info = await algod.accountInformation(deployAddr).do();
  console.log(`Deployer : ${deployAddr}`);
  console.log(`Balance  : ${(Number(info.amount) / 1e6).toFixed(4)} ALGO`);

  // Read existing IDs from .env
  const KYC_ID    = Number(process.env.KYC_REGISTRY_APP_ID);
  const SCORE_ID  = Number(process.env.CREDIT_SCORE_APP_ID);
  const ESCROW_ID = Number(process.env.REPAYMENT_ESCROW_APP_ID);
  console.log(`\nPreserved: KYCRegistry=${KYC_ID}  CreditScore=${SCORE_ID}  Escrow=${ESCROW_ID}`);

  if (!KYC_ID || !SCORE_ID || !ESCROW_ID) {
    throw new Error('KYC_REGISTRY_APP_ID / CREDIT_SCORE_APP_ID / REPAYMENT_ESCROW_APP_ID missing from .env');
  }

  const pk = encAddr(deployAddr);

  // 1) Deploy fixed LendingPool
  const poolId = await deployContract(
    'LendingPool',
    'create(address,address)void',
    [pk, pk]
  );

  // 2) Deploy fixed LoanManager (wired to new pool + existing KYC/Score)
  const loanMgrId = await deployContract(
    'LoanManager',
    'create(address,address,uint64,uint64,uint64)void',
    [pk, pk, encU64(KYC_ID), encU64(SCORE_ID), encU64(poolId)]
  );

  // 3) Wire: LendingPool.set_loan_manager(loanMgrId)
  console.log('\n── Wiring contracts ──');
  await callMethod(poolId, 'set_loan_manager(uint64)void', [encU64(loanMgrId)]);

  // 4) Wire: LendingPool.set_escrow(escrowId) — preserve existing escrow
  await callMethod(poolId, 'set_escrow(uint64)void', [encU64(ESCROW_ID)]);

  // 5) Update .env with new IDs
  updateEnv({
    LENDING_POOL_APP_ID : poolId,
    LOAN_MANAGER_APP_ID : loanMgrId,
  });

  console.log('\n=== Redeploy Complete ===');
  console.log(`  LENDING_POOL_APP_ID  = ${poolId}`);
  console.log(`  LOAN_MANAGER_APP_ID  = ${loanMgrId}`);
  console.log('\n✅ .env updated. Old loans are on the previous contract (state is fresh).');
  console.log('   Run: node backend/tests/e2e/e2e.test.js\n');
}

main().catch(e => { console.error('\nFAIL:', e.message); process.exit(1); });

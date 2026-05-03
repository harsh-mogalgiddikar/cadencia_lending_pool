/**
 * Deploy all 5 Cadencia contracts to Algorand Testnet.
 * Reads schemas from ARC56 JSON and passes correct ABI create args.
 *
 * Usage: node scripts/deploy.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const backendDir = path.resolve(__dirname, '../backend');
module.paths.unshift(path.join(backendDir, 'node_modules'));

const algosdk = require('algosdk');
require('dotenv').config({ path: path.resolve(backendDir, '.env') });

const algod = new algosdk.Algodv2('', 'https://testnet-api.algonode.cloud', 443);
const oracle = algosdk.mnemonicToSecretKey(process.env.ORACLE_MNEMONIC);
const oracleAddr = oracle.addr.toString();

// ── Helpers ──

function methodSelector(sig) {
  return crypto.createHash('sha512-256').update(sig).digest().slice(0, 4);
}

function encAddr(a) { return algosdk.decodeAddress(a).publicKey; }

function encU64(v) {
  const b = Buffer.alloc(8);
  b.writeBigUInt64BE(BigInt(v));
  return new Uint8Array(b);
}

function readArc56(name) {
  return JSON.parse(fs.readFileSync(
    path.resolve(__dirname, `../contracts/cadencia/${name}/${name}.arc56.json`), 'utf8'
  ));
}

function readTeal(dir, file) {
  return fs.readFileSync(
    path.resolve(__dirname, `../contracts/cadencia/${dir}/${file}`), 'utf8'
  );
}

async function compile(src) {
  const r = await algod.compile(Buffer.from(src)).do();
  return new Uint8Array(Buffer.from(r.result, 'base64'));
}

async function deploy(name, methodSig, abiArgs) {
  console.log(`\n── ${name} ──`);

  const arc = readArc56(name);
  const schema = arc.state.schema;

  const approval = await compile(readTeal(name, `${name}.approval.teal`));
  const clear = await compile(readTeal(name, `${name}.clear.teal`));
  console.log(`  TEAL: ${approval.length}b approval, ${clear.length}b clear`);
  console.log(`  Schema: ${schema.global.ints}i ${schema.global.bytes}b`);

  const sp = await algod.getTransactionParams().do();
  const txn = algosdk.makeApplicationCreateTxnFromObject({
    sender: oracleAddr,
    approvalProgram: approval,
    clearProgram: clear,
    numGlobalByteSlices: schema.global.bytes,
    numGlobalInts: schema.global.ints,
    numLocalByteSlices: schema.local.bytes,
    numLocalInts: schema.local.ints,
    suggestedParams: sp,
    onComplete: algosdk.OnApplicationComplete.NoOpOC,
    appArgs: [methodSelector(methodSig), ...abiArgs],
    extraPages: approval.length > 2048 ? 1 : 0,
  });

  const signed = txn.signTxn(oracle.sk);
  const res = await algod.sendRawTransaction(signed).do();
  const txId = res.txid || txn.txID();
  console.log(`  TxID: ${txId}`);

  const conf = await algosdk.waitForConfirmation(algod, txId, 4);
  const appId = Number(conf.applicationIndex);
  console.log(`  ✅ App ID: ${appId}`);
  return appId;
}

function updateEnv(ids) {
  const p = path.resolve(backendDir, '.env');
  let c = fs.readFileSync(p, 'utf8');
  for (const [k, v] of Object.entries(ids)) {
    c = c.replace(new RegExp(`${k}=\\d+`), `${k}=${v}`);
  }
  fs.writeFileSync(p, c);
}

// ── Main ──

async function main() {
  console.log('=== Cadencia — Testnet Deploy ===\n');
  const info = await algod.accountInformation(oracleAddr).do();
  console.log(`Deployer: ${oracleAddr}`);
  console.log(`Balance:  ${Number(info.amount) / 1e6} ALGO`);

  const pk = encAddr(oracleAddr);
  const ids = {};

  // 1) KYCRegistry — create(address, address)
  ids.KYC_REGISTRY_APP_ID = await deploy(
    'KYCRegistry', 'create(address,address)void', [pk, pk]
  );

  // 2) CreditScore — create(address, address)
  ids.CREDIT_SCORE_APP_ID = await deploy(
    'CreditScore', 'create(address,address)void', [pk, pk]
  );

  // 3) LendingPool — create(address, address)
  ids.LENDING_POOL_APP_ID = await deploy(
    'LendingPool', 'create(address,address)void', [pk, pk]
  );

  // 4) LoanManager — create(address, address, kyc_id, score_id, pool_id)
  ids.LOAN_MANAGER_APP_ID = await deploy(
    'LoanManager', 'create(address,address,uint64,uint64,uint64)void',
    [pk, pk, encU64(ids.KYC_REGISTRY_APP_ID), encU64(ids.CREDIT_SCORE_APP_ID), encU64(ids.LENDING_POOL_APP_ID)]
  );

  // 5) RepaymentEscrow — create(address, loan_mgr_id, pool_id, treasury, insurance)
  ids.REPAYMENT_ESCROW_APP_ID = await deploy(
    'RepaymentEscrow', 'create(address,uint64,uint64,address,address)void',
    [pk, encU64(ids.LOAN_MANAGER_APP_ID), encU64(ids.LENDING_POOL_APP_ID), pk, pk]
  );

  updateEnv(ids);
  console.log('\n=== Done ===');
  for (const [k, v] of Object.entries(ids)) console.log(`  ${k} = ${v}`);
  console.log('\n✅ .env updated. All contracts live on testnet! 🚀');
}

main().catch(e => { console.error('FAIL:', e.message); process.exit(1); });

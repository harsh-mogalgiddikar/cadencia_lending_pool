/**
 * Algorand client factory — creates algod and indexer clients
 * for the configured network (testnet by default).
 */

const algosdk = require('algosdk');
const config = require('./config');

function createAlgodClient() {
  return new algosdk.Algodv2(
    config.algorand.algodToken,
    config.algorand.algodServer,
    config.algorand.algodPort
  );
}

function createIndexerClient() {
  return new algosdk.Indexer(
    config.algorand.indexerToken,
    config.algorand.indexerServer,
    config.algorand.indexerPort
  );
}

/**
 * Get oracle account from mnemonic.
 * This account is used ONLY by the oracle-worker process.
 */
function getOracleAccount() {
  if (!config.oracle.mnemonic) {
    throw new Error('ORACLE_MNEMONIC not set');
  }
  return algosdk.mnemonicToSecretKey(config.oracle.mnemonic);
}

module.exports = {
  createAlgodClient,
  createIndexerClient,
  getOracleAccount,
};

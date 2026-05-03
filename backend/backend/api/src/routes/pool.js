/**
 * Pool Routes — Cadencia CreditFlow
 *
 * GET  /api/pool/stats              — Public: TVL, utilization, APY
 * GET  /api/pool/score/:address     — On-chain credit score (box storage)
 * POST /api/pool/deposit            — Build unsigned deposit txn for Pera signing
 * POST /api/pool/deposit/submit     — Submit signed deposit txn + record to DB
 * POST /api/pool/withdraw           — Build unsigned withdraw app call for Pera signing
 * POST /api/pool/withdraw/submit    — Submit signed withdraw txn + record to DB
 * GET  /api/pool/my-position        — Authenticated: lender's deposit history
 */

const express = require('express');
const algosdk = require('algosdk');
const { createAlgodClient } = require('../algorand');
const config = require('../config');
const supabase = require('../supabase');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Encode a raw Transaction object to base64 msgpack (unsigned).
 * The frontend decodes this with algosdk.decodeUnsignedTransaction()
 * and passes it to peraWallet.signTransaction().
 */
function txnToBase64(txn) {
  return Buffer.from(algosdk.encodeUnsignedTransaction(txn)).toString('base64');
}


// ── GET /api/pool/stats ───────────────────────────────────────────────────────

/**
 * Public endpoint — returns pool statistics from on-chain global state.
 */
router.get('/stats', async (req, res) => {
  try {
    const appId = config.contracts.lendingPoolAppId;

    if (!appId || appId === 0) {
      return res.json({
        totalLiquidity: 0,
        outstandingLoans: 0,
        utilizationBps: 0,
        totalDepositors: 0,
        message: 'Pool not deployed yet',
      });
    }

    const algod = createAlgodClient();
    const appInfo = await algod.getApplicationByID(appId).do();
    const globalState = appInfo['params']['global-state'] || [];

    // Decode global state values
    const state = {};
    for (const kv of globalState) {
      const key = Buffer.from(kv.key, 'base64').toString();
      state[key] = kv.value.uint || 0;
    }

    const totalLiquidity = state['total_liq'] || 0;
    const outstandingLoans = state['out_loans'] || 0;
    const totalShares = state['total_shares'] || 0;
    const totalDepositors = state['depositors'] || 0;

    const utilizationBps = totalLiquidity > 0
      ? Math.floor((outstandingLoans * 10000) / totalLiquidity)
      : 0;

    res.json({
      totalLiquidity,
      outstandingLoans,
      availableLiquidity: totalLiquidity - outstandingLoans,
      utilizationBps,
      totalShares,
      totalDepositors,
    });
  } catch (err) {
    console.error('[Pool] Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch pool stats' });
  }
});

// ── GET /api/pool/score/:address ──────────────────────────────────────────────

/**
 * Read on-chain credit score from the CreditScore contract's box storage.
 */
router.get('/score/:address', async (req, res) => {
  try {
    const { address } = req.params;

    // Validate Algorand address format (58-char base32 with checksum)
    if (!algosdk.isValidAddress(address)) {
      return res.status(400).json({ error: 'Invalid Algorand address format' });
    }

    const appId = config.contracts.creditScoreAppId;
    if (!appId || appId === 0) {
      return res.json({ score: 0, message: 'CreditScore contract not deployed' });
    }

    const algod = createAlgodClient();

    // Box key: "score_" + 32-byte public key
    const publicKey = algosdk.decodeAddress(address).publicKey;
    const boxName = Buffer.concat([Buffer.from('score_'), publicKey]);

    try {
      const boxResponse = await algod.getApplicationBoxByName(appId, boxName).do();
      const boxValue = boxResponse.value;

      // Decode ScoreRecord struct (all UInt64, 6 fields × 8 bytes = 48 bytes)
      const score = Number(BigInt('0x' + Buffer.from(boxValue.slice(0, 8)).toString('hex')));
      const totalLoans = Number(BigInt('0x' + Buffer.from(boxValue.slice(8, 16)).toString('hex')));
      const successfulRepayments = Number(BigInt('0x' + Buffer.from(boxValue.slice(16, 24)).toString('hex')));
      const defaults = Number(BigInt('0x' + Buffer.from(boxValue.slice(24, 32)).toString('hex')));

      res.json({ score, totalLoans, successfulRepayments, defaults, initialized: true });
    } catch (boxErr) {
      // Box not found — score not initialized
      res.json({ score: 0, initialized: false });
    }
  } catch (err) {
    console.error('[Score] Error:', err);
    res.status(500).json({ error: 'Failed to fetch credit score' });
  }
});

// ── POST /api/pool/deposit ────────────────────────────────────────────────────

/**
 * Build an unsigned ALGO payment transaction from the lender's wallet
 * to the LendingPool app account. Returns base64-encoded msgpack for Pera signing.
 *
 * For ARC-4 pools, a deposit is typically:
 *   [pay: lender → pool_app_addr, app_call: deposit() on LendingPool]
 * For a simple payment-only pool (MVP), just a payment to the app address.
 *
 * The backend returns both transaction types and the frontend signs them atomically.
 */
router.post('/deposit', requireAuth, async (req, res) => {
  try {
    const senderAddress = req.session.address;
    const { amountAlgo } = req.body;

    if (!amountAlgo || isNaN(Number(amountAlgo)) || Number(amountAlgo) <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    if (Number(amountAlgo) < 0.001 || Number(amountAlgo) > 100000) {
      return res.status(400).json({ error: 'Amount must be between 0.001 and 100,000 ALGO' });
    }

    const amountMicroAlgo = Math.floor(Number(amountAlgo) * 1_000_000);
    const appId = config.contracts.lendingPoolAppId;

    if (!appId || appId === 0) {
      return res.status(503).json({ error: 'Lending pool not deployed' });
    }

    const algod = createAlgodClient();
    const suggestedParams = await algod.getTransactionParams().do();
    const poolAppAddress = algosdk.getApplicationAddress(appId);

    // Transaction 1: Payment from lender → pool app address
    const payTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: senderAddress,
      receiver: poolAppAddress.toString(),
      amount: amountMicroAlgo,
      suggestedParams,
    });

    // Transaction 2: App call to deposit() method on LendingPool
    // ARC-4 method selector for deposit(pay)void
    const depositSelector = algosdk.ABIMethod.fromSignature('deposit(pay)void').getSelector();
    const appCallTxn = algosdk.makeApplicationNoOpTxnFromObject({
      sender: senderAddress,
      appIndex: appId,
      appArgs: [depositSelector],
      suggestedParams,
    });

    // Assign group ID — both txns must be signed together
    const grouped = algosdk.assignGroupID([payTxn, appCallTxn]);

    res.json({
      unsignedTxns: grouped.map(txnToBase64),
      amountMicroAlgo,
      poolAppAddress: poolAppAddress.toString(),
      appId,
    });
  } catch (err) {
    console.error('[Pool] Deposit build error:', err);
    res.status(500).json({ error: 'Failed to build deposit transaction' });
  }
});

// ── POST /api/pool/deposit/submit ─────────────────────────────────────────────

/**
 * Receive signed deposit transaction(s), submit to Algorand, record to DB.
 */
router.post('/deposit/submit', requireAuth, async (req, res) => {
  try {
    const address = req.session.address;
    const { signedTxns, amountMicroAlgo } = req.body;

    if (!signedTxns || !Array.isArray(signedTxns) || signedTxns.length === 0) {
      return res.status(400).json({ error: 'signedTxns array required' });
    }
    if (!amountMicroAlgo || amountMicroAlgo <= 0) {
      return res.status(400).json({ error: 'amountMicroAlgo required' });
    }

    const algod = createAlgodClient();

    // Concatenate all signed txn bytes (for atomic group submission)
    const allSignedBytes = signedTxns.map(b64 => new Uint8Array(Buffer.from(b64, 'base64')));
    await algod.sendRawTransaction(allSignedBytes).do();

    // Get txId from first signed txn
    const firstDecoded = algosdk.decodeSignedTransaction(allSignedBytes[0]);
    const txId = firstDecoded.txn.txID();

    // Wait for confirmation
    const result = await algosdk.waitForConfirmation(algod, txId, 12);
    const confirmedRound = result['confirmed-round'];

    // Write to deposits shadow table
    await supabase.from('deposits').insert({
      wallet_address: address,
      amount_algo: amountMicroAlgo,
      shares: 0, // LP shares will be read from chain; 0 is placeholder
      tx_id: txId,
      action: 'deposit',
    });

    console.log(`[Pool] Deposit confirmed: ${txId} (round ${confirmedRound})`);
    res.json({ ok: true, txId, confirmedRound });
  } catch (err) {
    console.error('[Pool] Deposit submit error:', err);
    // If Algorand submission failed, still return useful error
    const algoErr = err?.response?.body?.message || err.message;
    res.status(500).json({ error: `Transaction failed: ${algoErr}` });
  }
});

// ── POST /api/pool/withdraw ───────────────────────────────────────────────────

/**
 * Build an unsigned app call transaction to withdraw from the LendingPool.
 * ARC-4 method: withdraw(uint64)void — burns LP shares, returns ALGO.
 */
router.post('/withdraw', requireAuth, async (req, res) => {
  try {
    const senderAddress = req.session.address;
    const { amountAlgo } = req.body;

    if (!amountAlgo || isNaN(Number(amountAlgo)) || Number(amountAlgo) <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const amountMicroAlgo = Math.floor(Number(amountAlgo) * 1_000_000);
    const appId = config.contracts.lendingPoolAppId;

    if (!appId || appId === 0) {
      return res.status(503).json({ error: 'Lending pool not deployed' });
    }

    const algod = createAlgodClient();
    const suggestedParams = await algod.getTransactionParams().do();

    // ARC-4 method selector for withdraw(uint64)void
    const withdrawSelector = algosdk.ABIMethod.fromSignature('withdraw(uint64)void').getSelector();
    const amountArg = algosdk.encodeUint64(amountMicroAlgo);

    const appCallTxn = algosdk.makeApplicationNoOpTxnFromObject({
      sender: senderAddress,
      appIndex: appId,
      appArgs: [withdrawSelector, amountArg],
      suggestedParams,
    });

    res.json({
      unsignedTxns: [txnToBase64(appCallTxn)],
      amountMicroAlgo,
      appId,
    });
  } catch (err) {
    console.error('[Pool] Withdraw build error:', err);
    res.status(500).json({ error: 'Failed to build withdraw transaction' });
  }
});

// ── POST /api/pool/withdraw/submit ────────────────────────────────────────────

/**
 * Receive signed withdraw transaction, submit to Algorand, record to DB.
 */
router.post('/withdraw/submit', requireAuth, async (req, res) => {
  try {
    const address = req.session.address;
    const { signedTxns, amountMicroAlgo } = req.body;

    if (!signedTxns || !Array.isArray(signedTxns) || signedTxns.length === 0) {
      return res.status(400).json({ error: 'signedTxns array required' });
    }

    const algod = createAlgodClient();
    const allSignedBytes = signedTxns.map(b64 => new Uint8Array(Buffer.from(b64, 'base64')));
    await algod.sendRawTransaction(allSignedBytes).do();

    const firstDecoded = algosdk.decodeSignedTransaction(allSignedBytes[0]);
    const txId = firstDecoded.txn.txID();
    const result = await algosdk.waitForConfirmation(algod, txId, 12);
    const confirmedRound = result['confirmed-round'];

    // Record withdrawal in deposits table (negative action)
    await supabase.from('deposits').insert({
      wallet_address: address,
      amount_algo: amountMicroAlgo || 0,
      shares: 0,
      tx_id: txId,
      action: 'withdraw',
    });

    console.log(`[Pool] Withdrawal confirmed: ${txId} (round ${confirmedRound})`);
    res.json({ ok: true, txId, confirmedRound });
  } catch (err) {
    console.error('[Pool] Withdraw submit error:', err);
    const algoErr = err?.response?.body?.message || err.message;
    res.status(500).json({ error: `Transaction failed: ${algoErr}` });
  }
});

// ── GET /api/pool/my-position ─────────────────────────────────────────────────

/**
 * Return the authenticated lender's deposit history from the shadow table.
 */
router.get('/my-position', requireAuth, async (req, res) => {
  try {
    const address = req.session.address;

    const { data, error } = await supabase
      .from('deposits')
      .select('*')
      .eq('wallet_address', address)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch position' });
    }

    // Calculate net position (deposits - withdrawals)
    const netMicroAlgo = (data || []).reduce((acc, d) => {
      return acc + (d.action === 'deposit' ? d.amount_algo : -d.amount_algo);
    }, 0);

    res.json({
      deposits: data || [],
      netMicroAlgo,
      netAlgo: netMicroAlgo / 1_000_000,
    });
  } catch (err) {
    console.error('[Pool] My-position error:', err);
    res.status(500).json({ error: 'Failed to fetch position' });
  }
});

module.exports = router;

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
 * Public endpoint — returns pool statistics calculated from Supabase.
 * Since deposits go to the platform wallet (not the smart contract),
 * we track all figures in the deposits shadow table and loan_applications.
 */
router.get('/stats', async (req, res) => {
  try {
    // Total liquidity = net deposits (deposits - withdrawals) in microALGO
    const { data: depositRows } = await supabase
      .from('deposits')
      .select('amount_algo, action');

    const totalLiquidity = Math.max(0, (depositRows || []).reduce((acc, d) => {
      return acc + (d.action === 'deposit' ? d.amount_algo : -d.amount_algo);
    }, 0));

    // Outstanding loans = active/approved loans
    const { data: loanRows } = await supabase
      .from('loan_applications')
      .select('amount_algo')
      .in('status', ['active', 'approved']);

    const outstandingLoans = (loanRows || []).reduce((acc, l) => acc + l.amount_algo, 0);

    // Unique depositors
    const { data: depositorRows } = await supabase
      .from('deposits')
      .select('wallet_address')
      .eq('action', 'deposit');

    const totalDepositors = new Set((depositorRows || []).map(d => d.wallet_address)).size;

    const utilizationBps = totalLiquidity > 0
      ? Math.floor((outstandingLoans * 10000) / totalLiquidity)
      : 0;

    res.json({
      totalLiquidity,
      outstandingLoans,
      availableLiquidity: Math.max(0, totalLiquidity - outstandingLoans),
      utilizationBps,
      totalShares: 0,
      totalDepositors,
    });
  } catch (err) {
    console.error('[Pool] Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch pool stats' });
  }
});

// ── GET /api/pool/score/:address ──────────────────────────────────────────────

/**
 * Credit score — calculated from Supabase loan history.
 *
 * Formula:
 *   Base 700 (for any KYC-verified user)
 *   +50  per successful repayment
 *   -200 per default
 *   Clamped to [0, 1000]
 *
 * Falls back gracefully if user has no loan history.
 */
router.get('/score/:address', async (req, res) => {
  try {
    const { address } = req.params;

    if (!algosdk.isValidAddress(address)) {
      return res.status(400).json({ error: 'Invalid Algorand address format' });
    }

    // Fetch loan history from Supabase
    const { data: loans } = await supabase
      .from('loan_applications')
      .select('status')
      .eq('wallet_address', address);

    const totalLoans = (loans || []).length;
    const successfulRepayments = (loans || []).filter(l => l.status === 'repaid').length;
    const defaults = (loans || []).filter(l => l.status === 'defaulted').length;

    if (totalLoans === 0) {
      // No loan history — check if KYC verified to give base score
      const { data: user } = await supabase
        .from('users')
        .select('kyc_status')
        .eq('wallet_address', address)
        .single();

      if (!user || user.kyc_status !== 'verified') {
        return res.json({ score: 0, initialized: false, totalLoans: 0, successfulRepayments: 0, defaults: 0 });
      }
      // KYC verified, no loans yet — return base score
      return res.json({ score: 700, initialized: true, totalLoans: 0, successfulRepayments: 0, defaults: 0 });
    }

    // Score formula: 700 base + 50 per repayment - 200 per default, clamped to [0, 1000]
    const score = Math.max(0, Math.min(1000, 700 + (successfulRepayments * 50) - (defaults * 200)));

    console.log(`[Score] ${address}: score=${score} loans=${totalLoans} repaid=${successfulRepayments} defaults=${defaults}`);
    res.json({ score, initialized: true, totalLoans, successfulRepayments, defaults });
  } catch (err) {
    console.error('[Score] Error:', err);
    res.status(500).json({ error: 'Failed to fetch credit score' });
  }
});

// ── POST /api/pool/deposit ────────────────────────────────────────────────────

/**
 * Build a single unsigned ALGO payment from the lender directly to the
 * platform wallet (CFZRI425...). No smart contract call is needed — the
 * platform wallet is the same oracle wallet that disburses loans, so all
 * capital flows through one address.
 *
 * Returns a single base64-encoded msgpack for Pera to sign.
 */
router.post('/deposit', requireAuth, async (req, res) => {
  try {
    const senderAddress = req.session.address;
    const { amountAlgo } = req.body;

    if (!amountAlgo || isNaN(Number(amountAlgo)) || Number(amountAlgo) <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }
    if (Number(amountAlgo) < 1 || Number(amountAlgo) > 100000) {
      return res.status(400).json({ error: 'Amount must be between 1 and 100,000 ALGO' });
    }

    // Validate platform wallet is configured
    const platformWallet = config.platformWallet;
    if (!platformWallet) {
      console.error('[Pool] PLATFORM_WALLET is not set in .env');
      return res.status(503).json({ error: 'Platform wallet not configured — contact support' });
    }

    const amountMicroAlgo = Math.floor(Number(amountAlgo) * 1_000_000);

    const algod = createAlgodClient();
    const suggestedParams = await algod.getTransactionParams().do();

    // Single payment: lender → platform wallet (CFZRI425...)
    const payTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: senderAddress,
      receiver: platformWallet,
      amount: amountMicroAlgo,
      note: new TextEncoder().encode(`deposit:${senderAddress.slice(0, 8)}`),
      suggestedParams,
    });

    console.log(`[Pool] Deposit txn built: ${amountMicroAlgo} microALGO from ${senderAddress} → ${platformWallet}`);

    res.json({
      unsignedTxns: [txnToBase64(payTxn)],
      amountMicroAlgo,
      receiver: platformWallet,
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

    // Decode individual signed txns
    const allSignedBytes = signedTxns.map(b64 => new Uint8Array(Buffer.from(b64, 'base64')));

    // algosdk v3: sendRawTransaction requires a single concatenated Uint8Array for atomic groups
    const totalLength = allSignedBytes.reduce((sum, b) => sum + b.length, 0);
    const concatenated = new Uint8Array(totalLength);
    let offset = 0;
    for (const b of allSignedBytes) {
      concatenated.set(b, offset);
      offset += b.length;
    }
    await algod.sendRawTransaction(concatenated).do();

    // Get txId from first signed txn
    const firstDecoded = algosdk.decodeSignedTransaction(allSignedBytes[0]);
    const txId = firstDecoded.txn.txID();

    // Wait for confirmation
    const result = await algosdk.waitForConfirmation(algod, txId, 12);
    // algosdk v3 returns confirmed-round as BigInt — convert to Number for JSON serialization
    const confirmedRound = Number(result.confirmedRound ?? result['confirmed-round']);

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
 * Withdrawal — oracle wallet (platform wallet) sends ALGO directly to the user.
 *
 * No Pera signing needed from the user side. The user is already authenticated
 * via server session, and their deposit balance is tracked in Supabase.
 * The oracle wallet (CFZRI425…) signs and submits the payment.
 */
router.post('/withdraw', requireAuth, async (req, res) => {
  try {
    const address = req.session.address;
    const { amountAlgo } = req.body;

    if (!amountAlgo || isNaN(Number(amountAlgo)) || Number(amountAlgo) <= 0) {
      return res.status(400).json({ error: 'Invalid amount' });
    }

    const amountMicroAlgo = Math.floor(Number(amountAlgo) * 1_000_000);

    // Check user's net deposit balance from Supabase
    const { data: deposits } = await supabase
      .from('deposits')
      .select('amount_algo, action')
      .eq('wallet_address', address);

    const netBalance = (deposits || []).reduce((acc, d) => {
      return acc + (d.action === 'deposit' ? d.amount_algo : -d.amount_algo);
    }, 0);

    if (amountMicroAlgo > netBalance) {
      return res.status(400).json({
        error: `Insufficient balance. Available: ${(netBalance / 1_000_000).toFixed(4)} ALGO`,
      });
    }

    // Oracle wallet signs and sends payment to user
    const oracleMnemonic = config.oracle.mnemonic;
    if (!oracleMnemonic) {
      return res.status(503).json({ error: 'Oracle wallet not configured' });
    }

    const oracleAccount = algosdk.mnemonicToSecretKey(oracleMnemonic);
    const algod = createAlgodClient();
    const suggestedParams = await algod.getTransactionParams().do();

    const payTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: oracleAccount.addr.toString(),
      receiver: address,
      amount: amountMicroAlgo,
      note: new TextEncoder().encode(`withdraw:${address.slice(0, 8)}`),
      suggestedParams,
    });

    const signedTxn = payTxn.signTxn(oracleAccount.sk);
    await algod.sendRawTransaction(signedTxn).do();
    const txId = payTxn.txID();
    const result = await algosdk.waitForConfirmation(algod, txId, 12);
    const confirmedRound = Number(result['confirmed-round']);

    // Record withdrawal in deposits table
    await supabase.from('deposits').insert({
      wallet_address: address,
      amount_algo: amountMicroAlgo,
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

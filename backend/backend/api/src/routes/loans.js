/**
 * Loan Routes — Cadencia CreditFlow
 *
 * GET  /api/loans/my                  — Borrower: list own loans
 * POST /api/loans/apply               — Borrower: submit loan application
 * POST /api/loans/repay/:id           — Borrower: build unsigned repayment txn for Pera signing
 * POST /api/loans/repay/:id/submit    — Borrower: submit signed repayment txn + mark repaid
 * GET  /api/loans/admin/pending       — Admin: pending loan queue
 * GET  /api/loans/admin/all           — Admin: full loan history (all statuses)
 * POST /api/loans/admin/approve/:id   — Admin: approve → oracle disbursement job
 * POST /api/loans/admin/reject/:id    — Admin: reject loan
 */

const express = require('express');
const algosdk = require('algosdk');
const supabase = require('../supabase');
const { createAlgodClient } = require('../algorand');
const config = require('../config');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getOracleQueue } = require('../queues');

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────────

function txnToBase64(txn) {
  return Buffer.from(algosdk.encodeUnsignedTransaction(txn)).toString('base64');
}

/**
 * Calculate total repayment amount in microALGO.
 * interestBps is APR in basis points. Prorated to tenure_days.
 */
function calcRepaymentMicroAlgo(principalMicro, interestBps, tenureDays) {
  const interestFraction = (interestBps / 10000) * (tenureDays / 365);
  const interestMicro = Math.ceil(principalMicro * interestFraction);
  return principalMicro + interestMicro;
}

// ── POST /api/loans/apply ─────────────────────────────────────────────────────

router.post('/apply', requireAuth, async (req, res) => {
  try {
    const address = req.session.address;
    const { amountAlgo, tenureDays, purpose } = req.body;

    if (!amountAlgo || !tenureDays) {
      return res.status(400).json({ error: 'Amount and tenure are required' });
    }

    // ── Input validation ──
    const VALID_TENURES = [7, 15, 30, 60, 90];
    const parsedAmount = parseFloat(amountAlgo);
    const parsedTenure = parseInt(tenureDays, 10);

    if (isNaN(parsedAmount) || parsedAmount < 0.5 || parsedAmount > 50) {
      return res.status(400).json({ error: 'Loan amount must be between 0.5 and 50 ALGO' });
    }
    if (!VALID_TENURES.includes(parsedTenure)) {
      return res.status(400).json({ error: `Tenure must be one of: ${VALID_TENURES.join(', ')} days` });
    }
    if (purpose && typeof purpose === 'string' && purpose.length > 500) {
      return res.status(400).json({ error: 'Purpose must be 500 characters or fewer' });
    }

    // Check KYC status
    const { data: user } = await supabase
      .from('users')
      .select('kyc_status, role')
      .eq('wallet_address', address)
      .single();

    if (!user || user.kyc_status !== 'verified') {
      return res.status(403).json({ error: 'KYC verification required before applying' });
    }

    if (user.role !== 'borrower' && user.role !== 'both') {
      return res.status(403).json({ error: 'Only borrowers can apply for loans' });
    }

    // Check no existing active loan
    const { data: existingLoan } = await supabase
      .from('loan_applications')
      .select('id')
      .eq('wallet_address', address)
      .in('status', ['pending', 'approved', 'active'])
      .limit(1)
      .single();

    if (existingLoan) {
      return res.status(409).json({ error: 'You already have an active or pending loan' });
    }

    // Convert ALGO to microALGO
    const amountMicroAlgo = Math.floor(parsedAmount * 1_000_000);

    // Interest rate lookup by tenure
    const rateTable = { 7: 800, 15: 900, 30: 1000, 60: 1100, 90: 1200 };
    const interestBps = rateTable[parsedTenure] || 1000;

    // Create loan application
    const { data, error } = await supabase
      .from('loan_applications')
      .insert({
        wallet_address: address,
        amount_algo: amountMicroAlgo,
        tenure_days: parsedTenure,
        interest_bps: interestBps,
        purpose: purpose || null,
        status: 'pending',
      })
      .select()
      .single();

    if (error) {
      console.error('[Loans] Apply error:', error);
      return res.status(500).json({ error: 'Failed to create loan application' });
    }

    res.json({ ok: true, loan: data });
  } catch (err) {
    console.error('[Loans] Apply error:', err);
    res.status(500).json({ error: 'Loan application failed' });
  }
});

// ── GET /api/loans/my ─────────────────────────────────────────────────────────

router.get('/my', requireAuth, async (req, res) => {
  try {
    const address = req.session.address;

    const { data, error } = await supabase
      .from('loan_applications')
      .select('*')
      .eq('wallet_address', address)
      .order('created_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch loans' });
    }

    res.json({ loans: data || [] });
  } catch (err) {
    console.error('[Loans] My loans error:', err);
    res.status(500).json({ error: 'Failed to fetch loans' });
  }
});

// ── POST /api/loans/repay/:id ─────────────────────────────────────────────────

/**
 * Build an unsigned ALGO payment transaction for loan repayment.
 * Borrower pays principal + prorated interest back to the pool app address.
 * Returns base64-encoded msgpack for Pera to sign.
 */
router.post('/repay/:id', requireAuth, async (req, res) => {
  try {
    const address = req.session.address;
    const { id } = req.params;

    // Fetch loan
    const { data: loan, error: loanErr } = await supabase
      .from('loan_applications')
      .select('*')
      .eq('id', id)
      .eq('wallet_address', address) // Borrower can only repay their own loan
      .single();

    if (loanErr || !loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (loan.status !== 'active') {
      return res.status(400).json({ error: `Loan status is '${loan.status}' — only active loans can be repaid` });
    }

    // Validate platform wallet is configured
    const platformWallet = config.platformWallet;
    if (!platformWallet) {
      console.error('[Loans] PLATFORM_WALLET is not set in .env');
      return res.status(503).json({ error: 'Platform wallet not configured — contact support' });
    }

    // Calculate total repayment amount
    const repaymentMicroAlgo = calcRepaymentMicroAlgo(
      loan.amount_algo,
      loan.interest_bps,
      loan.tenure_days
    );

    const algod = createAlgodClient();
    const suggestedParams = await algod.getTransactionParams().do();

    // Payment: borrower → platform wallet (CFZRI425...)
    const payTxn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: address,
      receiver: platformWallet,
      amount: repaymentMicroAlgo,
      note: new TextEncoder().encode(`repay:${id}`), // Tag for indexer queries
      suggestedParams,
    });

    console.log(`[Loans] Repay txn built: loan=${id} amount=${repaymentMicroAlgo} microALGO → ${platformWallet}`);

    res.json({
      unsignedTxns: [txnToBase64(payTxn)],
      repaymentMicroAlgo,
      repaymentAlgo: repaymentMicroAlgo / 1_000_000,
      loanId: id,
      receiver: platformWallet,
    });
  } catch (err) {
    console.error('[Loans] Repay build error:', err);
    res.status(500).json({ error: 'Failed to build repayment transaction' });
  }
});

// ── POST /api/loans/repay/:id/submit ─────────────────────────────────────────

/**
 * Receive signed repayment txn, submit to Algorand, mark loan as repaid,
 * and enqueue SCORE_UPDATE (increase) for the borrower.
 */
router.post('/repay/:id/submit', requireAuth, async (req, res) => {
  try {
    const address = req.session.address;
    const { id } = req.params;
    const { signedTxns, repaymentMicroAlgo } = req.body;

    if (!signedTxns || !Array.isArray(signedTxns) || signedTxns.length === 0) {
      return res.status(400).json({ error: 'signedTxns array required' });
    }

    // Verify the loan belongs to this user and is still active
    const { data: loan, error: loanErr } = await supabase
      .from('loan_applications')
      .select('id, wallet_address, status, amount_algo, interest_bps, tenure_days')
      .eq('id', id)
      .eq('wallet_address', address)
      .single();

    if (loanErr || !loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }
    if (loan.status !== 'active') {
      return res.status(400).json({ error: 'Loan is no longer active' });
    }

    // Submit to Algorand
    const algod = createAlgodClient();
    const allSignedBytes = signedTxns.map(b64 => new Uint8Array(Buffer.from(b64, 'base64')));
    await algod.sendRawTransaction(allSignedBytes).do();

    const firstDecoded = algosdk.decodeSignedTransaction(allSignedBytes[0]);
    const txId = firstDecoded.txn.txID();
    const result = await algosdk.waitForConfirmation(algod, txId, 12);
    // algosdk v3 returns confirmed-round as BigInt — convert to Number for JSON
    const confirmedRound = Number(result['confirmed-round']);

    // Mark loan as repaid — only update status (repayment_tx_id column does not exist in schema)
    const { error: updateErr } = await supabase
      .from('loan_applications')
      .update({ status: 'repaid' })
      .eq('id', id);

    if (updateErr) {
      // On-chain tx is confirmed — the ALGO moved. DB is out of sync.
      // Log for manual reconciliation; return success with a warning.
      console.error(`[Loans] DB update failed for loan ${id} after on-chain repayment ${txId}:`, updateErr);
      return res.json({
        ok: true, txId, confirmedRound,
        warning: 'Repayment confirmed on-chain but DB sync failed — your loan status will be corrected shortly',
      });
    }

    // Enqueue SCORE_UPDATE — successful repayment increases credit score
    const queue = getOracleQueue();
    await queue.add('SCORE_UPDATE', {
      address,
      action: 'increase',
      delta: 50, // +50 points for successful repayment
      idempotencyKey: `repay:${id}:score:${Date.now()}`,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });

    console.log(`[Loans] Repayment confirmed: loan=${id} txId=${txId} (round ${confirmedRound})`);
    res.json({ ok: true, txId, confirmedRound });
  } catch (err) {
    console.error('[Loans] Repay submit error:', err);
    const algoErr = err?.response?.body?.message || err.message;
    res.status(500).json({ error: `Transaction failed: ${algoErr}` });
  }
});

// ── POST /api/loans/admin/approve/:id ────────────────────────────────────────

router.post('/admin/approve/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: loan, error } = await supabase
      .from('loan_applications')
      .select('*')
      .eq('id', id)
      .single();

    if (error || !loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (loan.status !== 'pending') {
      return res.status(400).json({ error: `Loan status is '${loan.status}', cannot approve` });
    }

    // Update status to approved
    await supabase
      .from('loan_applications')
      .update({ status: 'approved' })
      .eq('id', id);

    const queue = getOracleQueue();

    // Enqueue oracle disbursement job
    await queue.add('LOAN_DISBURSEMENT', {
      loanId: loan.id,
      walletAddress: loan.wallet_address,
      amountMicroAlgo: loan.amount_algo,
      tenureDays: loan.tenure_days,
      interestBps: loan.interest_bps,
      idempotencyKey: `loan:${loan.id}:disburse:${Date.now()}`,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });

    // Enqueue SCORE_UPDATE — loan approval gives a small positive signal
    await queue.add('SCORE_UPDATE', {
      address: loan.wallet_address,
      action: 'increase',
      delta: 10, // +10 points for getting approved
      idempotencyKey: `loan:${loan.id}:score:approve:${Date.now()}`,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });

    res.json({ ok: true, message: 'Loan approved, disbursement + score update enqueued' });
  } catch (err) {
    console.error('[Loans] Admin approve error:', err);
    res.status(500).json({ error: 'Loan approval failed' });
  }
});

// ── GET /api/loans/admin/pending ──────────────────────────────────────────────

router.get('/admin/pending', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('loan_applications')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[Loans] Admin pending error:', error);
      return res.status(500).json({ error: 'Failed to fetch pending loans' });
    }

    res.json({ loans: data || [] });
  } catch (err) {
    console.error('[Loans] Admin pending error:', err);
    res.status(500).json({ error: 'Failed to fetch pending loans' });
  }
});

// ── GET /api/loans/admin/all ──────────────────────────────────────────────────

/**
 * Admin: full loan history across all statuses, paginated.
 */
router.get('/admin/all', requireAdmin, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
    const offset = parseInt(req.query.offset || '0', 10);
    const status = req.query.status; // Optional filter

    let query = supabase
      .from('loan_applications')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (status) {
      query = query.eq('status', status);
    }

    const { data, error, count } = await query;

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch loans' });
    }

    res.json({ loans: data || [], total: count, limit, offset });
  } catch (err) {
    console.error('[Loans] Admin all error:', err);
    res.status(500).json({ error: 'Failed to fetch loans' });
  }
});

// ── POST /api/loans/admin/reject/:id ─────────────────────────────────────────

router.post('/admin/reject/:id', requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const { data: loan } = await supabase
      .from('loan_applications')
      .select('id, status')
      .eq('id', id)
      .single();

    if (!loan) {
      return res.status(404).json({ error: 'Loan not found' });
    }

    if (loan.status !== 'pending') {
      return res.status(400).json({ error: `Cannot reject a loan with status '${loan.status}'` });
    }

    const { error } = await supabase
      .from('loan_applications')
      .update({ status: 'rejected' })
      .eq('id', id);

    if (error) {
      return res.status(500).json({ error: 'Failed to reject loan' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[Loans] Admin reject error:', err);
    res.status(500).json({ error: 'Loan rejection failed' });
  }
});

module.exports = router;

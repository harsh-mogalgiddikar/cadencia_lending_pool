/**
 * KYC Routes — Submit and check KYC status.
 *
 * POST /api/kyc/submit          — Submit KYC form (name, GSTIN, role)
 * GET  /api/kyc/status/:address — Poll KYC verification status
 * POST /api/admin/kyc/approve   — Admin: approve → enqueue oracle write
 * POST /api/admin/kyc/reject    — Admin: reject KYC
 */

const express = require('express');
const supabase = require('../supabase');
const config = require('../config');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getOracleQueue } = require('../queues');

const router = express.Router();

/**
 * POST /api/kyc/submit
 * Submit KYC form. Creates or updates user record in Supabase.
 */
router.post('/submit', requireAuth, async (req, res) => {
  try {
    const address = req.session.address;
    const { businessName, gstin, role } = req.body;

    if (!role || !['lender', 'borrower', 'both'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role. Must be lender, borrower, or both.' });
    }

    // Upsert user record
    const { data, error } = await supabase
      .from('users')
      .upsert({
        wallet_address: address,
        role,
        business_name: businessName || null,
        gstin: gstin || null,
        kyc_status: 'pending',
        kyc_tier: 0,
      }, {
        onConflict: 'wallet_address',
      })
      .select()
      .single();

    if (error) {
      console.error('[KYC] Submit error:', error);
      return res.status(500).json({ error: 'Failed to submit KYC' });
    }

    // If mock KYC is enabled, immediately enqueue approval
    if (config.flags.mockKyc) {
      const queue = getOracleQueue();
      await queue.add('KYC_APPROVAL', {
        address,
        role,
        tier: 1, // TIER_BASIC
        idempotencyKey: `kyc:${address}:approve:${Date.now()}`,
      }, {
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
      });
    }

    res.json({ ok: true, status: config.flags.mockKyc ? 'auto-approving' : 'pending', user: data });
  } catch (err) {
    console.error('[KYC] Submit error:', err);
    res.status(500).json({ error: 'KYC submission failed' });
  }
});

/**
 * GET /api/kyc/status/:address
 * Poll KYC status for a wallet address.
 */
router.get('/status/:address', async (req, res) => {
  try {
    const { address } = req.params;

    const { data, error } = await supabase
      .from('users')
      .select('wallet_address, role, kyc_status, kyc_tier, created_at')
      .eq('wallet_address', address)
      .single();

    if (error || !data) {
      return res.json({ status: 'not_found' });
    }

    res.json(data);
  } catch (err) {
    console.error('[KYC] Status error:', err);
    res.status(500).json({ error: 'Failed to fetch KYC status' });
  }
});

/**
 * POST /api/admin/kyc/approve
 * Admin manually approves KYC → enqueue oracle write.
 */
router.post('/admin/approve', requireAdmin, async (req, res) => {
  try {
    const { address } = req.body;

    if (!address) {
      return res.status(400).json({ error: 'Address required' });
    }

    // Fetch user
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('wallet_address', address)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: 'User not found' });
    }

    if (user.kyc_status === 'verified') {
      return res.json({ ok: true, message: 'Already verified' });
    }

    // Enqueue oracle write
    const queue = getOracleQueue();
    await queue.add('KYC_APPROVAL', {
      address,
      role: user.role,
      tier: 1,
      idempotencyKey: `kyc:${address}:approve:${Date.now()}`,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
    });

    res.json({ ok: true, message: 'KYC approval enqueued' });
  } catch (err) {
    console.error('[KYC] Admin approve error:', err);
    res.status(500).json({ error: 'Failed to approve KYC' });
  }
});

/**
 * POST /api/admin/kyc/reject
 * Admin rejects KYC.
 */
router.post('/admin/reject', requireAdmin, async (req, res) => {
  try {
    const { address, reason } = req.body;

    if (!address) {
      return res.status(400).json({ error: 'Address required' });
    }

    const { error } = await supabase
      .from('users')
      .update({
        kyc_status: 'rejected',
        rejection_reason: reason || null,
      })
      .eq('wallet_address', address);

    if (error) {
      return res.status(500).json({ error: 'Failed to reject' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('[KYC] Reject error:', err);
    res.status(500).json({ error: 'Rejection failed' });
  }
});

/**
 * GET /api/kyc/admin/pending
 * Admin: list all users awaiting KYC review.
 */
router.get('/admin/pending', requireAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('users')
      .select('wallet_address, role, kyc_status, kyc_tier, business_name, gstin, created_at')
      .eq('kyc_status', 'pending')
      .order('created_at', { ascending: true });

    if (error) {
      console.error('[KYC] Admin pending error:', error);
      return res.status(500).json({ error: 'Failed to fetch pending KYC users' });
    }

    res.json({ users: data || [] });
  } catch (err) {
    console.error('[KYC] Admin pending error:', err);
    res.status(500).json({ error: 'Failed to fetch pending KYC users' });
  }
});

module.exports = router;

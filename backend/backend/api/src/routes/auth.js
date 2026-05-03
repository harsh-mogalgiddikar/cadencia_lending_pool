/**
 * Auth Routes — Nonce-challenge wallet authentication.
 *
 * Flow:
 *   1. POST /api/auth/nonce     → issue one-time nonce for wallet address
 *   2. POST /api/auth/verify    → verify Ed25519 signature → set session cookie
 *   3. POST /api/auth/logout    → destroy session
 *   4. GET  /api/auth/me        → return current session address
 */

const express = require('express');
const crypto = require('crypto');
const algosdk = require('algosdk');
const nacl = require('tweetnacl');
const { getRedis } = require('../redis');

const router = express.Router();

const NONCE_TTL_SECONDS = 300; // 5 minutes
const NONCE_PREFIX = 'nonce:';
const SIGN_MESSAGE_PREFIX = 'CreditFlow login:\n';

/**
 * Build the MX-prefixed byte array that Pera actually signs (ARC-60).
 * Pera prepends [0x4d, 0x58] ('MX') before Ed25519 signing to prevent
 * transaction malleability. The backend MUST verify against these exact bytes.
 */
function buildMxSignBytes(nonce) {
  const MX = Buffer.from([0x4d, 0x58]); // 'MX'
  const msg = Buffer.from(`${SIGN_MESSAGE_PREFIX}${nonce}`, 'utf8');
  return Buffer.concat([MX, msg]);
}

/**
 * POST /api/auth/nonce
 * Issue a one-time nonce tied to a wallet address.
 */
router.post('/nonce', async (req, res) => {
  try {
    const { address } = req.body;

    if (!address || !algosdk.isValidAddress(address)) {
      return res.status(400).json({ error: 'Invalid Algorand address' });
    }

    const nonce = crypto.randomUUID();
    const redis = getRedis();
    await redis.set(`${NONCE_PREFIX}${address}`, nonce, 'EX', NONCE_TTL_SECONDS);

    res.json({ nonce });
  } catch (err) {
    console.error('[Auth] Nonce error:', err);
    res.status(500).json({ error: 'Failed to generate nonce' });
  }
});

/**
 * POST /api/auth/verify
 * Verify the Ed25519 signature of the nonce → create session.
 */
router.post('/verify', async (req, res) => {
  try {
    const { address, nonce, signature, mxMessage } = req.body;

    if (!address || !nonce || !signature) {
      return res.status(400).json({ error: 'Missing address, nonce, or signature' });
    }

    if (!algosdk.isValidAddress(address)) {
      return res.status(400).json({ error: 'Invalid Algorand address' });
    }

    // Replay prevention: atomic get+delete of the nonce
    const redis = getRedis();
    const storedNonce = await redis.call('GETDEL', `${NONCE_PREFIX}${address}`);
    if (!storedNonce || storedNonce !== nonce) {
      return res.status(401).json({ error: 'Invalid or expired nonce' });
    }

    // Decode signature from base64
    const sig = Buffer.from(signature, 'base64');
    const publicKey = algosdk.decodeAddress(address).publicKey;

    console.log('[Auth/verify] address:', address);
    console.log('[Auth/verify] nonce (first 8):', nonce.slice(0, 8));
    console.log('[Auth/verify] sig byte length (expect 64):', sig.length);

    // ── Strategy: try MX-prefixed bytes first (Pera ARC-60), then raw ──
    //
    // Pera mobile signs:  Ed25519( MX || UTF8("CreditFlow login:\n<nonce>") )
    // Legacy clients may send the raw message without MX prefix.
    //
    // If frontend sends mxMessage (base64 of MX || rawMsg), use that directly.
    // Otherwise reconstruct both and try both.

    let messageToVerify;
    if (mxMessage) {
      // Frontend computed MX-prefixed bytes and sent them explicitly — most reliable
      messageToVerify = Buffer.from(mxMessage, 'base64');
      console.log('[Auth/verify] using client-supplied mxMessage, byte length:', messageToVerify.length);
    } else {
      // Fallback: build MX-prefixed bytes server-side
      messageToVerify = buildMxSignBytes(nonce);
      console.log('[Auth/verify] built MX-prefixed bytes server-side, length:', messageToVerify.length);
    }

    console.log('[Auth/verify] message hex (first 12 bytes):', messageToVerify.slice(0, 12).toString('hex'));
    // Expect: 4d58 43726564 (MX + 'Cred')

    let valid = false;

    // Attempt 1: MX-prefixed (ARC-60 / Pera mobile)
    try {
      valid = nacl.sign.detached.verify(
        new Uint8Array(messageToVerify),
        new Uint8Array(sig),
        new Uint8Array(publicKey)
      );
      console.log('[Auth/verify] MX-prefix verification result:', valid);
    } catch (err) {
      console.warn('[Auth/verify] MX-prefix verify threw:', err.message);
      valid = false;
    }

    // Attempt 2: Raw message without MX (legacy / Defly / other wallets)
    if (!valid) {
      const rawMsg = Buffer.from(`${SIGN_MESSAGE_PREFIX}${nonce}`, 'utf8');
      console.log('[Auth/verify] Trying raw (non-MX) message, length:', rawMsg.length);
      try {
        valid = nacl.sign.detached.verify(
          new Uint8Array(rawMsg),
          new Uint8Array(sig),
          new Uint8Array(publicKey)
        );
        console.log('[Auth/verify] Raw-message verification result:', valid);
      } catch (err) {
        console.warn('[Auth/verify] Raw verify threw:', err.message);
        valid = false;
      }
    }

    if (!valid) {
      console.error('[Auth/verify] BOTH verification strategies failed for address:', address);
      return res.status(401).json({ error: 'Signature verification failed' });
    }

    console.log('[Auth/verify] ✓ Verified. Setting session for:', address);
    req.session.address = address;

    // Explicitly save before responding — guarantees the cookie is committed to
    // Redis before the client's next request (e.g. GET /api/auth/me in AppLayout).
    req.session.save((saveErr) => {
      if (saveErr) {
        console.error('[Auth/verify] session.save() failed:', saveErr.message);
        return res.status(500).json({ error: 'Session save failed' });
      }
      res.json({ ok: true, address });
    });
  } catch (err) {
    console.error('[Auth] Verify error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

/**
 * POST /api/auth/logout
 * Destroy the session.
 */
router.post('/logout', (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    res.clearCookie('connect.sid');
    res.json({ ok: true });
  });
});

/**
 * GET /api/auth/me
 * Return the current session wallet address and admin status.
 */
router.get('/me', (req, res) => {
  if (!req.session || !req.session.address) {
    return res.json({ authenticated: false });
  }
  const adminAddresses = (process.env.ADMIN_ADDRESSES || '').split(',').map(a => a.trim()).filter(Boolean);
  const isAdmin = adminAddresses.includes(req.session.address);
  res.json({ authenticated: true, address: req.session.address, isAdmin });
});

module.exports = router;

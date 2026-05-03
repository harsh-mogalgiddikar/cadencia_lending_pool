/**
 * Shared PeraWallet singleton — Cadencia CreditFlow
 *
 * IMPORTANT: There must be exactly ONE PeraWalletConnect instance across the
 * entire app. Pera holds the WebSocket connection to the mobile wallet on this
 * object. If you create a second instance and call signTransaction() on it, it
 * will open a new QR-code popup (desktop) or fail silently on mobile because
 * that instance has no active session.
 *
 * Both WalletModal.tsx and useAlgoSigner.ts must import from this file.
 */

import { PeraWalletConnect } from '@perawallet/connect';

export const peraWallet = new PeraWalletConnect();

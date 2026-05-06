/**
 * useAlgoSigner — Pera transaction signing hook for Cadencia CreditFlow
 *
 * Architecture:
 *   1. Backend builds unsigned txn(s) and returns base64 msgpack
 *   2. Frontend decodes with algosdk, signs with Pera
 *   3. Frontend sends signed txn bytes back to backend submit endpoint
 *   4. Backend submits to Algorand, waits for confirmation, updates DB
 *
 * Usage:
 *   const { buildAndSign } = useAlgoSigner();
 *   const { txId } = await buildAndSign({
 *     buildUrl:  '/api/pool/deposit',
 *     submitUrl: '/api/pool/deposit/submit',
 *     buildBody: { amountAlgo: 10 },
 *   });
 */

import * as algosdk from 'algosdk';
import api from '@/lib/api';
import { useAuth } from '@/store/auth';
import { peraWallet } from '@/lib/peraWallet';


interface BuildAndSignOptions {
  /** Backend URL to call for building the unsigned transaction(s) */
  buildUrl: string;
  /** Backend URL to call with the signed transaction bytes */
  submitUrl: string;
  /** Request body for the build call */
  buildBody: Record<string, unknown>;
  /** Additional fields to pass to the submit call */
  submitExtra?: Record<string, unknown>;
}

interface BuildAndSignResult {
  txId: string;
  confirmedRound: number;
}

export function useAlgoSigner() {
  const { address } = useAuth();

  /**
   * Full build → sign → submit pipeline.
   *
   * 1. POST buildUrl with buildBody → { unsignedTxns: string[] }
   * 2. Decode each base64 txn with algosdk.decodeUnsignedTransaction()
   * 3. Sign all txns with peraWallet.signTransaction()
   * 4. POST submitUrl with { signedTxns: string[], ...submitExtra }
   * 5. Return { txId, confirmedRound }
   */
  const buildAndSign = async (opts: BuildAndSignOptions): Promise<BuildAndSignResult> => {
    if (!address) throw new Error('Wallet not connected');

    // Step 1: Build unsigned txns on the backend
    const buildRes = await api.post(opts.buildUrl, opts.buildBody);
    const { unsignedTxns, ...buildMeta } = buildRes.data as {
      unsignedTxns: string[];
      [key: string]: unknown;
    };

    if (!unsignedTxns || unsignedTxns.length === 0) {
      throw new Error('Backend returned no unsigned transactions');
    }

    // Step 2: Decode base64 msgpack → algosdk Transaction objects
    const decodedTxns = unsignedTxns.map((b64: string) => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      return algosdk.decodeUnsignedTransaction(bytes);
    });

    // Step 3: Sign with Pera wallet
    // Each txn in a group must be listed with its signer address.
    // Pera expects: signTransaction([[{txn, signers}, {txn, signers}, ...]])
    // All txns in the group must appear in the same inner array.
    const txnGroup = decodedTxns.map(txn => ({
      txn,
      signers: [address],
    }));

    let rawSignedResults: Uint8Array[];
    try {
      rawSignedResults = await peraWallet.signTransaction([txnGroup]);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);

      // Pera session was lost on page refresh — try to restore and retry once
      if (errMsg.toLowerCase().includes('not initialized') || errMsg.toLowerCase().includes('not connected')) {
        try {
          console.log('[AlgoSigner] Pera session lost — attempting reconnect…');
          await peraWallet.reconnectSession();
          rawSignedResults = await peraWallet.signTransaction([txnGroup]);
        } catch (reconnErr: unknown) {
          const reconnMsg = reconnErr instanceof Error ? reconnErr.message : String(reconnErr);
          if (reconnMsg.toLowerCase().includes('cancel') || reconnMsg.toLowerCase().includes('rejected')) {
            throw new Error('Transaction cancelled by user');
          }
          throw new Error('Pera session expired — please click Sign Out and reconnect your wallet');
        }
      } else if (errMsg.toLowerCase().includes('cancel') || errMsg.toLowerCase().includes('rejected')) {
        throw new Error('Transaction cancelled by user');
      } else {
        throw new Error(`Pera signing failed: ${errMsg}`);
      }
    }

    // Pera returns one entry per txn in the group; slots signed by a logicsig
    // or not signed by the user come back as empty Uint8Arrays (length === 0).
    // Filter those out — only send non-empty signed bytes to the backend.
    const nonEmptySignedResults = rawSignedResults.filter(b => b && b.length > 0);
    if (nonEmptySignedResults.length === 0) {
      throw new Error('Pera returned no signed transactions — was the transaction rejected?');
    }
    console.log(`[AlgoSigner] Pera returned ${rawSignedResults.length} results, ${nonEmptySignedResults.length} non-empty`);

    // Step 4: Base64-encode signed bytes safely (avoid spread stack overflow on large txns)
    const signedTxns = nonEmptySignedResults.map(bytes => {
      let binary = '';
      const chunkSize = 8192;
      for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
      }
      return btoa(binary);
    });

    const submitRes = await api.post(opts.submitUrl, {
      signedTxns,
      ...buildMeta, // Pass back amountMicroAlgo, loanId etc. from build response
      ...opts.submitExtra,
    });

    if (!submitRes.data.txId) {
      throw new Error('Backend did not return a txId after submission');
    }

    return {
      txId: submitRes.data.txId,
      confirmedRound: submitRes.data.confirmedRound,
    };
  };

  return { buildAndSign };
}

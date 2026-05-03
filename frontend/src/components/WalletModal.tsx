import { useEffect, useState } from 'react';
import { useAuth } from '@/store/auth';
import api from '@/lib/api';
import { useNavigate } from 'react-router-dom';
import { Loader2, X, Check } from 'lucide-react';
import { toast } from 'sonner';
import { peraWallet } from '@/lib/peraWallet';


/**
 * Build the exact message that will be signed.
 *
 * CRITICAL — ARC-60 / Pera mobile prepends two "MX" bytes (0x4d 0x58) to
 * every arbitrary-data payload before signing with Ed25519. The backend MUST
 * verify against the MX-prefixed bytes, not the raw string.
 *
 * Frontend signs:  MX || UTF8("CreditFlow login:\n<nonce>")
 * Backend verifies: MX || UTF8("CreditFlow login:\n<nonce>")
 */
const SIGN_MESSAGE_PREFIX = 'CreditFlow login:\n';
const MX_PREFIX = new Uint8Array([77, 88]); // 'M', 'X'

function buildSignBytes(nonce: string): Uint8Array {
  const msgBytes = new TextEncoder().encode(`${SIGN_MESSAGE_PREFIX}${nonce}`);
  // Concatenate MX + message — this is what Pera signs internally
  const full = new Uint8Array(MX_PREFIX.length + msgBytes.length);
  full.set(MX_PREFIX, 0);
  full.set(msgBytes, MX_PREFIX.length);
  return full;
}

/** Safe Uint8Array → base64 that doesn't stack-overflow on large buffers */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const PROVIDERS = [
  { id: 'pera',          name: 'Pera Wallet',    desc: 'Mobile + Web',         glyph: '◐', comingSoon: false },
  { id: 'defly',         name: 'Defly',          desc: 'Mobile',               glyph: '◑', comingSoon: true  },
  { id: 'lute',          name: 'Lute',           desc: 'Browser Extension',    glyph: '◒', comingSoon: true  },
  { id: 'walletconnect', name: 'WalletConnect',  desc: 'QR code',              glyph: '◓', comingSoon: true  },
];

export function WalletModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [stage, setStage] = useState<'select' | 'signing' | 'error'>('select');
  const [error, setError] = useState<string>('');
  const signIn = useAuth(s => s.signIn);
  const setAuth = useAuth(s => s.setAuth);
  const nav = useNavigate();

  useEffect(() => { if (open) { setStage('select'); setError(''); } }, [open]);

  // Reconnect existing Pera session on remount (handles page refreshes)
  useEffect(() => {
    peraWallet.reconnectSession().catch(() => {});
  }, []);

  if (!open) return null;

  const connect = async (providerId: string) => {
    setStage('signing');
    try {
      // All providers fall back to Pera SDK until dedicated SDKs are integrated
      const accounts = await peraWallet.connect();
      const address = accounts[0];

      // ── Step 1: Request a one-time nonce from the backend ──
      const { data: nonceData } = await api.post('/api/auth/nonce', { address });
      const nonce: string = nonceData.nonce;

      // ── Step 2: Build the message bytes that Pera will sign ──
      // We pass only the raw message bytes to signData. Pera internally prepends
      // "MX" before signing (ARC-60). We send the MX-prefixed bytes to the backend
      // so it can verify against the exact same byte sequence.
      const rawMsgBytes = new TextEncoder().encode(`${SIGN_MESSAGE_PREFIX}${nonce}`);

      console.debug('[WalletModal] Signing message string:', `${SIGN_MESSAGE_PREFIX}${nonce}`);
      console.debug('[WalletModal] Raw message byte length:', rawMsgBytes.length);
      console.debug('[WalletModal] Signer address:', address);

      // signData receives the raw bytes WITHOUT MX — Pera adds MX internally
      const signedResult = await peraWallet.signData(
        [{ data: rawMsgBytes, message: 'Sign to verify your identity on Cadencia. No transaction, no gas fee.' }],
        address
      );

      // signData returns Uint8Array[] — each entry is the raw 64-byte Ed25519 signature
      const sigBytes: Uint8Array = signedResult[0];
      console.debug('[WalletModal] Signature byte length (expect 64):', sigBytes.length);

      // Encode signature as base64 for JSON transport
      const signature = uint8ToBase64(sigBytes);
      console.debug('[WalletModal] Signature base64 (first 20 chars):', signature.slice(0, 20));

      // ── Step 3: Send to backend — also send the MX-prefixed message so the
      // backend can verify the exact bytes Pera signed ──
      const mxMsgBytes = buildSignBytes(nonce);
      const mxMessage = uint8ToBase64(mxMsgBytes); // base64 of MX || rawMsg

      await api.post('/api/auth/verify', { address, nonce, signature, mxMessage });

      // ── Step 4: Fetch KYC status for immediate UI hydration ──
      const { data: kyc } = await api.get(`/api/kyc/status/${address}`);
      const isFound = 'kyc_status' in kyc;

      signIn(address);
      setAuth({
        kycStatus: isFound ? kyc.kyc_status : 'not_found',
        role: isFound ? kyc.role : null,
        // isAdmin will be set on the next /me call in AppLayout
      });

      toast.success(`Connected: ${address.slice(0, 8)}…`);
      onClose();
      nav('/app/dashboard');
    } catch (e: any) {
      // Handle user rejection gracefully
      if (
        e?.message?.includes('cancelled') ||
        e?.message?.includes('rejected') ||
        e?.data?.type === 'CONNECT_CANCELLED' ||
        e?.data?.type === 'SIGN_DATA_VERIFICATION_FAILED'
      ) {
        toast.info('Wallet connection cancelled.');
        setStage('select');
        return;
      }
      const msg = e?.response?.data?.error ?? e?.message ?? 'Connection failed';
      console.error('[WalletModal] Auth error:', msg, e);
      setError(msg.includes('nonce') ? 'Session expired — please try again.' : msg);
      setStage('error');
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-fade-in" role="dialog" aria-modal>
      <div className="absolute inset-0 bg-ink/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-md mc-card-lg animate-scale-in">
        <button onClick={onClose} className="absolute right-5 top-5 text-muted-foreground hover:text-ink" aria-label="Close">
          <X size={18} />
        </button>

        {stage === 'select' && (
          <>
            <p className="eyebrow mb-3">Step 01 — Connect</p>
            <h2 className="text-3xl mb-2">Connect Wallet</h2>
            <p className="text-sm text-muted-foreground mb-6">Choose your Algorand wallet to continue.</p>
            <ul className="space-y-2">
              {PROVIDERS.map(p => (
                <li key={p.id}>
                  {p.comingSoon ? (
                    <div className="w-full flex items-center gap-4 rounded-[20px] border hairline p-4 opacity-40 cursor-not-allowed select-none">
                      <span className="grid h-10 w-10 place-items-center rounded-full bg-canvas text-ink text-lg">{p.glyph}</span>
                      <span className="flex-1">
                        <span className="block text-sm font-medium">{p.name}</span>
                        <span className="block text-xs text-muted-foreground">{p.desc}</span>
                      </span>
                      <span className="rounded-full bg-canvas px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Soon</span>
                    </div>
                  ) : (
                    <button onClick={() => connect(p.id)} className="w-full flex items-center gap-4 rounded-[20px] border hairline p-4 text-left transition-all hover:bg-canvas hover:-translate-y-0.5">
                      <span className="grid h-10 w-10 place-items-center rounded-full bg-ink text-lifted text-lg">{p.glyph}</span>
                      <span className="flex-1">
                        <span className="block text-sm font-medium">{p.name}</span>
                        <span className="block text-xs text-muted-foreground">{p.desc}</span>
                      </span>
                      <span className="text-muted-foreground">→</span>
                    </button>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-6 text-[11px] text-muted-foreground text-center">
              Your private key never leaves your wallet. We only verify your address via a signed message.
            </p>
          </>
        )}

        {stage === 'signing' && (
          <div className="py-6 text-center">
            <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-full bg-canvas">
              <Loader2 className="animate-spin" size={28} />
            </div>
            <h2 className="text-2xl mb-2">Sign to Login</h2>
            <p className="text-sm text-muted-foreground">Check your wallet — approve the sign request to verify your identity. No gas fee.</p>
          </div>
        )}

        {stage === 'error' && (
          <div className="py-6 text-center">
            <div className="mx-auto mb-5 grid h-16 w-16 place-items-center rounded-full bg-destructive/10 text-destructive">
              <X size={28} />
            </div>
            <h2 className="text-2xl mb-2">Connection failed</h2>
            <p className="text-sm text-muted-foreground mb-5">{error}</p>
            <button className="pill-ghost" onClick={() => setStage('select')}>Try again</button>
          </div>
        )}
      </div>
    </div>
  );
}

export function ConnectedBadge({ children }: { children: React.ReactNode }) {
  return <span className="status-pill status-verified"><Check size={12}/> {children}</span>;
}

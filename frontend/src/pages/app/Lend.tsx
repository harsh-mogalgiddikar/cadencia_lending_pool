import { useEffect, useState } from 'react';
import { useAuth } from '@/store/auth';
import api from '@/lib/api';
import { fmtAlgo, fmtBpsPct } from '@/lib/format';
import type { PoolStats } from '@/lib/types';
import { Reveal } from '@/components/ui/Reveal';
import { Link } from 'react-router-dom';
import { ArrowUpRight, AlertTriangle, Check, ExternalLink, Wallet, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { useAlgoSigner } from '@/hooks/useAlgoSigner';

const POOL_APP_ID = import.meta.env.VITE_LENDING_POOL_APP_ID ?? '—';

export default function Lend() {
  const { address, kycStatus, role } = useAuth();
  const { buildAndSign } = useAlgoSigner();

  const [pool, setPool] = useState<PoolStats | null>(null);
  const [tab, setTab] = useState<'deposit' | 'withdraw'>('deposit');
  const [amount, setAmount] = useState(10);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<{ tx: string; kind: 'deposit' | 'withdraw' } | null>(null);
  const [position, setPosition] = useState<{ netAlgo: number; deposits: unknown[] } | null>(null);

  const kycReady = kycStatus === 'verified' && (role === 'lender' || role === 'both');

  // Fetch pool stats every 30s
  useEffect(() => {
    const fetchStats = () => api.get('/api/pool/stats').then(r => setPool(r.data)).catch(() => {});
    fetchStats();
    const id = setInterval(fetchStats, 30_000);
    return () => clearInterval(id);
  }, []);

  // Fetch lender position
  useEffect(() => {
    if (!address) return;
    api.get('/api/pool/my-position').then(r => setPosition(r.data)).catch(() => {});
  }, [address, success]);

  const submit = async () => {
    if (!address || amount <= 0) return;
    setSubmitting(true);

    const toastId = toast.loading(
      tab === 'deposit'
        ? `Preparing deposit of ◎ ${amount} ALGO — Pera will open to sign…`
        : `Preparing withdrawal — Pera will open to sign…`
    );

    try {
      const { txId } = await buildAndSign({
        buildUrl:  tab === 'deposit' ? '/api/pool/deposit'  : '/api/pool/withdraw',
        submitUrl: tab === 'deposit' ? '/api/pool/deposit/submit' : '/api/pool/withdraw/submit',
        buildBody: { amountAlgo: amount },
      });

      toast.dismiss(toastId);
      toast.success(`${tab === 'deposit' ? 'Deposit' : 'Withdrawal'} confirmed on-chain!`);
      setSuccess({ tx: txId, kind: tab });

      // Refresh pool stats after transaction
      api.get('/api/pool/stats').then(r => setPool(r.data)).catch(() => {});
    } catch (e: unknown) {
      toast.dismiss(toastId);
      const errMsg = e instanceof Error ? e.message : String(e);
      if (errMsg.includes('cancelled') || errMsg.includes('rejected')) {
        toast.info('Transaction cancelled');
      } else {
        toast.error(errMsg || 'Transaction failed');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <Reveal>
        <header>
          <p className="eyebrow mb-3">Lend</p>
          <h1 className="text-5xl md:text-6xl tracking-tight">Earn yield, <span className="italic font-light">on-chain</span>.</h1>
        </header>
      </Reveal>

      {!kycReady && (
        <Reveal>
          <div className="rounded-[20px] border bg-warning/10 border-warning/20 p-5 flex items-center gap-4">
            <AlertTriangle className="text-warning shrink-0"/>
            <div className="flex-1">
              <p className="font-medium">{kycStatus === 'verified' ? 'Lender role required' : 'KYC required'}</p>
              <p className="text-sm text-muted-foreground">Complete KYC with a lender role to deposit and withdraw.</p>
            </div>
            <Link to="/app/kyc" className="pill-ink">Complete KYC <ArrowUpRight size={14}/></Link>
          </div>
        </Reveal>
      )}

      {/* Lender position card */}
      {kycReady && position && position.netAlgo > 0 && (
        <Reveal delay={40}>
          <div className="rounded-[20px] border hairline bg-success/5 border-success/20 p-5 flex items-center gap-5">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-success/10 text-success">
              <TrendingUp size={20}/>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Your pool position</p>
              <p className="mono text-2xl mt-0.5">◎ {position.netAlgo.toFixed(4)} ALGO</p>
            </div>
            <div className="ml-auto">
              <span className="status-pill status-verified">Active</span>
            </div>
          </div>
        </Reveal>
      )}

      <div className="grid lg:grid-cols-5 gap-5">
        <Reveal className="lg:col-span-3">
          <div className="mc-card-lg h-full">
            <p className="eyebrow mb-3">Pool overview</p>
            <h2 className="text-3xl mb-8">Live liquidity</h2>
            {pool ? (
              <div className="grid grid-cols-2 gap-y-6">
                <Stat label="Total liquidity" value={`◎ ${fmtAlgo(pool.totalLiquidity, 0)}`}/>
                <Stat label="Outstanding loans" value={`◎ ${fmtAlgo(pool.outstandingLoans, 0)}`}/>
                <Stat label="Available" value={`◎ ${fmtAlgo(pool.availableLiquidity, 0)}`}/>
                <Stat label="Utilization" value={fmtBpsPct(pool.utilizationBps)}/>
                <Stat label="Depositors" value={`${pool.totalDepositors}`}/>
                <Stat label="LP shares" value={`${fmtAlgo(pool.totalShares, 0)}`}/>
              </div>
            ) : (
              <div className="animate-pulse space-y-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-8 rounded-full bg-canvas"/>
                ))}
              </div>
            )}
            <div className="mt-10 rounded-[20px] bg-canvas p-5">
              <p className="eyebrow mb-2">How yield works</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Deposits send ALGO to the on-chain lending pool, minting LP shares proportional to your stake. Borrower interest accrues into the pool, growing your share value. Withdrawals burn shares pro-rata and return ALGO to your wallet.
              </p>
            </div>
          </div>
        </Reveal>

        <Reveal className="lg:col-span-2" delay={120}>
          <div className="mc-card-lg h-full">
            <div className="flex items-center gap-1 p-1 rounded-full bg-canvas mb-6 w-fit">
              {(['deposit', 'withdraw'] as const).map(t => (
                <button key={t} onClick={() => { setTab(t); setSuccess(null); }}
                  className={`rounded-full px-5 py-2 text-sm capitalize transition-colors ${tab === t ? 'bg-ink text-lifted' : 'text-muted-foreground'}`}>
                  {t}
                </button>
              ))}
            </div>

            {success ? (
              <div className="text-center py-8">
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-success/10 text-success mb-4"><Check size={28}/></div>
                <p className="text-xl mb-2 capitalize">{success.kind} confirmed</p>
                <p className="mono text-xs text-muted-foreground break-all mb-5">{success.tx}</p>
                <div className="flex gap-2 justify-center flex-wrap">
                  <a className="pill-ghost" href={`https://lora.algokit.io/testnet/transaction/${success.tx}`} target="_blank" rel="noreferrer">
                    View on Lora <ExternalLink size={14}/>
                  </a>
                  <button className="pill-ink" onClick={() => setSuccess(null)}>{success.kind === 'deposit' ? 'Deposit' : 'Withdraw'} more</button>
                </div>
              </div>
            ) : (
              <>
                <p className="text-xs text-muted-foreground mb-5">
                  {tab === 'deposit'
                    ? 'Pera wallet will open to sign the on-chain deposit transaction. Funds go directly to the lending pool smart contract.'
                    : 'Pera wallet will open to sign the withdrawal app call. LP shares are burned and ALGO is returned to your wallet.'}
                </p>

                <label className="block mb-5">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">Amount (ALGO)</span>
                  <input
                    type="number"
                    min={0.1}
                    step={0.1}
                    value={amount}
                    onChange={e => setAmount(Number(e.target.value))}
                    className="mt-2 w-full rounded-full border hairline bg-lifted px-5 py-3 mono focus:outline-none focus:border-ink"
                  />
                </label>

                <div className="rounded-[20px] bg-canvas p-4 text-sm space-y-1 mb-6">
                  <div className="flex justify-between"><span className="text-muted-foreground">Amount</span><span className="mono">◎ {amount.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Pool app ID</span><span className="mono">{POOL_APP_ID}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Network</span><span className="mono text-xs">Algorand Testnet</span></div>
                </div>

                <button
                  onClick={submit}
                  disabled={!kycReady || submitting || amount <= 0}
                  className="pill-ink w-full justify-center disabled:opacity-40"
                  id={tab === 'deposit' ? 'btn-deposit' : 'btn-withdraw'}
                >
                  {submitting ? (
                    <span className="flex items-center gap-2"><span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"/>Waiting for Pera…</span>
                  ) : (
                    <><Wallet size={14}/> {tab === 'deposit' ? 'Deposit ALGO' : 'Withdraw ALGO'}</>
                  )}
                </button>

                {kycReady && (
                  <p className="mt-3 text-center text-xs text-muted-foreground">
                    This is a real on-chain transaction on Algorand Testnet
                  </p>
                )}
              </>
            )}
          </div>
        </Reveal>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mono text-xl mt-1">{value}</p>
    </div>
  );
}

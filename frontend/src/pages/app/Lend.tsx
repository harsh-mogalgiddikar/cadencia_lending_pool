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
  const [success, setSuccess] = useState<{ tx: string; kind: 'deposit' | 'withdraw', amount: number } | null>(null);
  const [position, setPosition] = useState<{ netAlgo: number; deposits: unknown[] } | null>(null);

  const MIN_DEPOSIT_ALGO = 1;
  const WALLET_BALANCE = 500; // Mock wallet balance for UX
  const EST_APY = 8.5; // Mock APY for UX

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
      setSuccess({ tx: txId, kind: tab, amount });

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
          <div className="rounded-[20px] border hairline bg-success/5 border-success/20 p-5 flex items-center justify-between gap-5 flex-wrap">
            <div className="flex items-center gap-5">
              <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-success/10 text-success">
                <TrendingUp size={20}/>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Your pool position</p>
                <div className="flex items-baseline gap-2">
                  <p className="mono text-2xl mt-0.5">◎ {position.netAlgo.toFixed(4)} ALGO</p>
                  {pool && pool.totalLiquidity > 0 && (
                    <span className="text-xs text-muted-foreground">({((position.netAlgo / (pool.totalLiquidity / 1_000_000)) * 100).toFixed(2)}% of pool)</span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className="status-pill status-verified">Active</span>
              <button 
                onClick={() => { setTab('withdraw'); setAmount(position.netAlgo); setSuccess(null); }}
                className="pill-ghost"
              >
                Manage / Withdraw
              </button>
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
          <div className="mc-card-lg h-full flex flex-col">
            {tab === 'withdraw' && (
              <div className="flex items-center justify-between mb-6">
                <p className="eyebrow">Withdraw Funds</p>
                <button onClick={() => { setTab('deposit'); setAmount(10); setSuccess(null); }} className="text-xs text-muted-foreground hover:text-ink transition-colors">Cancel</button>
              </div>
            )}
            {tab === 'deposit' && (
              <div className="flex items-center justify-between mb-6">
                <p className="eyebrow">Deposit ALGO</p>
                <span className="text-xs text-success bg-success/10 px-2 py-1 rounded-full font-medium">Est. APY: {EST_APY}%</span>
              </div>
            )}

            {success ? (
              <div className="text-center py-8">
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-success/10 text-success mb-4"><Check size={28}/></div>
                <p className="text-xl mb-2 capitalize">Transaction submitted</p>
                <p className="text-sm text-muted-foreground mb-4">You successfully {success.kind === 'deposit' ? 'deposited' : 'withdrew'} ◎ {success.amount}</p>
                <p className="mono text-xs text-muted-foreground break-all mb-5">{success.tx}</p>
                <div className="flex gap-2 justify-center flex-wrap">
                  <a className="pill-ghost" href={`https://lora.algokit.io/testnet/transaction/${success.tx}`} target="_blank" rel="noreferrer">
                    View on Lora <ExternalLink size={14}/>
                  </a>
                  <button className="pill-ink" onClick={() => setSuccess(null)}>{success.kind === 'deposit' ? 'Deposit' : 'Withdraw'} more</button>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col">
                <p className="text-xs text-muted-foreground mb-5">
                  {tab === 'deposit'
                    ? 'Pera wallet will open to sign the on-chain deposit transaction. Funds go directly to the lending pool smart contract.'
                    : 'Pera wallet will open to sign the withdrawal app call. LP shares are burned and ALGO is returned to your wallet.'}
                </p>

                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">Amount (ALGO)</span>
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Wallet size={12}/> {tab === 'deposit' ? WALLET_BALANCE : position?.netAlgo?.toFixed(2) || 0} ALGO
                  </span>
                </div>
                
                <div className="relative mb-2">
                  <input
                    type="number"
                    min={tab === 'deposit' ? MIN_DEPOSIT_ALGO : 0.001}
                    step={1}
                    value={amount}
                    onChange={e => setAmount(Number(e.target.value))}
                    className="w-full rounded-full border hairline bg-lifted px-5 py-3 pr-20 mono focus:outline-none focus:border-ink"
                  />
                  <button 
                    onClick={() => setAmount(tab === 'deposit' ? Math.max(0, WALLET_BALANCE - 1) : (position?.netAlgo || 0))}
                    className="absolute right-2 top-2 bottom-2 px-3 text-xs font-medium bg-canvas hover:bg-ghost rounded-full transition-colors"
                  >
                    MAX
                  </button>
                </div>

                {tab === 'deposit' && amount < MIN_DEPOSIT_ALGO && (
                  <p className="text-xs text-destructive mb-3">Minimum deposit is {MIN_DEPOSIT_ALGO} ALGO (smart contract requirement)</p>
                )}

                <div className="mt-auto pt-6">
                  <button
                    onClick={submit}
                    disabled={!kycReady || submitting || amount <= 0 || (tab === 'deposit' && amount < MIN_DEPOSIT_ALGO) || (tab === 'withdraw' && amount > (position?.netAlgo || 0))}
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
                </div>
              </div>
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

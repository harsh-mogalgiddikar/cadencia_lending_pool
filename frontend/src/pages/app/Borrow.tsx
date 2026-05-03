import { useEffect, useState } from 'react';
import { useAuth } from '@/store/auth';
import api from '@/lib/api';
import { fmtAlgo, fmtBpsPct, interestAlgo, relTime } from '@/lib/format';
import { TENURE_RATES, type Loan } from '@/lib/types';
import { Reveal } from '@/components/ui/Reveal';
import { Link } from 'react-router-dom';
import { ArrowUpRight, AlertTriangle, Check, ExternalLink, Wallet, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { useAlgoSigner } from '@/hooks/useAlgoSigner';

const TENURES = [7, 15, 30, 60, 90];

function microToAlgo(micro: number) { return micro / 1_000_000; }

/** Days remaining until loan is due (approximate using tenure from apply date) */
function daysRemaining(createdAt: string, tenureDays: number): number {
  const due = new Date(createdAt).getTime() + tenureDays * 24 * 60 * 60 * 1000;
  const remaining = Math.ceil((due - Date.now()) / (24 * 60 * 60 * 1000));
  return Math.max(0, remaining);
}

export default function Borrow() {
  const { address, kycStatus, role } = useAuth();
  const { buildAndSign } = useAlgoSigner();

  const [loans, setLoans] = useState<Loan[]>([]);
  const [amount, setAmount] = useState(5);
  const [tenure, setTenure] = useState(30);
  const [purpose, setPurpose] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [repaySuccess, setRepaySuccess] = useState<{ tx: string; loanId: string } | null>(null);
  const [repaying, setRepaying] = useState<string | null>(null); // loanId being repaid

  const refresh = async () => {
    if (!address) return;
    const { data } = await api.get('/api/loans/my');
    setLoans(data.loans ?? []);
  };
  useEffect(() => { refresh(); }, [address]); // eslint-disable-line

  const active = loans.find(l => ['active', 'approved', 'pending'].includes(l.status));
  const bps = TENURE_RATES[tenure];
  const interest = interestAlgo(amount, bps, tenure);
  const total = amount + interest;
  const kycReady = kycStatus === 'verified' && (role === 'borrower' || role === 'both');

  const apply = async () => {
    if (!address) return;
    setSubmitting(true);
    try {
      await api.post('/api/loans/apply', { amountAlgo: amount, tenureDays: tenure, purpose: purpose || undefined });
      toast.success('Application submitted — awaiting admin review');
      setSuccess(true);
      await refresh();
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } }; message?: string };
      toast.error(err?.response?.data?.error ?? err?.message ?? 'Application failed');
    } finally { setSubmitting(false); }
  };

  const repay = async (loan: Loan) => {
    if (!address || repaying) return;
    setRepaying(loan.id);

    const principal = microToAlgo(loan.amount_algo);
    const repayAmt = (principal + interestAlgo(principal, loan.interest_bps, loan.tenure_days)).toFixed(4);
    const toastId = toast.loading(`Preparing repayment of ◎ ${repayAmt} ALGO — Pera will open to sign…`);

    try {
      const { txId } = await buildAndSign({
        buildUrl:  `/api/loans/repay/${loan.id}`,
        submitUrl: `/api/loans/repay/${loan.id}/submit`,
        buildBody: {},
      });

      toast.dismiss(toastId);
      toast.success('Loan repaid on-chain! Credit score update enqueued.');
      setRepaySuccess({ tx: txId, loanId: loan.id });
      await refresh();
    } catch (e: unknown) {
      toast.dismiss(toastId);
      const errMsg = e instanceof Error ? e.message : String(e);
      if (errMsg.includes('cancelled') || errMsg.includes('rejected')) {
        toast.info('Repayment cancelled');
      } else {
        toast.error(errMsg || 'Repayment failed');
      }
    } finally {
      setRepaying(null);
    }
  };

  return (
    <div className="space-y-8">
      <Reveal>
        <header>
          <p className="eyebrow mb-3">Borrow</p>
          <h1 className="text-5xl md:text-6xl tracking-tight">Capital, <span className="italic font-light">on demand</span>.</h1>
        </header>
      </Reveal>

      {!kycReady && (
        <Reveal delay={60}>
          <div className="rounded-[20px] border bg-warning/10 border-warning/20 p-5 flex items-center gap-4">
            <AlertTriangle className="text-warning shrink-0"/>
            <div className="flex-1">
              <p className="font-medium">{kycStatus === 'verified' ? 'Borrower role required' : 'KYC required'}</p>
              <p className="text-sm text-muted-foreground">Complete identity verification with a borrower role to unlock loans.</p>
            </div>
            <Link to="/app/kyc" className="pill-ink">Complete KYC <ArrowUpRight size={14}/></Link>
          </div>
        </Reveal>
      )}

      {/* Repay success banner */}
      {repaySuccess && (
        <Reveal>
          <div className="rounded-[20px] border bg-success/10 border-success/20 p-5 flex items-center gap-4">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-success/10 text-success">
              <Check size={18}/>
            </div>
            <div className="flex-1">
              <p className="font-medium">Loan repaid on-chain</p>
              <p className="mono text-xs text-muted-foreground break-all mt-1">{repaySuccess.tx}</p>
            </div>
            <a
              href={`https://lora.algokit.io/testnet/transaction/${repaySuccess.tx}`}
              target="_blank" rel="noreferrer"
              className="pill-ghost shrink-0"
            >
              Lora <ExternalLink size={12}/>
            </a>
          </div>
        </Reveal>
      )}

      {/* Active loan card */}
      {active && active.status === 'active' && !repaySuccess && (
        <Reveal>
          <div className="mc-card-lg">
            <div className="flex items-start justify-between mb-6">
              <div>
                <p className="eyebrow mb-1">Active loan</p>
                <h2 className="text-2xl">Outstanding balance</h2>
              </div>
              <div className="text-right">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Clock size={14}/>
                  <span>{daysRemaining(active.created_at, active.tenure_days)} days remaining</span>
                </div>
              </div>
            </div>

            <div className="grid sm:grid-cols-4 gap-6 mb-8">
              <div>
                <p className="text-xs text-muted-foreground">Principal</p>
                <p className="mono text-2xl mt-1">◎ {fmtAlgo(active.amount_algo)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Tenure</p>
                <p className="mono text-2xl mt-1">{active.tenure_days}d</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Interest ({fmtBpsPct(active.interest_bps)})</p>
                <p className="mono text-2xl mt-1">◎ {interestAlgo(microToAlgo(active.amount_algo), active.interest_bps, active.tenure_days).toFixed(4)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total due</p>
                <p className="mono text-2xl mt-1">◎ {(microToAlgo(active.amount_algo) + interestAlgo(microToAlgo(active.amount_algo), active.interest_bps, active.tenure_days)).toFixed(4)}</p>
              </div>
            </div>

            <div className="flex items-center gap-4 flex-wrap">
              <button
                onClick={() => repay(active)}
                disabled={!!repaying}
                className="pill-ink disabled:opacity-40"
                id="btn-repay-loan"
              >
                {repaying === active.id ? (
                  <span className="flex items-center gap-2">
                    <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"/>
                    Waiting for Pera…
                  </span>
                ) : (
                  <><Wallet size={14}/> Repay ◎ {(microToAlgo(active.amount_algo) + interestAlgo(microToAlgo(active.amount_algo), active.interest_bps, active.tenure_days)).toFixed(2)} ALGO</>
                )}
              </button>
              <p className="text-xs text-muted-foreground">
                Repayment is a real on-chain transaction. Your credit score increases after repayment.
              </p>
            </div>
          </div>
        </Reveal>
      )}

      {/* Pending / approved loan status */}
      {active && (active.status === 'pending' || active.status === 'approved') && (
        <Reveal>
          <div className="rounded-[20px] border hairline bg-canvas p-5 flex items-center gap-4">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink/10">
              <Clock size={18} className="text-muted-foreground"/>
            </div>
            <div>
              <p className="font-medium capitalize">{active.status === 'pending' ? 'Application under review' : 'Loan approved — disbursement pending'}</p>
              <p className="text-sm text-muted-foreground">◎ {fmtAlgo(active.amount_algo)} · {active.tenure_days} days · {relTime(active.created_at)}</p>
            </div>
            <span className={`ml-auto status-pill ${active.status === 'approved' ? 'status-verified' : 'status-pending'}`}>
              {active.status}
            </span>
          </div>
        </Reveal>
      )}

      <div className="grid lg:grid-cols-5 gap-5">
        <Reveal className="lg:col-span-3" delay={80}>
          <div className="mc-card-lg">
            <p className="eyebrow mb-3">New application</p>
            <h2 className="text-2xl mb-6">Configure your loan</h2>
            {success ? (
              <div className="text-center py-10">
                <div className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-success/10 text-success mb-4"><Check size={28}/></div>
                <p className="text-2xl mb-2">Application submitted!</p>
                <p className="text-sm text-muted-foreground mb-6">Awaiting admin review. You'll see it in your loan history.</p>
                <button className="pill-ghost" onClick={() => { setSuccess(false); refresh(); }}>Apply again</button>
              </div>
            ) : (
              <>
                <label className="block mb-5">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">Loan amount (ALGO)</span>
                  <input
                    type="number" min={1} max={50} step={0.5} value={amount}
                    onChange={e => setAmount(Number(e.target.value))}
                    className="mt-2 w-full rounded-full border hairline bg-lifted px-5 py-3 mono focus:outline-none focus:border-ink"
                  />
                </label>
                <label className="block mb-5">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">Tenure</span>
                  <div className="mt-2 flex gap-2 flex-wrap">
                    {TENURES.map(t => (
                      <button key={t} onClick={() => setTenure(t)}
                        className={`rounded-full px-5 py-2.5 text-sm transition-all ${tenure === t ? 'bg-ink text-lifted' : 'bg-canvas hover:bg-ghost'}`}>
                        {t}d
                      </button>
                    ))}
                  </div>
                </label>
                <label className="block mb-6">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">Purpose (optional)</span>
                  <input
                    value={purpose} onChange={e => setPurpose(e.target.value)}
                    placeholder="e.g. inventory restock"
                    className="mt-2 w-full rounded-full border hairline bg-lifted px-5 py-3 text-sm focus:outline-none focus:border-ink"
                  />
                </label>
                <div className="rounded-[20px] bg-canvas p-5 mb-6 space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-muted-foreground">Principal</span><span className="mono">◎ {amount.toFixed(2)}</span></div>
                  <div className="flex justify-between"><span className="text-muted-foreground">Interest ({fmtBpsPct(bps)} APR · {tenure}d)</span><span className="mono">◎ {interest.toFixed(4)}</span></div>
                  <div className="h-px bg-hairline my-2"/>
                  <div className="flex justify-between font-medium"><span>Total Repayment</span><span className="mono">◎ {total.toFixed(4)}</span></div>
                </div>
                
                <p className="text-xs text-muted-foreground mb-4 text-center">
                  Your current credit score may affect approval terms and limits.
                </p>
                
                <button
                  onClick={apply}
                  disabled={!kycReady || submitting || (!!active && active.status !== 'rejected' && active.status !== 'repaid')}
                  className="pill-ink w-full justify-center disabled:opacity-40"
                  id="btn-apply-loan"
                >
                  {submitting ? (
                    <span className="flex items-center gap-2">
                      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"/>
                      Submitting…
                    </span>
                  ) : (
                    <>Apply for loan <ArrowUpRight size={14}/></>
                  )}
                </button>
                {!!active && active.status !== 'rejected' && active.status !== 'repaid' && (
                  <p className="mt-2 text-xs text-center text-muted-foreground">You have an existing active or pending loan</p>
                )}
              </>
            )}
          </div>
        </Reveal>

        <Reveal className="lg:col-span-2" delay={140}>
          <div className="mc-card-lg h-full">
            <p className="eyebrow mb-3">History</p>
            <h2 className="text-2xl mb-6">Loan history</h2>
            {loans.length === 0 ? (
              <p className="text-sm text-muted-foreground">No loans yet.</p>
            ) : (
              <ul className="space-y-3">
                {loans.map(l => (
                  <li key={l.id} className="flex flex-col gap-2 rounded-[20px] border hairline p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="mono text-sm">◎ {fmtAlgo(l.amount_algo)} · {l.tenure_days}d</p>
                        <p className="text-xs text-muted-foreground">{relTime(l.created_at)}</p>
                      </div>
                      <span className={`status-pill ${
                        l.status === 'repaid'    ? 'status-repaid'   :
                        l.status === 'active'    ? 'status-active'   :
                        l.status === 'approved'  ? 'status-verified' :
                        l.status === 'pending'   ? 'status-pending'  :
                        l.status === 'rejected'  ? 'status-rejected' :
                        l.status === 'defaulted' ? 'status-rejected' : 'status-pending'
                      }`}>{l.status}</span>
                    </div>
                    {l.status === 'rejected' && (
                      <div className="mt-2 text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
                        {(l as any).rejection_reason || 'Rejected due to low credit score or pool limits'}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Reveal>
      </div>
    </div>
  );
}

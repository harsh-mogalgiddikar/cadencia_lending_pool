import { useEffect, useState } from 'react';
import { useAuth } from '@/store/auth';
import api from '@/lib/api';
import { fmtAlgo, fmtBpsPct, scoreTier, relTime } from '@/lib/format';
import type { Loan, PoolStats, ScoreData } from '@/lib/types';
import { Reveal } from '@/components/ui/Reveal';
import { ArrowUpRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Dashboard() {
  const { address, kycStatus, role } = useAuth();
  const [pool, setPool] = useState<PoolStats | null>(null);
  const [score, setScore] = useState<ScoreData | null>(null);
  const [loans, setLoans] = useState<Loan[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!address) return;
    const fetchAll = async () => {
      try {
        const [poolRes, scoreRes, loansRes] = await Promise.all([
          api.get('/api/pool/stats'),
          api.get(`/api/pool/score/${address}`),   // note: /api/pool/score/ not /api/score/
          api.get('/api/loans/my'),
        ]);
        setPool(poolRes.data);
        setScore(scoreRes.data);
        setLoans(loansRes.data.loans ?? []);
      } catch {
        // Errors handled globally by the 401 interceptor; others are silent
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
    // Poll pool stats every 30s (live utilization bar)
    const id = setInterval(() => api.get('/api/pool/stats').then(r => setPool(r.data)).catch(() => {}), 30000);
    return () => clearInterval(id);
  }, [address]);

  const active = loans.find(l => ['active', 'approved'].includes(l.status));
  const tier = score ? scoreTier(score.score) : null;
  const utilPct = pool ? pool.utilizationBps / 100 : 0;
  const utilColor = utilPct < 60 ? 'hsl(var(--success))' : utilPct < 80 ? 'hsl(var(--warning))' : 'hsl(var(--destructive))';

  if (loading) return (
    <div className="space-y-8 animate-pulse">
      <div className="h-16 w-72 rounded-full bg-ghost" />
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="mc-card h-28 bg-ghost" />
        ))}
      </div>
    </div>
  );

  // Pool not deployed yet
  const poolNotDeployed = (pool as any)?.message;

  return (
    <div className="space-y-8">
      <Reveal>
        <header className="flex items-end justify-between flex-wrap gap-4">
          <div>
            <p className="eyebrow mb-3">Workspace</p>
            <h1 className="text-5xl md:text-6xl tracking-tight">Welcome <span className="italic font-light">back</span>.</h1>
          </div>
          <span className={`status-pill ${
            kycStatus === 'verified' ? 'status-verified' :
            kycStatus === 'pending'  ? 'status-pending'  :
            kycStatus === 'rejected' ? 'status-rejected' : 'status-pending'
          }`}>KYC · {kycStatus.replace('_',' ')}</span>
        </header>
      </Reveal>

      {poolNotDeployed && (
        <Reveal>
          <div className="rounded-[20px] border bg-warning/10 border-warning/20 p-4 text-sm text-warning">
            Pool contracts not yet deployed on-chain. Stats will show zeros until deployment.
          </div>
        </Reveal>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Reveal delay={50}>
          <div className="mc-card">
            <p className="eyebrow mb-3">Credit Score</p>
            {score && score.initialized ? (
              <>
                <p className="mono text-4xl">{score.score}</p>
                <p className="mt-1 text-xs" style={{ color: tier?.color }}>{tier?.label}</p>
              </>
            ) : (
              <>
                <p className="mono text-4xl text-muted-foreground">—</p>
                <p className="mt-1 text-xs text-muted-foreground">Not initialized</p>
              </>
            )}
          </div>
        </Reveal>
        <Reveal delay={100}>
          <div className="mc-card">
            <p className="eyebrow mb-3">Pool TVL</p>
            <p className="mono text-4xl">{pool ? `◎ ${fmtAlgo(pool.totalLiquidity, 0)}` : '—'}</p>
            <p className="mt-1 text-xs text-muted-foreground">ALGO</p>
          </div>
        </Reveal>
        <Reveal delay={150}>
          <div className="mc-card">
            <p className="eyebrow mb-3">Utilization</p>
            <p className="mono text-4xl">{pool ? fmtBpsPct(pool.utilizationBps) : '—'}</p>
            <p className="mt-1 text-xs text-muted-foreground">of pool deployed</p>
          </div>
        </Reveal>
        <Reveal delay={200}>
          <div className="mc-card">
            <p className="eyebrow mb-3">Active Loan</p>
            <p className="mono text-4xl">{active ? `◎ ${fmtAlgo(active.amount_algo)}` : 'None'}</p>
            <p className="mt-1 text-xs text-muted-foreground">{active ? `${active.tenure_days}d tenure` : 'No active borrowing'}</p>
          </div>
        </Reveal>
      </div>

      <Reveal>
        <div className="mc-card-lg">
          <div className="flex items-end justify-between mb-6 flex-wrap gap-3">
            <div>
              <p className="eyebrow mb-2">Pool Utilization</p>
              <h2 className="text-3xl">{pool ? fmtBpsPct(pool.utilizationBps) : '—'} deployed</h2>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              {pool && <>Available: <span className="mono">◎ {fmtAlgo(pool.availableLiquidity, 0)}</span> · {pool.totalDepositors} depositors</>}
            </div>
          </div>
          <div className="h-3 w-full rounded-full bg-canvas overflow-hidden">
            <div className="h-full rounded-full transition-all duration-700"
              style={{ width: `${Math.min(100, utilPct)}%`, background: utilColor }}/>
          </div>
        </div>
      </Reveal>

      <Reveal>
        <div className="mc-card-lg">
          <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
            <div>
              <p className="eyebrow mb-2">Recent activity</p>
              <h2 className="text-3xl">My loans</h2>
            </div>
            <Link to="/app/borrow" className="pill-ghost">Apply for new <ArrowUpRight size={14}/></Link>
          </div>
          {loans.length === 0 ? (
            <div className="py-12 flex flex-col items-center text-center">
              <p className="text-muted-foreground mb-4">No activity yet — start by {role === 'lender' ? 'lending' : 'borrowing'}.</p>
              <Link to={role === 'lender' ? '/app/lend' : '/app/borrow'} className="pill-ink">
                {role === 'lender' ? 'Start Lending' : 'Apply for Loan'}
              </Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs uppercase tracking-wider text-muted-foreground border-b hairline">
                  <tr><th className="text-left py-3 font-medium">Amount</th><th className="text-left font-medium">Tenure</th><th className="text-left font-medium">Status</th><th className="text-left font-medium">Applied</th></tr>
                </thead>
                <tbody>
                  {loans.slice(0, 5).map(l => (
                    <tr key={l.id} className="border-b hairline last:border-0">
                      <td className="py-4 mono">◎ {fmtAlgo(l.amount_algo)}</td>
                      <td className="mono">{l.tenure_days}d</td>
                      <td><span className={`status-pill status-${l.status === 'repaid' ? 'repaid' : l.status === 'active' ? 'active' : l.status === 'pending' ? 'pending' : l.status === 'rejected' ? 'rejected' : 'pending'}`}>{l.status}</span></td>
                      <td className="text-muted-foreground">{relTime(l.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Reveal>
    </div>
  );
}

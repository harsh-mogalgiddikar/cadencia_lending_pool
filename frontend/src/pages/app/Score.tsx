import { useEffect, useState } from 'react';
import { useAuth } from '@/store/auth';
import api from '@/lib/api';
import type { ScoreData } from '@/lib/types';
import { scoreTier } from '@/lib/format';
import { Reveal } from '@/components/ui/Reveal';

const FACTORS = [
  { label: 'Repayment History', pct: 35 },
  { label: 'Credit Age',         pct: 25 },
  { label: 'Loan Utilization',   pct: 25 },
  { label: 'KYC Verification',   pct: 15 },
];

export default function Score() {
  const { address } = useAuth();
  const [data, setData] = useState<ScoreData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!address) return;
    // Correct URL: /api/pool/score/ (not /api/score/)
    api.get(`/api/pool/score/${address}`)
      .then(r => setData(r.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [address]);

  const score = data?.score ?? 0;
  const angle = (Math.min(1000, Math.max(0, score)) / 1000) * 180 - 90;
  const tier = scoreTier(score);

  return (
    <div className="space-y-8">
      <Reveal>
        <header>
          <p className="eyebrow mb-3">Credit</p>
          <h1 className="text-5xl md:text-6xl tracking-tight">Your <span className="italic font-light">on-chain</span> reputation.</h1>
        </header>
      </Reveal>

      <div className="grid lg:grid-cols-5 gap-5">
        <Reveal className="lg:col-span-3">
          <div className="mc-card-lg flex flex-col items-center justify-center text-center min-h-[420px]">
            {loading ? (
              <div className="animate-pulse space-y-4 w-full max-w-md">
                <div className="h-48 bg-ghost rounded-full mx-auto w-48" />
                <div className="h-16 bg-ghost rounded-full" />
              </div>
            ) : data && !data.initialized ? (
              <div className="space-y-3">
                <p className="mono text-6xl text-muted-foreground">—</p>
                <p className="text-sm text-muted-foreground">No on-chain score yet. Complete your first loan cycle to initialize.</p>
              </div>
            ) : (
              <>
                <svg viewBox="0 0 200 120" className="w-full max-w-md">
                  <path d="M 20 100 A 80 80 0 0 1 180 100" fill="none" stroke="hsl(var(--ghost))" strokeWidth="14" strokeLinecap="round"/>
                  <path d="M 20 100 A 80 80 0 0 1 180 100"
                    fill="none" stroke={tier.color} strokeWidth="14" strokeLinecap="round"
                    strokeDasharray="251.3" strokeDashoffset={(1 - score/1000) * 251.3}
                    style={{ transition: 'stroke-dashoffset 1.4s cubic-bezier(0.22,1,0.36,1)' }}/>
                  <line x1="100" y1="100" x2="100" y2="35" stroke="hsl(var(--ink))" strokeWidth="2" strokeLinecap="round"
                    style={{ transformOrigin: '100px 100px', transform: `rotate(${angle}deg)`, transition: 'transform 1.4s cubic-bezier(0.22,1,0.36,1)' }}/>
                  <circle cx="100" cy="100" r="6" fill="hsl(var(--ink))"/>
                </svg>
                <p className="mono text-7xl mt-4">{score}</p>
                <p className="mt-2 text-sm" style={{ color: tier.color }}>{tier.label}</p>
                <div className="mt-8 grid grid-cols-4 gap-1.5 w-full max-w-md">
                  {[
                    { l: 'Poor',      c: 'hsl(var(--destructive))' },
                    { l: 'Fair',      c: 'hsl(var(--warning))' },
                    { l: 'Good',      c: 'hsl(var(--info))' },
                    { l: 'Excellent', c: 'hsl(var(--success))' },
                  ].map(t => (
                    <div key={t.l}>
                      <div className="h-1.5 rounded-full" style={{ background: t.c }}/>
                      <p className="mt-2 text-[10px] text-muted-foreground text-center">{t.l}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </Reveal>

        <Reveal className="lg:col-span-2" delay={100}>
          <div className="mc-card-lg space-y-8">
            <div>
              <p className="eyebrow mb-3">Stats</p>
              <div className="grid grid-cols-2 gap-4">
                <div><p className="text-xs text-muted-foreground">Total loans</p><p className="mono text-2xl mt-1">{data?.totalLoans ?? 0}</p></div>
                <div><p className="text-xs text-muted-foreground">Repaid</p><p className="mono text-2xl mt-1">{data?.successfulRepayments ?? 0}</p></div>
              </div>
            </div>
            <div>
              <p className="eyebrow mb-3">Factors</p>
              <ul className="space-y-3">
                {FACTORS.map(f => (
                  <li key={f.label}>
                    <div className="flex justify-between text-sm mb-1.5">
                      <span>{f.label}</span><span className="mono text-muted-foreground">{f.pct}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-canvas overflow-hidden">
                      <div className="h-full bg-ink" style={{ width: `${f.pct}%` }}/>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="eyebrow mb-3">Improve your score</p>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>• Repay on time — each repayment adds <span className="text-ink">+50</span> points.</li>
                <li>• Avoid defaults — each default subtracts <span className="text-ink">−200</span> points.</li>
                <li>• Maintain consistent borrowing activity.</li>
              </ul>
            </div>
          </div>
        </Reveal>
      </div>
    </div>
  );
}

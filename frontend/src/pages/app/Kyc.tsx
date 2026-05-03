import { useEffect, useState } from 'react';
import { useAuth } from '@/store/auth';
import api from '@/lib/api';
import type { KycUser, Role } from '@/lib/types';
import { Reveal } from '@/components/ui/Reveal';
import { Check, Clock, ArrowRight, ArrowLeft, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

export default function Kyc() {
  const { address, setAuth, kycStatus } = useAuth();
  const [data, setData] = useState<KycUser | { status: 'not_found' } | null>(null);
  const [step, setStep] = useState<0 | 1>(0);
  const [role, setRole] = useState<Role | ''>('');
  const [businessName, setBusinessName] = useState('');
  const [gstin, setGstin] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const refresh = async () => {
    if (!address) return;
    const { data: k } = await api.get(`/api/kyc/status/${address}`);
    setData(k);
    if ('kyc_status' in k) setAuth({ kycStatus: k.kyc_status, role: k.role });
  };

  useEffect(() => { refresh(); }, [address]); // eslint-disable-line
  useEffect(() => {
    if (kycStatus === 'pending') {
      const id = setInterval(refresh, 5000);
      return () => clearInterval(id);
    }
  }, [kycStatus, address]); // eslint-disable-line

  if (!data) return <div className="text-sm text-muted-foreground">Loading…</div>;

  const isFound = 'kyc_status' in data;

  if (isFound && data.kyc_status === 'verified') {
    return (
      <Reveal>
        <div className="mc-card-lg max-w-2xl mx-auto text-center py-16">
          <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-success/10 text-success mb-6">
            <ShieldCheck size={32}/>
          </div>
          <p className="eyebrow justify-center mb-3" style={{ display: 'inline-flex' }}>Onboarding Complete</p>
          <h1 className="text-4xl mb-3">Identity <span className="italic font-light">secured</span>.</h1>
          <p className="text-muted-foreground mb-8">{data.business_name} · Tier {data.kyc_tier} <span className="capitalize">{data.role}</span></p>
          
          <div className="flex flex-col items-center gap-3 max-w-sm mx-auto bg-canvas rounded-2xl p-6">
            {data.role === 'borrower' || data.role === 'both' ? (
              <div className="flex items-center gap-3 w-full">
                <Check size={16} className="text-success shrink-0"/>
                <span className="text-sm text-left flex-1">You are now eligible to borrow up to <span className="mono">50 ALGO</span>.</span>
              </div>
            ) : null}
            {data.role === 'lender' || data.role === 'both' ? (
              <div className="flex items-center gap-3 w-full">
                <Check size={16} className="text-success shrink-0"/>
                <span className="text-sm text-left flex-1">You can now deposit ALGO to earn pool yield.</span>
              </div>
            ) : null}
          </div>
        </div>
      </Reveal>
    );
  }

  if (isFound && data.kyc_status === 'pending') {
    return (
      <Reveal>
        <div className="mc-card-lg max-w-2xl mx-auto text-center py-16">
          <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-warning/10 text-warning mb-6 floaty">
            <Clock size={32}/>
          </div>
          <p className="eyebrow justify-center mb-3" style={{ display: 'inline-flex' }}>Pending</p>
          <h1 className="text-4xl mb-3">Under <span className="italic font-light">review</span>.</h1>
          <span className="status-pill status-pending mb-6"><Clock size={12}/> Auto-checking every 5s</span>
          <p className="text-muted-foreground">Usually takes a few moments on testnet.</p>
        </div>
      </Reveal>
    );
  }

  const submit = async () => {
    if (!address || !role || businessName.length < 2) return;
    setSubmitting(true);
    try {
      await api.post('/api/kyc/submit', { businessName, gstin: gstin || undefined, role });
      toast.success('KYC submitted! Awaiting verification.');
      setAuth({ kycStatus: 'pending', role });
      await refresh();
    } catch (e: any) {
      toast.error(e?.response?.data?.error ?? e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <Reveal>
        <header>
          <p className="eyebrow mb-3">Onboarding</p>
          <h1 className="text-5xl md:text-6xl tracking-tight">Verify your <span className="italic font-light">identity</span>.</h1>
          <p className="mt-3 max-w-xl text-muted-foreground">Two short steps. Once verified, your KYC tier is registered on-chain.</p>
        </header>
      </Reveal>
      <Reveal delay={80}>
        <div className="mc-card-lg max-w-3xl">
          <div className="flex items-center gap-2 mb-8">
            {[0,1].map(i => (
              <div key={i} className={`h-1.5 flex-1 rounded-full transition-colors ${i <= step ? 'bg-ink' : 'bg-ghost'}`} />
            ))}
          </div>
          {step === 0 && (
            <>
              <p className="eyebrow mb-3">Step 01</p>
              <h2 className="text-3xl mb-6">Choose your role</h2>
              <div className="grid sm:grid-cols-3 gap-3">
                {([
                  { v: 'borrower', t: 'Borrower', d: 'Apply for collateral-free loans.' },
                  { v: 'lender',   t: 'Lender',   d: 'Deposit ALGO and earn yield.' },
                  { v: 'both',     t: 'Both',     d: 'Full borrow + lend access.' },
                ] as const).map(o => (
                  <button key={o.v} onClick={() => setRole(o.v)}
                    className={`text-left rounded-[20px] border p-5 transition-all hover:-translate-y-0.5 ${role === o.v ? 'border-ink bg-canvas' : 'hairline bg-lifted'}`}>
                    <ShieldCheck size={18} className="mb-3"/>
                    <p className="font-medium">{o.t}</p>
                    <p className="text-xs text-muted-foreground mt-1">{o.d}</p>
                  </button>
                ))}
              </div>
              <div className="mt-8 flex justify-end">
                <button onClick={() => setStep(1)} disabled={!role} className="pill-ink disabled:opacity-40 disabled:pointer-events-none">Continue <ArrowRight size={14}/></button>
              </div>
            </>
          )}
          {step === 1 && (
            <>
              <p className="eyebrow mb-3">Step 02</p>
              <h2 className="text-3xl mb-6">Business details</h2>
              <div className="space-y-5">
                <label className="block">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">Business name</span>
                  <input value={businessName} onChange={e => setBusinessName(e.target.value)}
                    className="mt-2 w-full rounded-full border hairline bg-lifted px-5 py-3 text-sm focus:outline-none focus:border-ink"
                    placeholder="Acme Co." />
                </label>
                <label className="block">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">GSTIN (optional)</span>
                  <input value={gstin} onChange={e => setGstin(e.target.value)}
                    className="mt-2 w-full rounded-full border hairline bg-lifted px-5 py-3 text-sm mono focus:outline-none focus:border-ink"
                    placeholder="22AAAAA0000A1Z5"/>
                </label>
              </div>
              <div className="mt-8 flex justify-between">
                <button onClick={() => setStep(0)} className="pill-ghost"><ArrowLeft size={14}/> Back</button>
                <button onClick={submit} disabled={businessName.length < 2 || submitting} className="pill-ink disabled:opacity-40">
                  {submitting ? 'Submitting…' : 'Submit KYC'} <ArrowRight size={14}/>
                </button>
              </div>
            </>
          )}
        </div>
      </Reveal>
    </div>
  );
}

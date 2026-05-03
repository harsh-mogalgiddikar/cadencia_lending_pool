import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/store/auth';
import api from '@/lib/api';
import { fmtAlgo, fmtBpsPct } from '@/lib/format';
import { MagneticButton } from '@/components/ui/MagneticButton';
import { Reveal } from '@/components/ui/Reveal';
import { WalletModal } from '@/components/WalletModal';
import { ArrowUpRight, Sparkles, Lock, Zap, LineChart, Globe2, Layers } from 'lucide-react';
import type { PoolStats } from '@/lib/types';

const APP_IDS = [
  { name: 'KYC Registry',     id: '759379619' },
  { name: 'Credit Score',     id: '759379629' },
  { name: 'Lending Pool',     id: '759454547' },
  { name: 'Loan Manager',     id: '759454548' },
  { name: 'Repayment Escrow', id: '759379632' },
];

const FEATURES = [
  { icon: Lock,      title: 'Zero-Collateral Loans',  body: 'Underwritten by an on-chain credit score, not your assets.' },
  { icon: Zap,       title: 'Instant Settlement',      body: 'Approvals settle in seconds on the Algorand network.' },
  { icon: LineChart, title: 'Transparent Scoring',     body: 'Every score factor is auditable on-chain.' },
  { icon: Layers,    title: 'Non-Custodial',           body: 'Your wallet, your keys. Cadencia never touches your funds.' },
  { icon: Sparkles,  title: 'Competitive Yield',        body: 'Earn lender APY proportional to pool utilization.' },
  { icon: Globe2,    title: 'Algorand Native',          body: 'Built on the carbon-negative, instant-finality L1.' },
];

export default function Landing() {
  const [walletOpen, setWalletOpen] = useState(false);
  const [stats, setStats] = useState<PoolStats | null>(null);
  const [scrollY, setScrollY] = useState(0);
  const isAuthed = useAuth(s => s.isAuthenticated);

  useEffect(() => {
    api.get('/api/pool/stats').then(r => setStats(r.data)).catch(() => {});
    const onScroll = () => setScrollY(window.scrollY);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const openWallet = () => setWalletOpen(true);

  return (
    <div className="min-h-screen bg-canvas text-ink overflow-hidden">
      {/* Floating nav */}
      <header className="fixed top-5 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-5xl">
        <div className="nav-pill flex items-center justify-between px-5 py-3">
          <Link to="/" className="flex items-center gap-2 px-2">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-ink text-lifted text-xs">◉</span>
            <span className="text-lg font-semibold tracking-tight">Cadencia</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium">
            {['Borrow','Score','Contracts'].map(l => (
              <a key={l} href={`#${l.toLowerCase()}`} className="text-muted-foreground hover:text-ink transition-colors">{l}</a>
            ))}
          </nav>
          {isAuthed
            ? <MagneticButton to="/app/dashboard" className="!py-2.5 !px-6 font-medium">Open app <ArrowUpRight size={14}/></MagneticButton>
            : <MagneticButton onClick={openWallet} className="!py-2.5 !px-6 font-medium">Connect wallet <ArrowUpRight size={14}/></MagneticButton>}
        </div>
      </header>

      {/* HERO */}
      <section className="relative pt-40 pb-32 px-6">
        {/* Orbital arc */}
        <svg className="absolute -top-20 -right-40 w-[820px] h-[820px] pointer-events-none opacity-50 spin-slow" viewBox="0 0 800 800" aria-hidden>
          <circle cx="400" cy="400" r="360" fill="none" stroke="hsl(var(--ghost))" strokeWidth="1" className="draw-arc"/>
          <circle cx="400" cy="400" r="280" fill="none" stroke="hsl(var(--ghost))" strokeWidth="1"/>
          <circle cx="760" cy="400" r="6" fill="hsl(var(--signal))"/>
        </svg>
        <div
          className="absolute left-[-10%] top-[20%] w-[420px] h-[420px] rounded-full bg-ghost/40 blur-3xl pointer-events-none"
          style={{ transform: `translateY(${scrollY * 0.15}px)` }}
        />

        <div className="relative max-w-6xl mx-auto">
          <Reveal>
            <div className="inline-flex items-center gap-2 rounded-full border hairline bg-lifted px-4 py-2 text-xs font-medium uppercase tracking-wider mb-6">
              <span className="h-2 w-2 rounded-full bg-success animate-pulse"/>
              Powered by Algorand
            </div>
          </Reveal>
          <Reveal delay={80}>
            <h1 className="text-[clamp(3.5rem,9vw,9rem)] leading-[0.92] tracking-[-0.04em]">
              The next era of<br/>
              <span className="italic font-light text-ink/80">digital</span> finance.
            </h1>
          </Reveal>
          <Reveal delay={180}>
            <p className="mt-8 max-w-xl text-lg md:text-xl text-muted-foreground leading-relaxed">
              Cadencia is an Algorand-native credit platform. Borrow without collateral, earn yield by lending, and build a verifiable on-chain reputation — all from your wallet.
            </p>
          </Reveal>
          <Reveal delay={260}>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <MagneticButton onClick={openWallet} className="!py-4 !px-8 text-base">Connect wallet <ArrowUpRight size={16}/></MagneticButton>
              <div className="flex items-center gap-4 px-4 py-2 border hairline rounded-full bg-lifted">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Secured by</p>
                <div className="flex items-center gap-2 font-semibold">
                  <span className="grid h-5 w-5 place-items-center rounded-full bg-ink text-lifted text-[10px]">◐</span>
                  Pera
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* STATS BAR */}
      <section className="relative px-6 pb-28">
        <div className="max-w-6xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { k: 'Total Locked',   v: stats ? `◎ ${fmtAlgo(stats.totalLiquidity, 0)}` : '◎ 245,500,000', s: 'ALGO' },
            { k: 'Active Loans',   v: stats ? `◎ ${fmtAlgo(stats.outstandingLoans, 0)}` : '◎ 182,300,000', s: 'ALGO outstanding' },
            { k: 'Utilization',    v: stats ? fmtBpsPct(stats.utilizationBps) : '74.2%', s: 'of pool deployed' },
            { k: 'Depositors',     v: stats ? `${stats.totalDepositors}` : '14,239', s: 'wallets earning yield' },
          ].map((s, i) => (
            <Reveal key={s.k} delay={i * 60}>
              <div className="mc-card hover:-translate-y-1">
                <p className="eyebrow mb-3">{s.k}</p>
                <p className="mono text-3xl md:text-4xl">{s.v}</p>
                <p className="mt-2 text-sm text-muted-foreground">{s.s}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section id="borrow" className="relative px-6 py-28">
        <div className="max-w-6xl mx-auto">
          <Reveal><p className="eyebrow mb-4">How it works</p></Reveal>
          <Reveal delay={80}><h2 className="text-5xl md:text-7xl tracking-tight max-w-3xl">Three steps from <span className="italic font-light">wallet</span> to working capital.</h2></Reveal>

          <div className="mt-16 grid md:grid-cols-3 gap-5">
            {[
              { n: '01', t: 'Connect Wallet', b: 'An off-chain signature proves you control your address. Zero gas, zero passwords.' },
              { n: '02', t: 'Complete KYC',   b: 'Submit business details once. Our oracle posts your verification on-chain.' },
              { n: '03', t: 'Borrow or Lend',  b: 'Apply for credit at competitive rates, or deposit ALGO and earn pool yield.' },
            ].map((s, i) => (
              <Reveal key={s.n} delay={i * 100}>
                <article className="mc-card-lg group relative overflow-hidden">
                  <div className="flex items-start justify-between mb-12">
                    <span className="mono text-xs text-muted-foreground">{s.n}</span>
                    <span className="satellite group-hover:rotate-[-45deg]"><ArrowUpRight size={18}/></span>
                  </div>
                  <h3 className="text-2xl mb-3">{s.t}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{s.b}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* WHY CADENCIA */}
      <section id="score" className="relative px-6 py-28 bg-lifted">
        <div className="max-w-6xl mx-auto">
          <Reveal><p className="eyebrow mb-4">Why Cadencia</p></Reveal>
          <Reveal delay={80}>
            <div className="flex items-end justify-between flex-wrap gap-6 mb-14">
              <h2 className="text-5xl md:text-7xl tracking-tight max-w-3xl">Built for a <span className="italic font-light">programmable</span> economy.</h2>
              <p className="max-w-md text-muted-foreground">Six guarantees that separate Cadencia from legacy lenders and from every other DeFi pool.</p>
            </div>
          </Reveal>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={i * 50}>
                <article className="mc-card h-full hover:-translate-y-1">
                  <div className="grid h-11 w-11 place-items-center rounded-full bg-canvas mb-5">
                    <f.icon size={18}/>
                  </div>
                  <h3 className="text-xl mb-2">{f.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{f.body}</p>
                </article>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative px-6 py-28">
        <div className="max-w-6xl mx-auto">
          <Reveal>
            <div className="rounded-[40px] bg-ink text-lifted p-10 md:p-16 relative overflow-hidden">
              <svg className="absolute -right-20 -bottom-20 w-[480px] h-[480px] opacity-20 spin-slow" viewBox="0 0 400 400" aria-hidden>
                <circle cx="200" cy="200" r="180" fill="none" stroke="hsl(var(--lifted))" strokeWidth="1"/>
                <circle cx="200" cy="200" r="120" fill="none" stroke="hsl(var(--lifted))" strokeWidth="1"/>
                <circle cx="380" cy="200" r="5" fill="hsl(var(--signal))"/>
              </svg>
              <p className="eyebrow mb-5" style={{ color: 'hsl(var(--lifted) / 0.7)' }}>Ready when you are</p>
              <h2 className="text-4xl md:text-6xl max-w-3xl tracking-tight">Build your credit score <span className="italic font-light">on-chain</span>, today.</h2>
              <div className="mt-10">
                <button onClick={openWallet} className="inline-flex items-center gap-2 rounded-full bg-lifted text-ink px-7 py-3.5 text-sm font-medium hover:bg-canvas transition-colors">
                  Get started free <ArrowUpRight size={16}/>
                </button>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* FOOTER */}
      <footer id="contracts" className="bg-ink text-lifted px-6 py-20">
        <div className="max-w-6xl mx-auto">
          <p className="eyebrow mb-5" style={{ color: 'hsl(var(--lifted) / 0.7)' }}>Footer</p>
          <h2 className="text-4xl md:text-6xl tracking-tight max-w-3xl">Let's reshape <span className="italic font-light">credit</span> together.</h2>

          <div className="mt-14 grid md:grid-cols-4 gap-10">
            <div className="md:col-span-1">
              <div className="flex items-center gap-2">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-lifted text-ink text-xs">◉</span>
                <span className="text-base font-medium">Cadencia</span>
              </div>
              <p className="mt-4 text-xs text-lifted/60 leading-relaxed">
                Running on Algorand Testnet · Not for production use. Smart contracts are unaudited demonstrations.
              </p>
            </div>
            <div>
              <p className="eyebrow mb-4" style={{ color: 'hsl(var(--lifted) / 0.7)' }}>Product</p>
              <ul className="space-y-2 text-sm text-lifted/80">
                <li><a href="#borrow" className="hover:text-lifted">Borrow</a></li>
                <li><a href="#score" className="hover:text-lifted">Credit Score</a></li>
                <li><a href="#contracts" className="hover:text-lifted">Contracts</a></li>
              </ul>
            </div>
            <div>
              <p className="eyebrow mb-4" style={{ color: 'hsl(var(--lifted) / 0.7)' }}>App IDs</p>
              <ul className="space-y-2 text-sm text-lifted/80 mono">
                {APP_IDS.map(c => (
                  <li key={c.id}>
                    <a target="_blank" rel="noreferrer" className="hover:text-lifted inline-flex items-center gap-2"
                       href={`https://testnet.algoexplorer.io/application/${c.id}`}>
                      {c.name} <ArrowUpRight size={12}/>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <p className="eyebrow mb-4" style={{ color: 'hsl(var(--lifted) / 0.7)' }}>Legal</p>
              <p className="text-xs text-lifted/60 leading-relaxed">By using Cadencia you consent to our experimental terms.</p>
              <button onClick={openWallet} className="mt-4 inline-flex items-center gap-2 rounded-full bg-signal text-ink px-4 py-2 text-xs font-medium hover:opacity-90 transition-opacity">
                Consent & connect
              </button>
            </div>
          </div>

          <div className="mt-16 pt-8 border-t border-lifted/10 flex justify-between flex-wrap gap-3 text-xs text-lifted/50">
            <span>© {new Date().getFullYear()} Cadencia Labs.</span>
            <span className="mono">Algorand Testnet · v0.1.0</span>
          </div>
        </div>
      </footer>

      <WalletModal open={walletOpen} onClose={() => setWalletOpen(false)} />
    </div>
  );
}

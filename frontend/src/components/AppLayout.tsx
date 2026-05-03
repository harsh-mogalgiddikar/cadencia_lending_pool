import { Link, NavLink, Navigate, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '@/store/auth';
import api from '@/lib/api';
import { useEffect, useState } from 'react';
import { LayoutGrid, HandCoins, Banknote, Gauge, ShieldCheck, LogOut, Shield, Menu, X, ArrowLeft } from 'lucide-react';
import { truncAddr } from '@/lib/format';

const CORE_NAV = [
  { to: '/app/dashboard', label: 'Dashboard', icon: LayoutGrid },
  { to: '/app/borrow',    label: 'Borrow',    icon: HandCoins },
  { to: '/app/lend',      label: 'Lend',      icon: Banknote },
];

const ACCOUNT_NAV = [
  { to: '/app/score',     label: 'Score',     icon: Gauge },
  { to: '/app/kyc',       label: 'KYC',       icon: ShieldCheck },
];

const ADMIN_NAV = [
  { to: '/admin/kyc',   label: 'KYC Queue',  icon: ShieldCheck },
  { to: '/admin/loans', label: 'Loan Queue', icon: HandCoins },
];

export default function AppLayout({ admin = false }: { admin?: boolean }) {
  const { isAuthenticated, isAdmin, address, kycStatus, signOut, setAuth } = useAuth();
  const nav = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  // On every protected page mount:
  // 1. Verify session is still valid with the backend
  // 2. Hydrate isAdmin from the server (not localStorage)
  // 3. Hydrate kycStatus from the real KYC endpoint
  useEffect(() => {
    if (!address) return;
    api.get('/api/auth/me')
      .then(({ data }) => {
        if (!data.authenticated) {
          signOut();
          nav('/');
          return null;
        }
        // Hydrate server-authoritative admin flag
        setAuth({ isAdmin: data.isAdmin });
        return api.get(`/api/kyc/status/${data.address}`);
      })
      .then((res) => {
        if (!res) return;
        const kyc = res.data;
        if ('kyc_status' in kyc) {
          setAuth({ kycStatus: kyc.kyc_status, role: kyc.role });
        }
      })
      .catch(() => {
        // Network failure or 401 — sign out and redirect
        signOut();
        nav('/');
      });
  }, [address]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isAuthenticated) return <Navigate to="/" replace />;
  if (admin && !isAdmin)  return <Navigate to="/app/dashboard" replace />;

  // removed items parsing since we map directly


  const handleSignOut = () => { setMobileOpen(false); signOut(); nav('/'); };

  return (
    <div className="min-h-screen flex bg-canvas">
      {/* ── Desktop sidebar ── */}
      <aside className="w-[260px] shrink-0 hidden lg:flex flex-col gap-2 p-5 border-r hairline bg-lifted/60 backdrop-blur">
        <Link to="/" className="flex items-center gap-2 px-2 py-3 mb-2">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-ink text-lifted">◉</span>
          <span className="text-lg font-medium tracking-tight">Cadencia</span>
        </Link>

        {admin ? (
          <>
            <p className="eyebrow px-2 py-2">Admin Console</p>
            <Link
              to="/app/dashboard"
              className="flex items-center gap-2 rounded-full px-4 py-2 text-xs text-muted-foreground hover:bg-ghost hover:text-ink transition-all mb-1"
            >
              <ArrowLeft size={13}/> Back to App
            </Link>
            <nav className="flex flex-col gap-1">
              {ADMIN_NAV.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to}
                  className={({ isActive }) => `flex items-center gap-3 rounded-full px-4 py-2.5 text-sm transition-all ${isActive ? 'bg-ink text-lifted' : 'text-muted-foreground hover:bg-ghost hover:text-ink'}`}>
                  <Icon size={16}/> {label}
                </NavLink>
              ))}
            </nav>
          </>
        ) : (
          <>
            <p className="eyebrow px-2 py-2 mb-1">Core</p>
            <nav className="flex flex-col gap-1 mb-4">
              {CORE_NAV.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to}
                  className={({ isActive }) => `flex items-center gap-3 rounded-full px-4 py-2.5 text-sm transition-all ${isActive ? 'bg-ink text-lifted' : 'text-muted-foreground hover:bg-ghost hover:text-ink'}`}>
                  <Icon size={16}/> {label}
                </NavLink>
              ))}
            </nav>
            <p className="eyebrow px-2 py-2 mb-1">Account</p>
            <nav className="flex flex-col gap-1">
              {ACCOUNT_NAV.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to}
                  className={({ isActive }) => `flex items-center gap-3 rounded-full px-4 py-2.5 text-sm transition-all ${isActive ? 'bg-ink text-lifted' : 'text-muted-foreground hover:bg-ghost hover:text-ink'}`}>
                  <Icon size={16}/> {label}
                </NavLink>
              ))}
            </nav>
          </>
        )}

        {!admin && isAdmin && (
          <>
            <div className="my-3 h-px bg-hairline" />
            <p className="eyebrow px-2 py-2">Admin</p>
            <NavLink to="/admin/kyc" className="flex items-center gap-3 rounded-full px-4 py-2.5 text-sm text-muted-foreground hover:bg-ghost hover:text-ink">
              <Shield size={16}/> Open Console
            </NavLink>
          </>
        )}

        <div className="mt-auto rounded-[20px] border hairline bg-canvas p-4">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Connected</p>
          <p className="mono text-xs mt-1 break-all">{truncAddr(address ?? '', 8)}</p>
          <span className={`mt-2 status-pill ${
            kycStatus === 'verified' ? 'status-verified' :
            kycStatus === 'pending'  ? 'status-pending'  :
            kycStatus === 'rejected' ? 'status-rejected' : 'status-pending'
          }`}>{kycStatus.replace('_',' ')}</span>
          <button onClick={() => { signOut(); nav('/'); }} className="mt-4 w-full pill-ghost !py-2 !text-xs">
            <LogOut size={12}/> Sign out
          </button>
        </div>
      </aside>

      {/* ── Mobile slide-out drawer overlay ── */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-ink/50 backdrop-blur-sm"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* ── Mobile slide-out drawer ── */}
      <aside className={`lg:hidden fixed top-0 left-0 z-50 h-full w-[280px] bg-lifted border-r hairline flex flex-col gap-2 p-5 transition-transform duration-300 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="flex items-center justify-between mb-4">
          <Link to="/" onClick={() => setMobileOpen(false)} className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-full bg-ink text-lifted">◉</span>
            <span className="text-lg font-medium tracking-tight">Cadencia</span>
          </Link>
          <button onClick={() => setMobileOpen(false)} className="text-muted-foreground hover:text-ink" aria-label="Close menu">
            <X size={20}/>
          </button>
        </div>

        {admin ? (
          <>
            <p className="eyebrow px-2 py-1">Admin Console</p>
            <Link
              to="/app/dashboard"
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-2 rounded-full px-4 py-2 text-xs text-muted-foreground hover:bg-ghost hover:text-ink transition-all mb-1"
            >
              <ArrowLeft size={13}/> Back to App
            </Link>
            <nav className="flex flex-col gap-1">
              {ADMIN_NAV.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) => `flex items-center gap-3 rounded-full px-4 py-2.5 text-sm transition-all ${isActive ? 'bg-ink text-lifted' : 'text-muted-foreground hover:bg-ghost hover:text-ink'}`}>
                  <Icon size={16}/> {label}
                </NavLink>
              ))}
            </nav>
          </>
        ) : (
          <>
            <p className="eyebrow px-2 py-1 mb-1">Core</p>
            <nav className="flex flex-col gap-1 mb-4">
              {CORE_NAV.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) => `flex items-center gap-3 rounded-full px-4 py-2.5 text-sm transition-all ${isActive ? 'bg-ink text-lifted' : 'text-muted-foreground hover:bg-ghost hover:text-ink'}`}>
                  <Icon size={16}/> {label}
                </NavLink>
              ))}
            </nav>
            <p className="eyebrow px-2 py-1 mb-1">Account</p>
            <nav className="flex flex-col gap-1">
              {ACCOUNT_NAV.map(({ to, label, icon: Icon }) => (
                <NavLink key={to} to={to}
                  onClick={() => setMobileOpen(false)}
                  className={({ isActive }) => `flex items-center gap-3 rounded-full px-4 py-2.5 text-sm transition-all ${isActive ? 'bg-ink text-lifted' : 'text-muted-foreground hover:bg-ghost hover:text-ink'}`}>
                  <Icon size={16}/> {label}
                </NavLink>
              ))}
            </nav>
          </>
        )}

        {!admin && isAdmin && (
          <>
            <div className="my-3 h-px bg-hairline" />
            <p className="eyebrow px-2 py-1">Admin</p>
            <NavLink to="/admin/kyc" onClick={() => setMobileOpen(false)}
              className="flex items-center gap-3 rounded-full px-4 py-2.5 text-sm text-muted-foreground hover:bg-ghost hover:text-ink">
              <Shield size={16}/> Open Console
            </NavLink>
          </>
        )}

        <div className="mt-auto rounded-[20px] border hairline bg-canvas p-4">
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground">Connected</p>
          <p className="mono text-xs mt-1 break-all">{truncAddr(address ?? '', 8)}</p>
          <span className={`mt-2 status-pill ${
            kycStatus === 'verified' ? 'status-verified' :
            kycStatus === 'pending'  ? 'status-pending'  :
            kycStatus === 'rejected' ? 'status-rejected' : 'status-pending'
          }`}>{kycStatus.replace('_',' ')}</span>
          <button onClick={handleSignOut} className="mt-4 w-full pill-ghost !py-2 !text-xs">
            <LogOut size={12}/> Sign out
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        {/* ── Mobile top bar ── */}
        <div className="lg:hidden flex items-center justify-between px-5 py-4 border-b hairline bg-lifted">
          <Link to="/" className="flex items-center gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-ink text-lifted text-xs">◉</span>
            <span className="text-base font-medium">Cadencia</span>
          </Link>
          <button
            onClick={() => setMobileOpen(true)}
            className="p-2 rounded-full text-muted-foreground hover:bg-ghost hover:text-ink transition-colors"
            aria-label="Open navigation"
          >
            <Menu size={20}/>
          </button>
        </div>
        <div className="mx-auto max-w-[1200px] p-5 md:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}


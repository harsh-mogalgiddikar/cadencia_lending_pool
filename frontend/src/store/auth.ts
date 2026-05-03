import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { KycStatus, Role } from '@/lib/types';

interface AuthState {
  address: string | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  kycStatus: KycStatus;
  role: Role | null;
  setAuth: (p: Partial<AuthState>) => void;
  signIn: (address: string) => void;
  signOut: () => void;
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      address: null,
      isAuthenticated: false,
      isAdmin: false,
      kycStatus: 'not_found',
      role: null,
      setAuth: (p) => set(p),
      // isAdmin starts false — AppLayout hydrates it from GET /api/auth/me
      signIn: (address) => set({
        address,
        isAuthenticated: true,
        isAdmin: false,
      }),
      // Calls backend logout to destroy server session before clearing local state
      signOut: () => {
        fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
        set({ address: null, isAuthenticated: false, isAdmin: false, kycStatus: 'not_found', role: null });
      },
    }),
    { name: 'cadencia.auth.v1' }
  )
);

/**
 * Cadencia CreditFlow — Real API Client
 *
 * Axios instance configured for session-cookie auth.
 * - baseURL pulled from VITE_API_URL env variable
 * - withCredentials sends the connect.sid cookie on every request
 * - 401 interceptor signs out the user and redirects home (expired session)
 */
import axios from 'axios';
import { useAuth } from '@/store/auth';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? 'http://localhost:3001',
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

// Global 401 handler — when session expires server-side,
// the frontend automatically clears state and redirects to landing.
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      // Avoid infinite loop if signOut itself triggers a 401
      const isAuthRoute =
        err.config?.url?.includes('/api/auth/logout') ||
        err.config?.url?.includes('/api/auth/me');
      if (!isAuthRoute) {
        useAuth.getState().signOut();
        window.location.href = '/';
      }
    }
    return Promise.reject(err);
  }
);

export default api;

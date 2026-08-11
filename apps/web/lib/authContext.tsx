// apps/web/lib/authContext.tsx
// Global auth state — stores access token in memory
// Access token never touches localStorage or sessionStorage
// Refresh token lives in httpOnly cookie (browser handles it automatically)
'use client';

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  ReactNode,
} from 'react';
import { decodeToken, JwtPayload } from './auth';
import { setApiAccessToken } from '../app/lib/api';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3002';

interface AuthState {
  user: JwtPayload | null;
  accessToken: string | null;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  getAccessToken: () => string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    isLoading: true,
  });

  // Ref to hold the refresh timer so we can clear it on logout
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep API client token synced with AuthState
  useEffect(() => {
    setApiAccessToken(state.accessToken);
  }, [state.accessToken]);

  // ─────────────────────────────────────────
  // Schedule automatic token refresh
  // Called after every successful token acquisition
  // Refreshes 1 minute before expiry
  // ─────────────────────────────────────────
  const scheduleRefresh = useCallback((token: string) => {
    // Clear any existing timer
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }

    const payload = decodeToken(token);
    if (!payload?.exp) return;

    const now = Math.floor(Date.now() / 1000);
    const expiresIn = payload.exp - now;
    // Refresh 60 seconds before expiry, minimum 1 second
    const refreshIn = Math.max((expiresIn - 60) * 1000, 1000);

    refreshTimerRef.current = setTimeout(async () => {
      try {
        // Call refresh endpoint — browser automatically sends the httpOnly cookie
        const response = await fetch(`${API_URL}/api/v1/auth/refresh`, {
          method: 'POST',
          credentials: 'include', // sends httpOnly cookie
        });

        if (response.ok) {
          const data = await response.json();
          const newToken = data.access_token;
          const newUser = decodeToken(newToken);

          setState(prev => ({
            ...prev,
            accessToken: newToken,
            user: newUser,
          }));

          // Schedule next refresh
          scheduleRefresh(newToken);
        } else {
          // Refresh failed — session expired
          setState({ user: null, accessToken: null, isLoading: false });
        }
      } catch {
        setState({ user: null, accessToken: null, isLoading: false });
      }
    }, refreshIn);
  }, []);

  // ─────────────────────────────────────────
  // On mount: try to restore session via refresh token
  // The httpOnly cookie is sent automatically by the browser
  // This handles page refresh — user doesn't have to log in again
  // ─────────────────────────────────────────
  useEffect(() => {
    async function restoreSession() {
      try {
        const response = await fetch(`${API_URL}/api/v1/auth/refresh`, {
          method: 'POST',
          credentials: 'include',
        });

        if (response.ok) {
          const data = await response.json();
          const token = data.access_token;
          const user = decodeToken(token);

          setState({ user, accessToken: token, isLoading: false });
          scheduleRefresh(token);
        } else {
          setState({ user: null, accessToken: null, isLoading: false });
        }
      } catch {
        setState({ user: null, accessToken: null, isLoading: false });
      }
    }

    restoreSession();

    // Cleanup timer on unmount
    return () => {
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current);
      }
    };
  }, [scheduleRefresh]);

  // ─────────────────────────────────────────
  // Login — call API, store access token in memory
  // ─────────────────────────────────────────
  const login = useCallback(async (email: string, password: string) => {
    const response = await fetch(`${API_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include', // allows browser to store the httpOnly cookie
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      const data = await response.json();
      throw new Error(data.error?.message || 'Login failed');
    }

    const data = await response.json();
    const token = data.access_token;
    const user = decodeToken(token);

    setState({ user, accessToken: token, isLoading: false });
    scheduleRefresh(token);
  }, [scheduleRefresh]);

  // ─────────────────────────────────────────
  // Logout — clear memory + call API to clear cookie + audit log
  // ─────────────────────────────────────────
  const logout = useCallback(async () => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
    }

    try {
      await fetch(`${API_URL}/api/v1/auth/logout`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          Authorization: `Bearer ${state.accessToken}`,
        },
      });
    } catch {
      // Even if API call fails, clear local state
    }

    setState({ user: null, accessToken: null, isLoading: false });
  }, [state.accessToken]);

  // Accessor for access token — used by API calls
  const getAccessToken = useCallback(() => state.accessToken, [state.accessToken]);

  return (
    <AuthContext.Provider value={{
      ...state,
      login,
      logout,
      getAccessToken,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

// ─────────────────────────────────────────
// useAuth hook — consume auth context
// ─────────────────────────────────────────
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
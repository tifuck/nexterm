import { create } from 'zustand';
import { apiGet, apiPost, decodeTokenPayload } from '../api/client';
import { useThemeStore } from './themeStore';
import { useTabStore } from './tabStore';
import { destroyAllTerminals } from '../components/terminal/TerminalContainer';
import {
  deriveKey,
  exportKey,
  importKey,
  storeKeyInSession,
  getKeyFromSession,
  getKeyFromCookie,
  storeSalt,
  getSalt,
  clearKeyMaterial,
} from '../utils/crypto';

interface User {
  id: string;
  username: string;
  email: string | null;
  settings?: Record<string, unknown>;
}

/** Shape returned by POST /api/auth/login and /api/auth/refresh */
interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  encryption_salt: string;
}

/** Shape returned by GET /api/auth/me and POST /api/auth/register */
interface UserResponse {
  id: string;
  username: string;
  email: string | null;
  is_active: boolean;
  created_at: string | null;
  last_login: string | null;
  settings?: Record<string, unknown>;
  encryption_salt: string;
}

function toUser(data: UserResponse): User {
  return {
    id: data.id,
    username: data.username,
    email: data.email,
    settings: data.settings,
  };
}

/** Apply user settings to the theme store after auth */
function applyUserSettings(user: User): void {
  if (user.settings && typeof user.settings === 'object' && Object.keys(user.settings).length > 0) {
    useThemeStore.getState().applySettings(user.settings);
  }
}

// ---------------------------------------------------------------------------
// Proactive token refresh timer
// ---------------------------------------------------------------------------
// Schedules a silent refresh at ~75% of the access token's lifetime so the
// token never expires while the tab is open.  After each successful refresh
// the timer is rescheduled automatically.

let refreshTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleTokenRefresh(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }

  const token = localStorage.getItem('token');
  if (!token) return;

  const payload = decodeTokenPayload(token);
  if (!payload?.exp || !payload?.iat) return;

  const now = Date.now() / 1000;
  const iat = payload.iat as number;
  const exp = payload.exp as number;
  const lifetime = exp - iat;
  // Refresh at 75 % of the token's lifetime
  const refreshAt = iat + lifetime * 0.75;
  const delayMs = (refreshAt - now) * 1000;

  if (delayMs <= 0) {
    // Already past 75 % — refresh on next tick to avoid sync recursion
    setTimeout(() => useAuthStore.getState().refreshToken(), 0);
    return;
  }

  refreshTimer = setTimeout(() => {
    useAuthStore.getState().refreshToken();
  }, delayMs);
}

function stopTokenRefresh(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

// ---------------------------------------------------------------------------

interface AuthState {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  /** The client-side E2EE encryption key, derived from the user's password. */
  cryptoKey: CryptoKey | null;
  login: (username: string, password: string, rememberMe?: boolean) => Promise<void>;
  register: (username: string, email: string, password: string, passwordConfirm: string) => Promise<void>;
  logout: () => void;
  refreshToken: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  token: localStorage.getItem('token'),
  isLoading: false,
  cryptoKey: null,

  login: async (username: string, password: string, rememberMe?: boolean) => {
    set({ isLoading: true });
    try {
      const data = await apiPost<TokenResponse>('/api/auth/login', { username, password });
      localStorage.setItem('token', data.access_token);
      localStorage.setItem('refresh_token', data.refresh_token);

      // Derive the client-side E2EE key from the user's password + server-provided salt
      const cryptoKey = await deriveKey(password, data.encryption_salt);
      const exportedKey = await exportKey(cryptoKey);

      // Persist key material in sessionStorage only (not cookies).
      // Storing raw key material in cookies is an XSS risk — the
      // "Remember Me" checkbox now only extends the refresh-token
      // lifetime.  The E2EE key is re-derived on the next full login.
      storeSalt(data.encryption_salt);
      storeKeyInSession(exportedKey);

      // Fetch user profile before clearing isLoading — prevents redirect race
      const me = await apiGet<UserResponse>('/api/auth/me');
      const user = toUser(me);
      set({ token: data.access_token, user, cryptoKey, isLoading: false });
      applyUserSettings(user);
      scheduleTokenRefresh();
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  register: async (username: string, email: string, password: string, passwordConfirm: string) => {
    set({ isLoading: true });
    try {
      // Register the user
      await apiPost<UserResponse>('/api/auth/register', {
        username,
        email: email || null,
        password,
        password_confirm: passwordConfirm,
      });

      // Auto-login after registration (derives the E2EE key)
      const data = await apiPost<TokenResponse>('/api/auth/login', { username, password });
      localStorage.setItem('token', data.access_token);
      localStorage.setItem('refresh_token', data.refresh_token);

      // Derive key
      const cryptoKey = await deriveKey(password, data.encryption_salt);
      const exportedKey = await exportKey(cryptoKey);
      storeSalt(data.encryption_salt);
      storeKeyInSession(exportedKey);

      const me = await apiGet<UserResponse>('/api/auth/me');
      const user = toUser(me);
      set({ token: data.access_token, user, cryptoKey, isLoading: false });
      applyUserSettings(user);
      scheduleTokenRefresh();
    } catch (error) {
      set({ isLoading: false });
      throw error;
    }
  },

  logout: () => {
    stopTokenRefresh();
    // Invalidate the access + refresh tokens server-side (best-effort)
    const refreshToken = localStorage.getItem('refresh_token');
    apiPost('/api/auth/logout', { refresh_token: refreshToken }).catch(() => {});
    localStorage.removeItem('token');
    localStorage.removeItem('refresh_token');
    clearKeyMaterial();
    // Clear all tabs and terminal instances from the previous session
    destroyAllTerminals();
    useTabStore.getState().clearAll();
    set({ user: null, token: null, cryptoKey: null });
  },

  refreshToken: async () => {
    const refreshToken = localStorage.getItem('refresh_token');
    if (!refreshToken) {
      get().logout();
      return;
    }
    try {
      const data = await apiPost<TokenResponse>('/api/auth/refresh', { refresh_token: refreshToken });
      localStorage.setItem('token', data.access_token);
      localStorage.setItem('refresh_token', data.refresh_token);

      // The refresh response also includes the encryption_salt — persist it
      storeSalt(data.encryption_salt);

      set({ token: data.access_token });
      scheduleTokenRefresh();
    } catch {
      get().logout();
    }
  },

  checkAuth: async () => {
    const token = localStorage.getItem('token');
    if (!token) {
      set({ user: null, token: null, cryptoKey: null, isLoading: false });
      return;
    }

    set({ isLoading: true });
    try {
      const data = await apiGet<UserResponse>('/api/auth/me');
      const user = toUser(data);

      // Try to restore the E2EE key from sessionStorage or cookie
      let cryptoKey: CryptoKey | null = null;
      const sessionKey = getKeyFromSession();
      const cookieKey = getKeyFromCookie();
      const keyBase64 = sessionKey || cookieKey;

      if (keyBase64) {
        try {
          cryptoKey = await importKey(keyBase64);
          // If we restored from cookie, also put it in sessionStorage
          if (!sessionKey && cookieKey) {
            storeKeyInSession(cookieKey);
          }
        } catch {
          // Key import failed — user will need to re-login
          cryptoKey = null;
        }
      }

      // Persist the salt from the /me response
      if (data.encryption_salt) {
        storeSalt(data.encryption_salt);
      }

      if (!cryptoKey) {
        // No valid key found — force re-login so we can derive the key
        get().logout();
        set({ isLoading: false });
        return;
      }

      set({ user, token, cryptoKey, isLoading: false });
      applyUserSettings(user);
      scheduleTokenRefresh();
    } catch {
      // Token might be expired, try refreshing
      try {
        await get().refreshToken();
        const data = await apiGet<UserResponse>('/api/auth/me');
        const user = toUser(data);

        // Try to restore the E2EE key
        let cryptoKey: CryptoKey | null = null;
        const keyBase64 = getKeyFromSession() || getKeyFromCookie();
        if (keyBase64) {
          try {
            cryptoKey = await importKey(keyBase64);
          } catch {
            cryptoKey = null;
          }
        }

        if (!cryptoKey) {
          get().logout();
          set({ isLoading: false });
          return;
        }

        set({ user, cryptoKey, isLoading: false });
        applyUserSettings(user);
        // scheduleTokenRefresh already called by refreshToken above
      } catch {
        get().logout();
        set({ isLoading: false });
      }
    }
  },
}));

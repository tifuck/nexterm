import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Terminal, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useConfigStore } from '@/store/configStore';

const LoginPage: React.FC = () => {
  const { login, isLoading } = useAuthStore();
  const appName = useConfigStore((s) => s.appName);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) return;
    setError(null);
    try {
      await login(username, password, rememberMe);
      // Navigation happens automatically via App.tsx auth guard
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-[var(--bg-primary)]">
      <div className="w-full max-w-sm mx-4 animate-scale-in">
        <form
          onSubmit={handleSubmit}
          className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-6 shadow-2xl"
        >
          {/* Logo / App name */}
          <div className="flex flex-col items-center mb-6">
            <div className="p-3 rounded-xl bg-[var(--accent-muted)] mb-3">
              <Terminal size={28} className="text-[var(--accent)]" />
            </div>
            <h1 className="text-xl font-bold text-[var(--accent)]">{appName}</h1>
            <p className="text-xs text-[var(--text-muted)] mt-1">Sign in to continue</p>
          </div>

          {/* Error */}
          {error && (
            <div
              className="mb-4 px-3 py-2 rounded text-xs animate-fade-in"
              style={{
                backgroundColor: 'color-mix(in srgb, var(--danger) 10%, transparent)',
                borderWidth: 1,
                borderStyle: 'solid',
                borderColor: 'color-mix(in srgb, var(--danger) 30%, transparent)',
                color: 'var(--danger)',
              }}
            >
              {error}
            </div>
          )}

          {/* Username */}
          <div className="mb-3">
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Username
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Enter your username"
              autoComplete="username"
              autoFocus
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] transition-colors"
            />
          </div>

          {/* Password */}
          <div className="mb-5">
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                autoComplete="current-password"
                className="w-full px-3 py-2 pr-9 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
              >
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          {/* Remember Me */}
          <label className="flex items-center gap-2 mb-5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
              className="w-3.5 h-3.5 rounded border-[var(--border)] bg-[var(--bg-tertiary)] accent-[var(--accent)]"
            />
            <span className="text-xs text-[var(--text-secondary)]">
              Remember me for 30 days
            </span>
          </label>

          {/* Submit */}
          <button
            type="submit"
            disabled={isLoading || !username || !password}
            className="w-full py-2.5 rounded-lg bg-[var(--accent)] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold text-[var(--accent-contrast)] transition-all active:scale-[0.98] flex items-center justify-center gap-2"
          >
            {isLoading && <Loader2 size={15} className="animate-spin" />}
            Sign In
          </button>

          {/* Register link */}
          <p className="mt-4 text-center text-xs text-[var(--text-muted)]">
            Don&apos;t have an account?{' '}
            <Link
              to="/register"
              className="text-[var(--accent)] hover:underline font-medium"
            >
              Create one
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
};

export default LoginPage;

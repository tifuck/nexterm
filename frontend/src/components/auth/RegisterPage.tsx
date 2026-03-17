import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Terminal, Eye, EyeOff, Loader2 } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { useConfigStore } from '@/store/configStore';

const RegisterPage: React.FC = () => {
  const { register, isLoading } = useAuthStore();
  const appName = useConfigStore((s) => s.appName);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!username || !password) return;

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    if (!/[A-Z]/.test(password)) {
      setError('Password must contain at least one uppercase letter');
      return;
    }

    if (!/[a-z]/.test(password)) {
      setError('Password must contain at least one lowercase letter');
      return;
    }

    if (!/\d/.test(password)) {
      setError('Password must contain at least one digit');
      return;
    }

    try {
      await register(username, email || '', password, confirmPassword);
      // Navigation happens automatically via App.tsx auth guard
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed');
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
            <p className="text-xs text-[var(--text-muted)] mt-1">Create your account</p>
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
              placeholder="Choose a username"
              autoComplete="username"
              autoFocus
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] transition-colors"
            />
          </div>

          {/* Email (optional) */}
          <div className="mb-3">
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Email{' '}
              <span className="text-[var(--text-muted)] font-normal">(optional)</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] transition-colors"
            />
          </div>

          {/* Password */}
          <div className="mb-3">
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 8 chars, upper, lower, digit"
                autoComplete="new-password"
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

          {/* Confirm Password */}
          <div className="mb-5">
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Confirm Password
            </label>
            <input
              type={showPassword ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Repeat your password"
              autoComplete="new-password"
              className="w-full px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] outline-none focus:border-[var(--accent)] transition-colors"
            />
          </div>

          {/* Submit */}
          <button
            type="submit"
            disabled={isLoading || !username || !password || !confirmPassword}
            className="w-full py-2.5 rounded-lg bg-[var(--accent)] hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed text-sm font-semibold text-[var(--accent-contrast)] transition-all active:scale-[0.98] flex items-center justify-center gap-2"
          >
            {isLoading && <Loader2 size={15} className="animate-spin" />}
            Create Account
          </button>

          {/* Login link */}
          <p className="mt-4 text-center text-xs text-[var(--text-muted)]">
            Already have an account?{' '}
            <Link
              to="/login"
              className="text-[var(--accent)] hover:underline font-medium"
            >
              Sign in
            </Link>
          </p>
        </form>
      </div>
    </div>
  );
};

export default RegisterPage;

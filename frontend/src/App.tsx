import React, { useEffect } from 'react';
import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { useThemeStore } from './store/themeStore';
import { useConfigStore } from './store/configStore';
import { useAIStore } from './store/aiStore';
import LoginPage from './components/auth/LoginPage';
import RegisterPage from './components/auth/RegisterPage';
import AppLayout from './components/layout/AppLayout';
import ToastContainer from './components/layout/ToastContainer';

const App: React.FC = () => {
  const { user, isLoading, checkAuth } = useAuthStore();
  const initTheme = useThemeStore((s) => s.initTheme);
  const fetchConfig = useConfigStore((s) => s.fetchConfig);
  const registrationEnabled = useConfigStore((s) => s.registrationEnabled);
  const aiEnabled = useConfigStore((s) => s.aiEnabled);
  const fetchAI = useAIStore((s) => s.fetchAll);
  const location = useLocation();

  // Fetch app config (app name, feature flags) on mount
  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  // Fetch AI settings/features once authenticated and AI is globally enabled
  useEffect(() => {
    if (user && aiEnabled) {
      fetchAI();
    }
  }, [user, aiEnabled, fetchAI]);

  // Apply saved theme on mount
  useEffect(() => {
    initTheme();
  }, [initTheme]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      checkAuth();
    }
  }, [checkAuth]);

  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--bg-primary)]">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
          <span className="text-sm text-[var(--text-secondary)]">Loading...</span>
        </div>
      </div>
    );
  }

  const isAuthPage = location.pathname === '/login' || location.pathname === '/register';

  if (!user && !isAuthPage) {
    return <Navigate to="/login" replace />;
  }

  if (user && isAuthPage) {
    return <Navigate to="/" replace />;
  }

  return (
    <>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={registrationEnabled ? <RegisterPage /> : <Navigate to="/login" replace />} />
        <Route path="/*" element={<AppLayout />} />
      </Routes>
      <ToastContainer />
    </>
  );
};

export default App;

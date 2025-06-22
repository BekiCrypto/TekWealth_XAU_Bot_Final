import React, { useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { Navigation } from './components/Navigation';
import { LandingPage } from './pages/LandingPage';
import { AdminDashboard } from './pages/AdminDashboard';
import { UserDashboard } from './pages/UserDashboard';
import { TradingBot } from './pages/TradingBot';
import { Analytics } from './pages/Analytics';
import { Settings } from './pages/Settings';
import { BacktestingPage } from './pages/BacktestingPage';
import { Toaster } from 'sonner';

type UserRole = 'admin' | 'subscriber' | null;

interface ProtectedRouteProps {
  userRole: UserRole;
  allowedRoles: Array<'admin' | 'subscriber'>;
  children: React.ReactNode;
}

function ProtectedRoute({ userRole, allowedRoles, children }: ProtectedRouteProps) {
  if (!userRole || !allowedRoles.includes(userRole)) {
    return <Navigate to="/" replace />;
  }
  return <>{children}</>;
}

interface MainLayoutProps {
  userRole: UserRole;
  onLogout: () => void;
}

function MainLayout({ userRole, onLogout }: MainLayoutProps) {
  if (!userRole) {
    // This should ideally not be hit if App's root route logic is correct,
    // but as a safeguard:
    return <Navigate to="/" replace />;
  }
  return (
    <div className="min-h-screen bg-gray-950">
      <Navigation 
        userRole={userRole}
        onLogout={onLogout}
      />
      <main className="ml-64 min-h-screen p-8">
        <Outlet />
      </main>
    </div>
  );
}

function App() {
  const [userRole, setUserRole] = useState<UserRole>(null);

  const handleLogin = (role: 'admin' | 'subscriber') => {
    setUserRole(role);
  };

  const handleLogout = () => {
    setUserRole(null);
    // Navigation to "/" is implicit as ProtectedRoute will deny access
    // and App's root route will render LandingPage.
  };

  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/"
          element={
            userRole ? (
              <Navigate to={userRole === 'admin' ? '/admin' : '/dashboard'} replace />
            ) : (
              <LandingPage onLogin={handleLogin} />
            )
          }
        />

        <Route element={<MainLayout userRole={userRole} onLogout={handleLogout} />}>
          <Route
            path="/admin"
            element={
              <ProtectedRoute userRole={userRole} allowedRoles={['admin']}>
                <AdminDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute userRole={userRole} allowedRoles={['subscriber']}>
                <UserDashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/bot"
            element={
              <ProtectedRoute userRole={userRole} allowedRoles={['subscriber']}>
                <TradingBot />
              </ProtectedRoute>
            }
          />
          <Route
            path="/analytics"
            element={
              <ProtectedRoute userRole={userRole} allowedRoles={['admin']}>
                <Analytics />
              </ProtectedRoute>
            }
          />
           <Route
            path="/backtesting"
            element={
              <ProtectedRoute userRole={userRole} allowedRoles={['subscriber']}>
                <BacktestingPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/settings"
            element={
              <ProtectedRoute userRole={userRole} allowedRoles={['admin', 'subscriber']}>
                <Settings />
              </ProtectedRoute>
            }
          />
        </Route>

        <Route
          path="*"
          element={<Navigate to={userRole ? (userRole === 'admin' ? '/admin' : '/dashboard') : '/'} replace />}
        />
      </Routes>
      <Toaster richColors position="top-right" />
    </BrowserRouter>
  );
}

export default App;
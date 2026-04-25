import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './layouts/AppLayout';
import LoginPage from './pages/auth/LoginPage';
import Dashboard from './pages/app/Dashboard';
import Accounts from './pages/app/Accounts';
import Streamers from './pages/app/Streamers';
import Stats from './pages/app/Stats';
import Automation from './pages/app/Automation';
import Logs from './pages/app/Logs';
import Settings from './pages/app/Settings';
import { getToken } from '@/lib/api';

function Protected({ children }: { children: React.ReactNode }) {
  return getToken() ? <>{children}</> : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/app"
        element={
          <Protected>
            <AppLayout />
          </Protected>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="streamers" element={<Streamers />} />
        <Route path="stats" element={<Stats />} />
        <Route path="automation" element={<Automation />} />
        <Route path="logs" element={<Logs />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to={getToken() ? '/app' : '/login'} replace />} />
    </Routes>
  );
}

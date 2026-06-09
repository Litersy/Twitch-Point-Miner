import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  LayoutDashboard,
  Users,
  Radio,
  BarChart3,
  Settings2,
  ScrollText,
  Cog,
  LogOut,
  Zap,
} from 'lucide-react';
import { clearToken } from '@/lib/api';
import { cn } from '@/lib/utils';

const navItems = [
  { to: '/app', icon: LayoutDashboard, key: 'dashboard', end: true },
  { to: '/app/accounts', icon: Users, key: 'accounts' },
  { to: '/app/streamers', icon: Radio, key: 'streamers' },
  { to: '/app/stats', icon: BarChart3, key: 'stats' },
  { to: '/app/automation', icon: Cog, key: 'automation' },
  { to: '/app/logs', icon: ScrollText, key: 'logs' },
  { to: '/app/settings', icon: Settings2, key: 'settings' },
];

export default function AppLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  function logout() {
    clearToken();
    navigate('/login');
  }

  return (
    <div className="flex min-h-screen">
      <aside className="hidden md:flex w-60 shrink-0 flex-col border-r bg-card">
        <div className="flex h-14 items-center gap-2 border-b px-5">
          <Zap className="h-5 w-5 text-primary" />
          <span className="font-semibold tracking-tight">TPM Panel</span>
        </div>
        <nav className="flex-1 space-y-1 p-3">
          {navItems.map((it) => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-accent/50',
                )
              }
            >
              <it.icon className="h-4 w-4" />
              <span>{t(`nav.${it.key}`)}</span>
            </NavLink>
          ))}
        </nav>
        <button
          onClick={logout}
          className="m-3 flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground"
        >
          <LogOut className="h-4 w-4" />
          {t('nav.logout')}
        </button>
      </aside>
      <main className="flex-1 min-w-0">
        <div className="mx-auto max-w-7xl p-4 md:p-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

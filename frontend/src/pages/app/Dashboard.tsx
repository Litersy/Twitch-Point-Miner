import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Legend,
} from 'recharts';
import { api } from '@/lib/api';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { formatNumber, formatMinutes } from '@/lib/utils';
import { useEffect } from 'react';

const COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#06b6d4', '#a855f7', '#84cc16'];

export default function Dashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const summary = useQuery({
    queryKey: ['stats', 'summary'],
    queryFn: () => api<any>('/api/stats/summary'),
    refetchInterval: 15_000,
  });
  const series = useQuery({
    queryKey: ['stats', 'timeseries', 'week'],
    queryFn: () => api<{ ts: string; total: number }[]>('/api/stats/timeseries?period=week'),
    refetchInterval: 30_000,
  });
  const breakdown = useQuery({
    queryKey: ['stats', 'breakdown', 'week'],
    queryFn: () => api<{ type: string; total: number }[]>('/api/stats/breakdown?period=week'),
    refetchInterval: 30_000,
  });
  const top = useQuery({
    queryKey: ['stats', 'top-streamers'],
    queryFn: () => api<{ login: string; total: number }[]>('/api/stats/top-streamers'),
    refetchInterval: 30_000,
  });

  // Onboarding: when the panel is empty, nudge the user toward "Add account".
  useEffect(() => {
    if (summary.data?.accounts === 0) navigate('/app/accounts', { replace: true });
  }, [summary.data, navigate]);

  const s = summary.data ?? {};
  const kpis = [
    { label: t('dashboard.accounts'), value: s.accounts ?? '—' },
    { label: t('dashboard.streamers'), value: `${s.onlineStreamers ?? 0} / ${s.streamers ?? 0}` },
    { label: t('dashboard.totalPoints'), value: formatNumber(s.totalPoints ?? 0) },
    { label: t('dashboard.earnedToday'), value: '+' + formatNumber(s.pointsEarnedToday ?? 0) },
    { label: t('dashboard.watchTime'), value: formatMinutes(s.totalWatchMinutes ?? 0) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('dashboard.title')}</h1>
        <p className="text-muted-foreground">{t('dashboard.subtitle')}</p>
      </div>

      <div className="grid gap-3 grid-cols-2 lg:grid-cols-5">
        {kpis.map((k) => (
          <Card key={k.label}>
            <CardContent className="p-4">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">{k.label}</div>
              <div className="mt-1 text-2xl font-semibold">{k.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('dashboard.chart')}</CardTitle>
            <CardDescription>+ points last 7 days</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={(series.data ?? []).map((r) => ({ ...r, date: new Date(r.ts).toLocaleDateString() }))}>
                  <defs>
                    <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                  <XAxis dataKey="date" fontSize={11} />
                  <YAxis fontSize={11} />
                  <Tooltip
                    contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                  />
                  <Area type="monotone" dataKey="total" stroke="#6366f1" fill="url(#g1)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.byType')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={breakdown.data ?? []} dataKey="total" nameKey="type" outerRadius={80} label>
                    {(breakdown.data ?? []).map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('dashboard.topStreamers')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64">
            <ResponsiveContainer>
              <BarChart data={top.data ?? []}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="login" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
                <Bar dataKey="total" fill="#22c55e" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

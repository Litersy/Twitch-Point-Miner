import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { formatNumber, formatMinutes } from '@/lib/utils';

type Period = 'day' | 'week' | 'month';

export default function Stats() {
  const { t } = useTranslation();
  const [period, setPeriod] = useState<Period>('week');
  const [accountId, setAccountId] = useState<string | ''>('');
  const [streamerId, setStreamerId] = useState<string | ''>('');

  const accounts = useQuery({
    queryKey: ['accounts', 'lite'],
    queryFn: () => api<{ id: string; login: string }[]>('/api/accounts'),
  });
  const streamers = useQuery({
    queryKey: ['streamers', 'lite'],
    queryFn: () => api<{ id: string; login: string }[]>('/api/streamers'),
  });

  const qs = new URLSearchParams({ period });
  if (accountId) qs.set('accountId', accountId);
  if (streamerId) qs.set('streamerId', streamerId);

  const series = useQuery({
    queryKey: ['stats', 'ts', period, accountId, streamerId],
    queryFn: () => api<{ ts: string; total: number }[]>(`/api/stats/timeseries?${qs}`),
  });

  const byAccount = useQuery({
    queryKey: ['stats', 'byAccount'],
    queryFn: () => api<{ login: string; total: number; watchMinutes: number }[]>('/api/stats/by-account'),
  });

  const balances = useQuery({
    queryKey: ['stats', 'balances'],
    queryFn: () =>
      api<{ accountLogin: string; streamerLogin: string; points: number; capturedAt: string }[]>(
        '/api/stats/balances',
      ),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('stats.title')}</h1>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">{t('stats.period')}</div>
          <div className="flex rounded-md border overflow-hidden">
            {(['day', 'week', 'month'] as Period[]).map((p) => (
              <Button
                key={p}
                variant={period === p ? 'default' : 'ghost'}
                size="sm"
                className="rounded-none"
                onClick={() => setPeriod(p)}
              >
                {t(`stats.${p}`)}
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">{t('stats.account')}</div>
          <select
            className="h-9 rounded-md border bg-transparent px-3 text-sm"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          >
            <option value="">{t('stats.all')}</option>
            {(accounts.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>
                {a.login}
              </option>
            ))}
          </select>
        </div>

        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">{t('stats.streamer')}</div>
          <select
            className="h-9 rounded-md border bg-transparent px-3 text-sm"
            value={streamerId}
            onChange={(e) => setStreamerId(e.target.value)}
          >
            <option value="">{t('stats.all')}</option>
            {(streamers.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.login}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('stats.earnings')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-80">
            <ResponsiveContainer>
              <AreaChart
                data={(series.data ?? []).map((r) => ({
                  ...r,
                  date:
                    period === 'day'
                      ? new Date(r.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                      : new Date(r.ts).toLocaleDateString(),
                }))}
              >
                <defs>
                  <linearGradient id="s1" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#22c55e" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#22c55e" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" opacity={0.15} />
                <XAxis dataKey="date" fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
                <Area type="monotone" dataKey="total" stroke="#22c55e" fill="url(#s1)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('stats.account')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">{t('stats.account')}</th>
                  <th className="px-4 py-2 font-medium text-right">{t('stats.earnings')}</th>
                  <th className="px-4 py-2 font-medium text-right">{t('dashboard.watchTime')}</th>
                </tr>
              </thead>
              <tbody>
                {(byAccount.data ?? []).map((r) => (
                  <tr key={r.login} className="border-b last:border-0">
                    <td className="px-4 py-2 font-medium">{r.login}</td>
                    <td className="px-4 py-2 text-right">+{formatNumber(r.total)}</td>
                    <td className="px-4 py-2 text-right text-muted-foreground">{formatMinutes(r.watchMinutes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('stats.balances')}</CardTitle>
          </CardHeader>
          <CardContent className="p-0 max-h-96 overflow-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-4 py-2 font-medium">{t('stats.account')}</th>
                  <th className="px-4 py-2 font-medium">{t('stats.streamer')}</th>
                  <th className="px-4 py-2 font-medium text-right">Points</th>
                </tr>
              </thead>
              <tbody>
                {(balances.data ?? []).map((r, i) => (
                  <tr key={i} className="border-b last:border-0">
                    <td className="px-4 py-2">{r.accountLogin}</td>
                    <td className="px-4 py-2">{r.streamerLogin}</td>
                    <td className="px-4 py-2 text-right">{formatNumber(r.points)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';

type LogRow = {
  id: string;
  level: string;
  category: string;
  message: string;
  createdAt: string;
  account: { id: string; login: string } | null;
};

type LogPage = { items: LogRow[]; nextCursor: string | null };

function levelBadge(level: string): 'success' | 'warning' | 'destructive' | 'default' {
  if (level === 'error') return 'destructive';
  if (level === 'warn') return 'warning';
  if (level === 'info') return 'success';
  return 'default';
}

export default function Logs() {
  const { t } = useTranslation();
  const [level, setLevel] = useState('');
  const [category, setCategory] = useState('');
  const [accountId, setAccountId] = useState('');

  const accounts = useQuery({
    queryKey: ['accounts', 'lite'],
    queryFn: () => api<{ id: string; login: string }[]>('/api/accounts'),
  });

  const q = useInfiniteQuery({
    queryKey: ['logs', level, category, accountId],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => {
      const qs = new URLSearchParams({ limit: '100' });
      if (level) qs.set('level', level);
      if (category) qs.set('category', category);
      if (accountId) qs.set('accountId', accountId);
      if (pageParam) qs.set('cursor', pageParam);
      return api<LogPage>(`/api/logs?${qs}`);
    },
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: 15_000,
  });

  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('logs.title')}</h1>
        <p className="text-muted-foreground">{t('logs.subtitle')}</p>
      </div>

      <div className="flex flex-wrap gap-3">
        <select
          className="h-9 rounded-md border bg-transparent px-3 text-sm"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
        >
          <option value="">{t('logs.level')}: all</option>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="error">error</option>
          <option value="debug">debug</option>
        </select>
        <select
          className="h-9 rounded-md border bg-transparent px-3 text-sm"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">{t('logs.category')}: all</option>
          <option value="miner">miner</option>
          <option value="points">points</option>
          <option value="prediction">prediction</option>
          <option value="automation">automation</option>
          <option value="auth">auth</option>
        </select>
        <select
          className="h-9 rounded-md border bg-transparent px-3 text-sm"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          <option value="">{t('logs.account')}: all</option>
          {(accounts.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.login}
            </option>
          ))}
        </select>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium w-44">{t('logs.time')}</th>
                <th className="px-4 py-3 font-medium w-24">{t('logs.level')}</th>
                <th className="px-4 py-3 font-medium w-32">{t('logs.category')}</th>
                <th className="px-4 py-3 font-medium w-32">{t('logs.account')}</th>
                <th className="px-4 py-3 font-medium">{t('logs.message')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b last:border-0 hover:bg-accent/30">
                  <td className="px-4 py-2 text-muted-foreground">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td className="px-4 py-2">
                    <Badge variant={levelBadge(r.level)}>{r.level}</Badge>
                  </td>
                  <td className="px-4 py-2 text-muted-foreground">{r.category}</td>
                  <td className="px-4 py-2">{r.account?.login ?? '—'}</td>
                  <td className="px-4 py-2">{r.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {q.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
            {t('logs.loadMore')}
          </Button>
        </div>
      )}
    </div>
  );
}

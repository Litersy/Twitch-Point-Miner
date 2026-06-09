import { useState, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Switch } from '@/components/ui/Switch';

type Automation = {
  id: string;
  accountId: string;
  streamerId: string | null;
  makePredictions: boolean;
  claimDrops: boolean;
  claimMoments: boolean;
  followRaid: boolean;
  watchStreak: boolean;
  betPercentage: number;
  betMaxPoints: number;
  betMinPoints: number;
};

const defaultSettings = {
  makePredictions: false,
  claimDrops: true,
  claimMoments: true,
  followRaid: true,
  watchStreak: true,
  betPercentage: 5,
  betMaxPoints: 50000,
  betMinPoints: 20000,
};

export default function AutomationPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [accountId, setAccountId] = useState<string>('');
  const [streamerId, setStreamerId] = useState<string>('');

  const accounts = useQuery({
    queryKey: ['accounts', 'lite'],
    queryFn: () => api<{ id: string; login: string }[]>('/api/accounts'),
  });
  const streamers = useQuery({
    queryKey: ['streamers', 'lite'],
    queryFn: () => api<{ id: string; login: string }[]>('/api/streamers'),
  });
  const rows = useQuery({
    queryKey: ['automation', accountId],
    queryFn: () => api<Automation[]>(`/api/automation${accountId ? `?accountId=${accountId}` : ''}`),
  });

  const current = useMemo(() => {
    return (
      rows.data?.find((r) => r.accountId === accountId && (r.streamerId ?? '') === streamerId) ?? {
        accountId,
        streamerId: streamerId || null,
        ...defaultSettings,
      }
    );
  }, [rows.data, accountId, streamerId]);

  const [form, setForm] = useState<Partial<Automation>>({});
  const merged: any = { ...current, ...form };

  const save = useMutation({
    mutationFn: () =>
      api('/api/automation', {
        method: 'PUT',
        body: JSON.stringify({
          accountId,
          streamerId: streamerId || null,
          makePredictions: merged.makePredictions,
          claimDrops: merged.claimDrops,
          claimMoments: merged.claimMoments,
          followRaid: merged.followRaid,
          watchStreak: merged.watchStreak,
          betPercentage: Number(merged.betPercentage),
          betMaxPoints: Number(merged.betMaxPoints),
          betMinPoints: Number(merged.betMinPoints),
        }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['automation'] });
      setForm({});
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('automation.title')}</h1>
        <p className="text-muted-foreground">{t('automation.subtitle')}</p>
      </div>

      <Card>
        <CardContent className="p-6 space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t('automation.account')}</Label>
              <select
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
                value={accountId}
                onChange={(e) => setAccountId(e.target.value)}
              >
                <option value="">—</option>
                {(accounts.data ?? []).map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.login}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>{t('automation.streamer')}</Label>
              <select
                className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
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

          {accountId ? (
            <div className="space-y-4 pt-2">
              {(['makePredictions', 'claimDrops', 'claimMoments', 'followRaid', 'watchStreak'] as const).map((k) => (
                <div key={k} className="flex items-center justify-between">
                  <Label>{t(`automation.${k}`)}</Label>
                  <Switch
                    checked={!!merged[k]}
                    onCheckedChange={(v) => setForm((f) => ({ ...f, [k]: v }))}
                  />
                </div>
              ))}

              <div className="grid grid-cols-3 gap-3 pt-3 border-t">
                <div className="space-y-1">
                  <Label>{t('automation.betPercentage')}</Label>
                  <Input
                    type="number"
                    value={merged.betPercentage}
                    onChange={(e) => setForm((f) => ({ ...f, betPercentage: Number(e.target.value) }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t('automation.betMax')}</Label>
                  <Input
                    type="number"
                    value={merged.betMaxPoints}
                    onChange={(e) => setForm((f) => ({ ...f, betMaxPoints: Number(e.target.value) }))}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t('automation.betMin')}</Label>
                  <Input
                    type="number"
                    value={merged.betMinPoints}
                    onChange={(e) => setForm((f) => ({ ...f, betMinPoints: Number(e.target.value) }))}
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button onClick={() => save.mutate()} disabled={save.isPending}>
                  {t('automation.save')}
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Select an account to edit automation settings.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

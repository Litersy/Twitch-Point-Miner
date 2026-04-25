import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Play, Square, RotateCcw, Trash2, Copy, ExternalLink, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { copyToClipboard } from '@/lib/utils';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Badge } from '@/components/ui/Badge';
import { Switch } from '@/components/ui/Switch';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/Dialog';

type Account = {
  id: string;
  login: string;
  displayName: string | null;
  status: string;
  lastError: string | null;
  enabled: boolean;
  has2FA: boolean;
  hasAuthToken: boolean;
  streamerCount: number;
};

function statusVariant(s: string): 'success' | 'warning' | 'destructive' | 'default' {
  if (s === 'running') return 'success';
  if (s === 'error') return 'destructive';
  if (s === 'stopped' || s === 'idle') return 'default';
  return 'warning';
}

export default function Accounts() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);

  const accounts = useQuery({
    queryKey: ['accounts'],
    queryFn: () => api<Account[]>('/api/accounts'),
    refetchInterval: 10_000,
  });

  const start = useMutation({
    mutationFn: (id: string) => api(`/api/accounts/${id}/start`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });
  const stop = useMutation({
    mutationFn: (id: string) => api(`/api/accounts/${id}/stop`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });
  const restart = useMutation({
    mutationFn: (id: string) => api(`/api/accounts/${id}/restart`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/accounts/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['accounts'] }),
  });

  const empty = accounts.data?.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('accounts.title')}</h1>
          <p className="text-muted-foreground">{t('accounts.subtitle')}</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4" /> {t('accounts.add')}
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <AddAccountFlow onDone={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {empty && (
        <Card>
          <CardContent className="p-10 text-center space-y-3">
            <h3 className="text-lg font-medium">{t('accounts.noAccounts')}</h3>
            <p className="text-muted-foreground">{t('accounts.firstRun')}</p>
            <Button onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" /> {t('accounts.add')}
            </Button>
          </CardContent>
        </Card>
      )}

      {!empty && (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-4 py-3 font-medium">{t('accounts.login')}</th>
                  <th className="px-4 py-3 font-medium">{t('accounts.status')}</th>
                  <th className="px-4 py-3 font-medium">{t('accounts.streamers')}</th>
                  <th className="px-4 py-3 font-medium text-right">{t('accounts.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {(accounts.data ?? []).map((a) => (
                  <tr key={a.id} className="border-b last:border-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{a.login}</div>
                      {a.displayName && <div className="text-xs text-muted-foreground">{a.displayName}</div>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Badge variant={statusVariant(a.status)}>{a.status}</Badge>
                        {a.has2FA && <Badge variant="outline">2FA</Badge>}
                        {!a.enabled && <Badge variant="warning">{t('accounts.disabled')}</Badge>}
                      </div>
                      {a.lastError && (
                        <div className="mt-1 text-xs text-destructive truncate max-w-xs">{a.lastError}</div>
                      )}
                    </td>
                    <td className="px-4 py-3">{a.streamerCount}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" onClick={() => start.mutate(a.id)} title={t('accounts.start')}>
                          <Play className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => stop.mutate(a.id)} title={t('accounts.stop')}>
                          <Square className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => restart.mutate(a.id)} title={t('accounts.restart')}>
                          <RotateCcw className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => {
                            if (confirm(`Delete ${a.login}?`)) remove.mutate(a.id);
                          }}
                          title={t('accounts.delete')}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/* ===== Two-step add-account flow with Twitch Device OAuth ===== */

type FlowStart = { flowId: string; userCode: string; verificationUri: string; expiresAt: number; interval: number };
type FlowStatus =
  | { status: 'pending'; userCode: string; verificationUri: string; expiresAt: number }
  | { status: 'success'; accountId: string; login: string }
  | { status: 'expired' }
  | { status: 'denied' }
  | { status: 'error'; message: string };

function AddAccountFlow({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const [login, setLogin] = useState('');
  const [has2FA, setHas2FA] = useState(false);
  const [flow, setFlow] = useState<FlowStart | null>(null);
  const [status, setStatus] = useState<FlowStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const start = useMutation({
    mutationFn: (body: { login: string; has2FA: boolean }) =>
      api<FlowStart>('/api/accounts/device-flow/start', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: (data) => {
      setErr(null);
      setFlow(data);
    },
    onError: (e: any) => setErr(e?.message ?? 'failed'),
  });

  // poll status while flow is open
  useEffect(() => {
    if (!flow) return;
    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        try {
          const s = await api<FlowStatus>(`/api/accounts/device-flow/${flow.flowId}`);
          if (cancelled) return;
          setStatus(s);
          if (s.status !== 'pending') {
            if (s.status === 'success') {
              qc.invalidateQueries({ queryKey: ['accounts'] });
            }
            return;
          }
        } catch {
          // keep polling through transient errors
        }
        await new Promise((r) => setTimeout(r, 2000));
      }
    };
    void poll();
    return () => {
      cancelled = true;
      void api(`/api/accounts/device-flow/${flow.flowId}/cancel`, { method: 'POST' }).catch(() => {});
    };
  }, [flow, qc]);

  function submitLogin(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!/^[a-zA-Z0-9_]+$/.test(login) || login.length < 1) {
      setErr('Invalid Twitch login');
      return;
    }
    start.mutate({ login, has2FA });
  }

  const [copied, setCopied] = useState(false);
  async function copyCode() {
    if (!flow?.userCode) return;
    const ok = await copyToClipboard(flow.userCode);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }
  }

  // Stage 1 — enter login
  if (!flow) {
    return (
      <form onSubmit={submitLogin} className="space-y-3">
        <DialogHeader>
          <DialogTitle>{t('accounts.add')}</DialogTitle>
        </DialogHeader>
        <div className="space-y-1">
          <Label>{t('accounts.login')}</Label>
          <Input value={login} onChange={(e) => setLogin(e.target.value)} autoFocus required placeholder="your_twitch_name" />
          <p className="text-xs text-muted-foreground">
            {t('accounts.deviceFlowHint')}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Switch checked={has2FA} onCheckedChange={setHas2FA} id="2fa" />
          <Label htmlFor="2fa">{t('accounts.has2FA')}</Label>
        </div>
        {err && <p className="text-sm text-destructive">{err}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onDone}>{t('accounts.cancel')}</Button>
          <Button disabled={start.isPending}>
            {start.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('accounts.continue')}
          </Button>
        </DialogFooter>
      </form>
    );
  }

  // Stage 2 — show device code and poll
  const s = status ?? { status: 'pending' as const, userCode: flow.userCode, verificationUri: flow.verificationUri, expiresAt: flow.expiresAt };

  if (s.status === 'success') {
    return (
      <div className="space-y-3 text-center">
        <DialogHeader>
          <DialogTitle className="text-center">{t('accounts.linked')}</DialogTitle>
        </DialogHeader>
        <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
        <p className="text-sm text-muted-foreground">
          {t('accounts.linkedDesc', { login: s.login })}
        </p>
        <DialogFooter className="justify-center">
          <Button onClick={onDone}>{t('accounts.done')}</Button>
        </DialogFooter>
      </div>
    );
  }

  if (s.status === 'expired' || s.status === 'denied' || s.status === 'error') {
    return (
      <div className="space-y-3 text-center">
        <DialogHeader>
          <DialogTitle className="text-center">{t('accounts.linkFailed')}</DialogTitle>
        </DialogHeader>
        <AlertCircle className="h-12 w-12 text-destructive mx-auto" />
        <p className="text-sm text-destructive">
          {s.status === 'expired' && t('accounts.linkExpired')}
          {s.status === 'denied' && t('accounts.linkDenied')}
          {s.status === 'error' && ('message' in s ? s.message : t('common.error'))}
        </p>
        <DialogFooter className="justify-center">
          <Button onClick={() => { setFlow(null); setStatus(null); }}>{t('accounts.retry')}</Button>
        </DialogFooter>
      </div>
    );
  }

  // pending
  const minutesLeft = Math.max(0, Math.floor((flow.expiresAt - Date.now()) / 60_000));
  return (
    <div className="space-y-4">
      <DialogHeader>
        <DialogTitle>{t('accounts.deviceFlowTitle')}</DialogTitle>
      </DialogHeader>

      <ol className="text-sm space-y-2 text-muted-foreground list-decimal pl-5">
        <li>{t('accounts.step1')}</li>
        <li>{t('accounts.step2')}</li>
        <li>{t('accounts.step3')}</li>
      </ol>

      <div className="rounded-lg border bg-secondary/40 p-4 text-center space-y-3">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">{t('accounts.yourCode')}</div>
        <div className="text-4xl font-mono font-bold tracking-[0.5em]">{flow.userCode}</div>
        <div className="flex justify-center gap-2">
          <Button size="sm" variant="outline" onClick={copyCode}>
            <Copy className="h-3.5 w-3.5" /> {copied ? '✓' : t('accounts.copy')}
          </Button>
          <Button size="sm" onClick={() => window.open(flow.verificationUri, '_blank')}>
            <ExternalLink className="h-3.5 w-3.5" /> {flow.verificationUri.replace('https://', '')}
          </Button>
        </div>
      </div>

      <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('accounts.waitingForApproval', { minutes: minutesLeft })}
      </div>

      <DialogFooter>
        <Button variant="outline" onClick={onDone}>{t('accounts.cancel')}</Button>
      </DialogFooter>
    </div>
  );
}

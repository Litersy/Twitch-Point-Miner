import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Plus, Trash2, Users2, Download, Link2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Badge } from '@/components/ui/Badge';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/Dialog';
import { formatNumber } from '@/lib/utils';

type Streamer = {
  id: string;
  login: string;
  displayName: string | null;
  isOnline: boolean;
  streamGame: string | null;
  streamTitle: string | null;
  viewersCount: number | null;
  accountCount: number;
};

type AccountLite = { id: string; login: string };

export default function Streamers() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const streamers = useQuery({
    queryKey: ['streamers', search],
    queryFn: () => api<Streamer[]>(`/api/streamers${search ? `?search=${encodeURIComponent(search)}` : ''}`),
    refetchInterval: 15_000,
  });

  const accounts = useQuery({
    queryKey: ['accounts', 'lite'],
    queryFn: () => api<AccountLite[]>('/api/accounts'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/streamers/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['streamers'] }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{t('streamers.title')}</h1>
          <p className="text-muted-foreground">{t('streamers.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Input
            placeholder={t('streamers.search')}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-56"
          />
          <Dialog open={importOpen} onOpenChange={setImportOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" disabled={!accounts.data?.length}>
                <Download className="h-4 w-4" /> {t('streamers.importFollowed')}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <ImportFollowedForm onDone={() => setImportOpen(false)} accounts={accounts.data ?? []} />
            </DialogContent>
          </Dialog>
          <Dialog open={addOpen} onOpenChange={setAddOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4" /> {t('streamers.add')}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <AddStreamerForm onDone={() => setAddOpen(false)} accounts={accounts.data ?? []} />
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-4 py-3 font-medium">{t('streamers.login')}</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">{t('streamers.game')}</th>
                <th className="px-4 py-3 font-medium">{t('streamers.viewers')}</th>
                <th className="px-4 py-3 font-medium">{t('streamers.accountsAssigned')}</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {(streamers.data ?? []).map((s) => (
                <tr key={s.id} className="border-b last:border-0">
                  <td className="px-4 py-3 font-medium">
                    <a
                      href={`https://twitch.tv/${s.login}`}
                      target="_blank"
                      rel="noreferrer"
                      className="hover:text-primary"
                    >
                      {s.login}
                    </a>
                  </td>
                  <td className="px-4 py-3">
                    {s.isOnline ? (
                      <Badge variant="success">
                        <span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                        {t('streamers.online')}
                      </Badge>
                    ) : (
                      <Badge>{t('streamers.offline')}</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3 truncate max-w-[16ch]">{s.streamGame ?? '—'}</td>
                  <td className="px-4 py-3">{s.viewersCount != null ? formatNumber(s.viewersCount) : '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Users2 className="h-3.5 w-3.5" /> {s.accountCount}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => confirm(`Delete ${s.login}?`) && remove.mutate(s.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}

function AddStreamerForm({ onDone, accounts }: { onDone: () => void; accounts: AccountLite[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [input, setInput] = useState('');
  const [attachIds, setAttachIds] = useState<string[]>(accounts.length === 1 ? [accounts[0].id] : []);
  const [err, setErr] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => {
      // Split by comma / newline / whitespace so multiple can be pasted at once
      const items = input
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (items.length <= 1) {
        return api('/api/streamers', {
          method: 'POST',
          body: JSON.stringify({ login: items[0] ?? input, attachAccountIds: attachIds }),
        });
      }
      return api('/api/streamers/bulk', {
        method: 'POST',
        body: JSON.stringify({ items, attachAccountIds: attachIds }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['streamers'] });
      onDone();
    },
    onError: (e: any) => setErr(e?.message ?? 'failed'),
  });

  function toggleAttach(id: string) {
    setAttachIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setErr(null);
        if (!input.trim()) {
          setErr('empty input');
          return;
        }
        create.mutate();
      }}
      className="space-y-3"
    >
      <DialogHeader>
        <DialogTitle>{t('streamers.add')}</DialogTitle>
      </DialogHeader>
      <div className="space-y-1">
        <Label>{t('streamers.loginOrUrl')}</Label>
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          autoFocus
          required
          placeholder="lydiaviolet  or  https://www.twitch.tv/lydiaviolet"
        />
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Link2 className="h-3 w-3" /> {t('streamers.multiHint')}
        </p>
      </div>

      {accounts.length > 0 && (
        <div className="space-y-1">
          <Label>{t('streamers.attachTo')}</Label>
          <div className="flex flex-wrap gap-2">
            {accounts.map((a) => (
              <button
                key={a.id}
                type="button"
                onClick={() => toggleAttach(a.id)}
                className={`text-xs px-2 py-1 rounded-md border ${
                  attachIds.includes(a.id) ? 'bg-primary text-primary-foreground border-primary' : 'border-border'
                }`}
              >
                {a.login}
              </button>
            ))}
          </div>
        </div>
      )}

      {err && <p className="text-sm text-destructive">{err}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {t('accounts.cancel')}
        </Button>
        <Button disabled={create.isPending}>{t('accounts.save')}</Button>
      </DialogFooter>
    </form>
  );
}

function ImportFollowedForm({ onDone, accounts }: { onDone: () => void; accounts: AccountLite[] }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [accountId, setAccountId] = useState<string>(accounts[0]?.id ?? '');
  const [err, setErr] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () =>
      api<{ imported: number; attached: number; total: number }>(
        `/api/accounts/${accountId}/import-followed`,
        { method: 'POST' },
      ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['streamers'] });
      alert(t('streamers.importedNotice', { n: res.imported }));
      onDone();
    },
    onError: (e: any) => setErr(e?.message ?? 'failed'),
  });

  return (
    <div className="space-y-3">
      <DialogHeader>
        <DialogTitle>{t('streamers.importFollowed')}</DialogTitle>
      </DialogHeader>
      <p className="text-sm text-muted-foreground">{t('streamers.importFollowedHint')}</p>
      <div className="space-y-1">
        <Label>{t('streamers.attachTo')}</Label>
        <select
          className="h-9 w-full rounded-md border bg-transparent px-3 text-sm"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.login}
            </option>
          ))}
        </select>
      </div>
      {err && <p className="text-sm text-destructive">{err}</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          {t('accounts.cancel')}
        </Button>
        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !accountId}>
          {mutation.isPending ? t('common.loading') : t('streamers.runImport')}
        </Button>
      </DialogFooter>
    </div>
  );
}

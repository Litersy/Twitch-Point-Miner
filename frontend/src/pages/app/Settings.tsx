import { useState, useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api, setToken } from '@/lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import i18n from '@/i18n';

type Me = { id: string; username: string; locale: string; role: string };

export default function Settings() {
  const { t } = useTranslation();

  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => api<Me>('/api/auth/me'),
  });

  const [locale, setLocale] = useState<string>(i18n.language.startsWith('en') ? 'en' : 'ru');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (me.data?.username && !username) setUsername(me.data.username);
  }, [me.data, username]);

  const save = useMutation({
    mutationFn: (payload: Record<string, unknown>) =>
      api<Me & { token?: string }>('/api/auth/me', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      }),
    onSuccess: (res, vars) => {
      if (res.token) setToken(res.token);
      if (vars.locale) i18n.changeLanguage(String(vars.locale));
      setMsg('ok');
      setPassword('');
      setErr(null);
      setTimeout(() => setMsg(null), 2000);
    },
    onError: (e: any) => setErr(e?.message ?? 'failed'),
  });

  function saveLanguage() {
    save.mutate({ locale });
  }

  function saveUsername() {
    if (!username || username === me.data?.username) {
      setErr(t('settings.sameUsername'));
      return;
    }
    save.mutate({ username });
  }

  function savePassword() {
    if (!password || password.length < 8) {
      setErr(t('settings.passwordTooShort'));
      return;
    }
    save.mutate({ password });
  }

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('settings.title')}</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.language')}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Button variant={locale === 'ru' ? 'default' : 'outline'} onClick={() => setLocale('ru')}>
              Русский
            </Button>
            <Button variant={locale === 'en' ? 'default' : 'outline'} onClick={() => setLocale('en')}>
              English
            </Button>
            <Button variant="outline" className="ml-auto" onClick={saveLanguage} disabled={save.isPending}>
              {t('settings.save')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.changeUsername')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>{t('settings.newUsername')}</Label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} minLength={3} maxLength={64} />
            <p className="text-xs text-muted-foreground">{t('settings.usernameHint')}</p>
          </div>
          <div className="flex justify-end">
            <Button onClick={saveUsername} disabled={save.isPending}>
              {t('settings.save')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('settings.changePassword')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>{t('settings.newPassword')}</Label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              placeholder="••••••••"
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={savePassword} disabled={save.isPending}>
              {t('settings.save')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        {msg === 'ok' && <span className="text-emerald-500 text-sm">✓ {t('settings.saved')}</span>}
        {err && <span className="text-destructive text-sm">{err}</span>}
      </div>
    </div>
  );
}

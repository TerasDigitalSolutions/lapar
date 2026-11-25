import { useEffect, useState, type FormEvent } from 'react';
import { useData } from '../../data/context';
import type { AuthApi, OwnerLinkType } from '../../data/types';
import { Banner, Button, Field, inputClass, Loading } from '../../ui';
import { useAuthT } from './messages';

// One-time links: React StrictMode runs effects twice in dev, so share one verification per link.
const pending = new Map<string, Promise<void>>();
function verifyOnce(auth: AuthApi, hash: string, type: OwnerLinkType) {
  const key = `${type}:${hash}`;
  let p = pending.get(key);
  if (!p) pending.set(key, (p = auth.verifyLink(hash, type)));
  return p;
}

const parseLinkType = (v: string | null): OwnerLinkType | null => (v === 'email' || v === 'recovery' ? v : null);

/** Owner invite or password-reset link: verify, then choose a password. */
export function WelcomeView({ tokenHash, type, onDone }: { tokenHash: string | null; type: string | null; onDone: () => void }) {
  const t = useAuthT();
  const { auth } = useData();
  const linkType = parseLinkType(type);
  const [state, setState] = useState<'checking' | 'ready' | 'invalid'>(tokenHash && linkType ? 'checking' : 'invalid');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!tokenHash || !linkType) return;
    let live = true;
    verifyOnce(auth, tokenHash, linkType).then(
      () => live && setState('ready'),
      () => live && setState('invalid'),
    );
    return () => {
      live = false;
    };
  }, [auth, tokenHash, linkType]);

  if (state === 'checking') return <Loading label={t('welcome_checking')} />;
  if (state === 'invalid')
    return (
      <main className="mx-auto flex max-w-sm flex-col gap-5 p-6">
        <Banner kind="error">{t('welcome_invalid')}</Banner>
        <a href="#/manage" className="inline-flex min-h-12 items-center underline">
          {t('to_signin')}
        </a>
      </main>
    );

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next = { password: password.length >= 8 ? undefined : t('password_short'), confirm: confirm === password ? undefined : t('password_mismatch') };
    setErrors(next);
    if (next.password || next.confirm) return;
    setBusy(true);
    try {
      await auth.setPassword(password);
      onDone();
    } catch {
      setErrors({ form: t('set_password_failed') });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="mx-auto flex max-w-sm flex-col gap-5 p-6" noValidate>
      <h1 className="text-2xl font-bold text-stone-900">{linkType === 'recovery' ? t('welcome_title_recovery') : t('welcome_title_email')}</h1>
      <Field label={t('new_password')} hint={t('new_password_hint')} error={errors.password}>
        {(p) => <input {...p} type="password" autoComplete="new-password" className={`${inputClass} text-lg`} value={password} onChange={(e) => setPassword(e.target.value)} />}
      </Field>
      <Field label={t('confirm_password')} error={errors.confirm}>
        {(p) => <input {...p} type="password" autoComplete="new-password" className={`${inputClass} text-lg`} value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
      </Field>
      {errors.form && <Banner kind="error">{errors.form}</Banner>}
      <Button type="submit" block disabled={busy}>
        {t('set_password_submit')}
      </Button>
    </form>
  );
}

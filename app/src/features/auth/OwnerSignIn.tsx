import { useEffect, useState, type FormEvent } from 'react';
import { useData } from '../../data/context';
import { isLaparError } from '../../data/types';
import { Banner, Button, Field, inputClass } from '../../ui';
import { useAuthT } from './messages';

/** Email + password for owners. Warns when this browser holds a live staff session (signing in replaces it, D38). */
export function OwnerSignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const t = useAuthT();
  const { auth } = useData();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);
  const [staff, setStaff] = useState(false);

  useEffect(() => {
    let live = true;
    auth.getStaffSession().then(
      (s) => live && setStaff(!!s),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [auth]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next = { email: email.trim() ? undefined : t('email_required'), password: password ? undefined : t('password_required') };
    setErrors(next);
    if (next.email || next.password) return;
    setBusy(true);
    try {
      await auth.signInWithPassword(email.trim(), password);
      onSignedIn();
    } catch (err) {
      const wrong = isLaparError(err, 'not_signed_in') || isLaparError(err, 'forbidden') || isLaparError(err, 'invalid_input');
      setErrors({ form: wrong ? t('signin_wrong') : t('signin_failed') });
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="mx-auto flex max-w-sm flex-col gap-5 p-6" noValidate>
      <h1 className="text-2xl font-bold text-stone-900">{t('signin_title')}</h1>
      <p className="text-stone-700">{t('signin_intro')}</p>
      {staff && <Banner kind="warn">{t('staff_warning')}</Banner>}
      <Field label={t('email')} error={errors.email}>
        {(p) => <input {...p} type="email" autoComplete="email" inputMode="email" autoCapitalize="none" autoCorrect="off" className={`${inputClass} text-lg`} value={email} onChange={(e) => setEmail(e.target.value)} />}
      </Field>
      <Field label={t('password')} error={errors.password}>
        {(p) => <input {...p} type="password" autoComplete="current-password" className={`${inputClass} text-lg`} value={password} onChange={(e) => setPassword(e.target.value)} />}
      </Field>
      {errors.form && <Banner kind="error">{errors.form}</Banner>}
      <Button type="submit" block disabled={busy}>
        {t('signin_submit')}
      </Button>
    </form>
  );
}

import { useState, type FormEvent } from 'react';
import { Banner, Button, Field, inputClass } from '../../ui';
import { isLaparError } from '../../data/types';
import { formatStaffCode, normalizeStaffCode } from '../../lib/staffCode';
import { readJson, writeJson } from '../../lib/storage';
import { useStaffT } from './messages';

const CODE_KEY = 'lapar.staff.code';
const DIGITS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];

export function StaffPinForm({ onSubmit }: { onSubmit: (staffCode: string, pin: string) => void | Promise<unknown> }) {
  const t = useStaffT();
  const [shop, setShop] = useState(() => formatStaffCode(readJson<string>(CODE_KEY, '')));
  const [pin, setPin] = useState('');
  const [shopError, setShopError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const press = (d: string) => setPin((p) => (p.length < 6 ? p + d : p));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const code = normalizeStaffCode(shop);
    setShopError(code.length === 8 ? null : t(code ? 'pin_not_found' : 'pin_shop_required'));
    const badPin = !/^\d{4,6}$/.test(pin);
    setError(badPin ? t('pin_len') : null);
    if (code.length !== 8 || badPin) return;
    setBusy(true);
    try {
      await onSubmit(code, pin);
      writeJson(CODE_KEY, code); // remembered only once it worked
    } catch (err) {
      setPin('');
      if (isLaparError(err, 'not_found')) {
        setShopError(t('pin_not_found'));
        return;
      }
      if (isLaparError(err, 'invalid_pin')) setError(t('pin_wrong'));
      else if (isLaparError(err, 'pin_locked')) {
        const until = err.detail ? new Date(err.detail) : null;
        const time = until && !isNaN(until.getTime()) ? until.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kuala_Lumpur' }) : '';
        setError(t('pin_locked', { time }));
      } else setError(t('pin_failed'));
    } finally {
      setBusy(false);
    }
  }

  const key = 'flex min-h-14 items-center justify-center rounded-xl border border-stone-300 bg-white text-2xl font-semibold text-stone-900 active:bg-stone-100';
  return (
    <form onSubmit={(e) => void submit(e)} className="mx-auto flex max-w-sm flex-col gap-5 p-6" noValidate>
      <h1 className="text-2xl font-bold text-stone-900">{t('pin_title')}</h1>
      <Field label={t('pin_shop')} hint={t('pin_shop_hint')} error={shopError}>
        {(p) => <input {...p} className={inputClass} value={shop} autoCapitalize="characters" autoCorrect="off" onChange={(e) => setShop(e.target.value)} />}
      </Field>
      <div className="flex flex-col gap-2">
        <span className="text-base font-semibold text-stone-800">{t('pin_pin')}</span>
        <div role="img" aria-label={t('pin_digits', { n: pin.length })} className="flex min-h-12 items-center justify-center text-3xl tracking-widest text-stone-900">
          {pin ? '●'.repeat(pin.length) : <span className="text-stone-300">- - - -</span>}
        </div>
        {error && <Banner kind="error">{error}</Banner>}
        <div className="grid grid-cols-3 gap-2">
          {DIGITS.map((d) => (
            <button key={d} type="button" className={key} onClick={() => press(d)}>{d}</button>
          ))}
          <span />
          <button type="button" className={key} onClick={() => press('0')}>0</button>
          <button type="button" aria-label={t('pin_backspace')} className={key} onClick={() => setPin((p) => p.slice(0, -1))}>⌫</button>
        </div>
      </div>
      <Button type="submit" block disabled={busy}>{t('pin_submit')}</Button>
    </form>
  );
}

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useData } from '../../data/context';
import { toLaparError } from '../../data/hooks';
import type { AdminShopDTO, EntitlementKey, LaparError, OverrideDTO, OwnerLinkDTO, OwnerLinkMode } from '../../data/types';
import { FEATURE_KEYS, LIMIT_KEYS, PLAN_DEFAULTS, isFeatureKey, type PlanId } from '../../entitlements/keys';
import { Banner, Button, ConfirmDialog, ErrorState, Field, Loading, Segmented, Sheet, ToastProvider, inputClass, useToast } from '../../ui';
import { useAdminT } from './messages';

const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const slugFrom = (name: string) => name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');
const when = (iso: string) => new Date(iso).toLocaleString();

type T = ReturnType<typeof useAdminT>;
const ERR_KEYS = ['slug_taken', 'forbidden', 'not_signed_in', 'not_found', 'invalid_input', 'network'] as const;
/** Readable text for any thrown value, never the raw code. */
function errText(t: T, e: unknown): string {
  const { code, detail } = toLaparError(e);
  if (detail === 'email_in_use') return t('err_email_in_use');
  return (ERR_KEYS as readonly string[]).includes(code) ? t(`err_${code as (typeof ERR_KEYS)[number]}`) : t('err_unknown');
}

/** The one-time link: copy, WhatsApp, and a plain statement that it works once. */
export function LinkPanel({ link }: { link: OwnerLinkDTO }) {
  const t = useAdminT();
  const toast = useToast();
  const text = t('share_message', { hours: link.expiresHours, url: link.url });
  const copy = () =>
    navigator.clipboard.writeText(link.url).then(
      () => toast(t('copied'), 'success'),
      () => toast(t('copy_failed'), 'error'),
    );
  return (
    <section aria-label={t('link_title', { email: link.email })} className="flex flex-col gap-3 rounded-xl border-2 border-orange-300 bg-orange-50 p-4">
      <h3 className="text-lg font-bold text-stone-900">{t('link_title', { email: link.email })}</h3>
      <p className="font-semibold text-stone-900">{t('link_once')}</p>
      <p className="text-stone-700">{t('link_expires', { hours: link.expiresHours })}</p>
      <input readOnly aria-label={t('copy')} value={link.url} onFocus={(e) => e.currentTarget.select()} className={`${inputClass} text-sm`} />
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={() => void copy()}>{t('copy')}</Button>
        <a
          href={`https://wa.me/?text=${encodeURIComponent(text)}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-12 items-center justify-center rounded-xl border border-stone-300 bg-white px-5 text-base font-semibold text-stone-900 hover:bg-stone-50"
        >
          {t('share_whatsapp')}
        </a>
      </div>
    </section>
  );
}

function CreateShop({ onCreated }: { onCreated: (id: string, link: OwnerLinkDTO | null, linkError: string | null) => void }) {
  const t = useAdminT();
  const { admin } = useData();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [email, setEmail] = useState('');
  const [errors, setErrors] = useState<{ name?: string; slug?: string; email?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const next = {
      name: name.trim() ? undefined : t('name_required'),
      slug: SLUG_RE.test(slug) ? undefined : t('slug_invalid'),
      email: EMAIL_RE.test(email.trim()) ? undefined : t('email_invalid'),
    };
    setErrors(next);
    if (next.name || next.slug || next.email) return;
    setBusy(true);
    let id: string;
    try {
      id = await admin.createShop({ name: name.trim(), slug });
    } catch (err) {
      setErrors({ ...(toLaparError(err).code === 'slug_taken' ? { slug: t('err_slug_taken') } : { form: errText(t, err) }) });
      setBusy(false);
      return;
    }
    let link: OwnerLinkDTO | null = null;
    let linkError: string | null = null;
    try {
      link = await admin.createOwnerLink(id, email.trim(), 'invite');
    } catch (err) {
      // the shop exists; the caller shows this as a warning
      linkError = toLaparError(err).detail === 'email_in_use' ? t('err_email_in_use') : t('shop_created_link_failed');
    }
    setBusy(false);
    setName('');
    setSlug('');
    setSlugTouched(false);
    setEmail('');
    onCreated(id, link, linkError);
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4 rounded-xl border border-stone-200 bg-white p-4">
      <h2 className="text-xl font-bold text-stone-900">{t('new_shop')}</h2>
      {errors.form && <Banner kind="error">{errors.form}</Banner>}
      <Field label={t('shop_name')} error={errors.name}>
        {(p) => (
          <input
            {...p}
            className={inputClass}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              if (!slugTouched) setSlug(slugFrom(e.target.value));
            }}
          />
        )}
      </Field>
      <Field label={t('shop_slug')} hint={t('shop_slug_hint')} error={errors.slug}>
        {(p) => (
          <input
            {...p}
            className={inputClass}
            autoCapitalize="none"
            autoCorrect="off"
            value={slug}
            onChange={(e) => (setSlugTouched(true), setSlug(e.target.value.toLowerCase()))}
          />
        )}
      </Field>
      <Field label={t('owner_email')} error={errors.email}>
        {(p) => <input {...p} type="email" inputMode="email" autoCapitalize="none" className={inputClass} value={email} onChange={(e) => setEmail(e.target.value)} />}
      </Field>
      <Button type="submit" block disabled={busy}>
        {busy ? t('creating') : t('create_shop')}
      </Button>
    </form>
  );
}

function OverrideEditor({ shop, keyName, current, onClose, onSaved }: { shop: AdminShopDTO; keyName: EntitlementKey; current: OverrideDTO | undefined; onClose: () => void; onSaved: () => void }) {
  const t = useAdminT();
  const { admin } = useData();
  const feature = isFeatureKey(keyName);
  const [enabled, setEnabled] = useState<'on' | 'off'>(current?.enabled === false ? 'off' : 'on');
  const [limit, setLimit] = useState(current ? (current.limitValue === null ? '' : String(current.limitValue)) : '');
  const [note, setNote] = useState(current?.note ?? '');
  const [errors, setErrors] = useState<{ note?: string; limit?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  async function save(e: FormEvent) {
    e.preventDefault();
    const limitNum = limit.trim() === '' ? null : Number(limit);
    const next = {
      note: note.trim() ? undefined : t('note_required'),
      limit: !feature && limitNum !== null && !(Number.isInteger(limitNum) && limitNum >= 0) ? t('limit_invalid') : undefined,
    };
    setErrors(next);
    if (next.note || next.limit) return;
    setBusy(true);
    try {
      await admin.setOverride({ shopId: shop.id, key: keyName, ...(feature ? { enabled: enabled === 'on' } : { limitValue: limitNum }), note: note.trim() });
      onSaved();
    } catch (err) {
      setErrors({ form: errText(t, err) });
      setBusy(false);
    }
  }

  return (
    <Sheet open onClose={onClose} title={t('override_title', { key: keyName })}>
      <form onSubmit={(e) => void save(e)} noValidate className="flex flex-col gap-4">
        {errors.form && <Banner kind="error">{errors.form}</Banner>}
        {feature ? (
          <Segmented
            label={keyName}
            value={enabled}
            onChange={setEnabled}
            options={[{ value: 'on', label: t('on') }, { value: 'off', label: t('off') }]}
          />
        ) : (
          <Field label={t('limit_value')} hint={t('limit_hint')} error={errors.limit}>
            {(p) => <input {...p} inputMode="numeric" className={inputClass} value={limit} onChange={(e) => setLimit(e.target.value)} />}
          </Field>
        )}
        <Field label={t('note')} hint={t('note_hint')} error={errors.note}>
          {(p) => <input {...p} maxLength={200} className={inputClass} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {t('cancel')}
          </Button>
          <Button type="submit" disabled={busy}>
            {t('save')}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

function ShopDetail({ shop, link, warn, onLink, onChanged, onBack }: { shop: AdminShopDTO; warn: string | null; link: OwnerLinkDTO | null; onLink: (l: OwnerLinkDTO | null) => void; onChanged: () => void; onBack: () => void }) {
  const t = useAdminT();
  const { admin } = useData();
  const toast = useToast();
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [editing, setEditing] = useState<EntitlementKey | null>(null);
  const [removing, setRemoving] = useState<OverrideDTO | null>(null);

  /** Run an admin action, then reload the list. */
  async function act(fn: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (done) toast(done, 'success');
      onChanged();
    } catch (e) {
      setError(errText(t, e));
    } finally {
      setBusy(false);
    }
  }

  const makeLink = (email: string, mode: OwnerLinkMode) => act(async () => onLink(await admin.createOwnerLink(shop.id, email, mode)));
  const invite = (e: FormEvent) => {
    e.preventDefault();
    if (!EMAIL_RE.test(inviteEmail.trim())) return setInviteError(t('email_invalid'));
    setInviteError(null);
    void makeLink(inviteEmail.trim(), 'invite').then(() => setInviteEmail(''));
  };

  const planValue = (k: EntitlementKey) => {
    const p = PLAN_DEFAULTS[shop.planId];
    const v = isFeatureKey(k) ? p.features[k] : p.limits[k as (typeof LIMIT_KEYS)[number]];
    return typeof v === 'boolean' ? (v ? t('on') : t('off')) : v === null ? t('unlimited') : String(v);
  };
  const overrideValue = (o: OverrideDTO) => (o.enabled !== null ? (o.enabled ? t('on') : t('off')) : o.limitValue === null ? t('unlimited') : String(o.limitValue));

  return (
    <div className="flex flex-col gap-5">
      <Button variant="ghost" onClick={onBack} className="self-start">
        ← {t('back')}
      </Button>
      <header>
        <h2 className="text-2xl font-bold text-stone-900">{shop.name}</h2>
        <p className="text-stone-600">
          {shop.slug}
          {!shop.active && ` · ${t('inactive')}`}
        </p>
      </header>
      {warn && <Banner kind="warn">{warn}</Banner>}
      {error && <Banner kind="error">{error}</Banner>}
      {link && <LinkPanel link={link} />}

      <section aria-label={t('owners')} className="flex flex-col gap-3">
        <h3 className="text-lg font-bold text-stone-900">{t('owners')}</h3>
        {shop.ownerEmails.length === 0 && <p className="text-stone-600">{t('no_owner')}</p>}
        {shop.ownerEmails.map((email) => (
          <div key={email} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-stone-200 bg-white p-3">
            <span className="min-w-0 break-all">{email}</span>
            <Button variant="secondary" disabled={busy} onClick={() => void makeLink(email, 'reset')} aria-label={`${t('reset_password')} ${email}`}>
              {t('reset_password')}
            </Button>
          </div>
        ))}
        <form onSubmit={invite} noValidate className="flex flex-col gap-3">
          <Field label={t('owner_email')} error={inviteError}>
            {(p) => <input {...p} type="email" inputMode="email" autoCapitalize="none" className={inputClass} value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} />}
          </Field>
          <Button type="submit" disabled={busy}>
            {t('invite_owner')}
          </Button>
        </form>
      </section>

      <section aria-label={t('plan')} className="flex flex-col gap-3">
        <h3 className="text-lg font-bold text-stone-900">{t('plan')}</h3>
        <Segmented<PlanId>
          label={t('plan')}
          value={shop.planId}
          onChange={(p) => p !== shop.planId && void act(() => admin.setPlan(shop.id, p), t('plan_changed'))}
          options={[{ value: 'basic', label: t('plan_basic') }, { value: 'pro', label: t('plan_pro') }]}
        />
        <Button variant={shop.active ? 'danger' : 'primary'} disabled={busy} onClick={() => (shop.active ? setConfirm(true) : void act(() => admin.setShopActive(shop.id, true), t('shop_activated')))}>
          {shop.active ? t('deactivate') : t('activate')}
        </Button>
      </section>

      <section aria-label={t('overrides')} className="flex flex-col gap-3">
        <h3 className="text-lg font-bold text-stone-900">{t('overrides')}</h3>
        <p className="text-stone-600">{t('overrides_hint')}</p>
        <ul className="flex flex-col gap-2">
          {[...FEATURE_KEYS, ...LIMIT_KEYS].map((k) => {
            const o = shop.overrides.find((x) => x.key === k);
            return (
              <li key={k} data-testid={`ov-${k}`} className={`flex flex-col gap-1 rounded-xl border p-3 ${o ? 'border-orange-300 bg-orange-50' : 'border-stone-200 bg-white'}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-stone-900">{k}</span>
                  <span className="text-sm text-stone-700">
                    {t('plan_value')}: {planValue(k)}
                    {o && ` · ${t('override_value')}: ${overrideValue(o)}`}
                  </span>
                </div>
                {o && (
                  <p className="text-sm text-stone-700">
                    {o.note} · {t('changed_by', { who: o.changedByEmail ?? '?', when: when(o.changedAt) })}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button variant="secondary" disabled={busy} onClick={() => setEditing(k)} aria-label={`${o ? t('edit') : t('override')} ${k}`}>
                    {o ? t('edit') : t('override')}
                  </Button>
                  {o && (
                    <Button variant="ghost" disabled={busy} onClick={() => setRemoving(o)} aria-label={`${t('remove')} ${k}`}>
                      {t('remove')}
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <ConfirmDialog open={confirm} danger busy={busy} title={t('deactivate_title', { name: shop.name })} confirmLabel={t('deactivate')} onCancel={() => setConfirm(false)} onConfirm={() => (setConfirm(false), void act(() => admin.setShopActive(shop.id, false), t('shop_deactivated')))}>
        {t('deactivate_body')}
      </ConfirmDialog>
      <ConfirmDialog open={!!removing} danger busy={busy} title={removing ? t('override_title', { key: removing.key }) : ''} confirmLabel={t('remove')} onCancel={() => setRemoving(null)} onConfirm={() => { const k = removing!.key; setRemoving(null); void act(() => admin.clearOverride(shop.id, k), t('override_removed')); }}>
        {removing?.note}
      </ConfirmDialog>
      {editing && (
        <OverrideEditor key={editing} shop={shop} keyName={editing} current={shop.overrides.find((x) => x.key === editing)} onClose={() => setEditing(null)} onSaved={() => (setEditing(null), toast(t('override_saved'), 'success'), onChanged())} />
      )}
    </div>
  );
}

function Settings() {
  const t = useAdminT();
  const { admin } = useData();
  const toast = useToast();
  const [value, setValue] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    admin.getPlatformSettings().then(
      // Keep anything typed before the saved value arrived.
      (s) => live && setValue((v) => v ?? s.whatsappNumber ?? ''),
      (e: unknown) => live && (setValue((v) => v ?? ''), setError(errText(t, e))),
    );
    return () => {
      live = false;
    };
  }, [admin, t]);
  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const digits = (value ?? '').replace(/[ +-]/g, '');
      await admin.setPlatformSettings({ whatsappNumber: digits || null });
      setValue(digits);
      toast(t('whatsapp_saved'), 'success');
    } catch (err) {
      setError(errText(t, err));
    }
  }
  return (
    <form onSubmit={(e) => void save(e)} className="flex flex-col gap-3 rounded-xl border border-stone-200 bg-white p-4">
      <h2 className="text-xl font-bold text-stone-900">{t('settings')}</h2>
      {error && <Banner kind="error">{error}</Banner>}
      <Field label={t('whatsapp')} hint={t('whatsapp_hint')}>
        {(p) => <input {...p} inputMode="tel" className={inputClass} value={value ?? ''} disabled={value === null} onChange={(e) => setValue(e.target.value)} />}
      </Field>
      <Button type="submit" disabled={value === null}>
        {t('save')}
      </Button>
    </form>
  );
}

function AdminScreen() {
  const t = useAdminT();
  const { admin } = useData();
  const [shops, setShops] = useState<AdminShopDTO[] | null>(null);
  const [error, setError] = useState<LaparError | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [link, setLink] = useState<OwnerLinkDTO | null>(null);
  const [warn, setWarn] = useState<string | null>(null);

  const load = useCallback(() => {
    admin.listShops().then((s) => (setShops(s), setError(null)), (e: unknown) => setError(toLaparError(e)));
  }, [admin]);
  useEffect(load, [load]);

  if (error && !shops) return <ErrorState error={error} onRetry={load} />;
  if (!shops) return <Loading />;
  const shop = shops.find((s) => s.id === selected);

  if (shop)
    return <ShopDetail key={shop.id} shop={shop} warn={warn} link={link} onLink={setLink} onChanged={load} onBack={() => (setSelected(null), setLink(null), setWarn(null))} />;

  return (
    <div className="flex flex-col gap-6">
      <section aria-label={t('shops')} className="flex flex-col gap-3">
        <h2 className="text-xl font-bold text-stone-900">{t('shops')}</h2>
        {shops.length === 0 && <p className="text-stone-600">{t('no_shops')}</p>}
        <ul className="flex flex-col gap-2">
          {shops.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => (setSelected(s.id), setLink(null))}
                className="flex min-h-12 w-full flex-col gap-0.5 rounded-xl border border-stone-200 bg-white p-4 text-left hover:bg-stone-50 focus-visible:outline-2 focus-visible:outline-orange-600"
              >
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-lg font-bold text-stone-900">{s.name}</span>
                  <span className="rounded-full bg-stone-200 px-2 py-0.5 text-sm font-semibold">{t(s.planId === 'pro' ? 'plan_pro' : 'plan_basic')}</span>
                </span>
                <span className="text-stone-600">
                  {s.slug}
                  {!s.active && ` · ${t('inactive')}`}
                </span>
                <span className="text-sm text-stone-600">{s.lastOrderAt ? t('last_order', { when: when(s.lastOrderAt) }) : t('no_orders')}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <CreateShop
        onCreated={(id, l, linkError) => {
          setLink(l);
          setWarn(linkError);
          setSelected(id);
          load();
        }}
      />
      <Settings />
    </div>
  );
}

/** Teras admin screen. Sign-in and the admin check are in the route (index.tsx). */
export function AdminView({ onSignOut }: { onSignOut?: () => void }) {
  const t = useAdminT();
  return (
    <ToastProvider>
      <main className="mx-auto flex max-w-2xl flex-col gap-6 p-4">
        <div className="flex items-center justify-between gap-3">
          <h1 className="text-2xl font-bold text-stone-900">{t('title')}</h1>
          {onSignOut && (
            <Button variant="ghost" onClick={onSignOut}>
              {t('sign_out')}
            </Button>
          )}
        </div>
        <AdminScreen />
      </main>
    </ToastProvider>
  );
}

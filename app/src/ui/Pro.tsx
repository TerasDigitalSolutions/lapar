import { useState, type ReactNode } from 'react';
import { useEntitlements, useProCta } from '../entitlements/hooks';
import { entitlementDescription, entitlementLabel } from '../entitlements/messages';
import type { FeatureKey, LimitKey } from '../entitlements/keys';
import { Button, focusRing } from './Button';
import { Sheet } from './Sheet';
import { useUiT } from './messages';

export function ProBadge() {
  const t = useUiT();
  return <span className="inline-flex items-center rounded-full bg-amber-400 px-2 py-0.5 text-xs font-extrabold tracking-wide text-stone-900 uppercase">{t('pro')}</span>;
}

/**
 * A locked feature: a Pro badge with the feature name (or `children`). Tap opens a sheet explaining what Pro adds,
 * with the call to action from `ProCtaProvider`. Render it instead of the feature when `useFeature(key)` is false.
 */
export function ProLocked({ feature, children }: { feature: FeatureKey; children?: ReactNode }) {
  const t = useUiT();
  const cta = useProCta();
  const [open, setOpen] = useState(false);
  const label = entitlementLabel(feature);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-xl border border-dashed border-stone-300 bg-stone-50 px-4 text-left text-stone-700 ${focusRing}`}
      >
        <span className="font-semibold">{children ?? label}</span>
        <ProBadge />
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('pro_title', { feature: label })}>
        <p className="mb-5 text-stone-700">{t('pro_body', { description: entitlementDescription(feature) })}</p>
        {cta.kind === 'demo' && <p className="mb-5 font-semibold text-stone-900">{t('pro_cta_demo')}</p>}
        {cta.kind === 'neutral' && <p className="mb-5 font-semibold text-stone-900">{t('pro_cta_neutral')}</p>}
        <div className="flex flex-col gap-3">
          {cta.kind === 'whatsapp' && (
            <a
              href={`https://wa.me/${cta.number.replace(/\D/g, '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className={`inline-flex min-h-12 items-center justify-center rounded-xl bg-green-700 px-5 text-base font-semibold text-white ${focusRing}`}
            >
              {t('pro_cta_whatsapp')}
            </a>
          )}
          <Button variant="secondary" onClick={() => setOpen(false)}>
            {t('got_it')}
          </Button>
        </div>
      </Sheet>
    </>
  );
}

/** "8 / 15" for a limit; renders nothing when the limit is unlimited. */
export function LimitBadge({ used, limitKey }: { used: number; limitKey: LimitKey }) {
  const t = useUiT();
  const limit = useEntitlements().limits[limitKey];
  if (limit === null) return null;
  const full = used >= limit;
  return (
    <span
      aria-label={t('limit_used', { used, limit })}
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-sm font-bold tabular-nums ${full ? 'bg-red-100 text-red-800' : 'bg-stone-200 text-stone-800'}`}
    >
      {used} / {limit}
    </span>
  );
}

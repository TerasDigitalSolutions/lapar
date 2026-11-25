import { useState } from 'react';
import { SITE_BASE_URL } from '../../../config';
import { useData } from '../../../data/context';
import { useFeature } from '../../../entitlements/hooks';
import { qrSvg, tableQrUrl } from '../../../lib/qr';
import { Button, ConfirmDialog, ErrorState, Field, inputClass, Loading, ProLocked, Sheet } from '../../../ui';
import { useAct, useLoad } from '../hooks';
import { Card, Heading } from '../parts';
import { useProT } from './messages';

const LABEL_MAX = 20;

/** Address of the pickup board screen. shortcut: no public route serves it yet, wire it up when one exists. */
export const pickupBoardUrl = (token: string): string => `${SITE_BASE_URL}#/pickup/${token}`;

export function TakeawaySection({ shopId }: { shopId: string }) {
  const on = useFeature('takeaway');
  if (!on) return <ProLocked feature="takeaway" />;
  return <Takeaway shopId={shopId} />;
}

type Qr = { title: string; url: string } | null;

function Takeaway({ shopId }: { shopId: string }) {
  const t = useProT();
  const api = useData();
  const { run, busy } = useAct();
  const tables = useLoad(() => api.owner.listTables(shopId), shopId);
  const settings = useLoad(() => api.owner.getShopSettings(shopId), shopId);
  const [label, setLabel] = useState('');
  const [labelError, setLabelError] = useState<string | null>(null);
  const [qr, setQr] = useState<Qr>(null);
  const [confirming, setConfirming] = useState(false);

  const error = tables.error ?? settings.error;
  if (!tables.data || !settings.data) return error ? <ErrorState error={error} onRetry={() => (tables.reload(), settings.reload())} /> : <Loading />;
  const counters = tables.data.filter((x) => x.kind === 'counter');
  const token = settings.data.pickupBoardToken;

  const createCounter = async () => {
    const name = label.trim();
    const problem = !name ? t('name_required') : name.length > LABEL_MAX ? t('name_too_long', { max: LABEL_MAX }) : null;
    setLabelError(problem);
    if (problem) return;
    if (await run(() => api.owner.saveTable({ shopId, label: name, kind: 'counter' }), t('counter_created'))) {
      setLabel('');
      tables.reload();
    }
  };

  const regenerate = async () => {
    const made = await run(() => api.pro.regeneratePickupBoardToken(shopId), token ? t('link_regenerated') : t('link_made'));
    if (made) {
      setConfirming(false);
      settings.reload();
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Heading>{t('takeaway_title')}</Heading>

      <Card className="flex flex-col gap-3">
        <p className="text-stone-700">{t('counter_body')}</p>
        {counters.map((c) => (
          <div key={c.id} className="flex items-center justify-between gap-3">
            <span className="text-lg font-bold text-stone-900">{c.label}</span>
            <Button variant="secondary" aria-label={t('show_qr', { name: c.label })} onClick={() => setQr({ title: t('qr_title', { name: c.label }), url: tableQrUrl(c.token) })}>
              QR
            </Button>
          </div>
        ))}
        {counters.length === 0 && (
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void createCounter();
            }}
          >
            <Field label={t('counter_name')} hint={t('counter_name_hint')} error={labelError}>
              {(p) => <input {...p} className={inputClass} value={label} onChange={(e) => setLabel(e.target.value)} />}
            </Field>
            <Button type="submit" disabled={busy}>
              {t('create_counter')}
            </Button>
          </form>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <h3 className="text-lg font-bold text-stone-900">{t('pickup_title')}</h3>
        <p className="text-stone-700">{t('pickup_body')}</p>
        {token ? (
          <>
            <p className="text-sm break-all text-stone-600">{pickupBoardUrl(token)}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" onClick={() => setQr({ title: t('pickup_qr'), url: pickupBoardUrl(token) })}>
                {t('pickup_qr')}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => setConfirming(true)}>
                {t('regenerate')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-stone-600">{t('pickup_missing')}</p>
            <Button disabled={busy} onClick={() => void regenerate()}>
              {t('make_link')}
            </Button>
          </>
        )}
      </Card>

      <Sheet open={!!qr} onClose={() => setQr(null)} title={qr?.title ?? ''}>
        {qr && (
          <div className="flex flex-col items-center gap-4">
            <div className="w-64 max-w-full" dangerouslySetInnerHTML={{ __html: qrSvg(qr.url) }} />
            <p className="text-center text-sm break-all text-stone-600">{qr.url}</p>
          </div>
        )}
      </Sheet>

      <ConfirmDialog open={confirming} danger busy={busy} title={t('regenerate_title')} confirmLabel={t('regenerate_confirm')} cancelLabel={t('keep_old')} onConfirm={() => void regenerate()} onCancel={() => setConfirming(false)}>
        {t('regenerate_warning')}
      </ConfirmDialog>
    </div>
  );
}

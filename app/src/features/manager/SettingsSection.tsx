import { useState } from 'react';
import { useData } from '../../data/context';
import type { ApprovalMode, ShopSettings } from '../../data/types';
import { resizeImage } from '../../lib/image';
import { Button, ErrorState, Field, inputClass, Loading, PhotoTile, Segmented } from '../../ui';
import { useAct, useLoad } from './hooks';
import { useManagerT } from './messages';
import { Card, Heading } from './parts';

const NAME_MAX = 80;

function SettingsForm({ shop, onSaved }: { shop: ShopSettings; onSaved: () => void }) {
  const t = useManagerT();
  const api = useData();
  const { run, busy } = useAct();
  const [name, setName] = useState(shop.name);
  const [mode, setMode] = useState<ApprovalMode>(shop.approvalMode);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const clean = name.trim();
    const err = !clean ? t('name_required') : clean.length > NAME_MAX ? t('name_too_long', { max: NAME_MAX }) : null;
    setError(err);
    if (err) return;
    if (await run(() => api.owner.updateShopSettings(shop.id, { name: clean, approvalMode: mode }), t('saved'))) onSaved();
  };

  const pickLogo = async (file: File | undefined) => {
    if (!file) return;
    await run(
      async () => {
        const blob = await resizeImage(file, 512);
        const url = await api.owner.uploadLogo(shop.id, blob);
        await api.owner.updateShopSettings(shop.id, { logoUrl: url });
      },
      t('logo_saved'),
      (e) => (e instanceof Error && e.name !== 'LaparError' ? t('photo_unreadable') : null),
    );
    onSaved();
  };

  const modes: { value: ApprovalMode; label: string; hint: string }[] = [
    { value: 'every_order', label: t('mode_every'), hint: t('mode_every_hint') },
    { value: 'first_order', label: t('mode_first'), hint: t('mode_first_hint') },
    { value: 'none', label: t('mode_none'), hint: t('mode_none_hint') },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Heading>{t('settings_title')}</Heading>
      <Card>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label={t('shop_name')} error={error}>
            {(p) => <input {...p} className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <div className="flex flex-col gap-1.5">
            <span className="text-base font-semibold text-stone-800">{t('approval_title')}</span>
            <Segmented label={t('approval_title')} options={modes} value={mode} onChange={setMode} />
            <p className="text-sm text-stone-600">{modes.find((m) => m.value === mode)?.hint}</p>
          </div>
          <Button type="submit" disabled={busy || (name.trim() === shop.name && mode === shop.approvalMode)}>
            {t('save')}
          </Button>
        </form>
      </Card>
      <Card className="flex items-center gap-4">
        <PhotoTile url={shop.logoUrl} name={shop.name} className="size-20" />
        <div className="flex flex-col gap-2">
          <span className="text-base font-semibold text-stone-800">{t('logo')}</span>
          <label className="inline-flex min-h-12 cursor-pointer items-center justify-center rounded-xl border border-stone-300 bg-white px-5 text-base font-semibold text-stone-900 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-orange-600">
            {shop.logoUrl ? t('change_logo') : t('upload_logo')}
            <input type="file" accept="image/*" className="sr-only" disabled={busy} onChange={(e) => void pickLogo(e.target.files?.[0])} />
          </label>
        </div>
      </Card>
    </div>
  );
}

export function SettingsSection({ shopId }: { shopId: string }) {
  const api = useData();
  const q = useLoad(() => api.owner.getShopSettings(shopId), shopId);
  if (!q.data) return q.error ? <ErrorState error={q.error} onRetry={q.reload} /> : <Loading />;
  return <SettingsForm key={q.data.name + q.data.approvalMode + (q.data.logoUrl ?? '')} shop={q.data} onSaved={q.reload} />;
}

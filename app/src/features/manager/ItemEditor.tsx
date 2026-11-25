import { useState } from 'react';
import { useData } from '../../data/context';
import type { ItemInput, ItemRow, MenuEditorDTO } from '../../data/types';
import { resizeImage } from '../../lib/image';
import { parseRM } from '../../lib/money';
import { Button, Field, inputClass, PhotoTile, Toggle } from '../../ui';
import { priceText, useAct } from './hooks';
import { useManagerT } from './messages';
import { OptionGroups } from './OptionGroups';
import { Card, Heading } from './parts';
import { ItemProFields } from './pro/ItemProFields';

const NAME_MAX = 60;
const DESC_MAX = 300;
const PRICE_MAX = 10_000_000;

function initialDraft(shopId: string, categoryId: string, item: ItemRow | undefined): ItemInput {
  if (!item) return { shopId, categoryId, name: '', description: '', priceSen: 0, active: true, soldOut: false };
  return {
    id: item.id,
    shopId,
    categoryId: item.categoryId,
    stationId: item.stationId,
    name: item.name,
    description: item.description,
    translations: item.translations,
    priceSen: item.priceSen,
    active: item.active,
    soldOut: item.soldOut,
    isCombo: item.isCombo,
  };
}

/** Full-page editor for one item: details, photo, suggestions, then (once saved) its option groups. */
export function ItemEditor({ shopId, editor, itemId, categoryId, onBack, onChanged }: { shopId: string; editor: MenuEditorDTO; itemId: string | null; categoryId: string; onBack: () => void; onChanged: () => void }) {
  const t = useManagerT();
  const api = useData();
  const { run, busy } = useAct();
  const [draft, setDraft] = useState<ItemInput>(() => initialDraft(shopId, categoryId, editor.items.find((i) => i.id === itemId)));
  const [price, setPrice] = useState(() => {
    const item = editor.items.find((i) => i.id === itemId);
    return item ? priceText(item.priceSen) : '';
  });
  const [errors, setErrors] = useState<{ name?: string; price?: string; description?: string }>({});
  const [pendingPhoto, setPendingPhoto] = useState<Blob | null>(null);
  const savedItem = editor.items.find((i) => i.id === draft.id);

  const save = async () => {
    const name = draft.name.trim();
    const sen = parseRM(price);
    const next: typeof errors = {};
    if (!name) next.name = t('name_required');
    else if (name.length > NAME_MAX) next.name = t('name_too_long', { max: NAME_MAX });
    if (sen === null || sen > PRICE_MAX) next.price = t('price_invalid');
    if ((draft.description ?? '').length > DESC_MAX) next.description = t('description_too_long', { max: DESC_MAX });
    setErrors(next);
    if (next.name || next.price || next.description) return;
    const row = await run(async () => {
      const saved = await api.owner.saveItem({ ...draft, name, priceSen: sen! });
      if (pendingPhoto) await api.owner.uploadItemPhoto(shopId, saved.id, pendingPhoto);
      return saved;
    }, t('item_saved'));
    if (!row) return;
    setDraft({ ...draft, id: row.value.id, name, priceSen: sen! });
    setPendingPhoto(null);
    onChanged();
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    const blob = await run(() => resizeImage(file, 1200), undefined, () => t('photo_unreadable'));
    if (!blob) return;
    if (!draft.id) return setPendingPhoto(blob.value);
    if (await run(() => api.owner.uploadItemPhoto(shopId, draft.id!, blob.value), t('photo_saved'))) onChanged();
  };

  return (
    <div className="flex flex-col gap-4">
      <Heading aside={<Button variant="secondary" onClick={onBack}>{t('back_to_menu')}</Button>}>{draft.id ? t('edit_item') : t('new_item')}</Heading>

      <Card>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label={t('item_name')} error={errors.name}>
            {(p) => <input {...p} className={inputClass} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />}
          </Field>
          <Field label={t('item_description')} error={errors.description}>
            {(p) => <textarea {...p} className={inputClass} rows={2} value={draft.description ?? ''} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />}
          </Field>
          <Field label={t('item_price')} hint={t('item_price_hint')} error={errors.price}>
            {(p) => <input {...p} className={inputClass} inputMode="decimal" placeholder="2.20" value={price} onChange={(e) => setPrice(e.target.value)} />}
          </Field>
          <Field label={t('item_category')}>
            {(p) => (
              <select {...p} className={inputClass} value={draft.categoryId} onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}>
                {[...editor.categories]
                  .sort((a, b) => a.sort - b.sort)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            )}
          </Field>
          <Toggle checked={draft.active ?? true} onChange={(active) => setDraft({ ...draft, active })} label={t('item_active')} description={t('item_active_hint')} />
          <Toggle checked={draft.soldOut ?? false} onChange={(soldOut) => setDraft({ ...draft, soldOut })} label={t('item_sold_out')} description={t('item_sold_out_hint')} />

          <div className="flex items-center gap-4">
            <PhotoTile url={savedItem?.photoUrl} name={draft.name || t('new_item')} className="size-20" />
            <div className="flex flex-col gap-1">
              <label className="inline-flex min-h-12 cursor-pointer items-center justify-center rounded-xl border border-stone-300 bg-white px-5 text-base font-semibold text-stone-900 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-orange-600">
                {savedItem?.photoUrl || pendingPhoto ? t('change_photo') : t('add_photo')}
                <input type="file" accept="image/*" className="sr-only" disabled={busy} onChange={(e) => void pickPhoto(e.target.files?.[0])} />
              </label>
              {pendingPhoto && <span className="text-sm text-stone-600">{t('photo_after_save')}</span>}
            </div>
          </div>

          <ItemProFields draft={draft} onDraftChange={setDraft} editor={editor} />

          <Button type="submit" disabled={busy}>
            {t('save_item')}
          </Button>
        </form>
      </Card>

      {draft.id ? (
        <>
          <PairingsCard shopId={shopId} itemId={draft.id} editor={editor} onSaved={onChanged} />
          <Card>
            <OptionGroups shopId={shopId} itemId={draft.id} editor={editor} onChanged={onChanged} />
          </Card>
        </>
      ) : (
        <p className="text-stone-600">{t('save_first')}</p>
      )}
    </div>
  );
}

/** Up to three dishes suggested with this one, in order. */
function PairingsCard({ itemId, editor, onSaved }: { shopId: string; itemId: string; editor: MenuEditorDTO; onSaved: () => void }) {
  const t = useManagerT();
  const api = useData();
  const { run, busy } = useAct();
  const current = editor.pairings.filter((p) => p.sourceItemId === itemId).sort((a, b) => a.position - b.position);
  const [picks, setPicks] = useState<string[]>(() => [0, 1, 2].map((i) => current[i]?.suggestedItemId ?? ''));
  const choices = editor.items.filter((i) => i.id !== itemId && i.active);

  const save = async () => {
    const ids = picks.filter((id, i) => id && picks.indexOf(id) === i);
    if (await run(() => api.owner.setPairings(itemId, ids), t('saved'))) onSaved();
  };

  return (
    <Card className="flex flex-col gap-3">
      <h3 className="text-lg font-bold text-stone-900">{t('suggestions_title')}</h3>
      <p className="text-sm text-stone-600">{t('suggestions_hint')}</p>
      {picks.map((value, i) => (
        <Field key={i} label={t('suggestion_n', { n: i + 1 })}>
          {(p) => (
            <select {...p} className={inputClass} value={value} onChange={(e) => setPicks(picks.map((v, j) => (j === i ? e.target.value : v)))}>
              <option value="">{t('none')}</option>
              {choices.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      ))}
      <Button variant="secondary" disabled={busy} onClick={() => void save()}>
        {t('save_suggestions')}
      </Button>
    </Card>
  );
}

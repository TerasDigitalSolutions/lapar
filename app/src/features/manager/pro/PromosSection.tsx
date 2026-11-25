import { useState } from 'react';
import { useData } from '../../../data/context';
import type { DiscountType, IsoWeekday, MenuEditorDTO, PromoInput, PromoRow } from '../../../data/types';
import { useFeature } from '../../../entitlements/hooks';
import { formatRM, parseRM } from '../../../lib/money';
import { Button, ConfirmDialog, EmptyState, ErrorState, Field, focusRing, inputClass, Loading, ProLocked, Segmented, Sheet, Toggle } from '../../../ui';
import { priceText, useAct, useLoad } from '../hooks';
import { Card, Heading, Tag } from '../parts';
import { ALL_DAYS, DaysField, TimeRange, TranslationFields } from './fields';
import { useProT } from './messages';

const NAME_MAX = 40;

interface Form {
  id?: string;
  name: string;
  translations: PromoRow['translations'];
  type: DiscountType;
  value: string;
  days: IsoWeekday[];
  start: string;
  end: string;
  itemIds: string[];
  active: boolean;
}

const blank = (): Form => ({ name: '', translations: {}, type: 'percent', value: '', days: ALL_DAYS, start: '14:00', end: '17:00', itemIds: [], active: true });

const toForm = (p: PromoRow): Form => ({
  id: p.id,
  name: p.name,
  translations: p.translations,
  type: p.discountType,
  value: p.discountType === 'amount' ? priceText(p.discountValue) : String(p.discountValue),
  days: p.days,
  start: p.startTime,
  end: p.endTime,
  itemIds: p.itemIds,
  active: p.active,
});

export type PromoErrors = Partial<Record<'name' | 'value' | 'days' | 'time' | 'items', 'name_required' | 'name_too_long' | 'percent_invalid' | 'amount_invalid' | 'one_day_needed' | 'time_required' | 'items_required'>>;

/** Checks a promo form; returns the error keys, or the PromoInput (percent as typed, amount as sen) when it is valid. */
export function checkPromo(form: Form, shopId: string): { errors: PromoErrors; input: null } | { errors: null; input: PromoInput } {
  const errors: PromoErrors = {};
  const name = form.name.trim();
  if (!name) errors.name = 'name_required';
  else if (name.length > NAME_MAX) errors.name = 'name_too_long';
  let value = 0;
  if (form.type === 'percent') {
    value = /^\d{1,3}$/.test(form.value.trim()) ? Number(form.value) : 0;
    if (value < 1 || value > 100) errors.value = 'percent_invalid';
  } else {
    value = parseRM(form.value) ?? 0;
    if (value < 1) errors.value = 'amount_invalid';
  }
  if (!form.days.length) errors.days = 'one_day_needed';
  if (!form.start || !form.end) errors.time = 'time_required'; // a window may cross midnight, so end before start is fine
  if (!form.itemIds.length) errors.items = 'items_required';
  if (Object.keys(errors).length) return { errors, input: null };
  return {
    errors: null,
    input: {
      ...(form.id ? { id: form.id } : {}),
      shopId,
      name,
      translations: form.translations,
      discountType: form.type,
      discountValue: value,
      days: form.days,
      startTime: form.start,
      endTime: form.end,
      active: form.active,
      itemIds: form.itemIds,
    },
  };
}

export function PromosSection({ shopId }: { shopId: string }) {
  const on = useFeature('promos');
  if (!on) return <ProLocked feature="promos" />;
  return <PromosList shopId={shopId} />;
}

function PromosList({ shopId }: { shopId: string }) {
  const t = useProT();
  const api = useData();
  const { run, busy } = useAct();
  const list = useLoad(() => api.pro.listPromos(shopId), shopId);
  const menu = useLoad(() => api.owner.getMenuEditor(shopId), shopId);
  const languages = useFeature('multi_language_menu');
  const [form, setForm] = useState<Form | null>(null);
  const [errors, setErrors] = useState<PromoErrors>({});
  const [deleting, setDeleting] = useState<PromoRow | null>(null);

  if (!list.data || !menu.data) {
    const error = list.error ?? menu.error;
    return error ? <ErrorState error={error} onRetry={() => (list.reload(), menu.reload())} /> : <Loading />;
  }
  const editor = menu.data;

  const edit = (next: Form | null) => {
    setErrors({});
    setForm(next);
  };

  const save = async () => {
    if (!form) return;
    const checked = checkPromo(form, shopId);
    if (checked.errors) return setErrors(checked.errors);
    if (await run(() => api.pro.savePromo(checked.input), t('promo_saved'))) {
      edit(null);
      list.reload();
    }
  };

  const remove = async () => {
    if (!deleting) return;
    if (await run(() => api.pro.deletePromo(deleting.id), t('promo_deleted'))) {
      setDeleting(null);
      list.reload();
    }
  };

  const err = (k: keyof PromoErrors, vars?: Record<string, number>) => (errors[k] ? t(errors[k], vars ?? { max: NAME_MAX }) : null);
  const summary = (p: PromoRow) =>
    t(p.discountType === 'percent' ? 'promo_summary_percent' : 'promo_summary_amount', {
      value: p.discountType === 'percent' ? p.discountValue : formatRM(p.discountValue),
      from: p.startTime,
      to: p.endTime,
    });

  return (
    <div className="flex flex-col gap-4">
      <Heading>{t('promos_title')}</Heading>
      <Button onClick={() => edit(blank())}>{t('add_promo')}</Button>

      {list.data.length === 0 ? (
        <EmptyState title={t('no_promos')}>{t('no_promos_body')}</EmptyState>
      ) : (
        <ul className="flex flex-col gap-3">
          {list.data.map((p) => (
            <li key={p.id}>
              <Card className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-lg font-bold text-stone-900">{p.name}</span>
                  {!p.active && <Tag>{t('promo_off')}</Tag>}
                </div>
                <p className="text-stone-700">{summary(p)}</p>
                <p className="text-sm text-stone-600">
                  {p.days.length === 7 ? '' : `${p.days.map((d) => t(`day_${d}`)).join(', ')} · `}
                  {t('promo_dishes', { n: p.itemIds.length })}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" aria-label={t('edit_named', { name: p.name })} onClick={() => edit(toForm(p))}>
                    {t('edit_promo')}
                  </Button>
                  <Button variant="ghost" aria-label={t('delete_named', { name: p.name })} onClick={() => setDeleting(p)}>
                    {t('delete')}
                  </Button>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}

      <Sheet open={!!form} onClose={() => edit(null)} title={form?.id ? t('edit_promo') : t('new_promo')}>
        {form && (
          <form
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void save();
            }}
          >
            <Field label={t('promo_name')} error={err('name')}>
              {(p) => <input {...p} className={inputClass} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
            </Field>
            {languages && <TranslationFields value={form.translations} onChange={(translations) => setForm({ ...form, translations })} />}
            <Segmented
              label={t('promo_type')}
              value={form.type}
              onChange={(type) => setForm({ ...form, type, value: '' })}
              options={[
                { value: 'percent', label: t('type_percent') },
                { value: 'amount', label: t('type_amount') },
              ]}
            />
            <Field label={form.type === 'percent' ? t('promo_percent') : t('promo_amount')} hint={form.type === 'amount' ? t('promo_amount_hint') : undefined} error={err('value')}>
              {(p) => <input {...p} className={inputClass} inputMode={form.type === 'percent' ? 'numeric' : 'decimal'} value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />}
            </Field>
            <DaysField value={form.days} onChange={(days) => setForm({ ...form, days })} error={err('days')} />
            <TimeRange from={form.start} to={form.end} onChange={(start, end) => setForm({ ...form, start, end })} />
            {errors.time && (
              <p role="alert" className="text-sm font-medium text-red-700">
                {t(errors.time)}
              </p>
            )}
            <ItemPicker editor={editor} value={form.itemIds} onChange={(itemIds) => setForm({ ...form, itemIds })} error={err('items')} />
            <Toggle checked={form.active} onChange={(active) => setForm({ ...form, active })} label={t('promo_active')} description={t('promo_active_hint')} />
            <Button type="submit" disabled={busy}>
              {t('save_promo')}
            </Button>
          </form>
        )}
      </Sheet>

      <ConfirmDialog open={!!deleting} danger busy={busy} title={deleting ? t('delete_promo_title', { name: deleting.name }) : ''} confirmLabel={t('delete')} cancelLabel={t('cancel')} onConfirm={() => void remove()} onCancel={() => setDeleting(null)}>
        {t('delete_promo_body')}
      </ConfirmDialog>
    </div>
  );
}

/** Checkbox list of the shop's dishes (set meals included: a promo can discount them too). */
function ItemPicker({ editor, value, onChange, error }: { editor: MenuEditorDTO; value: string[]; onChange: (ids: string[]) => void; error: string | null }) {
  const t = useProT();
  const items = [...editor.items].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-base font-semibold text-stone-800">{t('promo_items')}</legend>
      <ul className="max-h-64 overflow-y-auto rounded-xl border border-stone-200">
        {items.map((i) => {
          const checked = value.includes(i.id);
          return (
            <li key={i.id}>
              <label className={`flex min-h-12 cursor-pointer items-center gap-3 px-3 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-orange-600 ${focusRing}`}>
                <input type="checkbox" className="size-5 accent-orange-600" checked={checked} onChange={() => onChange(checked ? value.filter((x) => x !== i.id) : [...value, i.id])} />
                <span className="text-base text-stone-900">{i.name}</span>
              </label>
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </fieldset>
  );
}

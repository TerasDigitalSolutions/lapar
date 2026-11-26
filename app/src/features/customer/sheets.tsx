import { useState } from 'react';
import type { MenuDTO, MenuItem, Uuid } from '../../data/types';
import { formatRM } from '../../lib/money';
import { Banner, Button, Field, PhotoTile, QtyStepper, Sheet, inputClass } from '../../ui';
import { optionNames, pickupSlots, hhmm, tr, trDesc, unitSen, type CartLine } from './cart';
import { useT } from './messages';

const rowBtn = 'flex min-h-12 w-full items-center gap-3 rounded-2xl border border-stone-200 bg-white p-3 text-left shadow-sm';

export function ItemPrice({ item }: { item: MenuItem }) {
  const t = useT();
  return (
    <span className="flex flex-col">
      <span className="text-xl leading-tight font-extrabold text-orange-700">{formatRM(item.effectivePriceSen)}</span>
      {item.effectivePriceSen < item.priceSen && <span className="text-sm text-stone-500 line-through">{t('was', { price: formatRM(item.priceSen) })}</span>}
      {item.promo && <span className="text-sm font-semibold text-orange-800">{tr(item.promo.name, item.promo.translations)}</span>}
    </span>
  );
}

/** Item detail: option groups, quantity, note, live price. */
export function ItemSheet({ item, from, onAdd, onClose }: { item: MenuItem; from: Uuid | null; onAdd: (line: CartLine) => void; onClose: () => void }) {
  const t = useT();
  const [picked, setPicked] = useState<Record<Uuid, Uuid[]>>({});
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const optionIds = item.groups.flatMap((g) => picked[g.id] ?? []);
  const missing = item.groups.filter((g) => (picked[g.id]?.length ?? 0) < g.minSelect);
  const set = (gid: Uuid, ids: Uuid[]) => setPicked((p) => ({ ...p, [gid]: ids }));

  return (
    <Sheet open onClose={onClose} title={tr(item.name, item.translations)}>
      <div className="flex flex-col gap-5">
        {item.photoUrl && <PhotoTile url={item.photoUrl} name={item.name} className="-mt-1 h-52 w-full rounded-2xl" />}
        {item.description && <p className="text-stone-700">{trDesc(item)}</p>}
        {item.combo && <p className="text-stone-700">{t('set_includes', { items: item.combo.components.map((c) => `${c.qty} x ${tr(c.name, c.translations)}`).join(', ') })}</p>}
        {item.promo && (
          <p className="font-semibold text-orange-800">
            {tr(item.promo.name, item.promo.translations)} · <span className="line-through">{formatRM(item.priceSen)}</span> {formatRM(item.effectivePriceSen)}
          </p>
        )}
        {item.groups.map((g) => {
          const chosen = picked[g.id] ?? [];
          const single = g.maxSelect === 1;
          const hint = single ? t('choose_one') : g.minSelect > 0 ? t('choose_between', { min: g.minSelect, max: g.maxSelect }) : t('choose_up_to', { n: g.maxSelect });
          return (
            <fieldset key={g.id} className="flex flex-col gap-2">
              <legend className="mb-1 flex w-full items-baseline justify-between gap-2 text-base font-semibold text-stone-900">
                <span>{tr(g.name, g.translations)}</span>
                <span className={`text-sm ${g.minSelect > 0 ? 'font-bold text-orange-700' : 'font-normal text-stone-600'}`}>{g.minSelect > 0 ? `${t('required')} · ${hint}` : hint}</span>
              </legend>
              {g.options.map((o) => {
                const on = chosen.includes(o.id);
                const full = !single && !on && chosen.length >= g.maxSelect;
                return (
                  <label key={o.id} className={`${rowBtn} ${on ? 'border-orange-600 bg-orange-50' : ''} ${full ? 'opacity-50' : ''}`}>
                    <input
                      type={single ? 'radio' : 'checkbox'}
                      name={g.id}
                      className="size-6 accent-orange-600"
                      checked={on}
                      disabled={full}
                      onChange={() => set(g.id, single ? [o.id] : on ? chosen.filter((x) => x !== o.id) : [...chosen, o.id])}
                      // An optional single choice can be cleared by tapping it again.
                      onClick={() => single && on && g.minSelect === 0 && set(g.id, [])}
                    />
                    <span className="flex-1">{tr(o.name, o.translations)}</span>
                    {o.priceDeltaSen !== 0 && <span className="text-stone-700">+{formatRM(o.priceDeltaSen)}</span>}
                  </label>
                );
              })}
            </fieldset>
          );
        })}
        <Field label={t('note')} hint={t('note_count', { n: note.length })}>
          {(p) => <textarea {...p} className={inputClass} rows={2} maxLength={140} placeholder={t('note_hint')} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        <div className="flex items-center justify-between rounded-2xl bg-stone-100 p-3">
          <QtyStepper value={qty} min={1} onChange={setQty} />
          <span className="text-2xl font-extrabold text-orange-700">{formatRM(qty * unitSen(item, optionIds))}</span>
        </div>
        {missing.length > 0 && <p className="text-sm font-medium text-orange-800">{t('pick_required', { groups: missing.map((g) => tr(g.name, g.translations)).join(', ') })}</p>}
        <Button block disabled={missing.length > 0} onClick={() => onAdd({ itemId: item.id, qty, optionIds, note: note.trim(), from })}>
          {t('add_to_order')}
        </Button>
      </div>
    </Sheet>
  );
}

/** Rows of items with an Add button: used for suggestions and the checkout nudge. */
export function PickSheet({
  title,
  body,
  items,
  autoIds,
  skipLabel,
  onPick,
  onSkip,
  onClose,
}: {
  title: string;
  body?: string;
  items: MenuItem[];
  autoIds?: ReadonlySet<Uuid>;
  skipLabel: string;
  onPick: (item: MenuItem) => void;
  onSkip?: () => void;
  onClose: () => void;
}) {
  const t = useT();
  return (
    <Sheet open onClose={onClose} title={title}>
      <div className="flex flex-col gap-3">
        {body && <p className="text-stone-700">{body}</p>}
        {items.map((i) => (
          <div key={i.id} className={`${rowBtn} justify-between`}>
            <PhotoTile url={i.photoUrl} name={i.name} className="size-14" />
            <span className="min-w-0 flex-1">
              <span className="block font-semibold">{tr(i.name, i.translations)}</span>
              {autoIds?.has(i.id) && <span className="block text-sm text-stone-600">{t('suggest_auto')}</span>}
              <span className="text-stone-700">{formatRM(i.effectivePriceSen)}</span>
            </span>
            <Button onClick={() => onPick(i)}>{t('add')}</Button>
          </div>
        ))}
        <Button variant="secondary" block onClick={onSkip ?? onClose}>
          {skipLabel}
        </Button>
      </div>
    </Sheet>
  );
}

export function CartSheet({
  menu,
  cart,
  sending,
  error,
  onQty,
  onRemove,
  onPlace,
  onClose,
  pickup,
  onPickup,
}: {
  menu: MenuDTO;
  /** Takeaway (counter token with `takeaway`): '' = as soon as possible, else an ISO time. */
  pickup?: string;
  onPickup?: (v: string) => void;
  cart: CartLine[];
  sending: boolean;
  error: string | null;
  onQty: (i: number, qty: number) => void;
  onRemove: (i: number) => void;
  onPlace: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const byId = new Map(menu.items.map((i) => [i.id, i]));
  const total = cart.reduce((s, l) => s + l.qty * unitSen(byId.get(l.itemId)!, l.optionIds), 0);
  return (
    <Sheet open onClose={onClose} title={t('cart_title')}>
      <div className="flex flex-col gap-4">
        {error && <Banner kind="error">{error}</Banner>}
        {cart.length === 0 && <p className="text-stone-700">{t('cart_empty')}</p>}
        <ul className="flex flex-col gap-3">
          {cart.map((l, i) => {
            const item = byId.get(l.itemId)!;
            const opts = optionNames(item, l.optionIds);
            return (
              <li key={i} className="flex flex-col gap-2 rounded-2xl border border-stone-200 bg-white p-3 shadow-sm">
                <div className="flex justify-between gap-3">
                  <span className="font-semibold">{tr(item.name, item.translations)}</span>
                  <span className="font-bold">{formatRM(l.qty * unitSen(item, l.optionIds))}</span>
                </div>
                {opts && <span className="text-sm text-stone-600">{opts}</span>}
                {l.note && <span className="text-sm text-stone-600">“{l.note}”</span>}
                <div className="flex items-center justify-between">
                  <QtyStepper value={l.qty} min={1} onChange={(n) => onQty(i, n)} label={tr(item.name, item.translations)} />
                  <Button variant="ghost" onClick={() => onRemove(i)} aria-label={`${t('remove')} ${tr(item.name, item.translations)}`}>
                    {t('remove')}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
        {pickup !== undefined && onPickup && (
          <Field label={t('pickup_time')}>
            {(p) => (
              <select {...p} className={inputClass} value={pickup} onChange={(e) => onPickup(e.target.value)}>
                <option value="">{t('pickup_asap')}</option>
                {pickupSlots(menu.serverNow).map((iso) => (
                  <option key={iso} value={iso}>
                    {hhmm(iso)}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        <div className="flex items-baseline justify-between rounded-2xl bg-orange-50 px-4 py-3 text-xl font-extrabold text-orange-900">
          <span>{t('total')}</span>
          <span>{formatRM(total)}</span>
        </div>
        <p className="text-sm text-stone-600">{t('total_note')}</p>
        <Button block disabled={sending || cart.length === 0} onClick={onPlace}>
          {sending ? t('sending') : t('place_order')}
        </Button>
      </div>
    </Sheet>
  );
}

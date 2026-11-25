import { useState } from 'react';
import { useData } from '../../data/context';
import type { MenuEditorDTO, ModifierGroupInput, ModifierGroupRow, ModifierOptionInput, ModifierOptionRow } from '../../data/types';
import { formatRM, parseRM } from '../../lib/money';
import { Button, ConfirmDialog, Field, IconButton, inputClass } from '../../ui';
import { moved, priceText, useAct } from './hooks';
import { useManagerT } from './messages';
import { Card, UpDown } from './parts';
import { GroupProFields } from './pro/GroupProFields';
import { OptionProFields } from './pro/OptionProFields';

const NAME_MAX = 40;
const bySort = <T extends { sort: number }>(a: T, b: T) => a.sort - b.sort;
const toInt = (s: string) => (/^\d{1,2}$/.test(s.trim()) ? Number(s) : null);

type Pending = { kind: 'group'; row: ModifierGroupRow } | { kind: 'option'; row: ModifierOptionRow } | null;

/** An item's option groups (for example Size, Sugar) and their options, edited in place. */
export function OptionGroups({ shopId, itemId, editor, onChanged }: { shopId: string; itemId: string; editor: MenuEditorDTO; onChanged: () => void }) {
  const t = useManagerT();
  const api = useData();
  const { run, busy } = useAct();
  const groups = editor.groups.filter((g) => g.itemId === itemId).sort(bySort);
  const [addingGroup, setAddingGroup] = useState(false);
  const [pending, setPending] = useState<Pending>(null);

  const reorder = async (kind: 'modifier_groups' | 'modifier_options', ids: string[] | null) => {
    if (ids && (await run(() => api.owner.reorder(kind, ids)))) onChanged();
  };

  const confirmDelete = async () => {
    if (!pending) return;
    const p = pending;
    await run(() => (p.kind === 'group' ? api.owner.deleteModifierGroup(p.row.id) : api.owner.deleteModifierOption(p.row.id)), t('deleted'));
    setPending(null);
    onChanged();
  };

  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-lg font-bold text-stone-900">{t('options_title')}</h3>
      <p className="text-sm text-stone-600">{t('options_hint')}</p>
      {groups.map((g, i) => (
        <GroupCard
          key={g.id}
          shopId={shopId}
          group={g}
          options={editor.options.filter((o) => o.groupId === g.id).sort(bySort)}
          editor={editor}
          index={i}
          count={groups.length}
          onMove={(d) =>
            void reorder(
              'modifier_groups',
              moved(
                groups.map((x) => x.id),
                i,
                d,
              ),
            )
          }
          onOptionMove={(ids) => void reorder('modifier_options', ids)}
          onDelete={(kind, row) => setPending({ kind, row } as Pending)}
          onChanged={onChanged}
        />
      ))}
      {addingGroup ? (
        <Card>
          <GroupForm
            initial={{ shopId, itemId, name: '', minSelect: 0, maxSelect: 1 }}
            editor={editor}
            busy={busy}
            onCancel={() => setAddingGroup(false)}
            onSave={async (input) => {
              if (await run(() => api.owner.saveModifierGroup(input), t('saved'))) {
                setAddingGroup(false);
                onChanged();
              }
            }}
          />
        </Card>
      ) : (
        <Button variant="secondary" onClick={() => setAddingGroup(true)}>
          {t('add_group')}
        </Button>
      )}
      <ConfirmDialog
        open={!!pending}
        danger
        busy={busy}
        title={pending ? t(pending.kind === 'group' ? 'delete_group_title' : 'delete_option_title', { name: pending.row.name }) : ''}
        confirmLabel={t('delete')}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPending(null)}
      >
        {pending?.kind === 'group' ? t('delete_group_body') : t('delete_option_body')}
      </ConfirmDialog>
    </div>
  );
}

function GroupCard({
  shopId,
  group,
  options,
  editor,
  index,
  count,
  onMove,
  onOptionMove,
  onDelete,
  onChanged,
}: {
  shopId: string;
  group: ModifierGroupRow;
  options: ModifierOptionRow[];
  editor: MenuEditorDTO;
  index: number;
  count: number;
  onMove: (d: -1 | 1) => void;
  onOptionMove: (ids: string[] | null) => void;
  onDelete: (kind: 'group' | 'option', row: ModifierGroupRow | ModifierOptionRow) => void;
  onChanged: () => void;
}) {
  const t = useManagerT();
  const api = useData();
  const { run, busy } = useAct();
  const [editing, setEditing] = useState(false);
  const [addingOption, setAddingOption] = useState(false);
  const [editingOption, setEditingOption] = useState<string | null>(null);

  return (
    <Card className="flex flex-col gap-3">
      <section aria-label={group.name} className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-col">
            <h4 className="truncate font-bold text-stone-900">{group.name}</h4>
            <span className="text-sm text-stone-600">{t('group_summary', { min: group.minSelect, max: group.maxSelect })}</span>
          </div>
          <div className="flex gap-1">
            <UpDown index={index} count={count} name={group.name} onMove={onMove} />
            <IconButton label={t('edit_named', { name: group.name })} onClick={() => setEditing(!editing)}>
              ✎
            </IconButton>
            <IconButton label={t('delete_named', { name: group.name })} onClick={() => onDelete('group', group)}>
              🗑
            </IconButton>
          </div>
        </div>
        {editing && (
          <GroupForm
            initial={{ id: group.id, shopId, itemId: group.itemId, name: group.name, translations: group.translations, minSelect: group.minSelect, maxSelect: group.maxSelect }}
            editor={editor}
            busy={busy}
            onCancel={() => setEditing(false)}
            onSave={async (input) => {
              if (await run(() => api.owner.saveModifierGroup(input), t('saved'))) {
                setEditing(false);
                onChanged();
              }
            }}
          />
        )}
        <ul className="flex flex-col divide-y divide-stone-200">
          {options.map((o, n) => (
            <li key={o.id} className="py-1">
              {editingOption === o.id ? (
                <OptionForm
                  initial={{ id: o.id, shopId, groupId: group.id, name: o.name, translations: o.translations, priceDeltaSen: o.priceDeltaSen }}
                  editor={editor}
                  busy={busy}
                  onCancel={() => setEditingOption(null)}
                  onSave={async (input) => {
                    if (await run(() => api.owner.saveModifierOption(input), t('saved'))) {
                      setEditingOption(null);
                      onChanged();
                    }
                  }}
                />
              ) : (
                <div className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate text-stone-900">{o.name}</span>
                  <span className="text-stone-700 tabular-nums">{o.priceDeltaSen > 0 ? `+${formatRM(o.priceDeltaSen)}` : t('no_extra')}</span>
                  <UpDown
                    index={n}
                    count={options.length}
                    name={o.name}
                    onMove={(d) =>
                      onOptionMove(
                        moved(
                          options.map((x) => x.id),
                          n,
                          d,
                        ),
                      )
                    }
                  />
                  <IconButton label={t('edit_named', { name: o.name })} onClick={() => setEditingOption(o.id)}>
                    ✎
                  </IconButton>
                  <IconButton label={t('delete_named', { name: o.name })} onClick={() => onDelete('option', o)}>
                    🗑
                  </IconButton>
                </div>
              )}
            </li>
          ))}
        </ul>
        {addingOption ? (
          <OptionForm
            initial={{ shopId, groupId: group.id, name: '', priceDeltaSen: 0 }}
            editor={editor}
            busy={busy}
            onCancel={() => setAddingOption(false)}
            onSave={async (input) => {
              if (await run(() => api.owner.saveModifierOption(input), t('saved'))) {
                setAddingOption(false);
                onChanged();
              }
            }}
          />
        ) : (
          <Button variant="ghost" onClick={() => setAddingOption(true)} aria-label={t('add_option_to', { name: group.name })}>
            {t('add_option')}
          </Button>
        )}
      </section>
    </Card>
  );
}

function GroupForm({ initial, editor, busy, onSave, onCancel }: { initial: ModifierGroupInput; editor: MenuEditorDTO; busy: boolean; onSave: (g: ModifierGroupInput) => void; onCancel: () => void }) {
  const t = useManagerT();
  const [draft, setDraft] = useState(initial);
  const [min, setMin] = useState(String(initial.minSelect));
  const [max, setMax] = useState(String(initial.maxSelect));
  const [errors, setErrors] = useState<{ name?: string; min?: string; max?: string }>({});

  const submit = () => {
    const name = draft.name.trim();
    const lo = toInt(min);
    const hi = toInt(max);
    const next: typeof errors = {};
    if (!name) next.name = t('name_required');
    else if (name.length > NAME_MAX) next.name = t('name_too_long', { max: NAME_MAX });
    if (lo === null) next.min = t('whole_number');
    if (hi === null || hi < 1) next.max = t('max_at_least_one');
    else if (lo !== null && lo > hi) next.min = t('min_above_max');
    setErrors(next);
    if (next.name || next.min || next.max) return;
    onSave({ ...draft, name, minSelect: lo!, maxSelect: hi! });
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-stone-50 p-3">
      <Field label={t('group_name')} hint={t('group_name_hint')} error={errors.name}>
        {(p) => <input {...p} className={inputClass} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />}
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('min_choices')} hint={t('min_choices_hint')} error={errors.min}>
          {(p) => <input {...p} className={inputClass} inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} />}
        </Field>
        <Field label={t('max_choices')} error={errors.max}>
          {(p) => <input {...p} className={inputClass} inputMode="numeric" value={max} onChange={(e) => setMax(e.target.value)} />}
        </Field>
      </div>
      <GroupProFields draft={draft} onDraftChange={setDraft} editor={editor} />
      <div className="flex gap-2">
        <Button disabled={busy} onClick={submit}>
          {t('save_group')}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </div>
  );
}

function OptionForm({ initial, editor, busy, onSave, onCancel }: { initial: ModifierOptionInput; editor: MenuEditorDTO; busy: boolean; onSave: (o: ModifierOptionInput) => void; onCancel: () => void }) {
  const t = useManagerT();
  const [draft, setDraft] = useState(initial);
  const [price, setPrice] = useState(initial.priceDeltaSen > 0 ? priceText(initial.priceDeltaSen) : '');
  const [errors, setErrors] = useState<{ name?: string; price?: string }>({});

  const submit = () => {
    const name = draft.name.trim();
    const sen = price.trim() === '' ? 0 : parseRM(price);
    const next: typeof errors = {};
    if (!name) next.name = t('name_required');
    else if (name.length > NAME_MAX) next.name = t('name_too_long', { max: NAME_MAX });
    if (sen === null) next.price = t('price_invalid');
    setErrors(next);
    if (next.name || next.price) return;
    onSave({ ...draft, name, priceDeltaSen: sen! });
  };

  return (
    <div className="flex flex-col gap-3 rounded-xl bg-stone-50 p-3">
      <Field label={t('option_name')} error={errors.name}>
        {(p) => <input {...p} className={inputClass} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />}
      </Field>
      <Field label={t('option_extra')} hint={t('option_extra_hint')} error={errors.price}>
        {(p) => <input {...p} className={inputClass} inputMode="decimal" placeholder="0.00" value={price} onChange={(e) => setPrice(e.target.value)} />}
      </Field>
      <OptionProFields draft={draft} onDraftChange={setDraft} editor={editor} />
      <div className="flex gap-2">
        <Button disabled={busy} onClick={submit}>
          {t('save_option')}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          {t('cancel')}
        </Button>
      </div>
    </div>
  );
}

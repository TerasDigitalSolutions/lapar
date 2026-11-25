import { useState } from 'react';
import { useData } from '../../../data/context';
import type { ComboComponentInput, ItemInput, MenuEditorDTO } from '../../../data/types';
import { useFeature } from '../../../entitlements/hooks';
import { Button, Field, IconButton, inputClass, QtyStepper, Sheet, Toggle } from '../../../ui';
import { useAct } from '../hooks';
import { TranslationFields } from './fields';
import { useProT } from './messages';

export interface ItemProFieldsProps {
  draft: ItemInput;
  onDraftChange: (draft: ItemInput) => void;
  editor: MenuEditorDTO;
}

export const COMBO_MAX_LINES = 6;
const QTY_MAX = 10;

/** Pro fields of the dish editor: station (multi_station), set meal (combos), translations (multi_language_menu). */
export function ItemProFields({ draft, onDraftChange, editor }: ItemProFieldsProps) {
  const t = useProT();
  const stations = useFeature('multi_station');
  const combos = useFeature('combos');
  const languages = useFeature('multi_language_menu');
  const stationChoices = editor.stations.filter((s) => s.active || s.id === draft.stationId);
  return (
    <>
      {stations && (
        <Field label={t('station')} hint={t('station_hint')}>
          {(p) => (
            <select {...p} className={inputClass} value={draft.stationId ?? ''} onChange={(e) => onDraftChange({ ...draft, stationId: e.target.value || null })}>
              <option value="">{t('station_default')}</option>
              {stationChoices.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}
      {combos && <SetMeal draft={draft} onDraftChange={onDraftChange} editor={editor} />}
      {languages && <TranslationFields description value={draft.translations} onChange={(translations) => onDraftChange({ ...draft, translations })} />}
    </>
  );
}

function SetMeal({ draft, onDraftChange, editor }: ItemProFieldsProps) {
  const t = useProT();
  const [open, setOpen] = useState(false);
  const saved = editor.items.find((i) => i.id === draft.id);
  // After a save the editor's rows are older than what was just saved, so the sheet keeps its own copy.
  const [lines, setLines] = useState<ComboComponentInput[] | null>(null);
  const current = lines ?? editor.comboComponents.filter((c) => c.comboItemId === draft.id).sort((a, b) => a.sort - b.sort).map((c) => ({ itemId: c.itemId, qty: c.qty }));
  return (
    <div className="flex flex-col gap-2">
      <Toggle checked={draft.isCombo ?? false} onChange={(isCombo) => onDraftChange({ ...draft, isCombo })} label={t('set_meal')} description={t('set_meal_hint')} />
      {draft.isCombo &&
        (draft.id && saved?.isCombo ? (
          <>
            <Button variant="secondary" onClick={() => setOpen(true)}>
              {t('set_contents')}
            </Button>
            <p className="text-sm text-stone-600">{t('contents_count', { n: current.length })}</p>
            {/* Mounted only while open so each opening starts from the saved contents. */}
            {open && <ContentsSheet open onClose={() => setOpen(false)} comboId={draft.id} name={draft.name || saved.name} editor={editor} initial={current} onSaved={setLines} />}
          </>
        ) : (
          <p className="text-sm text-stone-600">{t('contents_after_save')}</p>
        ))}
    </div>
  );
}

function ContentsSheet({ open, onClose, comboId, name, editor, initial, onSaved }: { open: boolean; onClose: () => void; comboId: string; name: string; editor: MenuEditorDTO; initial: ComboComponentInput[]; onSaved: (lines: ComboComponentInput[]) => void }) {
  const t = useProT();
  const api = useData();
  const { run, busy } = useAct();
  const [lines, setLines] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const nameOf = (id: string) => editor.items.find((i) => i.id === id)?.name ?? id;
  const choices = editor.items.filter((i) => !i.isCombo && i.id !== comboId && !lines.some((l) => l.itemId === i.id));

  const save = async () => {
    if (!lines.length) return setError(t('contents_empty'));
    setError(null);
    if (await run(() => api.pro.setComboComponents(comboId, lines), t('contents_saved'))) {
      onSaved(lines);
      onClose();
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={t('contents_title', { name })}>
      <div className="flex flex-col gap-4">
        <p className="text-sm text-stone-600">{t('contents_hint')}</p>
        <ul className="flex flex-col gap-3">
          {lines.map((l) => (
            <li key={l.itemId} className="flex items-center justify-between gap-2">
              <span className="font-semibold text-stone-900">{nameOf(l.itemId)}</span>
              <span className="flex items-center gap-1">
                <QtyStepper label={t('contents_qty', { name: nameOf(l.itemId) })} min={1} max={QTY_MAX} value={l.qty} onChange={(qty) => setLines(lines.map((x) => (x.itemId === l.itemId ? { ...x, qty } : x)))} />
                <IconButton label={t('contents_remove', { name: nameOf(l.itemId) })} onClick={() => setLines(lines.filter((x) => x.itemId !== l.itemId))}>
                  ✕
                </IconButton>
              </span>
            </li>
          ))}
        </ul>
        {lines.length < COMBO_MAX_LINES && choices.length > 0 && (
          <Field label={t('contents_add')}>
            {(p) => (
              <select {...p} className={inputClass} value="" onChange={(e) => e.target.value && setLines([...lines, { itemId: e.target.value, qty: 1 }])}>
                <option value="">{t('contents_add')}</option>
                {choices.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        {error && (
          <p role="alert" className="text-sm font-medium text-red-700">
            {error}
          </p>
        )}
        <Button disabled={busy} onClick={() => void save()}>
          {t('save_contents')}
        </Button>
      </div>
    </Sheet>
  );
}

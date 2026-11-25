import { useFeature } from '../../../entitlements/hooks';
import type { CategoryInput, MenuEditorDTO } from '../../../data/types';
import { Toggle } from '../../../ui';
import { ALL_DAYS, DaysField, TimeRange, TranslationFields } from './fields';
import { useProT } from './messages';

export interface CategoryProFieldsProps {
  draft: CategoryInput;
  onDraftChange: (draft: CategoryInput) => void;
  editor: MenuEditorDTO;
}

/** Pro fields of the category editor: translations (multi_language_menu), serving window (timed_menus). */
export function CategoryProFields({ draft, onDraftChange }: CategoryProFieldsProps) {
  const t = useProT();
  const timed = useFeature('timed_menus');
  const languages = useFeature('multi_language_menu');
  const window = draft.window ?? null;
  return (
    <>
      {languages && <TranslationFields value={draft.translations} onChange={(translations) => onDraftChange({ ...draft, translations })} />}
      {timed && (
        <div className="flex flex-col gap-3">
          <Toggle
            checked={!!window}
            onChange={(on) => onDraftChange({ ...draft, window: on ? { from: '07:00', to: '11:00', days: null } : null })}
            label={t('timed')}
            description={t('timed_hint')}
          />
          {window && (
            <>
              {/* An emptied time input is ignored so the draft always holds a valid HH:MM. */}
              <TimeRange from={window.from} to={window.to} onChange={(from, to) => from && to && onDraftChange({ ...draft, window: { ...window, from, to } })} />
              <DaysField value={window.days ?? ALL_DAYS} onChange={(days) => days.length && onDraftChange({ ...draft, window: { ...window, days: days.length === 7 ? null : days } })} />
            </>
          )}
        </div>
      )}
    </>
  );
}

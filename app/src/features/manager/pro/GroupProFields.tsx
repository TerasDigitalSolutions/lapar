import { useFeature } from '../../../entitlements/hooks';
import type { MenuEditorDTO, ModifierGroupInput } from '../../../data/types';
import { TranslationFields } from './fields';

export interface GroupProFieldsProps {
  draft: ModifierGroupInput;
  onDraftChange: (draft: ModifierGroupInput) => void;
  editor: MenuEditorDTO;
}

/** Pro fields of the option group editor: translated name (multi_language_menu). */
export function GroupProFields({ draft, onDraftChange }: GroupProFieldsProps) {
  const on = useFeature('multi_language_menu');
  if (!on) return null;
  return <TranslationFields value={draft.translations} onChange={(translations) => onDraftChange({ ...draft, translations })} />;
}

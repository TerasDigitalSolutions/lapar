import { useFeature } from '../../../entitlements/hooks';
import type { MenuEditorDTO, ModifierOptionInput } from '../../../data/types';
import { TranslationFields } from './fields';

export interface OptionProFieldsProps {
  draft: ModifierOptionInput;
  onDraftChange: (draft: ModifierOptionInput) => void;
  editor: MenuEditorDTO;
}

/** Pro fields of the option editor: translated name (multi_language_menu). */
export function OptionProFields({ draft, onDraftChange }: OptionProFieldsProps) {
  const on = useFeature('multi_language_menu');
  if (!on) return null;
  return <TranslationFields value={draft.translations} onChange={(translations) => onDraftChange({ ...draft, translations })} />;
}

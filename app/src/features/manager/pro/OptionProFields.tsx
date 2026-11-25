import type { ModifierOptionInput, MenuEditorDTO } from '../../../data/types';

export interface OptionProFieldsProps {
  draft: ModifierOptionInput;
  onDraftChange: (draft: ModifierOptionInput) => void;
  editor: MenuEditorDTO;
}

/** Slot for Pro fields of the option editor. Renders nothing until the Pro editors card fills it in. */
export function OptionProFields(props: OptionProFieldsProps) {
  void props;
  return null;
}

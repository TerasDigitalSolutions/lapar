import type { CategoryInput, MenuEditorDTO } from '../../../data/types';

export interface CategoryProFieldsProps {
  draft: CategoryInput;
  onDraftChange: (draft: CategoryInput) => void;
  editor: MenuEditorDTO;
}

/** Slot for Pro fields of the category editor. Renders nothing until the Pro editors card fills it in. */
export function CategoryProFields(props: CategoryProFieldsProps) {
  void props;
  return null;
}

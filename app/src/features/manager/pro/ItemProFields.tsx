import type { ItemInput, MenuEditorDTO } from '../../../data/types';

export interface ItemProFieldsProps {
  draft: ItemInput;
  onDraftChange: (draft: ItemInput) => void;
  editor: MenuEditorDTO;
}

/** Slot for Pro fields of the item editor. Renders nothing until the Pro editors card fills it in. */
export function ItemProFields(props: ItemProFieldsProps) {
  void props;
  return null;
}

import type { ModifierGroupInput, MenuEditorDTO } from '../../../data/types';

export interface GroupProFieldsProps {
  draft: ModifierGroupInput;
  onDraftChange: (draft: ModifierGroupInput) => void;
  editor: MenuEditorDTO;
}

/** Slot for Pro fields of the group editor. Renders nothing until the Pro editors card fills it in. */
export function GroupProFields(props: GroupProFieldsProps) {
  void props;
  return null;
}

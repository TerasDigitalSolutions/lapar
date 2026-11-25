import { toLaparError } from '../../data/hooks';
import { useUiT } from '../../ui/messages';
import { useStaffT } from './messages';

/** Readable text for any thrown value: the UI kit's message per `LaparErrorCode`, plus the one detail staff can act on. */
export function useErrorText(): (e: unknown) => string {
  const ui = useUiT();
  const t = useStaffT();
  return (e) => {
    const err = toLaparError(e);
    if (err.code === 'invalid_input' && err.detail === 'mixed_split') return t('err_mixed_split');
    return ui(`err_${err.code}`);
  };
}

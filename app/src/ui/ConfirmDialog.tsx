import type { ReactNode } from 'react';
import { Button } from './Button';
import { Sheet } from './Sheet';
import { useUiT } from './messages';

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button for destructive actions. */
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const t = useUiT();
  return (
    <Sheet open={open} onClose={onCancel} title={title}>
      {children && <div className="mb-5 text-stone-700">{children}</div>}
      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {cancelLabel ?? t('cancel')}
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
          {confirmLabel ?? t('confirm')}
        </Button>
      </div>
    </Sheet>
  );
}

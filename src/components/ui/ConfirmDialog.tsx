import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import controls from '../../styles/controls.module.css';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

/** Explicit confirmation for anything that destroys data. */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={
        <>
          {destructive && <AlertTriangle size={17} color="var(--destructive)" />}
          {title}
        </>
      }
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={controls.btnPrimary}
            style={destructive ? { backgroundColor: 'var(--destructive)' } : undefined}
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p style={{ fontSize: '0.875rem', lineHeight: 1.6, color: 'var(--muted-foreground)', margin: 0 }}>
        {message}
      </p>
    </Modal>
  );
}

import { useState } from 'react';
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
  /** Second confirmation: the user must type this word before the button enables. */
  requireText?: string;
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
  requireText,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('');
  const blocked = !!requireText && typed.trim().toUpperCase() !== requireText.toUpperCase();
  const close = () => {
    setTyped('');
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={close}
      size="sm"
      title={
        <>
          {destructive && <AlertTriangle size={17} color="var(--destructive)" />}
          {title}
        </>
      }
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={close}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={controls.btnPrimary}
            style={destructive ? { backgroundColor: 'var(--destructive)' } : undefined}
            disabled={blocked}
            onClick={() => {
              onConfirm();
              close();
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
      {requireText && (
        <label className={controls.field} style={{ marginTop: '0.75rem' }}>
          <span className={controls.label}>Type {requireText} to confirm</span>
          <input className={controls.input} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
      )}
    </Modal>
  );
}

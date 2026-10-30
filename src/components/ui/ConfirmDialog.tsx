import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { t, useT } from '../../i18n';
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

/** Explicit confirmation for anything that destroys data: an alert card above any sheet (spec 2.6). */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive,
  requireText,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  useT();
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
      kind="alert"
      title={
        <>
          {destructive && <AlertTriangle size={17} color="var(--sys-red-ink)" aria-hidden="true" />}
          {title}
        </>
      }
      footer={
        <>
          {/* The safe choice takes the first focus; a destructive action is never the default (spec 2.6). */}
          <button type="button" className={controls.btnOutline} onClick={close} data-autofocus={requireText ? undefined : true}>
            {cancelLabel ?? t('common.cancel')}
          </button>
          <button
            type="button"
            className={destructive ? controls.btnDestructive : controls.btnPrimary}
            disabled={blocked}
            onClick={() => {
              onConfirm();
              close();
            }}
          >
            {confirmLabel ?? t('common.confirm')}
          </button>
        </>
      }
    >
      <p style={{ lineHeight: 1.5, color: 'var(--label)', margin: 0, textAlign: 'center' }}>
        {message}
      </p>
      {requireText && (
        <label className={controls.field}>
          <span className={controls.label}>{t('common.typeToConfirm', { word: requireText })}</span>
          <input className={controls.input} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
        </label>
      )}
    </Modal>
  );
}

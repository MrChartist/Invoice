import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Modal } from '../ui/Modal';
import controls from '../../styles/controls.module.css';
import styles from './audit.module.css';

export interface PinConfirmModalProps {
  open: boolean;
  title: string;
  /** Plain-language explanation of what the PIN unlocks. */
  message: string;
  confirmLabel?: string;
  onClose: () => void;
  /** Resolve true when the PIN was accepted (the modal then closes). */
  onSubmit: (pin: string) => Promise<boolean>;
}

/** Asks for the app PIN before a guarded action (lifting the period lock). */
export function PinConfirmModal({ open, title, message, confirmLabel = 'Unlock', onClose, onSubmit }: PinConfirmModalProps) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setPin('');
      setError('');
      setBusy(false);
      // the dialog mounts a frame later; focus the field once it exists
      const t = setTimeout(() => input.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pin || busy) return;
    setBusy(true);
    setError('');
    try {
      const ok = await onSubmit(pin);
      if (ok) onClose();
      else {
        setError('That PIN is not correct. Please try again.');
        setPin('');
        input.current?.focus();
      }
    } catch (err) {
      setError((err as Error).message || 'Could not verify the PIN.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="pin-confirm-form" className={controls.btnPrimary} disabled={!pin || busy}>
            {busy ? 'Checking…' : confirmLabel}
          </button>
        </>
      }
    >
      <form id="pin-confirm-form" onSubmit={submit} noValidate>
        <p className={controls.hint} style={{ marginBottom: '0.75rem' }}>
          {message}
        </p>
        <label className={controls.field}>
          <span className={controls.label}>Your app PIN</span>
          <input
            ref={input}
            className={`${controls.input} ${styles.pinInput}`}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            maxLength={12}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'pin-confirm-error' : undefined}
          />
        </label>
        {error && (
          <p id="pin-confirm-error" className={controls.error} role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

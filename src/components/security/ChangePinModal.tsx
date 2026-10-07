import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { changePin, isValidPinFormat, pinStrength } from '../../lib/auth';
import controls from '../../styles/controls.module.css';
import styles from './Security.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}

const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);

const MESSAGES = {
  'wrong-pin': 'The current PIN is incorrect.',
  'invalid-format': 'The new PIN must be 4 to 6 digits.',
  'same-pin': 'The new PIN must be different from the current one.',
  'no-account': 'No account found on this device.',
} as const;

/** Verifies the current PIN, then stores a freshly salted hash of the new one. */
export function ChangePinModal({ open, onClose, onChanged }: Props) {
  const [oldPin, setOldPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const close = () => {
    setOldPin('');
    setNewPin('');
    setConfirm('');
    setError('');
    onClose();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError('');
    if (!isValidPinFormat(newPin)) return setError(MESSAGES['invalid-format']);
    if (newPin !== confirm) return setError('The two new PINs do not match.');
    setBusy(true);
    try {
      const result = await changePin(oldPin, newPin);
      if (result.ok) {
        onChanged?.();
        close();
      } else if (result.reason === 'locked') {
        setError(`Too many incorrect attempts. Try again in ${Math.ceil((result.retryInMs ?? 0) / 1000)} seconds.`);
      } else {
        setError(MESSAGES[result.reason]);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const strength = newPin.length >= 4 ? pinStrength(newPin) : null;

  return (
    <Modal
      open={open}
      onClose={close}
      size="sm"
      title="Change PIN"
      subtitle="Enter your current PIN, then choose a new one."
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={close}>Cancel</button>
          <button
            type="submit"
            form="change-pin-form"
            className={controls.btnPrimary}
            disabled={busy || oldPin.length < 4 || newPin.length < 4 || confirm.length < 4}
          >
            {busy ? 'Saving…' : 'Change PIN'}
          </button>
        </>
      }
    >
      <form id="change-pin-form" className={styles.form} onSubmit={submit} noValidate>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="cp-old">Current PIN</label>
          <input id="cp-old" className={controls.input} type="password" inputMode="numeric" autoComplete="current-password"
            value={oldPin} onChange={(e) => setOldPin(digits(e.target.value))} maxLength={6} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="cp-new">New PIN (4–6 digits)</label>
          <input id="cp-new" className={controls.input} type="password" inputMode="numeric" autoComplete="new-password"
            value={newPin} onChange={(e) => setNewPin(digits(e.target.value))} maxLength={6} />
          {strength?.warning && <span className={controls.hint}>{strength.warning} You can still use it.</span>}
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="cp-confirm">Confirm new PIN</label>
          <input id="cp-confirm" className={`${controls.input} ${confirm && confirm !== newPin ? controls.inputInvalid : ''}`}
            type="password" inputMode="numeric" autoComplete="new-password"
            value={confirm} onChange={(e) => setConfirm(digits(e.target.value))} maxLength={6} />
        </div>
        {error && <span className={controls.error} role="alert">{error}</span>}
      </form>
    </Modal>
  );
}

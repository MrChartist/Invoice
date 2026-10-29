import { useState } from 'react';
import { Modal } from '../ui/Modal';
import { changePin, isValidPinFormat, pinStrength } from '../../lib/auth';
import { useT } from '../../i18n';
import { secT } from '../../i18n/areas/security';
import controls from '../../styles/controls.module.css';
import styles from './Security.module.css';
import { errText, libMsg } from '../../i18n/lib-msg';

interface Props {
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}

const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);

const MESSAGES = {
  'wrong-pin': 'errWrongPin',
  'invalid-format': 'errFormat',
  'same-pin': 'errSame',
  'no-account': 'errNoAccount',
} as const;

/** Verifies the current PIN, then stores a freshly salted hash of the new one. */
export function ChangePinModal({ open, onClose, onChanged }: Props) {
  useT(); // re-render on a language switch (5.4)
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
    if (!isValidPinFormat(newPin)) return setError(secT(MESSAGES['invalid-format']));
    if (newPin !== confirm) return setError(secT('errMismatch'));
    setBusy(true);
    try {
      const result = await changePin(oldPin, newPin);
      if (result.ok) {
        onChanged?.();
        close();
      } else if (result.reason === 'locked') {
        setError(secT('errLocked', { n: Math.ceil((result.retryInMs ?? 0) / 1000) }));
      } else {
        setError(secT(MESSAGES[result.reason]));
      }
    } catch (err) {
      setError(errText(err));
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
      title={secT('changePin')}
      subtitle={secT('changePinSub')}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={close}>{secT('cancel')}</button>
          <button
            type="submit"
            form="change-pin-form"
            className={controls.btnPrimary}
            disabled={busy || oldPin.length < 4 || newPin.length < 4 || confirm.length < 4}
          >
            {busy ? secT('saving') : secT('changePin')}
          </button>
        </>
      }
    >
      <form id="change-pin-form" className={styles.form} onSubmit={submit} noValidate>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="cp-old">{secT('currentPin')}</label>
          <input id="cp-old" className={controls.input} type="password" inputMode="numeric" autoComplete="current-password"
            value={oldPin} onChange={(e) => setOldPin(digits(e.target.value))} maxLength={6} />
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="cp-new">{secT('newPin')}</label>
          <input id="cp-new" className={controls.input} type="password" inputMode="numeric" autoComplete="new-password"
            value={newPin} onChange={(e) => setNewPin(digits(e.target.value))} maxLength={6} />
          {strength?.warning && <span className={controls.hint}>{libMsg(strength.warning)} {secT('stillUse')}</span>}
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="cp-confirm">{secT('confirmPin')}</label>
          <input id="cp-confirm" className={`${controls.input} ${confirm && confirm !== newPin ? controls.inputInvalid : ''}`}
            type="password" inputMode="numeric" autoComplete="new-password"
            value={confirm} onChange={(e) => setConfirm(digits(e.target.value))} maxLength={6} />
        </div>
        {error && <span className={controls.error} role="alert">{error}</span>}
      </form>
    </Modal>
  );
}

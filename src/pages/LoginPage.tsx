import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Eye, EyeOff, Lock, ShieldCheck, TimerReset, User, WifiOff } from 'lucide-react';
import { Logo } from '../components/brand/Logo';
import {
  RESET_PHRASE,
  getAttemptsLeft,
  getLockoutRemaining,
  getUser,
  isResetPhrase,
  isValidPinFormat,
  login,
  pinStrength,
  resetAllData,
  unlock,
} from '../lib/auth';
import controls from '../styles/controls.module.css';
import styles from './LoginPage.module.css';

interface LoginPageProps {
  onSuccess: () => void;
}

type Mode = 'login' | 'register' | 'forgot';

function formatCountdown(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`;
}

const digitsOnly = (value: string) => value.replace(/\D/g, '').slice(0, 6);

export function LoginPage({ onSuccess }: LoginPageProps) {
  const existingUser = getUser();
  const [mode, setMode] = useState<Mode>(existingUser ? 'login' : 'register');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [lockedMs, setLockedMs] = useState(() => getLockoutRemaining());

  // Tick the lockout countdown (persisted deadline, so a reload keeps it).
  useEffect(() => {
    if (lockedMs <= 0) return;
    const id = window.setInterval(() => {
      const left = getLockoutRemaining();
      setLockedMs(left);
      if (left <= 0) setError('');
    }, 500);
    return () => window.clearInterval(id);
  }, [lockedMs > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  const locked = lockedMs > 0;
  const strength = mode === 'register' && pin.length >= 4 ? pinStrength(pin) : null;

  const switchMode = (next: Mode) => {
    setMode(next);
    setError('');
    setPin('');
    setConfirm('');
    setPhrase('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || locked) return;
    setError('');
    setBusy(true);
    try {
      if (mode === 'register') {
        if (!name.trim()) return setError('Please enter your name.');
        if (!isValidPinFormat(pin)) return setError('Choose a PIN of 4 to 6 digits.');
        if (pin !== confirm) return setError('The two PINs do not match.');
        if (await login(name, pin)) onSuccess();
        else setError('Could not create the account. Please try again.');
      } else {
        const result = await unlock(pin);
        if (result.ok) return onSuccess();
        setPin('');
        if (result.locked) {
          setLockedMs(result.retryInMs);
          setError('Too many incorrect attempts.');
        } else {
          setError(`Incorrect PIN. ${result.attemptsLeft} ${result.attemptsLeft === 1 ? 'attempt' : 'attempts'} left before a temporary lock.`);
        }
      }
    } catch (err) {
      setError((err as Error).message || 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const handleReset = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetAllData(phrase)) return setError('The confirmation phrase does not match.');
    // Fresh start: reload so every module re-reads empty storage.
    window.location.reload();
  };

  return (
    <div className={styles.shell}>
      <aside className={styles.brand}>
        <Logo height={40} tone="on-dark" />
        <div className={styles.brandBody}>
          <h1 className={styles.headline}>
            Invoices &amp; books, <em>on your device.</em>
          </h1>
          <p className={styles.lede}>
            GST-ready invoicing, ledgers and reports that work offline. Nothing is uploaded — your PIN only unlocks this browser.
          </p>
        </div>
        <ul className={styles.points}>
          <li><WifiOff size={16} /> Works fully offline, zero tracking</li>
          <li><ShieldCheck size={16} /> PIN stored as a salted PBKDF2 hash</li>
          <li><TimerReset size={16} /> Auto-locks when you step away</li>
        </ul>
      </aside>

      <main className={styles.formSide}>
        <div className={styles.card}>
          {mode === 'forgot' ? (
            <form className={styles.form} onSubmit={handleReset} noValidate>
              <div>
                <h2 className={styles.title}>Forgot your PIN?</h2>
                <p className={styles.subtitle}>
                  Your data lives only in this browser, so there is no server to reset it. The only way back in is to erase everything on this
                  device and start fresh.
                </p>
              </div>
              <div className={styles.noticeWarn} role="alert">
                <AlertTriangle size={16} />
                <span>
                  This permanently deletes every invoice, client, item, profile and your PIN. If you have a backup file, you can restore it
                  afterwards from Settings.
                </span>
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="reset-phrase">
                  Type <span className={styles.phrase}>{RESET_PHRASE}</span> to confirm
                </label>
                <input
                  id="reset-phrase"
                  className={controls.input}
                  value={phrase}
                  onChange={(e) => setPhrase(e.target.value)}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  autoFocus
                />
              </div>
              {error && <div className={styles.noticeError} role="alert">{error}</div>}
              <button
                type="submit"
                className={`${controls.btnPrimary} ${controls.btnLg} ${controls.btnBlock} ${styles.dangerBtn}`}
                disabled={!isResetPhrase(phrase)}
              >
                Erase everything and start over
              </button>
              <div className={styles.links}>
                <button type="button" className={styles.linkBtn} onClick={() => switchMode('login')}>
                  I remembered it — go back
                </button>
              </div>
            </form>
          ) : (
            <form className={styles.form} onSubmit={handleSubmit} noValidate>
              <div>
                <h2 className={styles.title}>
                  {mode === 'register' ? 'Create your account' : `Welcome back, ${existingUser?.name ?? ''}`}
                </h2>
                <p className={styles.subtitle}>
                  {mode === 'register'
                    ? 'Set a PIN to protect your invoices. Your data stays 100% on this device.'
                    : 'Enter your PIN to unlock.'}
                </p>
              </div>

              {mode === 'register' && (
                <div className={controls.field}>
                  <label className={controls.label} htmlFor="login-name">Full name</label>
                  <div className={styles.inputWrap}>
                    <User size={16} className={styles.inputIcon} />
                    <input
                      id="login-name"
                      className={`${controls.input} ${styles.withIcon}`}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Your name or business"
                      autoComplete="name"
                      autoFocus
                    />
                  </div>
                </div>
              )}

              <div className={controls.field}>
                <label className={controls.label} htmlFor="login-pin">
                  {mode === 'register' ? 'Create a PIN (4–6 digits)' : 'PIN'}
                </label>
                <div className={styles.inputWrap}>
                  <Lock size={16} className={styles.inputIcon} />
                  <input
                    id="login-pin"
                    className={`${controls.input} ${styles.withIcon} ${styles.pinInput}`}
                    type={reveal ? 'text' : 'password'}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                    value={pin}
                    onChange={(e) => setPin(digitsOnly(e.target.value))}
                    placeholder="••••"
                    maxLength={6}
                    disabled={locked}
                    autoFocus={mode === 'login'}
                    aria-describedby="login-pin-hint"
                  />
                  <button
                    type="button"
                    className={styles.reveal}
                    onClick={() => setReveal((r) => !r)}
                    aria-label={reveal ? 'Hide PIN' : 'Show PIN'}
                  >
                    {reveal ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {strength && (
                  <>
                    <div className={styles.meter} data-level={strength.level} aria-hidden="true">
                      <span /><span /><span />
                    </div>
                    <span id="login-pin-hint" className={strength.warning ? controls.hint : controls.ok}>
                      {strength.warning ?? (
                        <>
                          <CheckCircle2 size={13} /> Looks good
                        </>
                      )}
                      {strength.level === 'weak' && ' You can still use it, but a less obvious PIN protects you better.'}
                    </span>
                  </>
                )}
              </div>

              {mode === 'register' && (
                <div className={controls.field}>
                  <label className={controls.label} htmlFor="login-confirm">Confirm PIN</label>
                  <div className={styles.inputWrap}>
                    <Lock size={16} className={styles.inputIcon} />
                    <input
                      id="login-confirm"
                      className={`${controls.input} ${styles.withIcon} ${styles.pinInput} ${confirm && confirm !== pin ? controls.inputInvalid : ''}`}
                      type={reveal ? 'text' : 'password'}
                      inputMode="numeric"
                      pattern="[0-9]*"
                      autoComplete="new-password"
                      value={confirm}
                      onChange={(e) => setConfirm(digitsOnly(e.target.value))}
                      placeholder="••••"
                      maxLength={6}
                    />
                  </div>
                </div>
              )}

              {locked && (
                <div className={styles.noticeError} role="alert">
                  <Lock size={16} />
                  <span>
                    Too many incorrect attempts. Try again in <span className={styles.countdown}>{formatCountdown(lockedMs)}</span>.
                  </span>
                </div>
              )}
              {!locked && error && <div className={styles.noticeError} role="alert">{error}</div>}
              {mode === 'login' && !locked && !error && getAttemptsLeft() < 5 && (
                <div className={styles.noticeWarn}>
                  <AlertTriangle size={16} />
                  <span>{getAttemptsLeft()} attempts left before a temporary lock.</span>
                </div>
              )}

              <button
                type="submit"
                className={`${controls.btnPrimary} ${controls.btnLg} ${controls.btnBlock}`}
                disabled={busy || locked || pin.length < 4}
              >
                {busy ? 'Checking…' : mode === 'register' ? 'Create account' : 'Unlock'} <ArrowRight size={18} />
              </button>

              {mode === 'login' && (
                <div className={styles.links}>
                  <button type="button" className={styles.linkBtn} onClick={() => switchMode('forgot')}>
                    Forgot PIN?
                  </button>
                </div>
              )}
            </form>
          )}

          <p className={styles.foot}>Your data never leaves this device. Zero backend. Zero tracking.</p>
        </div>
      </main>
    </div>
  );
}

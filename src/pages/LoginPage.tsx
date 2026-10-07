import { useState } from 'react';
import { ArrowRight, Eye, EyeOff, FileCheck2, Lock, QrCode, ShieldCheck, User } from 'lucide-react';
import { Logo } from '../components/brand/Logo';
import { getUser, login, verifyPin } from '../lib/auth';
import controls from '../styles/controls.module.css';
import styles from './LoginPage.module.css';

const PERKS = [
  { icon: ShieldCheck, text: 'Private by design — data never leaves this device' },
  { icon: FileCheck2, text: 'GST-ready: CGST / SGST / IGST, HSN, Indian FY numbering' },
  { icon: QrCode, text: '20 templates with a scannable UPI QR on every invoice' },
];

export function LoginPage({ onSuccess }: { onSuccess: () => void }) {
  const existingUser = getUser();
  const mode: 'login' | 'register' = existingUser ? 'login' : 'register';
  const [name, setName] = useState(existingUser?.name || '');
  const [pin, setPin] = useState('');
  const [showPin, setShowPin] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (mode === 'register') {
      if (!name.trim()) return setError('Please enter your name.');
      if (pin.length < 4) return setError('Your PIN must be at least 4 digits.');
      if (login(name, pin)) onSuccess();
      else setError('Could not create the account. Is browser storage blocked?');
      return;
    }

    if (!verifyPin(pin)) {
      setPin('');
      return setError('Incorrect PIN. Please try again.');
    }
    login(existingUser!.name, pin);
    onSuccess();
  };

  return (
    <div className={styles.page}>
      <aside className={styles.brandPanel}>
        <Logo height={52} tone="on-dark" />
        <div className={styles.pitch}>
          <h2 className={styles.headline}>
            Invoices that look as sharp as <span>your work.</span>
          </h2>
          <ul className={styles.perks}>
            {PERKS.map(({ icon: Icon, text }) => (
              <li key={text}>
                <Icon size={16} /> {text}
              </li>
            ))}
          </ul>
        </div>
        <p className={styles.tagline}>Built with conviction. For traders, by a trader.</p>
      </aside>

      <main className={styles.formPanel}>
        <div className={styles.formWrap}>
          <div className={styles.mobileLogo}>
            <Logo height={46} />
          </div>

          <h1 className={styles.title}>
            {mode === 'register' ? 'Set up your workspace' : `Welcome back, ${existingUser?.name}`}
          </h1>
          <p className={styles.subtitle}>
            {mode === 'register'
              ? 'Create a local PIN. Everything stays in this browser — there is no server and no account to sign up for.'
              : 'Enter your PIN to unlock your invoices.'}
          </p>

          <form onSubmit={handleSubmit} className={styles.form} noValidate>
            {mode === 'register' && (
              <label className={controls.field}>
                <span className={controls.label}>Your name</span>
                <span className={styles.inputWrap}>
                  <User size={16} className={styles.inputIcon} />
                  <input
                    className={`${controls.input} ${styles.withIcon}`}
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Rohit Singh"
                    autoComplete="name"
                    autoFocus
                  />
                </span>
              </label>
            )}

            <label className={controls.field}>
              <span className={controls.label}>{mode === 'register' ? 'Create a PIN (4–6 digits)' : 'PIN'}</span>
              <span className={styles.inputWrap}>
                <Lock size={16} className={styles.inputIcon} />
                <input
                  className={`${controls.input} ${styles.withIcon} ${styles.pin}`}
                  type={showPin ? 'text' : 'password'}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="••••"
                  maxLength={6}
                  autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
                  autoFocus={mode === 'login'}
                  aria-invalid={!!error}
                />
                <button
                  type="button"
                  className={styles.reveal}
                  onClick={() => setShowPin((s) => !s)}
                  aria-label={showPin ? 'Hide PIN' : 'Show PIN'}
                >
                  {showPin ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </label>

            {error && (
              <div className={styles.error} role="alert">
                {error}
              </div>
            )}

            <button type="submit" className={`${controls.btnPrimary} ${controls.btnLg} ${controls.btnBlock}`}>
              {mode === 'register' ? 'Create workspace' : 'Unlock'} <ArrowRight size={18} />
            </button>
          </form>

          <p className={styles.note}>
            <Lock size={12} /> The PIN only locks this screen on a shared computer. It is not encryption — use a
            private browser profile for sensitive data.
          </p>
        </div>
      </main>
    </div>
  );
}

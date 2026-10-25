import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Eye, EyeOff, Lock, ShieldCheck, TimerReset, User, Users, WifiOff } from 'lucide-react';
import { readRegistry } from '../lib/company-registry';
import { Logo } from '../components/brand/Logo';
import {
  OWNER_ID,
  RESET_PHRASE,
  getAttemptsLeft,
  getLockoutRemaining,
  getUser,
  isResetPhrase,
  isValidPinFormat,
  listUsers,
  login,
  pinStrength,
  resetAllData,
  unlock,
} from '../lib/auth';
import { tNodes, useT } from '../i18n';
import { roleLabel } from '../i18n/labels';
import { LanguageSwitch } from '../components/ui/LanguageSwitch';
import { reloadAfterFlush } from '../lib/storage';
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
  const { t } = useT();
  const existingUser = getUser();
  // Local roles (6.21): with more than one user on this device, pick who is signing in.
  const users = listUsers();
  const [userId, setUserId] = useState(OWNER_ID);
  const selected = users.find((u) => u.id === userId) ?? users[0];
  const isOwner = !selected || selected.id === OWNER_ID;
  const [mode, setMode] = useState<Mode>(existingUser ? 'login' : 'register');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [phrase, setPhrase] = useState('');
  const [lockedMs, setLockedMs] = useState(() => getLockoutRemaining());

  // Lockout is per user: switching user shows that user's own countdown.
  const pickUser = (id: string) => {
    setUserId(id);
    setPin('');
    setError('');
    setLockedMs(getLockoutRemaining(Date.now(), id));
  };

  // Tick the lockout countdown (persisted deadline, so a reload keeps it).
  useEffect(() => {
    if (lockedMs <= 0) return;
    const id = window.setInterval(() => {
      const left = getLockoutRemaining(Date.now(), userId);
      setLockedMs(left);
      if (left <= 0) setError('');
    }, 500);
    return () => window.clearInterval(id);
  }, [lockedMs > 0, userId]); // eslint-disable-line react-hooks/exhaustive-deps

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
        if (!name.trim()) return setError(t('login.errName'));
        if (!isValidPinFormat(pin)) return setError(t('login.errPinFormat'));
        if (pin !== confirm) return setError(t('login.errPinMatch'));
        if (await login(name, pin)) onSuccess();
        else setError(t('login.errCreate'));
      } else {
        const result = await unlock(pin, undefined, selected?.id ?? OWNER_ID);
        if (result.ok) return onSuccess();
        setPin('');
        if (result.locked) {
          setLockedMs(result.retryInMs);
          setError(t('login.errTooMany'));
        } else {
          setError(result.attemptsLeft === 1 ? t('login.errIncorrectOne') : t('login.errIncorrectMany', { n: result.attemptsLeft }));
        }
      }
    } catch (err) {
      setError((err as Error).message || t('login.errGeneric'));
    } finally {
      setBusy(false);
    }
  };

  // Easy entry: a full 6-digit PIN unlocks without pressing Enter (shorter PINs: Enter / button).
  useEffect(() => {
    if (mode === 'login' && pin.length === 6 && !busy && !locked) {
      void handleSubmit({ preventDefault() {} } as React.FormEvent);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, mode]);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    const companies = readRegistry(); // the reset clears the registry
    if (!resetAllData(phrase)) return setError(t('login.errPhrase'));
    // Also drop the undo copy, backup key and folder link kept in IndexedDB (security: no way back to the old data).
    const [{ forgetDeviceData }, { eraseOtherCompanies }] = await Promise.all([import('../lib/auto-backup'), import('../lib/companies')]);
    await forgetDeviceData();
    await eraseOtherCompanies(companies); // other companies' databases on this device (6.20)
    // Fresh start: commit the erase of the data tables to IndexedDB, then reload so every module re-reads empty storage.
    reloadAfterFlush();
  };

  return (
    <div className={styles.shell}>
      <aside className={styles.brand}>
        <Logo height={40} tone="on-dark" />
        <div className={styles.brandBody}>
          <h1 className={styles.headline}>
            {t('login.headline')} <em>{t('login.headlineEm')}</em>
          </h1>
          <p className={styles.lede}>
            {t('login.lede')}
          </p>
        </div>
        <ul className={styles.points}>
          <li><WifiOff size={16} /> {t('login.pointOffline')}</li>
          <li><ShieldCheck size={16} /> {t('login.pointHash')}</li>
          <li><TimerReset size={16} /> {t('login.pointLock')}</li>
        </ul>
      </aside>

      <main className={styles.formSide}>
        <div className={styles.card}>
          <LanguageSwitch compact className={styles.lang} />
          {mode === 'forgot' && !isOwner ? (
            <div className={styles.form}>
              <div>
                <h2 className={styles.title}>{t('login.forgotTitle')}</h2>
                <p className={styles.subtitle}>
                  {t('login.askOwner', { owner: users[0]?.name ? ` (${users[0].name})` : '', name: selected?.name ?? t('login.you') })}
                </p>
              </div>
              <div className={styles.links}>
                <button type="button" className={styles.linkBtn} onClick={() => switchMode('login')}>
                  {t('login.goBack')}
                </button>
              </div>
            </div>
          ) : mode === 'forgot' ? (
            <form className={styles.form} onSubmit={handleReset} noValidate>
              <div>
                <h2 className={styles.title}>{t('login.forgotTitle')}</h2>
                <p className={styles.subtitle}>{t('login.forgotText')}</p>
              </div>
              <div className={styles.noticeWarn} role="alert">
                <AlertTriangle size={16} />
                <span>{t('login.eraseWarn')}</span>
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="reset-phrase">
                  {tNodes('common.typeToConfirm', { word: <span className={styles.phrase}>{RESET_PHRASE}</span> })}
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
                {t('login.eraseButton')}
              </button>
              <div className={styles.links}>
                <button type="button" className={styles.linkBtn} onClick={() => switchMode('login')}>
                  {t('login.remembered')}
                </button>
              </div>
            </form>
          ) : (
            <form className={styles.form} onSubmit={handleSubmit} noValidate>
              <div>
                <h2 className={styles.title}>
                  {mode === 'register' ? t('login.createTitle') : selected?.name ? t('login.welcomeBackName', { name: selected.name }) : t('login.welcomeBack')}
                </h2>
                <p className={styles.subtitle}>
                  {mode === 'register' ? t('login.createSub') : t('login.unlockSub')}
                </p>
              </div>

              {mode === 'login' && users.length > 1 && (
                <div className={controls.field}>
                  <label className={controls.label} htmlFor="login-user">{t('shell.user')}</label>
                  <div className={styles.inputWrap}>
                    <Users size={16} className={styles.inputIcon} />
                    <select
                      id="login-user"
                      className={`${controls.select} ${styles.withIcon}`}
                      value={selected?.id ?? OWNER_ID}
                      onChange={(e) => pickUser(e.target.value)}
                    >
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({roleLabel(u.role)})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )}

              {mode === 'register' && (
                <div className={controls.field}>
                  <label className={controls.label} htmlFor="login-name">{t('login.fullName')}</label>
                  <div className={styles.inputWrap}>
                    <User size={16} className={styles.inputIcon} />
                    <input
                      id="login-name"
                      className={`${controls.input} ${styles.withIcon}`}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder={t('login.namePlaceholder')}
                      autoComplete="name"
                      autoFocus
                    />
                  </div>
                </div>
              )}

              <div className={controls.field}>
                <label className={controls.label} htmlFor="login-pin">
                  {mode === 'register' ? t('login.createPin') : t('login.pin')}
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
                    aria-describedby={strength ? 'login-pin-hint' : undefined}
                  />
                  <button
                    type="button"
                    className={styles.reveal}
                    onClick={() => setReveal((r) => !r)}
                    aria-label={reveal ? t('login.hidePin') : t('login.showPin')}
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
                          <CheckCircle2 size={13} /> {t('login.looksGood')}
                        </>
                      )}
                      {strength.level === 'weak' && t('login.weakNote')}
                    </span>
                  </>
                )}
              </div>

              {mode === 'register' && (
                <div className={controls.field}>
                  <label className={controls.label} htmlFor="login-confirm">{t('login.confirmPin')}</label>
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
                  <span>{tNodes('login.lockedNotice', { time: <span className={styles.countdown}>{formatCountdown(lockedMs)}</span> })}</span>
                </div>
              )}
              {!locked && error && <div className={styles.noticeError} role="alert">{error}</div>}
              {mode === 'login' && !locked && !error && getAttemptsLeft(selected?.id) < 5 && (
                <div className={styles.noticeWarn}>
                  <AlertTriangle size={16} />
                  <span>{t('login.attemptsLeft', { n: getAttemptsLeft(selected?.id) })}</span>
                </div>
              )}

              <button
                type="submit"
                className={`${controls.btnPrimary} ${controls.btnLg} ${controls.btnBlock}`}
                disabled={busy || locked || pin.length < 4}
              >
                {busy ? t('login.checking') : mode === 'register' ? t('login.createAccount') : t('login.unlock')} <ArrowRight size={18} />
              </button>

              {mode === 'login' && (
                <div className={styles.links}>
                  <button type="button" className={styles.linkBtn} onClick={() => switchMode('forgot')}>
                    {t('login.forgotPin')}
                  </button>
                </div>
              )}
            </form>
          )}

          <p className={styles.foot}>{t('login.foot')}</p>
        </div>
      </main>
    </div>
  );
}

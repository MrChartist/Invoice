import { useState } from 'react';
import { Info, KeyRound, Trash2, UserPlus, Users } from 'lucide-react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ROLE_HINTS, ROLE_LABELS } from '../../lib/access';
import { OWNER_ID, isValidPinFormat, listUsers, type UserSummary } from '../../lib/auth';
import { ASSIGNABLE_ROLES, USER_ERRORS, addUser, removeUser, resetUserPin, setUserRole, type AssignableRole, type UserResult } from '../../lib/users';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './Security.module.css';

interface Props {
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);
const problem = (r: UserResult) => (r.ok ? '' : USER_ERRORS[r.reason]);

/**
 * Settings → Security → Users (owner only, roadmap 6.21): add clerks and viewers with their own
 * PINs, change a role, reset a forgotten PIN, remove a user.
 */
export function UsersPanel({ notify }: Props) {
  const [users, setUsers] = useState<UserSummary[]>(listUsers);
  const refresh = () => setUsers(listUsers());

  const [name, setName] = useState('');
  const [role, setRole] = useState<AssignableRole>('clerk');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const [resetFor, setResetFor] = useState<UserSummary | null>(null);
  const [resetPin, setResetPin] = useState('');
  const [removing, setRemoving] = useState<UserSummary | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setFormError('');
    if (!isValidPinFormat(pin)) return setFormError(USER_ERRORS['invalid-pin']);
    setBusy(true);
    try {
      const r = await addUser(name, role, pin);
      if (!r.ok) return setFormError(problem(r));
      notify(`${r.user.name} added as ${ROLE_LABELS[r.user.role].toLowerCase()}`);
      setName('');
      setPin('');
      refresh();
    } catch (err) {
      setFormError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const changeRole = (u: UserSummary, next: AssignableRole) => {
    try {
      const r = setUserRole(u.id, next);
      if (!r.ok) return notify(problem(r), 'error');
      notify(`${u.name} is now a ${ROLE_LABELS[next].toLowerCase()}`);
      refresh();
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  const doReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetFor || busy) return;
    setBusy(true);
    try {
      const r = await resetUserPin(resetFor.id, resetPin);
      if (!r.ok) return notify(problem(r), 'error');
      notify(`New PIN set for ${resetFor.name}`);
      setResetFor(null);
      setResetPin('');
    } catch (err) {
      notify((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={surface.card}>
      <div className={surface.cardHead}>
        <span className={surface.cardHeadIcon}>
          <Users size={16} /> Users on this device
        </span>
      </div>
      <div className={surface.cardBody}>
        <div className={styles.note} role="note">
          <Info size={16} aria-hidden="true" />
          <span>
            Roles are a convenience for a shared computer, not security: they hide and refuse actions in this app, but anyone
            with the device and the browser&apos;s developer tools can get around them. For real protection use vault mode
            (below) and a separate operating-system account per person.
          </span>
        </div>

        <ul className={styles.userList} aria-label="Users">
          {users.map((u) => (
            <li key={u.id} className={styles.userRow}>
              <div className={styles.rowText}>
                <strong>{u.name}</strong>
                <span>{u.id === OWNER_ID ? `${ROLE_LABELS.owner} — ${ROLE_HINTS.owner}` : ROLE_HINTS[u.role]}</span>
              </div>
              {u.id !== OWNER_ID && (
                <div className={styles.buttons}>
                  <select
                    className={controls.select}
                    aria-label={`Role for ${u.name}`}
                    value={u.role}
                    onChange={(e) => changeRole(u, e.target.value as AssignableRole)}
                  >
                    {ASSIGNABLE_ROLES.map((r) => (
                      <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                    ))}
                  </select>
                  <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => { setResetFor(u); setResetPin(''); }}>
                    <KeyRound size={14} /> Reset PIN
                  </button>
                  <button type="button" className={controls.btnDanger} onClick={() => setRemoving(u)} aria-label={`Remove ${u.name}`}>
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>

        {resetFor && (
          <form className={styles.form} onSubmit={doReset} aria-label={`New PIN for ${resetFor.name}`}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="user-reset-pin">New PIN for {resetFor.name} (4–6 digits)</label>
              <input
                id="user-reset-pin"
                className={controls.input}
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                value={resetPin}
                onChange={(e) => setResetPin(digits(e.target.value))}
                maxLength={6}
                autoFocus
              />
            </div>
            <div className={styles.buttons}>
              <button type="submit" className={controls.btnPrimary} disabled={busy || !isValidPinFormat(resetPin)}>Set new PIN</button>
              <button type="button" className={controls.btnOutline} onClick={() => setResetFor(null)}>Cancel</button>
            </div>
          </form>
        )}

        <hr className={styles.divider} />

        <form className={styles.form} onSubmit={add} aria-label="Add a user">
          <strong>Add a user</strong>
          <div className={styles.passRow}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="user-name">Name</label>
              <input id="user-name" className={controls.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="off" />
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="user-role">Role</label>
              <select id="user-role" className={controls.select} value={role} onChange={(e) => setRole(e.target.value as AssignableRole)}>
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                ))}
              </select>
            </div>
          </div>
          <span className={controls.hint}>{ROLE_HINTS[role]}</span>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="user-pin">Their PIN (4–6 digits)</label>
            <input
              id="user-pin"
              className={controls.input}
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              value={pin}
              onChange={(e) => setPin(digits(e.target.value))}
              maxLength={6}
            />
          </div>
          {formError && <div className={controls.error} role="alert">{formError}</div>}
          <div className={styles.buttons}>
            <button type="submit" className={controls.btnPrimary} disabled={busy || !name.trim() || pin.length < 4}>
              <UserPlus size={16} /> {busy ? 'Adding…' : 'Add user'}
            </button>
          </div>
        </form>
      </div>

      <ConfirmDialog
        open={!!removing}
        destructive
        title="Remove this user?"
        message={`${removing?.name ?? 'This user'} will no longer be able to sign in on this device. Their past changes stay in the activity log.`}
        confirmLabel="Remove user"
        onConfirm={() => {
          if (!removing) return;
          try {
            const r = removeUser(removing.id);
            if (!r.ok) notify(problem(r), 'error');
            else notify(`${removing.name} removed`);
          } catch (err) {
            notify((err as Error).message, 'error');
          }
          refresh();
        }}
        onClose={() => setRemoving(null)}
      />
    </section>
  );
}

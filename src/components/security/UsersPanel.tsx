import { lazy, Suspense, useState } from 'react';
import { Info, KeyRound, SlidersHorizontal, Trash2, UserPlus, Users } from 'lucide-react';
import { rightsT } from '../../i18n/areas/rights';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { OWNER_ID, isValidPinFormat, listUsers, type UserSummary } from '../../lib/auth';
import { ASSIGNABLE_ROLES, MAX_NAME, MAX_USERS, addUser, removeUser, resetUserPin, setUserRole, type AssignableRole, type UserResult } from '../../lib/users';
import { useT } from '../../i18n';
import { secT } from '../../i18n/areas/security';
import { roleLabel } from '../../i18n/labels';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './Security.module.css';

interface Props {
  notify: (message: string, tone?: 'success' | 'error' | 'info') => void;
}

const RightsEditor = lazy(() => import('./RightsEditor').then((m) => ({ default: m.RightsEditor })));

const digits = (v: string) => v.replace(/\D/g, '').slice(0, 6);
const problem = (r: UserResult) => (r.ok ? '' : secT(`ue.${r.reason}`, { n: r.reason === 'too-many' ? MAX_USERS : MAX_NAME }));

/**
 * Settings → Security → Users (owner only, roadmap 6.21): add clerks and viewers with their own
 * PINs, change a role, reset a forgotten PIN, remove a user.
 */
export function UsersPanel({ notify }: Props) {
  useT(); // re-render on a language switch (5.4)
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
  // Finer rights (8H): the editor loads only when opened.
  const [rightsFor, setRightsFor] = useState<UserSummary | null>(null);

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setFormError('');
    if (!isValidPinFormat(pin)) return setFormError(secT('ue.invalid-pin'));
    setBusy(true);
    try {
      const r = await addUser(name, role, pin);
      if (!r.ok) return setFormError(problem(r));
      notify(secT('userAdded', { name: r.user.name, role: roleLabel(r.user.role).toLowerCase() }));
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
      notify(secT('roleChanged', { name: u.name, role: roleLabel(next).toLowerCase() }));
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
      notify(secT('newPinSet', { name: resetFor.name }));
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
          <Users size={16} /> {secT('usersTitle')}
        </span>
      </div>
      <div className={surface.cardBody}>
        <div className={styles.note} role="note">
          <Info size={16} aria-hidden="true" />
          <span>{secT('rolesNote')}</span>
        </div>

        <ul className={styles.userList} aria-label={secT('users')}>
          {users.map((u) => (
            <li key={u.id} className={styles.userRow}>
              <div className={styles.rowText}>
                <strong>{u.name}</strong>
                <span>{u.id === OWNER_ID ? `${roleLabel('owner')} — ${secT('hint.owner')}` : secT(`hint.${u.role}`)}</span>
              </div>
              {u.id !== OWNER_ID && (
                <div className={styles.buttons}>
                  <select
                    className={controls.select}
                    aria-label={secT('roleFor', { name: u.name })}
                    value={u.role}
                    onChange={(e) => changeRole(u, e.target.value as AssignableRole)}
                  >
                    {ASSIGNABLE_ROLES.map((r) => (
                      <option key={r} value={r}>{roleLabel(r)}</option>
                    ))}
                  </select>
                  <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setRightsFor(u)}>
                    <SlidersHorizontal size={14} /> {rightsT('button')}
                  </button>
                  <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => { setResetFor(u); setResetPin(''); }}>
                    <KeyRound size={14} /> {secT('resetPin')}
                  </button>
                  <button type="button" className={controls.btnDanger} onClick={() => setRemoving(u)} aria-label={secT('removeNamed', { name: u.name })}>
                    <Trash2 size={16} />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>

        {resetFor && (
          <form className={styles.form} onSubmit={doReset} aria-label={secT('newPinFor', { name: resetFor.name })}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="user-reset-pin">{secT('newPinForLabel', { name: resetFor.name })}</label>
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
              <button type="submit" className={controls.btnPrimary} disabled={busy || !isValidPinFormat(resetPin)}>{secT('setNewPin')}</button>
              <button type="button" className={controls.btnOutline} onClick={() => setResetFor(null)}>{secT('cancel')}</button>
            </div>
          </form>
        )}

        <hr className={styles.divider} />

        <form className={styles.form} onSubmit={add} aria-label={secT('addUser')}>
          <strong>{secT('addUser')}</strong>
          <div className={styles.passRow}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="user-name">{secT('name')}</label>
              <input id="user-name" className={controls.input} value={name} onChange={(e) => setName(e.target.value)} maxLength={40} autoComplete="off" />
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="user-role">{secT('role')}</label>
              <select id="user-role" className={controls.select} value={role} onChange={(e) => setRole(e.target.value as AssignableRole)}>
                {ASSIGNABLE_ROLES.map((r) => (
                  <option key={r} value={r}>{roleLabel(r)}</option>
                ))}
              </select>
            </div>
          </div>
          <span className={controls.hint}>{secT(`hint.${role}`)}</span>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="user-pin">{secT('theirPin')}</label>
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
              <UserPlus size={16} /> {busy ? secT('adding') : secT('addUserBtn')}
            </button>
          </div>
        </form>
      </div>

      {rightsFor && (
        <Suspense fallback={null}>
          <RightsEditor user={rightsFor} notify={notify} onClose={() => { setRightsFor(null); refresh(); }} />
        </Suspense>
      )}
      <ConfirmDialog
        open={!!removing}
        destructive
        title={secT('removeUserTitle')}
        message={secT('removeUserMsg', { name: removing?.name ?? secT('thisUser') })}
        confirmLabel={secT('removeUser')}
        onConfirm={() => {
          if (!removing) return;
          try {
            const r = removeUser(removing.id);
            if (!r.ok) notify(problem(r), 'error');
            else notify(secT('removed', { name: removing.name }));
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

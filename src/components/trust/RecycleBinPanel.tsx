/**
 * R4-C4 "Recently deleted": the recycle bin with search, restore (through the table's own save path: period lock,
 * roles, numbers), restore together with a deleted parent or with the rows deleted with it, delete permanently
 * (owner; PIN for entries in a locked period) and the retention setting. Lazy dialog.
 */
import { useMemo, useState } from 'react';
import { History, KeyRound, Trash2, Undo2 } from 'lucide-react';
import type { BinEntry } from '../../types/trade-r4';
import { Modal } from '../ui/Modal';
import { can } from '../../lib/access';
import { verifyPin } from '../../lib/auth';
import { grantOverride, isPeriodLockedError } from '../../lib/period-lock';
import { peekTable } from '../../lib/storage';
import { localDayOf } from '../../lib/dates';
import { BIN_RETENTION } from '../../lib/trade/trade-rules';
import {
  BIN_TABLE, RestoreError, binRetentionDays, currentViewer, deleteForGood, describeEntry, lockedEntries, planRestore,
  restoreEntry, setBinRetentionDays, tableLabel, visibleEntries,
} from '../../lib/trust/recycle-bin';
import { useT } from '../../i18n';
import { trErr, trT } from '../../i18n/areas/trade-trust-r4';
import controls from '../../styles/controls.module.css';
import styles from './trust.module.css';
import { SelectField } from '../ui/SelectField';

type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void;

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
};

export default function RecycleBinPanel({ onClose, notify }: { onClose: () => void; notify?: Notify }) {
  useT();
  const [version, setVersion] = useState(0);
  const [q, setQ] = useState('');
  const [pending, setPending] = useState<{ kind: 'unlock'; entry: BinEntry; opts: { withParent?: boolean; withChildren?: boolean } } | { kind: 'delete'; ids: string[] } | null>(null);
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [days, setDays] = useState(binRetentionDays);
  const owner = can('data.erase');
  const all = useMemo(() => (version >= 0 ? visibleEntries(peekTable<BinEntry>(BIN_TABLE), currentViewer()).slice().reverse() : []), [version]);
  const shown = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return all;
    return all.filter((e) => {
      const d = describeEntry(e);
      return [d.label, d.number, d.name, tableLabel(e.table), e.deleted_by].filter(Boolean).join(' ').toLowerCase().includes(k);
    });
  }, [all, q]);
  const refresh = () => setVersion((v) => v + 1);
  const say = (msg: string, tone: 'success' | 'error' = 'success') => (notify ? notify(msg, tone) : tone === 'error' ? setError(msg) : undefined);

  const restore = (e: BinEntry, opts: { withParent?: boolean; withChildren?: boolean } = {}) => {
    setError('');
    try {
      const done = restoreEntry(e.id, opts);
      refresh();
      say(trT('binRestored', { label: done.map((x) => describeEntry(x).number || describeEntry(x).label).join(', ') }));
    } catch (err) {
      if (isPeriodLockedError(err)) return setPending({ kind: 'unlock', entry: e, opts });
      setError(err instanceof RestoreError ? err.message : trErr(err));
    }
  };
  const confirmPin = async () => {
    if (!pending) return;
    setError('');
    try {
      if (pending.kind === 'unlock') {
        const d = describeEntry(pending.entry);
        if (!(await grantOverride(pin, { scope: pending.entry.row_id, docNumber: d.number || undefined }))) return setError(trT('binWrongPin'));
        const { entry, opts } = pending;
        setPending(null);
        setPin('');
        restore(entry, opts);
      } else {
        if (!(await verifyPin(pin))) return setError(trT('binWrongPin'));
        const n = deleteForGood(pending.ids, { pinOk: true });
        setPending(null);
        setPin('');
        refresh();
        say(trT('binDeleted', { n }));
      }
    } catch (err) {
      setError(trErr(err));
    }
  };
  const remove = async (ids: string[]) => {
    setError('');
    if (!ids.length) return;
    const entries = all.filter((e) => ids.includes(e.id));
    // R9 (RT-B2): bills with Schedule H1 / X lines inside their retention window — a warning, never a block.
    const bills = entries.filter((e) => e.table === 'invoices').map((e) => e.row);
    const kept = bills.length ? await import('../../lib/retail/rt-pharmacy-retention').then((m) => m.retainedAmong(bills, localDayOf(new Date())), () => []) : [];
    const warn = kept.length ? `${trT('binRxRetained', { bills: kept.map((k) => k.number).join(', '), until: kept.reduce((m, k) => (k.until > m ? k.until : m), '') })}\n\n` : '';
    if (!window.confirm(warn + trT('binConfirmDelete', { n: ids.length }))) return;
    if (lockedEntries(entries).length) return setPending({ kind: 'delete', ids });
    try {
      const n = deleteForGood(ids);
      refresh();
      say(trT('binDeleted', { n }));
    } catch (err) {
      setError(trErr(err));
    }
  };

  return (
    <Modal open onClose={onClose} size="xl" title={<><History size={18} aria-hidden="true" /> {trT('binTitle')}</>}
      footer={<>
        {owner && all.length > 0 && <button type="button" className={controls.btnDanger} onClick={() => void remove(all.map((e) => e.id))}><Trash2 size={14} aria-hidden="true" /> {trT('binEmptyAll')}</button>}
        <button type="button" className={controls.btnPrimary} onClick={onClose}>{trT('close')}</button>
      </>}>
      <div className={styles.stack} data-recycle-bin>
        <p className={styles.muted}>{trT('binIntro', { days })} {trT('binLimit')}</p>
        <div className={styles.inline}>
          <label className={controls.field} style={{ flex: '1 1 14rem' }}>
            <span className={controls.label}>{trT('binSearch')}</span>
            <input className={controls.input} type="search" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          {can('settings.manage') && (
            <label className={controls.field}>
              <span className={controls.label}>{trT('binRetention')}</span>
              <SelectField className={controls.select} value={days} onChange={(e) => {
                try {
                  setBinRetentionDays(Number(e.target.value));
                  setDays(binRetentionDays());
                } catch (err) {
                  setError(trErr(err));
                }
              }}>
                {[BIN_RETENTION.min, 14, BIN_RETENTION.days, 60, BIN_RETENTION.max].map((d) => <option key={d} value={d}>{trT('binDays', { n: d })}</option>)}
              </SelectField>
            </label>
          )}
        </div>
        {pending && (
          <div className={styles.inline} role="group" aria-label={pending.kind === 'unlock' ? trT('binUnlock') : trT('binPin')}>
            <span className={styles.note}>{pending.kind === 'unlock' ? trT('binUnlock') : trT('binPin')}</span>
            <input type="password" inputMode="numeric" className={controls.input} style={{ maxWidth: '8rem' }} aria-label="PIN" placeholder="PIN" value={pin} onChange={(e) => setPin(e.target.value)} />
            <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={pin.length < 4} onClick={() => void confirmPin()}><KeyRound size={14} aria-hidden="true" /> {pending.kind === 'unlock' ? trT('binUnlockGo') : trT('binDeleteForGood')}</button>
            <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => { setPending(null); setPin(''); }}>{trT('cancel')}</button>
          </div>
        )}
        {error && <p className={controls.error} role="alert">{error}</p>}
        {!shown.length ? <p className={styles.muted}>{trT('binEmpty')}</p> : (
          <div className={styles.tableWrap}>
            <table className={styles.table} data-testid="bin-table">
              <thead><tr><th>{trT('colWhat')}</th><th>{trT('colNumber')}</th><th>{trT('colDeleted')}</th><th>{trT('colBy')}</th><th /></tr></thead>
              <tbody>
                {shown.map((e) => {
                  const d = describeEntry(e);
                  const plan = planRestore(e, (t) => peekTable(t), peekTable<BinEntry>(BIN_TABLE));
                  return (
                    <tr key={e.id} data-bin-row={d.number || e.row_id}>
                      <td>
                        {d.label}{d.name ? <div className={styles.muted}>{d.name}</div> : null}
                        {/* QA6-1 F1: the module that owns the row refuses — say why and where to redo it. */}
                        {plan.refusal === 'module' && <div className={styles.note} data-bin-refusal>{plan.message}</div>}
                      </td>
                      <td>{d.number || '-'}{d.day ? <div className={styles.muted}>{d.day}</div> : null}</td>
                      <td>{when(e.deleted_at)}</td>
                      <td>{e.deleted_by ?? '-'}</td>
                      <td>
                        <div className={styles.actions}>
                          {plan.refusal === 'parentMissing' && plan.parentEntry ? (
                            <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => restore(e, { withParent: true })}><Undo2 size={14} aria-hidden="true" /> {trT('binRestoreBoth')}</button>
                          ) : (
                            <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={plan.refusal === 'module'} onClick={() => restore(e)} aria-label={`${trT('binRestore')} ${d.number || d.label}`}><Undo2 size={14} aria-hidden="true" /> {trT('binRestore')}</button>
                          )}
                          {plan.children.length > 0 && <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => restore(e, { withChildren: true })}>{trT('binRestoreWith', { n: plan.children.length })}</button>}
                          {owner && <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} aria-label={`${trT('binDeleteForGood')} ${d.number || d.label}`} onClick={() => void remove([e.id])}><Trash2 size={14} aria-hidden="true" /></button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

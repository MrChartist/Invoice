/**
 * R4-C2 IRMs & e-BRC: bank inward remittances typed or imported, matched to export invoices (one IRM can split over
 * invoices, one invoice can take many IRMs), with the e-BRC number / date / status per IRM.
 */
import { lazy, Suspense, useMemo, useState } from 'react';
import { Trash2, Upload } from 'lucide-react';
import type { ExportIrm, IrmAllocation, EbrcStatus } from '../../types/trade-r4';
import { Modal } from '../ui/Modal';
import { NumberInput } from '../ui/NumberInput';
import { can } from '../../lib/access';
import { round2 } from '../../lib/invoice-calc';
import { formatDate, todayInput } from '../../lib/utils';
import { allocationProblems, autoAllocate, irmsDb, suggestMatches, type RealisationRow } from '../../lib/trade/export-register';
import { useT } from '../../i18n';
import { trErr, trT, type TrKey } from '../../i18n/areas/trade-trust-r4';
import controls from '../../styles/controls.module.css';
import styles from './trade.module.css';
import { money, type Notify } from './desk-shared';

const IrmImport = lazy(() => import('./IrmImport'));

export default function IrmsTab({ rows, notify, changed }: { rows: RealisationRow[]; notify: Notify; changed: () => void }) {
  useT();
  const [version, setVersion] = useState(0);
  const irms = useMemo(() => (version >= 0 ? irmsDb.all().sort((a, b) => b.date.localeCompare(a.date)) : []), [version]);
  const [editing, setEditing] = useState<Partial<ExportIrm> | null>(null);
  const [importing, setImporting] = useState(false);
  const canBooks = can('books.edit');
  const refresh = () => {
    setVersion((v) => v + 1);
    changed();
  };
  return (
    <>
      {canBooks && (
        <div className={styles.actions}>
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setEditing({ date: todayInput(), currency: rows[0]?.currency ?? 'USD', allocations: [] })}>{trT('irmAdd')}</button>
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setImporting(true)}><Upload size={14} aria-hidden="true" /> {trT('irmImport')}</button>
        </div>
      )}
      {!irms.length ? <p className={styles.muted}>{trT('irmNone')}</p> : (
        <div className={styles.tableWrap}>
          <table className={styles.table} data-testid="irm-table">
            <thead><tr><th>{trT('irmNo')}</th><th>{trT('irmDate')}</th><th>{trT('irmRemitter')}</th><th className={styles.num}>{trT('irmAmount')}</th><th>{trT('irmAlloc')}</th><th>{trT('colEbrc')}</th><th /></tr></thead>
            <tbody>
              {irms.map((r) => {
                const used = round2(r.allocations.reduce((s, a) => s + a.fcy, 0));
                return (
                  <tr key={r.id}>
                    <td>{r.irm_no}<div className={styles.muted}>{r.bank ?? ''}{r.purpose ? ` · ${r.purpose}` : ''}</div></td>
                    <td>{formatDate(r.date)}</td>
                    <td>{r.remitter ?? ''}</td>
                    <td className={styles.num}>{money(r.fcy, r.currency)}</td>
                    <td>
                      {r.allocations.map((a) => <div key={a.invoice_id}>{rows.find((x) => x.invoiceId === a.invoice_id)?.number ?? '-'} · {money(a.fcy, r.currency)}</div>)}
                      {used < r.fcy - 0.005 && <div className={styles.warn}>{trT('irmUnallocated', { amount: money(round2(r.fcy - used), r.currency) })}</div>}
                    </td>
                    <td>{r.ebrc_no ? `${r.ebrc_no} · ${trT(`ebrc_${r.ebrc_status ?? 'pending'}`)}` : '-'}</td>
                    <td>
                      {canBooks && <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setEditing({ ...r })}>{trT('edit')}</button>}
                      {canBooks && (
                        <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} aria-label={`${trT('remove')} ${r.irm_no}`} onClick={() => {
                          try {
                            irmsDb.remove(r.id);
                            refresh();
                            notify(trT('irmRemoved'));
                          } catch (err) {
                            notify(trErr(err), 'error');
                          }
                        }}><Trash2 size={14} aria-hidden="true" /></button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && <IrmForm initial={editing} rows={rows} onClose={() => setEditing(null)} onSaved={(irm) => { setEditing(null); refresh(); notify(trT('irmSaved', { number: irm.irm_no })); }} />}
      {importing && <Suspense fallback={null}><IrmImport onClose={() => setImporting(false)} onDone={(n) => { setImporting(false); refresh(); notify(trT('importDone', { n })); }} /></Suspense>}
    </>
  );
}

function IrmForm({ initial, rows, onClose, onSaved }: { initial: Partial<ExportIrm>; rows: RealisationRow[]; onClose: () => void; onSaved: (irm: ExportIrm) => void }) {
  const [f, setF] = useState<Partial<ExportIrm>>(initial);
  const [error, setError] = useState('');
  const allocations = f.allocations ?? [];
  const set = (patch: Partial<ExportIrm>) => setF((x) => ({ ...x, ...patch }));
  const setAlloc = (list: IrmAllocation[]) => set({ allocations: list });
  const probe = { currency: String(f.currency ?? ''), fcy: Number(f.fcy) || 0, date: f.date ?? '', remitter: f.remitter };
  const suggestions = suggestMatches(probe, rows).filter((s) => !allocations.some((a) => a.invoice_id === s.invoiceId)).slice(0, 5);
  const problems = allocationProblems({ id: f.id ?? '', fcy: probe.fcy, currency: probe.currency }, allocations, rows);
  const save = () => {
    if (problems.length) return setError(trT(problems[0] as TrKey));
    try {
      onSaved(irmsDb.save({ ...(f as ExportIrm), allocations }));
    } catch (err) {
      setError(trErr(err));
    }
  };
  const field = (k: 'irm_no' | 'bank' | 'purpose' | 'remitter' | 'ebrc_no', label: string) => (
    <label className={`${controls.field} ${styles.grow}`}><span className={controls.label}>{label}</span><input className={controls.input} value={(f[k] as string | undefined) ?? ''} onChange={(e) => set({ [k]: e.target.value || undefined })} /></label>
  );
  return (
    <Modal open onClose={onClose} size="lg" title={f.id ? `${trT('irmNo')} ${f.irm_no ?? ''}` : trT('irmAdd')}
      footer={<><button type="button" className={controls.btnOutline} onClick={onClose}>{trT('cancel')}</button><button type="button" className={controls.btnPrimary} onClick={save} data-testid="irm-save">{trT('irmSave')}</button></>}>
      <div className={styles.stack}>
        <div className={styles.inline}>
          {field('irm_no', trT('irmNo'))}
          <label className={`${controls.field} ${styles.narrow}`}><span className={controls.label}>{trT('irmDate')}</span><input className={controls.input} type="date" value={f.date ?? ''} onChange={(e) => set({ date: e.target.value })} /></label>
          <label className={`${controls.field} ${styles.narrow}`}><span className={controls.label}>{trT('irmCurrency')}</span><input className={`${controls.input} ${controls.inputMono}`} maxLength={3} value={f.currency ?? ''} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} /></label>
          <label className={`${controls.field} ${styles.narrow}`}><span className={controls.label}>{trT('irmAmount')}</span><NumberInput className={`${controls.input} ${controls.inputNumeric}`} value={Number(f.fcy) || 0} onChange={(n) => set({ fcy: n })} /></label>
        </div>
        <div className={styles.inline}>
          {field('bank', trT('irmBank'))}
          {field('purpose', trT('irmPurpose'))}
          {field('remitter', trT('irmRemitter'))}
        </div>
        <div className={styles.panel}>
          <strong>{trT('irmAlloc')}</strong>
          {allocations.map((a, i) => (
            <div key={a.invoice_id} className={styles.inline}>
              <span className={styles.grow}>{rows.find((r) => r.invoiceId === a.invoice_id)?.number ?? a.invoice_id}</span>
              <NumberInput className={`${controls.input} ${controls.inputNumeric} ${styles.narrow}`} aria-label={trT('irmAmount')} value={a.fcy} onChange={(n) => setAlloc(allocations.map((x, j) => (j === i ? { ...x, fcy: n } : x)))} />
              <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} aria-label={trT('remove')} onClick={() => setAlloc(allocations.filter((_, j) => j !== i))}><Trash2 size={14} aria-hidden="true" /></button>
            </div>
          ))}
          {suggestions.length > 0 && (
            <div className={styles.inline}>
              <span className={styles.muted}>{trT('irmSuggest')}:</span>
              {suggestions.map((s) => (
                <button key={s.invoiceId} type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => {
                  const left = round2(probe.fcy - allocations.reduce((t, a) => t + a.fcy, 0));
                  setAlloc([...allocations, { invoice_id: s.invoiceId, fcy: Math.max(Math.min(left, s.outstandingFcy), 0) }]);
                }}>{trT('irmAddAlloc')} {s.number} · {money(s.outstandingFcy, probe.currency || 'INR')}</button>
              ))}
              <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setAlloc(autoAllocate(probe, rows))}>{trT('irmAuto')}</button>
            </div>
          )}
        </div>
        <div className={styles.inline}>
          {field('ebrc_no', trT('ebrcNo'))}
          <label className={`${controls.field} ${styles.narrow}`}><span className={controls.label}>{trT('ebrcDate')}</span><input className={controls.input} type="date" value={f.ebrc_date ?? ''} onChange={(e) => set({ ebrc_date: e.target.value || undefined })} /></label>
          <label className={`${controls.field} ${styles.narrow}`}>
            <span className={controls.label}>{trT('ebrcStatus')}</span>
            <select className={controls.select} value={f.ebrc_status ?? 'pending'} onChange={(e) => set({ ebrc_status: e.target.value as EbrcStatus })}>
              <option value="pending">{trT('ebrc_pending')}</option>
              <option value="self_certified">{trT('ebrc_self_certified')}</option>
            </select>
          </label>
        </div>
        {error && <p className={controls.error} role="alert">{error}</p>}
      </div>
    </Modal>
  );
}

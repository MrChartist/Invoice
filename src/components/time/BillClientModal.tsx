import { Suspense, lazy, useMemo, useState } from 'react';
import type { TimePrefs } from '../../types/time';
import { billUnbilled, buildBillLines, currentLiveInvoiceIds, timeDb, unbilledFor, unbilledTime, type BillSelection } from '../../lib/timesheets';
import { num, round2 } from '../../lib/invoice-calc';
import { formatCurrency, formatDate, formatQuantity } from '../../lib/utils';
import { localDb } from '../../lib/localDb';
import { loadCostCentres } from '../../lib/cost-centres';
import { commitReRate, loadWorkTypes, reRate } from '../../lib/rate-cards';
import { loadTasks } from '../../lib/projects';
import { clientKey } from '../../lib/timesheets';
import { Modal } from '../ui/Modal';
import { RateSourceTag } from './rate-ui';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './time.module.css';
import { useT } from '../../i18n';
import { timeT } from '../../i18n/areas/time';
import { svcT } from '../../i18n/areas/service-r3';
import { isPackOn } from '../../lib/industry-packs';
// R14 (PS-A): professional rows, only while the `practice` pack is on (one small lazy chunk).
const PreBillLink = lazy(() => import('../prof/ProfRows').then((m) => ({ default: m.PreBillLink })));

/** Preview and create a new draft invoice from a client's unbilled time, costs and trips. */
export function BillClientModal({ target, prefs, onClose, onCreated }: {
  /** `projectId` (R3-B2 "Bill project") limits the selection to one project. */
  target: { key: string; name: string; projectId?: string } | null;
  prefs: TimePrefs;
  onClose: () => void;
  onCreated: (invoiceId: string, invoiceNumber: string) => void;
}) {
  useT(); // re-render on a language switch (5.4)
  return (
    <Modal open={!!target} onClose={onClose} size="lg" title={target ? timeT('billTitle', { name: target.name }) : timeT('bill')} subtitle={timeT('billSub')}>
      {target && <BillForm key={`${target.key}|${target.projectId ?? ''}`} clientKey={target.key} projectId={target.projectId} prefs={prefs} onClose={onClose} onCreated={onCreated} />}
    </Modal>
  );
}

function BillForm({ clientKey: key, projectId, prefs, onClose, onCreated }: {
  clientKey: string;
  projectId?: string;
  prefs: TimePrefs;
  onClose: () => void;
  onCreated: (invoiceId: string, invoiceNumber: string) => void;
}) {
  const [version, setVersion] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const all = useMemo(() => unbilledFor(key, currentLiveInvoiceIds(), { projectId, prefs }), [key, projectId, prefs, version]);
  const [include, setInclude] = useState({ time: true, expenses: true, mileage: true });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const centres = useMemo(() => loadCostCentres(), []);
  const workTypes = useMemo(() => loadWorkTypes(), []);
  // R3-B4: the annexure is ticked by default when the client's document defaults ask for it (R3-B5).
  const master = useMemo(() => localDb.clients.getById(key), [key]);
  const [annexure, setAnnexure] = useState(!!master?.doc_defaults?.annexure);
  const [showReRate, setShowReRate] = useState(false);

  const selection = useMemo<BillSelection>(() => ({
    time: include.time ? all.time : [],
    expenses: include.expenses ? all.expenses : [],
    mileage: include.mileage ? all.mileage : [],
  }), [all, include]);
  const lines = useMemo(() => buildBillLines(selection, prefs, centres, workTypes), [selection, prefs, centres, workTypes]);
  const taxable = round2(lines.reduce((s, l) => s + num(l.amount), 0));
  const gst = round2(lines.reduce((s, l) => s + (num(l.amount) * num(l.tax_rate)) / 100, 0));

  // R3-B1 "Re-rate unbilled": the client's unbilled entries (raw rows, before retainer copies) vs the current cards.
  const changes = useMemo(() => {
    if (!showReRate) return [];
    const unbilled = unbilledTime(timeDb.all(), currentLiveInvoiceIds()).filter((e) => clientKey(e) === key);
    return reRate(unbilled, { tasks: loadTasks(), centres, clients: localDb.clients.getAll(), workTypes, prefs });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showReRate, key, centres, workTypes, prefs, version]);

  const applyReRate = () => {
    try {
      const n = commitReRate(changes);
      setNotice(svcT('reRateDone', { n }) + (n < changes.length ? ` ${svcT('reRateLocked')}` : ''));
      setShowReRate(false);
      setVersion((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const create = () => {
    try {
      const inv = billUnbilled(key, selection, prefs, { annexure: annexure && selection.time.length + selection.expenses.length > 0 });
      onCreated(inv.id, inv.invoice_number);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const toggle = (k: keyof typeof include) => setInclude((v) => ({ ...v, [k]: !v[k] }));

  return (
    <div className={styles.form}>
      <div className={styles.includeRow}>
        <label className={controls.check}>
          <input type="checkbox" checked={include.time} disabled={!all.time.length} onChange={() => toggle('time')} />
          {all.time.length === 1 ? timeT('incTimeOne') : timeT('incTimeMany', { n: all.time.length })}
        </label>
        <label className={controls.check}>
          <input type="checkbox" checked={include.expenses} disabled={!all.expenses.length} onChange={() => toggle('expenses')} />
          {timeT('incExpenses', { n: all.expenses.length })}
        </label>
        <label className={controls.check}>
          <input type="checkbox" checked={include.mileage} disabled={!all.mileage.length} onChange={() => toggle('mileage')} />
          {all.mileage.length === 1 ? timeT('incMileageOne') : timeT('incMileageMany', { n: all.mileage.length })}
        </label>
      </div>

      {lines.length ? (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead>
              <tr><th>{timeT('line')}</th><th className={surface.numeric}>{timeT('qty')}</th><th className={surface.numeric}>{timeT('rate')}</th><th className={surface.numeric}>{timeT('gst')}</th><th className={surface.numeric}>{timeT('amount')}</th></tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    <div>{l.name}</div>
                    {l.description && <div className={styles.muted}>{l.description}</div>}
                  </td>
                  <td className={surface.numeric}>{formatQuantity(l.quantity)} {l.unit}</td>
                  <td className={surface.numeric}>{formatCurrency(l.rate)}</td>
                  <td className={surface.numeric}>{num(l.tax_rate)}%</td>
                  <td className={surface.numeric}>{formatCurrency(l.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className={styles.muted}>{timeT('nothingSelected')}</p>
      )}

      <div className={styles.billTotals}>
        <span>{timeT('taxable', { amount: formatCurrency(taxable) })}</span>
        <span>{timeT('gstAbout', { amount: formatCurrency(gst) })}</span>
      </div>
      <p className={styles.muted}>
        {timeT('billNote', {
          rule: prefs.round_mode === 'none' || !prefs.round_increment
            ? timeT('roundExact')
            : timeT('roundRule', { mode: prefs.round_mode === 'up' ? timeT('modeUp') : timeT('modeNearest'), n: prefs.round_increment }),
          sac: prefs.sac,
        })}
      </p>

      {/* R3-B4 */}
      <label className={controls.check} title={svcT('annexureHint')}>
        <input type="checkbox" checked={annexure} onChange={(e) => setAnnexure(e.target.checked)} data-attach-annexure />
        {svcT('attachAnnexure')}
      </label>

      {/* R3-B1 */}
      <div>
        <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} aria-expanded={showReRate} onClick={() => setShowReRate((v) => !v)} data-rerate>
          {svcT('reRate')}
        </button>
        {showReRate && (
          <div className={styles.form}>
            <p className={styles.muted}>{svcT('reRateIntro')}</p>
            {changes.length ? (
              <div className={surface.tableWrap}>
                <table className={surface.table}>
                  <thead><tr><th>{svcT('date')}</th><th>{timeT('work')}</th><th className={surface.numeric}>{svcT('from')}</th><th className={surface.numeric}>{svcT('to')}</th><th>{svcT('source')}</th></tr></thead>
                  <tbody>
                    {changes.map((c) => (
                      <tr key={c.id}>
                        <td>{formatDate(c.date)}</td>
                        <td>{c.description || '-'}</td>
                        <td className={surface.numeric}>{formatCurrency(c.from)}</td>
                        <td className={surface.numeric}>{formatCurrency(c.to)}</td>
                        <td><RateSourceTag source={c.source} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className={styles.muted}>{svcT('reRateNone')}</p>
            )}
            {changes.length > 0 && (
              <div className={styles.actions}>
                <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={applyReRate}>{svcT('reRateApply', { n: changes.length })}</button>
              </div>
            )}
          </div>
        )}
      </div>

      {notice && <p className={styles.muted} role="status">{notice}</p>}
      {error && <p className={styles.formError} role="alert">{error}</p>}
      <div className={styles.actions}>
        {isPackOn(localDb.settings.get(), 'practice') && <Suspense fallback={null}><PreBillLink clientKey={key} projectId={projectId} /></Suspense>}
        <button type="button" className={controls.btnOutline} onClick={onClose}>{timeT('cancel')}</button>
        <button type="button" className={controls.btnPrimary} disabled={!lines.length} onClick={create}>{timeT('createDraft')}</button>
      </div>
    </div>
  );
}

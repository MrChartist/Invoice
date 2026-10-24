import { useMemo, useState } from 'react';
import type { TimePrefs } from '../../types/time';
import { billUnbilled, buildBillLines, unbilledFor, type BillSelection } from '../../lib/timesheets';
import { num, round2 } from '../../lib/invoice-calc';
import { formatCurrency, formatQuantity } from '../../lib/utils';
import { Modal } from '../ui/Modal';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './time.module.css';

/** Preview and create a new draft invoice from a client's unbilled time, costs and trips. */
export function BillClientModal({ target, prefs, onClose, onCreated }: {
  target: { key: string; name: string } | null;
  prefs: TimePrefs;
  onClose: () => void;
  onCreated: (invoiceId: string, invoiceNumber: string) => void;
}) {
  return (
    <Modal open={!!target} onClose={onClose} size="lg" title={target ? `Bill ${target.name}` : 'Bill'} subtitle="Creates a new draft invoice you can review before sending.">
      {target && <BillForm key={target.key} clientKey={target.key} prefs={prefs} onClose={onClose} onCreated={onCreated} />}
    </Modal>
  );
}

function BillForm({ clientKey, prefs, onClose, onCreated }: {
  clientKey: string;
  prefs: TimePrefs;
  onClose: () => void;
  onCreated: (invoiceId: string, invoiceNumber: string) => void;
}) {
  const all = useMemo(() => unbilledFor(clientKey), [clientKey]);
  const [include, setInclude] = useState({ time: true, expenses: true, mileage: true });
  const [error, setError] = useState('');

  const selection = useMemo<BillSelection>(() => ({
    time: include.time ? all.time : [],
    expenses: include.expenses ? all.expenses : [],
    mileage: include.mileage ? all.mileage : [],
  }), [all, include]);
  const lines = useMemo(() => buildBillLines(selection, prefs), [selection, prefs]);
  const taxable = round2(lines.reduce((s, l) => s + num(l.amount), 0));
  const gst = round2(lines.reduce((s, l) => s + (num(l.amount) * num(l.tax_rate)) / 100, 0));

  const create = () => {
    try {
      const inv = billUnbilled(clientKey, selection, prefs);
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
          Time ({all.time.length} {all.time.length === 1 ? 'entry' : 'entries'})
        </label>
        <label className={controls.check}>
          <input type="checkbox" checked={include.expenses} disabled={!all.expenses.length} onChange={() => toggle('expenses')} />
          Expenses ({all.expenses.length})
        </label>
        <label className={controls.check}>
          <input type="checkbox" checked={include.mileage} disabled={!all.mileage.length} onChange={() => toggle('mileage')} />
          Mileage ({all.mileage.length} {all.mileage.length === 1 ? 'trip' : 'trips'})
        </label>
      </div>

      {lines.length ? (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead>
              <tr><th>Line</th><th className={surface.numeric}>Qty</th><th className={surface.numeric}>Rate</th><th className={surface.numeric}>GST</th><th className={surface.numeric}>Amount</th></tr>
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
        <p className={styles.muted}>Nothing selected to bill.</p>
      )}

      <div className={styles.billTotals}>
        <span>Taxable {formatCurrency(taxable)}</span>
        <span>GST about {formatCurrency(gst)}</span>
      </div>
      <p className={styles.muted}>
        Time is rounded per entry ({prefs.round_mode === 'none' || !prefs.round_increment ? 'exact minutes' : `${prefs.round_mode} ${prefs.round_increment} min`})
        and billed in hours (SAC {prefs.sac}). Re-billed costs and mileage are part of the taxable supply; pure-agent
        reimbursements are 0% lines. The invoice works out CGST/SGST or IGST from the client&apos;s state — verify with your CA.
      </p>
      {error && <p className={styles.formError} role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="button" className={controls.btnOutline} onClick={onClose}>Cancel</button>
        <button type="button" className={controls.btnPrimary} disabled={!lines.length} onClick={create}>Create draft invoice</button>
      </div>
    </div>
  );
}

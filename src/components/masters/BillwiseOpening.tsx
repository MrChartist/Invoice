/**
 * "Bill-wise Details for: <party>" (Tally, opening New Refs). The bills feed receivables ageing /
 * statements (and WIP-C bill-wise payables through `openingBillsFor`); their total should equal
 * the party's opening balance — any remainder is shown as On Account, never hidden.
 */
import { useId, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { can } from '../../lib/access';
import { findLedger, loadMasters, loadOpenings, openingBalance, parsePartyLedgerId, saveOpenings } from '../../lib/ledger';
import { billsTotal, loadOpeningBills, openingBillsFor, saveOpeningBillsFor, type OpeningBillDraft } from '../../lib/opening-bills';
import { formatMoney } from '../../lib/utils';
import { useT } from '../../i18n';
import { mastersT } from '../../i18n/areas/masters';
import { MasterFrame } from './shared';
import { paiseText, parsePaise } from './masters-utils';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './masters.module.css';
import { DateField } from '../ui/DateField';
import { SelectField } from '../ui/SelectField';

export interface BillwiseOpeningProps {
  /** Party ledger id (`party:debtor:<clientId>` / `party:creditor:<vendorId>`). */
  ledgerId: string;
  onDone: () => void;
  onBack: () => void;
  notify?: (msg: string, tone?: 'success' | 'error') => void;
}

interface Row extends Omit<OpeningBillDraft, 'amount' | 'credit_days'> {
  key: number;
  amount: string;
  credit_days: string;
}

let seq = 0;
const drcrText = (rupees: number) => `${formatMoney(Math.abs(rupees))} ${rupees >= 0 ? 'Dr' : 'Cr'}`;

export function BillwiseOpening({ ledgerId, onDone, onBack, notify }: BillwiseOpeningProps) {
  useT();
  const uid = useId();
  const parsed = parsePartyLedgerId(ledgerId);
  const ledger = useMemo(() => findLedger(ledgerId, loadMasters()), [ledgerId]);
  const side = parsed?.side === 'creditor' ? 'payable' : 'receivable';
  const defaultDrCr = side === 'payable' ? 'Cr' : 'Dr';
  const opening = openingBalance(ledgerId, undefined, loadOpenings());
  const [rows, setRows] = useState<Row[]>(() => {
    const stored = parsed ? openingBillsFor(parsed.id, side, loadOpeningBills()) : [];
    const list = stored.map((b) => ({ key: ++seq, id: b.id, ref_no: b.ref_no, date: b.date, due_date: b.due_date ?? '', credit_days: '', amount: b.amount.toFixed(2), dr_cr: b.dr_cr }));
    return list.length ? list : [{ key: ++seq, ref_no: '', date: '', due_date: '', credit_days: '', amount: opening ? paiseText(opening) : '', dr_cr: opening < 0 ? 'Cr' : opening > 0 ? 'Dr' : defaultDrCr }];
  });
  const [syncOpening, setSyncOpening] = useState(true);
  const [error, setError] = useState('');
  const readOnly = !can('books.edit');

  const drafts: OpeningBillDraft[] = rows
    .filter((r) => r.ref_no.trim() || r.amount.trim())
    .map((r) => ({
      id: r.id,
      ref_no: r.ref_no,
      date: r.date,
      due_date: r.due_date || undefined,
      credit_days: parseInt(r.credit_days, 10) || undefined,
      amount: parsePaise(r.amount) / 100,
      dr_cr: r.dr_cr,
    }));
  const total = billsTotal(drafts);
  const onAccount = Math.round(opening - total * 100) / 100;

  const set = (key: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const accept = () => {
    if (!parsed || !ledger || readOnly) return onBack();
    try {
      saveOpeningBillsFor({ id: parsed.id, name: ledger.name, side }, drafts);
      const totalPaise = Math.round(total * 100);
      if (syncOpening && totalPaise !== opening) saveOpenings([{ ledger_id: ledgerId, amount: totalPaise, party_name: ledger.name }]);
      notify?.(mastersT('saved', { name: ledger.name }));
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  if (!parsed || !ledger) {
    return (
      <MasterFrame title={mastersT('billwise')} keys={{ onAccept: onBack, onBack }}>
        <p className={styles.note}>{mastersT('noMatches')}</p>
      </MasterFrame>
    );
  }

  return (
    <MasterFrame
      title={mastersT('billwiseFor', { name: ledger.name })}
      keys={{ onAccept: accept, onBack }}
      actions={
        <>
          {!readOnly && (
            <button type="button" className={`${controls.btn} ${controls.btnPrimary}`} onClick={accept}>
              {mastersT('accept')} (Ctrl+A)
            </button>
          )}
          <button type="button" className={`${controls.btn} ${controls.btnOutline}`} onClick={onBack}>
            {mastersT('back')} (Esc)
          </button>
        </>
      }
    >
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead>
            <tr>
              <th scope="col">{mastersT('typeOfRef')}</th>
              <th scope="col">{mastersT('refName')}</th>
              <th scope="col">{mastersT('billDate')}</th>
              <th scope="col">{mastersT('dueDate')}</th>
              <th scope="col">{mastersT('creditDays')}</th>
              <th scope="col" className={surface.numeric}>{mastersT('amount')}</th>
              <th scope="col">{mastersT('dr')} / {mastersT('cr')}</th>
              <th scope="col"><span className={surface.srOnly}>{mastersT('delete')}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.key}>
                <td>{mastersT('newRef')}</td>
                <td><input className={`${controls.input} ${styles.cellText}`} aria-label={`Bill ${i + 1} reference`} value={r.ref_no} readOnly={readOnly} autoFocus={i === 0} onChange={(e) => set(r.key, { ref_no: e.target.value })} /></td>
                <td><DateField className={controls.input} aria-label={`Bill ${i + 1} date`} value={r.date} readOnly={readOnly} onChange={(e) => set(r.key, { date: e.target.value })} /></td>
                <td><DateField className={controls.input} aria-label={`Bill ${i + 1} due date`} value={r.due_date ?? ''} readOnly={readOnly} onChange={(e) => set(r.key, { due_date: e.target.value })} /></td>
                <td><input className={`${controls.input} ${styles.cellInput}`} inputMode="numeric" aria-label={`Bill ${i + 1} credit days`} value={r.credit_days} readOnly={readOnly} onChange={(e) => set(r.key, { credit_days: e.target.value })} /></td>
                <td><input className={`${controls.input} ${styles.cellInput}`} inputMode="decimal" aria-label={`Bill ${i + 1} amount`} value={r.amount} readOnly={readOnly} onChange={(e) => set(r.key, { amount: e.target.value })} /></td>
                <td>
                  <SelectField className={`${controls.select} ${styles.drcr}`} aria-label={`Bill ${i + 1} Dr / Cr`} value={r.dr_cr} disabled={readOnly} onChange={(e) => set(r.key, { dr_cr: e.target.value === 'Cr' ? 'Cr' : 'Dr' })}>
                    <option value="Dr">{mastersT('dr')}</option>
                    <option value="Cr">{mastersT('cr')}</option>
                  </SelectField>
                </td>
                <td>
                  {!readOnly && (
                    <button type="button" className={controls.btnIcon} aria-label={mastersT('removeBill', { n: i + 1 })} onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>
                      <Trash2 size={16} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>{mastersT('billsTotal')}</td>
              <td className={surface.numeric}>{drcrText(total)}</td>
              <td colSpan={2} />
            </tr>
            <tr>
              <td colSpan={5}>{mastersT('ledgerOpening')}</td>
              <td className={surface.numeric}>{drcrText(opening / 100)}</td>
              <td colSpan={2} />
            </tr>
            {Math.abs(onAccount) >= 0.005 && (
              <tr>
                <td colSpan={5}>{mastersT('onAccount')}</td>
                <td className={surface.numeric}>{drcrText(onAccount)}</td>
                <td colSpan={2} />
              </tr>
            )}
          </tfoot>
        </table>
      </div>
      {!readOnly && (
        <div className={styles.inline}>
          <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => setRows((rs) => [...rs, { key: ++seq, ref_no: '', date: rs[rs.length - 1]?.date ?? '', due_date: '', credit_days: '', amount: '', dr_cr: defaultDrCr }])}>
            <Plus size={14} /> {mastersT('addBill')}
          </button>
          <label className={controls.check} htmlFor={`${uid}-sync`}>
            <input id={`${uid}-sync`} type="checkbox" checked={syncOpening} onChange={(e) => setSyncOpening(e.target.checked)} /> {mastersT('setOpeningToBills')}
          </label>
        </div>
      )}
      <p className={styles.note}>{mastersT('billsHint')}</p>
      {error && (
        <div className={controls.error} role="alert">
          {error}
        </div>
      )}
    </MasterFrame>
  );
}

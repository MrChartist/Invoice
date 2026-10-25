import { useMemo, useState } from 'react';
import { Download, Plus, Save, Trash2 } from 'lucide-react';
import {
  HEADS4,
  buildGstr4Annual,
  gstr4AnnualRows,
  loadGstr4Manual,
  saveGstr4Manual,
  type Gstr4Manual,
  type Head4,
  type RefundEntry,
  type TdsTcsEntry,
} from '../../lib/gstr4-annual';
import { loadFiled } from '../../lib/compliance';
import { toCsv } from '../../lib/gstr-json';
import { todayIso, type CompositionKind } from '../../lib/tax-rules';
import { downloadText } from '../../lib/download';
import { generateId } from '../../lib/storage';
import type { InvoiceRecord } from '../../types/invoice';
import { NumberInput } from '../ui/NumberInput';
import { DataTable, Money } from './DataTable';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import local from './gst-reports.module.css';

export interface Gstr4AnnualViewProps {
  invoices: InvoiceRecord[];
  purchases: unknown[];
  fyStart: number;
  gstin: string;
  filerStateCode: string;
  category?: CompositionKind;
  notify?: (msg: string, kind?: 'success' | 'error') => void;
}

const HEAD_LABEL: Record<Head4, string> = { igst: 'Integrated tax', cgst: 'Central tax', sgst: 'State / UT tax', cess: 'Cess' };
const REFUND_KEYS: (keyof RefundEntry)[] = ['tax', 'interest', 'penalty', 'fee', 'other'];

/**
 * GSTR-4 Tables 7 (TDS / TCS credit), 8 (tax, interest, late fee payable and paid) and 9 (refund claimed), with
 * CMP-08 interest and GSTR-4 late-fee estimates. Typed-in values are saved per FY × GSTIN (`gstr4_manual`).
 */
export default function Gstr4AnnualView({ invoices, purchases, fyStart, gstin, filerStateCode, category, notify }: Gstr4AnnualViewProps) {
  const [manual, setManual] = useState<Gstr4Manual>(() => loadGstr4Manual(fyStart, gstin));
  const [loadedFor, setLoadedFor] = useState(`${fyStart}|${gstin}`);
  if (loadedFor !== `${fyStart}|${gstin}`) {
    setLoadedFor(`${fyStart}|${gstin}`);
    setManual(loadGstr4Manual(fyStart, gstin));
  }
  const today = todayIso();
  const annual = useMemo(
    () => buildGstr4Annual(invoices, purchases, fyStart, manual, { gstin, filerStateCode, category, filed: loadFiled(), asOf: today }),
    [invoices, purchases, fyStart, manual, gstin, filerStateCode, category, today],
  );

  const setHead = (field: 'tax_paid' | 'interest_paid' | 'late_fee_paid', h: Head4, v: number) =>
    setManual((m) => ({ ...m, [field]: { ...(m[field] ?? {}), [h]: v } }));
  const setRefund = (h: Head4, k: keyof RefundEntry, v: number) =>
    setManual((m) => ({ ...m, refund: { ...(m.refund ?? {}), [h]: { ...(m.refund?.[h] ?? {}), [k]: v } } }));
  const setEntry = (id: string, patch: Partial<TdsTcsEntry>) =>
    setManual((m) => ({ ...m, tds_tcs: (m.tds_tcs ?? []).map((e) => (e.id === id ? { ...e, ...patch } : e)) }));

  const save = () => {
    try {
      saveGstr4Manual(manual);
      notify?.('GSTR-4 entries saved');
    } catch (err) {
      notify?.((err as Error).message || 'Could not save', 'error');
    }
  };

  const num = (value: number, onChange: (n: number) => void, label: string) => (
    <NumberInput className={`${controls.input} ${controls.inputNumeric}`} value={value} onChange={onChange} aria-label={label} />
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-gstr4-annual>
      <div className={local.toolbar}>
        <h3 className={local.tbHeading}>GSTR-4 Tables 7–9 · interest and late fee (estimates)</h3>
        <button type="button" className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`} onClick={save}>
          <Save size={14} aria-hidden /> Save entries
        </button>
        <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`}
          onClick={() => downloadText(`GSTR4_T7-9_${gstin || 'all'}_FY${fyStart}.csv`, toCsv(gstr4AnnualRows(annual)), 'text/csv')}>
          <Download size={14} aria-hidden /> Download CSV
        </button>
      </div>

      <h4 className={local.tbHeading}>Table 7 — TDS / TCS credit received</h4>
      <DataTable
        caption="TCS estimate from documents"
        emptyText="No documents marked as sold through an operator that collects TCS."
        rows={annual.table7.tcsEstimate}
        rowKey={(r) => r.etin}
        columns={[
          { key: 'g', label: 'Operator GSTIN (estimate)', render: (r) => <span className={surface.mono}>{r.etin}</span> },
          { key: 'v', label: 'Gross value', numeric: true, render: (r) => <Money value={r.gross} /> },
          { key: 'i', label: 'IGST', numeric: true, render: (r) => <Money value={r.igst} /> },
          { key: 'c', label: 'CGST', numeric: true, render: (r) => <Money value={r.cgst} /> },
          { key: 's', label: 'SGST', numeric: true, render: (r) => <Money value={r.sgst} /> },
        ]}
      />
      {(manual.tds_tcs ?? []).map((e) => (
        <div key={e.id} className={controls.row3} style={{ alignItems: 'end' }}>
          <select className={controls.select} value={e.kind} aria-label="TDS or TCS" onChange={(ev) => setEntry(e.id, { kind: ev.target.value as 'TDS' | 'TCS' })}>
            <option value="TDS">TDS (Sec 51)</option>
            <option value="TCS">TCS (Sec 52)</option>
          </select>
          <input className={`${controls.input} ${controls.inputMono}`} maxLength={15} value={e.gstin} placeholder="Deductor / operator GSTIN" aria-label="Deductor or operator GSTIN"
            onChange={(ev) => setEntry(e.id, { gstin: ev.target.value.toUpperCase() })} />
          {num(e.gross, (v) => setEntry(e.id, { gross: v }), 'Gross value')}
          {num(e.cgst, (v) => setEntry(e.id, { cgst: v }), 'CGST')}
          {num(e.sgst, (v) => setEntry(e.id, { sgst: v }), 'SGST')}
          {num(e.igst, (v) => setEntry(e.id, { igst: v }), 'IGST')}
          <button type="button" className={controls.btnIcon} aria-label="Remove row"
            onClick={() => setManual((m) => ({ ...m, tds_tcs: (m.tds_tcs ?? []).filter((x) => x.id !== e.id) }))}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <div>
        <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`}
          onClick={() => setManual((m) => ({ ...m, tds_tcs: [...(m.tds_tcs ?? []), { id: generateId(), kind: 'TDS', gstin: '', gross: 0, igst: 0, cgst: 0, sgst: 0 }] }))}>
          <Plus size={14} aria-hidden /> Add TDS / TCS row (from the portal)
        </button>
      </div>

      <h4 className={local.tbHeading}>Table 8 — tax, interest and late fee payable and paid</h4>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <caption className={surface.srOnly}>GSTR-4 Table 8</caption>
          <thead>
            <tr>
              <th scope="col">Head</th>
              <th scope="col" className={surface.numeric}>Tax payable</th><th scope="col">Tax paid</th>
              <th scope="col" className={surface.numeric}>Interest payable (est.)</th><th scope="col">Interest paid</th>
              <th scope="col" className={surface.numeric}>Late fee payable (est.)</th><th scope="col">Late fee paid</th>
            </tr>
          </thead>
          <tbody>
            {annual.table8.map((r) => (
              <tr key={r.head}>
                <th scope="row">{HEAD_LABEL[r.head]}</th>
                <td className={surface.numeric}><Money value={r.taxPayable} /></td>
                <td>{num(r.taxPaid, (v) => setHead('tax_paid', r.head, v), `${HEAD_LABEL[r.head]} paid`)}</td>
                <td className={surface.numeric}><Money value={r.interestPayable} /></td>
                <td>{num(r.interestPaid, (v) => setHead('interest_paid', r.head, v), `${HEAD_LABEL[r.head]} interest paid`)}</td>
                <td className={surface.numeric}><Money value={r.lateFeePayable} /></td>
                <td>{num(r.lateFeePaid, (v) => setHead('late_fee_paid', r.head, v), `${HEAD_LABEL[r.head]} late fee paid`)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className={controls.field} style={{ maxWidth: 260 }}>
        <span className={controls.label}>GSTR-4 filed / to be filed on (due {annual.lateFee.due})</span>
        <input className={controls.input} type="date" value={manual.filed_on ?? ''} onChange={(e) => setManual((m) => ({ ...m, filed_on: e.target.value || undefined }))} />
      </label>
      <ul className={local.gapList}>
        {annual.interest.filter((q) => q.days > 0).map((q) => (
          <li key={q.quarter}>
            CMP-08 Q{q.quarter} (due {q.due}) paid {q.days} day(s) late{q.paidOn ? ` on ${q.paidOn}` : ' (not marked filed on the Compliance tab)'}: interest ≈ <Money value={HEADS4.reduce((s, h) => s + q.interest[h], 0)} />.
          </li>
        ))}
        {annual.lateFee.days > 0 && (
          <li>GSTR-4 {annual.lateFee.days} day(s) late{annual.lateFee.nil ? ' (nil return)' : ''}: late fee ≈ <Money value={annual.lateFee.total} /> (CGST + SGST).</li>
        )}
      </ul>

      <h4 className={local.tbHeading}>Table 9 — refund claimed from the electronic cash ledger</h4>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <caption className={surface.srOnly}>GSTR-4 Table 9</caption>
          <thead>
            <tr><th scope="col">Head</th>{REFUND_KEYS.map((k) => <th key={k} scope="col">{k[0].toUpperCase() + k.slice(1)}</th>)}</tr>
          </thead>
          <tbody>
            {annual.table9.map((r) => (
              <tr key={r.head}>
                <th scope="row">{HEAD_LABEL[r.head]}</th>
                {REFUND_KEYS.map((k) => <td key={k}>{num(r.refund[k], (v) => setRefund(r.head, k, v), `${HEAD_LABEL[r.head]} refund ${k}`)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className={controls.field}>
        <span className={controls.label}>Debit entry nos. of the refund claim</span>
        <input className={controls.input} value={manual.refund_debit_entries ?? ''} onChange={(e) => setManual((m) => ({ ...m, refund_debit_entries: e.target.value || undefined }))} />
      </label>
      {annual.notes.map((x) => <p key={x} className={controls.hint} style={{ margin: 0 }}>{x}</p>)}
    </div>
  );
}

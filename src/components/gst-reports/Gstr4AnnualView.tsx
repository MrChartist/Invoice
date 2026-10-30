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
import { useT } from '../../i18n';
import { gstGapT } from '../../i18n/areas/gst-gaps';
import { SelectField } from '../ui/SelectField';
import { DateField } from '../ui/DateField';

export interface Gstr4AnnualViewProps {
  invoices: InvoiceRecord[];
  purchases: unknown[];
  fyStart: number;
  gstin: string;
  filerStateCode: string;
  category?: CompositionKind;
  notify?: (msg: string, kind?: 'success' | 'error') => void;
}

const HEAD_KEY = { igst: 'hIgst', cgst: 'hCgst', sgst: 'hSgst', cess: 'hCess' } as const;
const headLabel = (h: Head4) => gstGapT(HEAD_KEY[h]);
const REFUND_KEY = { tax: 'rTax', interest: 'rInterest', penalty: 'rPenalty', fee: 'rFee', other: 'rOther' } as const;
const REFUND_KEYS: (keyof RefundEntry)[] = ['tax', 'interest', 'penalty', 'fee', 'other'];

/**
 * GSTR-4 Tables 7 (TDS / TCS credit), 8 (tax, interest, late fee payable and paid) and 9 (refund claimed), with
 * CMP-08 interest and GSTR-4 late-fee estimates. Typed-in values are saved per FY × GSTIN (`gstr4_manual`).
 */
export default function Gstr4AnnualView({ invoices, purchases, fyStart, gstin, filerStateCode, category, notify }: Gstr4AnnualViewProps) {
  useT(); // re-render on a language switch / when the Hindi pack arrives
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
      notify?.(gstGapT('saved'));
    } catch (err) {
      notify?.((err as Error).message || gstGapT('saveFail'), 'error');
    }
  };

  const num = (value: number, onChange: (n: number) => void, label: string) => (
    <NumberInput className={`${controls.input} ${controls.inputNumeric}`} value={value} onChange={onChange} aria-label={label} />
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-gstr4-annual>
      <div className={local.toolbar}>
        <h3 className={local.tbHeading}>{gstGapT('g4Title')}</h3>
        <button type="button" className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`} onClick={save}>
          <Save size={14} aria-hidden /> {gstGapT('saveEntries')}
        </button>
        <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`}
          onClick={() => downloadText(`GSTR4_T7-9_${gstin || 'all'}_FY${fyStart}.csv`, toCsv(gstr4AnnualRows(annual)), 'text/csv')}>
          <Download size={14} aria-hidden /> {gstGapT('csv')}
        </button>
      </div>

      <h4 className={local.tbHeading}>{gstGapT('t7')}</h4>
      <DataTable
        caption={gstGapT('t7Caption')}
        emptyText={gstGapT('t7Empty')}
        rows={annual.table7.tcsEstimate}
        rowKey={(r) => r.etin}
        columns={[
          { key: 'g', label: gstGapT('operatorEst'), render: (r) => <span className={surface.mono}>{r.etin}</span> },
          { key: 'v', label: gstGapT('gross'), numeric: true, render: (r) => <Money value={r.gross} /> },
          { key: 'i', label: 'IGST', numeric: true, render: (r) => <Money value={r.igst} /> },
          { key: 'c', label: 'CGST', numeric: true, render: (r) => <Money value={r.cgst} /> },
          { key: 's', label: 'SGST', numeric: true, render: (r) => <Money value={r.sgst} /> },
        ]}
      />
      {(manual.tds_tcs ?? []).map((e) => (
        <div key={e.id} className={controls.row3} style={{ alignItems: 'end' }}>
          <SelectField className={controls.select} value={e.kind} aria-label={gstGapT('tdsOrTcs')} onChange={(ev) => setEntry(e.id, { kind: ev.target.value as 'TDS' | 'TCS' })}>
            <option value="TDS">TDS (Sec 51)</option>
            <option value="TCS">TCS (Sec 52)</option>
          </SelectField>
          <input className={`${controls.input} ${controls.inputMono}`} maxLength={15} value={e.gstin} placeholder={gstGapT('deductorPh')} aria-label={gstGapT('deductorAria')}
            onChange={(ev) => setEntry(e.id, { gstin: ev.target.value.toUpperCase() })} />
          {num(e.gross, (v) => setEntry(e.id, { gross: v }), gstGapT('gross'))}
          {num(e.cgst, (v) => setEntry(e.id, { cgst: v }), 'CGST')}
          {num(e.sgst, (v) => setEntry(e.id, { sgst: v }), 'SGST')}
          {num(e.igst, (v) => setEntry(e.id, { igst: v }), 'IGST')}
          <button type="button" className={controls.btnIcon} aria-label={gstGapT('removeRow')}
            onClick={() => setManual((m) => ({ ...m, tds_tcs: (m.tds_tcs ?? []).filter((x) => x.id !== e.id) }))}>
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <div>
        <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`}
          onClick={() => setManual((m) => ({ ...m, tds_tcs: [...(m.tds_tcs ?? []), { id: generateId(), kind: 'TDS', gstin: '', gross: 0, igst: 0, cgst: 0, sgst: 0 }] }))}>
          <Plus size={14} aria-hidden /> {gstGapT('addRow')}
        </button>
      </div>

      <h4 className={local.tbHeading}>{gstGapT('t8')}</h4>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <caption className={surface.srOnly}>GSTR-4 Table 8</caption>
          <thead>
            <tr>
              <th scope="col">{gstGapT('head')}</th>
              <th scope="col" className={surface.numeric}>{gstGapT('taxPayable')}</th><th scope="col">{gstGapT('taxPaid')}</th>
              <th scope="col" className={surface.numeric}>{gstGapT('intPayable')}</th><th scope="col">{gstGapT('intPaid')}</th>
              <th scope="col" className={surface.numeric}>{gstGapT('feePayable')}</th><th scope="col">{gstGapT('feePaid')}</th>
            </tr>
          </thead>
          <tbody>
            {annual.table8.map((r) => (
              <tr key={r.head}>
                <th scope="row">{headLabel(r.head)}</th>
                <td className={surface.numeric}><Money value={r.taxPayable} /></td>
                <td>{num(r.taxPaid, (v) => setHead('tax_paid', r.head, v), gstGapT('headPaid', { head: headLabel(r.head) }))}</td>
                <td className={surface.numeric}><Money value={r.interestPayable} /></td>
                <td>{num(r.interestPaid, (v) => setHead('interest_paid', r.head, v), gstGapT('headIntPaid', { head: headLabel(r.head) }))}</td>
                <td className={surface.numeric}><Money value={r.lateFeePayable} /></td>
                <td>{num(r.lateFeePaid, (v) => setHead('late_fee_paid', r.head, v), gstGapT('headFeePaid', { head: headLabel(r.head) }))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className={controls.field} style={{ maxWidth: 260 }}>
        <span className={controls.label}>{gstGapT('filedOn', { due: annual.lateFee.due })}</span>
        <DateField className={controls.input} value={manual.filed_on ?? ''} onChange={(e) => setManual((m) => ({ ...m, filed_on: e.target.value || undefined }))} />
      </label>
      <ul className={local.gapList}>
        {annual.interest.filter((q) => q.days > 0).map((q) => (
          <li key={q.quarter}>
            {q.paidOn ? gstGapT('cmpLate', { q: q.quarter, due: q.due, days: q.days, paidOn: q.paidOn }) : gstGapT('cmpLateUnmarked', { q: q.quarter, due: q.due, days: q.days })} <Money value={HEADS4.reduce((s, h) => s + q.interest[h], 0)} />.
          </li>
        ))}
        {annual.lateFee.days > 0 && (
          <li>{gstGapT(annual.lateFee.nil ? 'g4LateNil' : 'g4Late', { days: annual.lateFee.days })} <Money value={annual.lateFee.total} /> {gstGapT('cgstSgst')}</li>
        )}
      </ul>

      <h4 className={local.tbHeading}>{gstGapT('t9')}</h4>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <caption className={surface.srOnly}>GSTR-4 Table 9</caption>
          <thead>
            <tr><th scope="col">{gstGapT('head')}</th>{REFUND_KEYS.map((k) => <th key={k} scope="col">{gstGapT(REFUND_KEY[k])}</th>)}</tr>
          </thead>
          <tbody>
            {annual.table9.map((r) => (
              <tr key={r.head}>
                <th scope="row">{headLabel(r.head)}</th>
                {REFUND_KEYS.map((k) => <td key={k}>{num(r.refund[k], (v) => setRefund(r.head, k, v), gstGapT('headRefund', { head: headLabel(r.head), kind: gstGapT(REFUND_KEY[k]) }))}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className={controls.field}>
        <span className={controls.label}>{gstGapT('debitEntries')}</span>
        <input className={controls.input} value={manual.refund_debit_entries ?? ''} onChange={(e) => setManual((m) => ({ ...m, refund_debit_entries: e.target.value || undefined }))} />
      </label>
      {annual.notes.map((x) => <p key={x} className={controls.hint} style={{ margin: 0 }}>{x}</p>)}
    </div>
  );
}

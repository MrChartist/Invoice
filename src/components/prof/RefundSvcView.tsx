/**
 * R14 PS-C3 refund view: Rule 89(4) for export of services under LUT — turnover of zero-rated services from the period's
 * receipts and advances, net ITC typed by head, adjusted total turnover (worked out or typed), the maximum refund, the
 * statement (invoice, FIRA / e-BRC, realised value) as CSV / XLSX, and one draft claim in the refund register.
 */
import { useMemo, useState } from 'react';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import type { AdvanceRecord } from '../../types/advances';
import type { ExportIrm } from '../../types/trade-r4';
import { localDb } from '../../lib/localDb';
import { getTable } from '../../lib/storage';
import { formatCurrency, todayInput } from '../../lib/utils';
import { downloadText } from '../../lib/download';
import { localDayOf } from '../../lib/dates';
import { toCsv } from '../../lib/csv';
import { irmsDb, liveRegister } from '../../lib/trade/export-register';
import { servicesRows } from '../../lib/prof/ps-fema';
import { brcRows } from '../../lib/prof/ps-brc';
import { refundSvcPaper, saveDraftClaim, statementSheet } from '../../lib/prof/ps-refund-svc';
import { pcT, type PcKey } from '../../i18n/areas/prof-r14c-export';
import { Tbl } from './pc-ui';
import { Field } from './ps-ui';
import { runner, type Notify } from './pc-run';
import controls from '../../styles/controls.module.css';
import css from './exportsvc.module.css';

const HEADS = ['igst', 'cgst', 'sgst', 'cess'] as const;
/** The FY quarter of `day` (Apr–Jun, Jul–Sep, Oct–Dec, Jan–Mar), local days. */
function quarter(day: string): { from: string; to: string } {
  const y = Number(day.slice(0, 4)), m = Number(day.slice(5, 7));
  const sm = m >= 4 ? Math.floor((m - 4) / 3) * 3 + 4 : 1;
  return { from: `${y}-${String(sm).padStart(2, '0')}-01`, to: localDayOf(new Date(y, sm + 2, 0)) };
}

export default function RefundSvcView({ notify }: { notify: Notify }) {
  const [p, setP] = useState(() => quarter(todayInput()));
  const [itc, setItc] = useState<Record<(typeof HEADS)[number], string>>({ igst: '', cgst: '', sgst: '', cess: '' });
  const [att, setAtt] = useState('');
  const run = runner(notify, () => undefined);
  const base = useMemo(() => {
    const invoices = localDb.invoices.getAll() as InvoiceRecord[];
    const payments = getTable<Payment>('transactions');
    const day = todayInput();
    const rows = servicesRows(liveRegister(day), invoices, day);
    return { invoices, payments, advances: getTable<AdvanceRecord>('advances'), brc: brcRows(rows, invoices, payments, irmsDb.all() as ExportIrm[]) };
  }, []);
  const paper = refundSvcPaper({ ...p, invoices: base.invoices, payments: base.payments, advances: base.advances, netItc: { igst: Number(itc.igst) || 0, cgst: Number(itc.cgst) || 0, sgst: Number(itc.sgst) || 0, cess: Number(itc.cess) || 0 }, adjustedTotalTurnover: Number(att) || undefined });
  const sheet = statementSheet(base.brc, paper.invoiceIds);
  const m = (n: number) => formatCurrency(n, 'INR');
  const name = `refund-services-${p.from}-${p.to}`;
  const lines: [PcKey, number][] = [['received', paper.received], ['advEarlier', paper.advancesEarlier], ['advNow', paper.advancesNow], ['zero', paper.zeroRated], ['domestic', paper.domestic], ['maxRefund', paper.result.total]];
  return (
    <>
      <div className={css.bar}>
        <Field label={pcT('from')}><input type="date" className={controls.input} value={p.from} onChange={(e) => setP({ ...p, from: e.target.value })} /></Field>
        <Field label={pcT('to')}><input type="date" className={controls.input} value={p.to} onChange={(e) => setP({ ...p, to: e.target.value })} /></Field>
        <Field label={pcT('att')}><input type="number" className={controls.input} value={att} onChange={(e) => setAtt(e.target.value)} /></Field>
      </div>
      <p className={controls.label}>{pcT('netItc')}</p>
      <div className={css.form}>{HEADS.map((h) => <Field key={h} label={h.toUpperCase()}><input type="number" className={controls.input} value={itc[h]} onChange={(e) => setItc({ ...itc, [h]: e.target.value })} {...{ [`data-ps-itc-${h}`]: '' }} /></Field>)}</div>
      <ul data-ps-refund>{lines.map(([k, v]) => <li key={k}>{pcT(k)}: <strong>{m(v)}</strong></li>)}<li>{paper.adjustedTotalTurnover ? `${m(paper.zeroRated)} ÷ ${m(paper.adjustedTotalTurnover)}` : ''}</li></ul>
      {paper.result.notes.map((n, i) => <p key={i} className={controls.hint}>{n}</p>)}
      <Tbl tag="stmt" head={sheet[0].map(String)} rows={sheet.slice(1)} />
      <div className={css.bar}>
        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => downloadText(`${name}.csv`, toCsv(sheet), 'text/csv')}>CSV</button>
        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => void import('../../lib/xlsx').then((x) => x.downloadXlsx(`${name}.xlsx`, [{ name: 'Statement', rows: sheet }]))}>XLSX</button>
        <button type="button" className={controls.btnPrimary} disabled={!(paper.result.total > 0)} onClick={() => run(() => { saveDraftClaim(p.from, p.to, paper, localDb.settings.activeProfile()?.companyGstin || undefined); return pcT('drafted'); })} data-ps-refund-draft>{pcT('draft')}</button>
      </div>
    </>
  );
}

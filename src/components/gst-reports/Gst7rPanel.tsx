/**
 * 7R GST tabs (lazy, one chunk): electronic cash ledger with PMT-09 and refund claims (RFD-01 trail, Rule 89(4)
 * working paper), Input Service Distributor + GSTR-6, consolidated e-Way Bill (EWB-02) JSON, and GSTR-1 / 3B side by
 * side per GSTIN. Every output is a working paper — verify with your CA.
 */
import { useMemo, useState } from 'react';
import { AlertTriangle, Download, Plus, Trash2 } from 'lucide-react';
import type { InvoiceRecord } from '../../types/invoice';
import type { PurchaseReturn } from '../../types/purchases';
import type { Gstr1Report, Gstr3bReport, ReportPeriod } from '../../lib/gst-reports';
import { periodRange } from '../../lib/gst-reports';
import { GST_HEADS, GST_HEAD_LABELS, MINOR_HEADS, MINOR_HEAD_LABELS, creditLedgerBalance, loadGstChallans, loadSetOffs, zeroHeads, type GstHead, type Heads, type MinorHead } from '../../lib/gst-setoff';
import {
  CASH_REFUND_DISCLAIMER,
  REFUND_CATEGORIES,
  REFUND_STATUS_FORM,
  advanceRefund,
  nextRefundStatuses,
  cashLedgerDetail,
  deletePmt09,
  deleteRefund,
  detailByHead,
  headsTotal,
  loadPmt09,
  creditLedgerRefundMoves,
  loadRefunds,
  refundDeadline,
  refundDelayInterest,
  rule894Basis,
  rule894Refund,
  savePmt09,
  saveRefund,
  validateRefund,
  type RefundCategory,
  type RefundStatus,
} from '../../lib/gst-cash-refunds';
import {
  ISD_DISCLAIMER,
  buildGstr6,
  deleteIsdDoc,
  gstr6Csv,
  isdCreditPool,
  isdTotal,
  issueDistribution,
  loadIsdDocs,
  planIsdDistribution,
  saveIsdDoc,
  type IsdKind,
  type IsdUnit,
} from '../../lib/isd';
import { CEWB_NOTE, buildConsolidatedEway, ewbCandidates, parseEwbList } from '../../lib/eway-consolidated';
import { buildByGstin, gstinColumns } from '../../lib/gst-by-gstin';
import { INDIAN_STATES } from '../../lib/india-states';
import { chartOf, loadUserAccounts, A } from '../../lib/ledger/accounts';
import { isCashOrBankLedger } from '../../lib/bank-ledgers';
import { getTable } from '../../lib/storage';
import { downloadText } from '../../lib/download';
import { toCsv } from '../../lib/csv';
import { localDb } from '../../lib/localDb';
import { todayIso } from '../../lib/tax-rules';
import { formatDate, formatMoney } from '../../lib/utils';
import type { EwayTransMode } from '../../lib/eway';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import local from './gst-reports.module.css';
import styles from './gst-setoff.module.css';
import { useT } from '../../i18n';
import { r7T } from '../../i18n/areas/gst-tds-7r';

export type Gst7rView = 'cashref' | 'isd' | 'ewbcons' | 'bygstin';

export interface Gst7rPanelProps {
  view: Gst7rView;
  period: ReportPeriod;
  gstin: string;
  g1: Gstr1Report;
  g3: Gstr3bReport;
  invoices: InvoiceRecord[];
  purchases: unknown[];
  notify: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}

const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const headsFrom = (o: Record<string, string>): Heads => ({ igst: num(o.igst ?? ''), cgst: num(o.cgst ?? ''), sgst: num(o.sgst ?? ''), cess: num(o.cess ?? '') });
const emptyHeadInputs = (): Record<GstHead, string> => ({ igst: '', cgst: '', sgst: '', cess: '' });

function Disclaimer({ text }: { text: string }) {
  return (
    <div className={`${surface.card} ${local.disclaimer}`} role="note">
      <AlertTriangle size={16} aria-hidden style={{ flexShrink: 0, color: 'var(--warning)' }} />
      <span>{text}</span>
    </div>
  );
}

function HeadInputs({ value, onChange, idPrefix }: { value: Record<GstHead, string>; onChange: (v: Record<GstHead, string>) => void; idPrefix: string }) {
  return (
    <>
      {GST_HEADS.map((h) => (
        <label key={h} className={controls.field}>
          <span className={controls.label}>{GST_HEAD_LABELS[h]}</span>
          <input id={`${idPrefix}-${h}`} type="number" min={0} step="0.01" className={controls.input} value={value[h]} onChange={(e) => onChange({ ...value, [h]: e.target.value })} />
        </label>
      ))}
    </>
  );
}

export default function Gst7rPanel(props: Gst7rPanelProps) {
  useT();
  return (
    <div className={local.tabBody} style={{ padding: 0 }} data-gst-7r={props.view}>
      {props.view === 'cashref' && <CashRefundsView {...props} />}
      {props.view === 'isd' && <IsdView {...props} />}
      {props.view === 'ewbcons' && <ConsolidatedEwbView {...props} />}
      {props.view === 'bygstin' && <ByGstinView {...props} />}
    </div>
  );
}

/* ── Cash ledger, PMT-09, refunds ─────────────────────────────── */

const CATEGORY_KEY: Record<RefundCategory, Parameters<typeof r7T>[0]> = {
  EXCESS_CASH: 'rcExcessCash',
  EXPORT_LUT_ITC: 'rcExportLut',
  SEZ_LUT_ITC: 'rcSezLut',
  EXPORT_SERVICES_IGST: 'rcExportIgst',
  INVERTED_DUTY: 'rcInverted',
  OTHER: 'rcOther',
};
const STATUS_KEY: Record<RefundStatus, Parameters<typeof r7T>[0]> = {
  DRAFT: 'rsDraft', FILED: 'rsFiled', ACKNOWLEDGED: 'rsAck', DEFICIENCY: 'rsDeficiency', PROVISIONAL: 'rsProvisional', SANCTIONED: 'rsSanctioned', REJECTED: 'rsRejected', PAID: 'rsPaid', WITHDRAWN: 'rsWithdrawn',
};

function CashRefundsView({ period, gstin, g1, g3, notify }: Gst7rPanelProps) {
  // `version` re-renders after a write; the tables are read on each render (small, in-memory cache).
  const [version, setVersion] = useState(0);
  void version;
  const today = todayIso();
  const challans = loadGstChallans();
  const setoffs = loadSetOffs();
  const transfers = loadPmt09();
  const allRefunds = loadRefunds();
  const refunds = allRefunds.filter((r) => !gstin || !r.gstin || r.gstin === gstin);
  const detail = cashLedgerDetail(challans, setoffs, transfers, allRefunds, undefined, gstin);
  const byHead = detailByHead(detail);
  const banks = useMemo(() => chartOf(loadUserAccounts()).filter((a) => isCashOrBankLedger(a)), []);
  const range = periodRange(period);
  const refresh = () => setVersion((v) => v + 1);
  const run = (fn: () => void, ok: string) => {
    try {
      fn();
      refresh();
      notify(ok);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  // PMT-09 form
  const [pmt, setPmt] = useState({ date: today, fromHead: 'igst' as GstHead, fromMinor: 'tax' as MinorHead, toHead: 'cgst' as GstHead, toMinor: 'tax' as MinorHead, amount: '', arn: '' });
  // New claim form
  const [claim, setClaim] = useState({ category: 'EXCESS_CASH' as RefundCategory, from: range.from, to: range.to, relevant: range.to, filed: '', arn: '', amounts: emptyHeadInputs() });
  const claimCheck = validateRefund({ category: claim.category, period_from: claim.from, period_to: claim.to, relevant_date: claim.relevant, filed_on: claim.filed || undefined, arn: claim.arn, claimed: headsFrom(claim.amounts), gstin }, byHead);
  // Status step
  const [step, setStep] = useState<{ id: string; status: RefundStatus; date: string; sanctioned: Record<GstHead, string>; bank: string } | null>(null);

  // Rule 89(4)
  const basis = useMemo(() => rule894Basis(g1, g3), [g1, g3]);
  const [zr, setZr] = useState('');
  const [att, setAtt] = useState('');
  const credit = creditLedgerBalance(setoffs, gstin, undefined, creditLedgerRefundMoves(refunds));
  const lut = rule894Refund({ zeroRatedTurnover: zr === '' ? basis.zeroRatedTurnover : num(zr), adjustedTotalTurnover: att === '' ? basis.adjustedTotalTurnover : num(att), netItc: basis.netItc, ...(headsTotal(credit) > 0 ? { creditBalance: credit } : {}) });

  return (
    <>
      <Disclaimer text={`${r7T('cashIntro')} ${CASH_REFUND_DISCLAIMER}`} />
      <h3 className={local.tbHeading}>{r7T('cashLedgerTitle')}</h3>
      <div className={styles.scroll}>
        <table className={styles.grid} aria-label={r7T('cashLedgerTitle')}>
          <thead>
            <tr>
              <th scope="col">{r7T('colHead')}</th>
              {MINOR_HEADS.map((m) => <th key={m} scope="col">{MINOR_HEAD_LABELS[m]}</th>)}
              <th scope="col">{r7T('colTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {GST_HEADS.map((h) => (
              <tr key={h}>
                <td>{GST_HEAD_LABELS[h]}</td>
                {MINOR_HEADS.map((m) => <td key={m} className={detail[h][m] < -0.004 ? styles.bad : undefined}>{formatMoney(detail[h][m])}</td>)}
                <td><strong>{formatMoney(byHead[h])}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className={styles.muted}>{r7T('cashLedgerHint')}</p>

      <h3 className={local.tbHeading}>{r7T('pmt09Title')}</h3>
      <p className={styles.muted}>{r7T('pmt09Hint')}</p>
      <div className={styles.bar}>
        <label>{r7T('date')}<input type="date" className={controls.input} value={pmt.date} onChange={(e) => setPmt({ ...pmt, date: e.target.value })} /></label>
        <label>{r7T('pmtFrom')}
          <span className={styles.actions}>
            <select aria-label={r7T('pmtFromHead')} className={controls.select} value={pmt.fromHead} onChange={(e) => setPmt({ ...pmt, fromHead: e.target.value as GstHead })}>{GST_HEADS.map((h) => <option key={h} value={h}>{GST_HEAD_LABELS[h]}</option>)}</select>
            <select aria-label={r7T('pmtFromMinor')} className={controls.select} value={pmt.fromMinor} onChange={(e) => setPmt({ ...pmt, fromMinor: e.target.value as MinorHead })}>{MINOR_HEADS.map((m) => <option key={m} value={m}>{MINOR_HEAD_LABELS[m]}</option>)}</select>
          </span>
        </label>
        <label>{r7T('pmtTo')}
          <span className={styles.actions}>
            <select aria-label={r7T('pmtToHead')} className={controls.select} value={pmt.toHead} onChange={(e) => setPmt({ ...pmt, toHead: e.target.value as GstHead })}>{GST_HEADS.map((h) => <option key={h} value={h}>{GST_HEAD_LABELS[h]}</option>)}</select>
            <select aria-label={r7T('pmtToMinor')} className={controls.select} value={pmt.toMinor} onChange={(e) => setPmt({ ...pmt, toMinor: e.target.value as MinorHead })}>{MINOR_HEADS.map((m) => <option key={m} value={m}>{MINOR_HEAD_LABELS[m]}</option>)}</select>
          </span>
        </label>
        <label>{r7T('amount')}<input type="number" min={0} step="0.01" className={controls.input} value={pmt.amount} onChange={(e) => setPmt({ ...pmt, amount: e.target.value })} /></label>
        <label>{r7T('arnOptional')}<input className={controls.input} value={pmt.arn} onChange={(e) => setPmt({ ...pmt, arn: e.target.value })} /></label>
        <button
          type="button"
          className={`${controls.btn} ${controls.btnPrimary}`}
          onClick={() => run(() => savePmt09({ date: pmt.date, gstin, arn: pmt.arn, from: { head: pmt.fromHead, minor: pmt.fromMinor }, to: { head: pmt.toHead, minor: pmt.toMinor }, amount: num(pmt.amount) }, challans, setoffs), r7T('saved'))}
        >
          <Plus size={14} aria-hidden /> {r7T('pmtSave')}
        </button>
      </div>
      {transfers.length > 0 && (
        <div className={styles.scroll}>
          <table className={styles.grid} aria-label={r7T('pmt09Title')}>
            <thead><tr><th scope="col">{r7T('date')}</th><th scope="col">{r7T('pmtFrom')}</th><th scope="col">{r7T('pmtTo')}</th><th scope="col">{r7T('amount')}</th><th scope="col">ARN</th><th scope="col"><span className={surface.srOnly}>{r7T('delete')}</span></th></tr></thead>
            <tbody>
              {transfers.filter((t) => !gstin || !t.gstin || t.gstin === gstin).map((t) => (
                <tr key={t.id}>
                  <td>{formatDate(t.date)}</td>
                  <td>{GST_HEAD_LABELS[t.from.head]} · {MINOR_HEAD_LABELS[t.from.minor]}</td>
                  <td>{GST_HEAD_LABELS[t.to.head]} · {MINOR_HEAD_LABELS[t.to.minor]}</td>
                  <td>{formatMoney(t.amount)}</td>
                  <td>{t.arn ?? '-'}</td>
                  <td><button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} aria-label={r7T('delete')} onClick={() => run(() => deletePmt09(t.id), r7T('deleted'))}><Trash2 size={14} aria-hidden /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className={local.tbHeading}>{r7T('refundsTitle')}</h3>
      <div className={styles.scroll}>
        <table className={styles.grid} aria-label={r7T('refundsTitle')}>
          <thead>
            <tr>
              <th scope="col">{r7T('rfCategory')}</th>
              <th scope="col">{r7T('rfPeriod')}</th>
              <th scope="col">ARN</th>
              <th scope="col">{r7T('rfClaimed')}</th>
              <th scope="col">{r7T('rfSanctioned')}</th>
              <th scope="col">{r7T('rfStatus')}</th>
              <th scope="col">{r7T('rfLastDay')}</th>
              <th scope="col">{r7T('rfInterest')}</th>
              <th scope="col"><span className={surface.srOnly}>{r7T('actions')}</span></th>
            </tr>
          </thead>
          <tbody>
            {refunds.length === 0 && <tr><td colSpan={9} className={styles.muted}>{r7T('rfNone')}</td></tr>}
            {refunds.map((r) => {
              const dl = refundDeadline(r.relevant_date, r.filed_on, today);
              const delay = refundDelayInterest(r, today);
              return (
                <tr key={r.id} data-refund-status={r.status}>
                  <td>{r7T(CATEGORY_KEY[r.category])}</td>
                  <td>{formatDate(r.period_from)} – {formatDate(r.period_to)}</td>
                  <td>{r.arn ?? '-'}</td>
                  <td>{formatMoney(headsTotal(r.claimed))}</td>
                  <td>{r.sanctioned ? formatMoney(headsTotal(r.sanctioned)) : '-'}</td>
                  <td title={r.history.map((e) => `${e.date} ${REFUND_STATUS_FORM[e.status]} ${e.status}${e.note ? `: ${e.note}` : ''}`).join('\n')}>{r7T(STATUS_KEY[r.status])} ({REFUND_STATUS_FORM[r.status]}){r.voucher_number ? ` · ${r.voucher_number}` : ''}</td>
                  <td className={dl.late ? styles.bad : undefined}>{dl.lastDay ? formatDate(dl.lastDay) : '-'}</td>
                  <td>{delay.daysLate > 0 && r.status !== 'REJECTED' && r.status !== 'WITHDRAWN' ? r7T('rfDelay', { days: delay.daysLate, amount: formatMoney(delay.interest) }) : '-'}</td>
                  <td>
                    <span className={styles.actions}>
                      {nextRefundStatuses(r.status).length > 0 && <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => setStep({ id: r.id, status: nextRefundStatuses(r.status).find((x) => x === 'SANCTIONED' || x === 'PAID') ?? nextRefundStatuses(r.status)[0], date: today, sanctioned: { igst: String(r.claimed.igst || ''), cgst: String(r.claimed.cgst || ''), sgst: String(r.claimed.sgst || ''), cess: String(r.claimed.cess || '') }, bank: r.bank_ledger_id ?? A.bank })}>{r7T('rfStep')}</button>}
                      <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} aria-label={r7T('delete')} onClick={() => run(() => deleteRefund(r.id), r7T('deleted'))}><Trash2 size={14} aria-hidden /></button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {step && (
        <div className={styles.bar} data-refund-step>
          <label>{r7T('rfNewStatus')}
            <select className={controls.select} value={step.status} onChange={(e) => setStep({ ...step, status: e.target.value as RefundStatus })}>
              {nextRefundStatuses(refunds.find((x) => x.id === step.id)?.status ?? 'FILED').map((x) => <option key={x} value={x}>{r7T(STATUS_KEY[x])} ({REFUND_STATUS_FORM[x]})</option>)}
            </select>
          </label>
          <label>{r7T('date')}<input type="date" className={controls.input} value={step.date} onChange={(e) => setStep({ ...step, date: e.target.value })} /></label>
          {(step.status === 'SANCTIONED' || step.status === 'PROVISIONAL' || step.status === 'PAID') && <HeadInputs idPrefix="rf-step" value={step.sanctioned} onChange={(v) => setStep({ ...step, sanctioned: v })} />}
          {step.status === 'PAID' && (
            <label>{r7T('rfBank')}
              <select className={controls.select} value={step.bank} onChange={(e) => setStep({ ...step, bank: e.target.value })}>
                {banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
              </select>
            </label>
          )}
          <span className={styles.actions}>
            <button
              type="button"
              className={`${controls.btn} ${controls.btnPrimary}`}
              onClick={() => {
                const r = refunds.find((x) => x.id === step.id);
                const amounts = headsFrom(step.sanctioned);
                const rejected: Heads = zeroHeads();
                if (r && step.status === 'SANCTIONED') for (const h of GST_HEADS) rejected[h] = Math.max(Math.round((r.claimed[h] - amounts[h]) * 100) / 100, 0);
                run(() => {
                  advanceRefund(step.id, {
                    status: step.status,
                    date: step.date,
                    ...(step.status === 'PROVISIONAL' ? { provisional: amounts } : {}),
                    ...(step.status === 'SANCTIONED' ? { sanctioned: amounts, rejected } : {}),
                    ...(step.status === 'PAID' ? { sanctioned: amounts, bankLedgerId: step.bank } : {}),
                  });
                  setStep(null);
                }, r7T('saved'));
              }}
            >
              {r7T('save')}
            </button>
            <button type="button" className={`${controls.btn} ${controls.btnGhost}`} onClick={() => setStep(null)}>{r7T('cancel')}</button>
          </span>
        </div>
      )}

      <h3 className={local.tbHeading}>{r7T('rfNewTitle')}</h3>
      <div className={styles.formGrid}>
        <label className={controls.field}>
          <span className={controls.label}>{r7T('rfCategory')}</span>
          <select className={controls.select} value={claim.category} onChange={(e) => setClaim({ ...claim, category: e.target.value as RefundCategory })}>
            {REFUND_CATEGORIES.map((c) => <option key={c} value={c}>{r7T(CATEGORY_KEY[c])}</option>)}
          </select>
        </label>
        <label className={controls.field}><span className={controls.label}>{r7T('rfFrom')}</span><input type="date" className={controls.input} value={claim.from} onChange={(e) => setClaim({ ...claim, from: e.target.value })} /></label>
        <label className={controls.field}><span className={controls.label}>{r7T('rfTo')}</span><input type="date" className={controls.input} value={claim.to} onChange={(e) => setClaim({ ...claim, to: e.target.value })} /></label>
        <label className={controls.field}><span className={controls.label}>{r7T('rfRelevant')}</span><input type="date" className={controls.input} value={claim.relevant} onChange={(e) => setClaim({ ...claim, relevant: e.target.value })} /></label>
        <label className={controls.field}><span className={controls.label}>{r7T('rfFiledOn')}</span><input type="date" className={controls.input} value={claim.filed} onChange={(e) => setClaim({ ...claim, filed: e.target.value })} /></label>
        <label className={controls.field}><span className={controls.label}>ARN</span><input className={controls.input} value={claim.arn} onChange={(e) => setClaim({ ...claim, arn: e.target.value })} /></label>
        <HeadInputs idPrefix="rf-new" value={claim.amounts} onChange={(v) => setClaim({ ...claim, amounts: v })} />
      </div>
      {[...claimCheck.errors, ...claimCheck.warnings].length > 0 && (
        <ul className={styles.muted}>{[...claimCheck.errors, ...claimCheck.warnings].map((w, i) => <li key={i}>{w}</li>)}</ul>
      )}
      <div className={styles.actions}>
        <button
          type="button"
          className={`${controls.btn} ${controls.btnPrimary}`}
          disabled={claimCheck.errors.length > 0}
          onClick={() => run(() => {
            saveRefund({ category: claim.category, period_from: claim.from, period_to: claim.to, relevant_date: claim.relevant, filed_on: claim.filed || undefined, arn: claim.arn, claimed: headsFrom(claim.amounts), gstin }, byHead);
            setClaim({ ...claim, amounts: emptyHeadInputs(), arn: '' });
          }, r7T('saved'))}
        >
          <Plus size={14} aria-hidden /> {r7T('rfAdd')}
        </button>
      </div>

      <h3 className={local.tbHeading}>{r7T('lutTitle')}</h3>
      <p className={styles.muted}>{r7T('lutHint')}</p>
      <div className={styles.formGrid}>
        <label className={controls.field}><span className={controls.label}>{r7T('lutZr')}</span><input type="number" step="0.01" className={controls.input} placeholder={String(basis.zeroRatedTurnover)} value={zr} onChange={(e) => setZr(e.target.value)} /></label>
        <label className={controls.field}><span className={controls.label}>{r7T('lutAtt')}</span><input type="number" step="0.01" className={controls.input} placeholder={String(basis.adjustedTotalTurnover)} value={att} onChange={(e) => setAtt(e.target.value)} /></label>
      </div>
      <div className={styles.scroll}>
        <table className={styles.grid} aria-label={r7T('lutTitle')}>
          <thead><tr><th scope="col">{r7T('colHead')}</th><th scope="col">{r7T('lutNetItc')}</th><th scope="col">{r7T('lutCredit')}</th><th scope="col">{r7T('lutRefund')}</th></tr></thead>
          <tbody>
            {GST_HEADS.map((h) => (
              <tr key={h}><td>{GST_HEAD_LABELS[h]}</td><td>{formatMoney(basis.netItc[h])}</td><td>{formatMoney(credit[h])}</td><td>{formatMoney(lut.byHead[h])}</td></tr>
            ))}
          </tbody>
          <tfoot><tr><td>{r7T('colTotal')} · {r7T('lutRatio', { ratio: lut.ratio })}</td><td>{formatMoney(headsTotal(basis.netItc))}</td><td>{formatMoney(headsTotal(credit))}</td><td>{formatMoney(lut.total)}</td></tr></tfoot>
        </table>
      </div>
      <ul className={styles.muted}>{lut.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
      <div className={styles.actions}>
        <button type="button" className={`${controls.btn} ${controls.btnOutline}`} onClick={() => setClaim({ ...claim, category: 'EXPORT_LUT_ITC', from: range.from, to: range.to, relevant: range.to, amounts: { igst: String(lut.byHead.igst || ''), cgst: String(lut.byHead.cgst || ''), sgst: String(lut.byHead.sgst || ''), cess: String(lut.byHead.cess || '') } })}>
          {r7T('lutUse')}
        </button>
      </div>
    </>
  );
}

/* ── ISD ──────────────────────────────────────────────────────── */

function IsdView({ period, gstin, invoices, notify }: Gst7rPanelProps) {
  const [version, setVersion] = useState(0);
  void version;
  const docs = loadIsdDocs();
  const [role, setRole] = useState<'ISD' | 'UNIT'>(() => (docs.some((d) => d.kind !== 'RECEIVED') ? 'ISD' : docs.length ? 'UNIT' : 'ISD'));
  const range = periodRange(period);
  const [month, setMonth] = useState(range.from.slice(0, 7));
  const [isdGstin, setIsdGstin] = useState(() => docs.find((d) => d.kind !== 'RECEIVED')?.isd_gstin ?? '');
  const columns = useMemo(() => gstinColumns(localDb.settings.get().profiles, getTable<{ gstin?: string; name?: string }>('branches'), invoices), [invoices]);
  const [units, setUnits] = useState<IsdUnit[]>(() => columns.map((c) => ({ gstin: c.gstin, name: c.label, turnover: 0 })));
  const blank = (kind: IsdKind) => ({ kind, date: todayIso(), number: '', isd_gstin: kind === 'RECEIVED' ? '' : isdGstin, party_gstin: kind === 'RECEIVED' ? gstin : '', party_name: '', taxable: '', heads: emptyHeadInputs(), eligible: true, credit_note: false });
  const [form, setForm] = useState(() => blank(role === 'ISD' ? 'INWARD' : 'RECEIVED'));
  const [distDate, setDistDate] = useState(todayIso());
  const refresh = () => setVersion((v) => v + 1);
  const run = (fn: () => void, ok: string) => {
    try {
      fn();
      refresh();
      notify(ok);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  const pool = isdCreditPool(docs, month, isdGstin.toUpperCase());
  const plan = planIsdDistribution(pool, units.filter((u) => u.gstin.toUpperCase() !== isdGstin.toUpperCase()), isdGstin.slice(0, 2));
  const paper = buildGstr6(docs, month, isdGstin.toUpperCase());
  const list = docs.filter((d) => (role === 'ISD' ? d.kind !== 'RECEIVED' : d.kind === 'RECEIVED'));
  const h4 = (h: { igst: number; cgst: number; sgst: number; cess: number }) => GST_HEADS.map((k) => <td key={k}>{formatMoney(h[k])}</td>);

  return (
    <>
      <Disclaimer text={`${r7T('isdIntro')} ${ISD_DISCLAIMER}`} />
      <div className={styles.bar}>
        <label>{r7T('isdRole')}
          <select className={controls.select} value={role} onChange={(e) => {
            const r = e.target.value as 'ISD' | 'UNIT';
            setRole(r);
            setForm(blank(r === 'ISD' ? 'INWARD' : 'RECEIVED'));
          }}>
            <option value="ISD">{r7T('isdRoleIsd')}</option>
            <option value="UNIT">{r7T('isdRoleUnit')}</option>
          </select>
        </label>
        {role === 'ISD' && <label>{r7T('isdGstin')}<input className={`${controls.input} ${controls.inputMono}`} maxLength={15} value={isdGstin} onChange={(e) => setIsdGstin(e.target.value.toUpperCase())} /></label>}
        {role === 'ISD' && <label>{r7T('isdMonth')}<input type="month" className={controls.input} value={month} onChange={(e) => setMonth(e.target.value)} /></label>}
      </div>

      <h3 className={local.tbHeading}>{role === 'ISD' ? r7T('isdInwardTitle') : r7T('isdReceivedTitle')}</h3>
      {role === 'UNIT' && <p className={styles.muted}>{r7T('isdReceivedHint')}</p>}
      <div className={styles.formGrid}>
        {role === 'ISD' && (
          <label className={controls.field}><span className={controls.label}>{r7T('isdKind')}</span>
            <select className={controls.select} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as IsdKind })}>
              <option value="INWARD">{r7T('isdKindInward')}</option>
              <option value="DISTRIBUTION">{r7T('isdKindDist')}</option>
            </select>
          </label>
        )}
        <label className={controls.field}><span className={controls.label}>{r7T('date')}</span><input type="date" className={controls.input} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
        {form.kind !== 'DISTRIBUTION' && <label className={controls.field}><span className={controls.label}>{r7T('isdNumber')}</span><input className={controls.input} value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} /></label>}
        {role === 'UNIT' && <label className={controls.field}><span className={controls.label}>{r7T('isdDistributor')}</span><input className={`${controls.input} ${controls.inputMono}`} maxLength={15} value={form.isd_gstin} onChange={(e) => setForm({ ...form, isd_gstin: e.target.value.toUpperCase() })} /></label>}
        <label className={controls.field}><span className={controls.label}>{form.kind === 'INWARD' ? r7T('isdSupplierGstin') : form.kind === 'DISTRIBUTION' ? r7T('isdRecipientGstin') : r7T('isdOurGstin')}</span><input className={`${controls.input} ${controls.inputMono}`} maxLength={15} value={form.party_gstin} onChange={(e) => setForm({ ...form, party_gstin: e.target.value.toUpperCase() })} /></label>
        <label className={controls.field}><span className={controls.label}>{r7T('isdPartyName')}</span><input className={controls.input} value={form.party_name} onChange={(e) => setForm({ ...form, party_name: e.target.value })} /></label>
        {form.kind === 'INWARD' && <label className={controls.field}><span className={controls.label}>{r7T('isdTaxable')}</span><input type="number" step="0.01" className={controls.input} value={form.taxable} onChange={(e) => setForm({ ...form, taxable: e.target.value })} /></label>}
        <HeadInputs idPrefix="isd" value={form.heads} onChange={(v) => setForm({ ...form, heads: v })} />
      </div>
      <div className={styles.checks}>
        <label className={controls.check}><input type="checkbox" checked={form.eligible} onChange={(e) => setForm({ ...form, eligible: e.target.checked })} /> {r7T('isdEligible')}</label>
        <label className={controls.check}><input type="checkbox" checked={form.credit_note} onChange={(e) => setForm({ ...form, credit_note: e.target.checked })} /> {r7T('isdCreditNote')}</label>
        <button
          type="button"
          className={`${controls.btn} ${controls.btnPrimary}`}
          onClick={() => run(() => {
            saveIsdDoc({ kind: form.kind, date: form.date, number: form.number, isd_gstin: form.kind === 'RECEIVED' ? form.isd_gstin : isdGstin, party_gstin: form.party_gstin, party_name: form.party_name, taxable: num(form.taxable), ...headsFrom(form.heads), eligible: form.eligible, credit_note: form.credit_note, ...(form.kind === 'DISTRIBUTION' ? { month } : {}) });
            setForm(blank(form.kind));
          }, r7T('saved'))}
        >
          <Plus size={14} aria-hidden /> {r7T('isdAdd')}
        </button>
      </div>
      <div className={styles.scroll}>
        <table className={styles.grid} aria-label={r7T('isdDocsTitle')}>
          <thead><tr><th scope="col">{r7T('isdKind')}</th><th scope="col">{r7T('date')}</th><th scope="col">{r7T('isdNumber')}</th><th scope="col">GSTIN</th>{GST_HEADS.map((h) => <th key={h} scope="col">{GST_HEAD_LABELS[h]}</th>)}<th scope="col">{r7T('isdEligible')}</th><th scope="col"><span className={surface.srOnly}>{r7T('delete')}</span></th></tr></thead>
          <tbody>
            {list.length === 0 && <tr><td colSpan={10} className={styles.muted}>{r7T('isdNone')}</td></tr>}
            {list.map((d) => (
              <tr key={d.id} data-isd-kind={d.kind}>
                <td>{d.kind === 'INWARD' ? r7T('isdKindInward') : d.kind === 'DISTRIBUTION' ? r7T('isdKindDist') : r7T('isdKindReceived')}{d.credit_note ? ` · ${r7T('isdCreditNote')}` : ''}</td>
                <td>{formatDate(d.date)}</td>
                <td>{d.number}</td>
                <td>{d.party_gstin}{d.party_name ? ` · ${d.party_name}` : ''}</td>
                {h4(d)}
                <td>{d.eligible ? '✓' : '✕'}</td>
                <td><button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} aria-label={r7T('delete')} onClick={() => run(() => deleteIsdDoc(d.id), r7T('deleted'))}><Trash2 size={14} aria-hidden /></button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {role === 'ISD' && (
        <>
          <h3 className={local.tbHeading}>{r7T('isdPlanTitle', { month })}</h3>
          <p className={styles.muted}>{r7T('isdPlanHint', { eligible: formatMoney(isdTotal(pool.eligible)), ineligible: formatMoney(isdTotal(pool.ineligible)) })}</p>
          <div className={styles.scroll}>
            <table className={styles.grid} aria-label={r7T('isdUnits')}>
              <thead><tr><th scope="col">{r7T('isdRecipientGstin')}</th><th scope="col">{r7T('isdPartyName')}</th><th scope="col">{r7T('isdTurnover')}</th><th scope="col"><span className={surface.srOnly}>{r7T('delete')}</span></th></tr></thead>
              <tbody>
                {units.map((u, i) => (
                  <tr key={i}>
                    <td><input aria-label={r7T('isdRecipientGstin')} className={`${controls.input} ${controls.inputMono}`} maxLength={15} value={u.gstin} onChange={(e) => setUnits(units.map((x, j) => (j === i ? { ...x, gstin: e.target.value.toUpperCase() } : x)))} /></td>
                    <td><input aria-label={r7T('isdPartyName')} className={controls.input} value={u.name} onChange={(e) => setUnits(units.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></td>
                    <td><input aria-label={r7T('isdTurnover')} type="number" min={0} step="0.01" className={controls.input} value={u.turnover || ''} onChange={(e) => setUnits(units.map((x, j) => (j === i ? { ...x, turnover: num(e.target.value) } : x)))} /></td>
                    <td><button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} aria-label={r7T('delete')} onClick={() => setUnits(units.filter((_, j) => j !== i))}><Trash2 size={14} aria-hidden /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.actions}>
            <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => setUnits([...units, { gstin: '', name: '', turnover: 0 }])}><Plus size={14} aria-hidden /> {r7T('isdAddUnit')}</button>
          </div>
          {plan.shares.length > 0 && (
            <div className={styles.scroll}>
              <table className={styles.grid} aria-label={r7T('isdShares')}>
                <thead><tr><th scope="col">{r7T('isdRecipientGstin')}</th><th scope="col">{r7T('isdRatio')}</th>{GST_HEADS.map((h) => <th key={h} scope="col">{GST_HEAD_LABELS[h]}</th>)}<th scope="col">{r7T('isdIneligible')}</th></tr></thead>
                <tbody>
                  {plan.shares.map((s) => (
                    <tr key={s.gstin}><td>{s.gstin} · {s.name}</td><td>{(s.ratio * 100).toFixed(2)}%</td>{h4(s.eligible)}<td>{formatMoney(isdTotal(s.ineligible))}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {plan.warnings.length > 0 && <ul className={styles.muted}>{plan.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
          <div className={styles.bar}>
            <label>{r7T('isdDistDate')}<input type="date" className={controls.input} value={distDate} onChange={(e) => setDistDate(e.target.value)} /></label>
            <button type="button" className={`${controls.btn} ${controls.btnPrimary}`} disabled={!plan.shares.length} onClick={() => run(() => issueDistribution(plan.shares, { date: distDate, month, isdGstin }), r7T('isdIssued'))}>{r7T('isdIssue')}</button>
          </div>

          <h3 className={local.tbHeading}>{r7T('gstr6Title', { month, due: formatDate(paper.due) })}</h3>
          <div className={styles.scroll}>
            <table className={styles.grid} aria-label="GSTR-6 Table 4">
              <thead><tr><th scope="col">{r7T('gstr6T4')}</th>{GST_HEADS.map((h) => <th key={h} scope="col">{GST_HEAD_LABELS[h]}</th>)}</tr></thead>
              <tbody>
                <tr><td>{r7T('gstr6Total')}</td>{h4(paper.table4.total)}</tr>
                <tr><td>{r7T('isdEligible')}</td>{h4(paper.table4.eligible)}</tr>
                <tr><td>{r7T('isdIneligible')}</td>{h4(paper.table4.ineligible)}</tr>
              </tbody>
            </table>
          </div>
          <p className={styles.muted}>{r7T('gstr6Counts', { t3: paper.table3.length, t5: paper.table5.length, t8: paper.table8.length })}</p>
          {paper.warnings.length > 0 && <div className={styles.warn} role="note"><ul>{paper.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
          <div className={styles.actions}>
            <button type="button" className={`${controls.btn} ${controls.btnOutline}`} onClick={() => downloadText(`GSTR6_${isdGstin || 'ISD'}_${month}.csv`, gstr6Csv(paper), 'text/csv')}><Download size={14} aria-hidden /> {r7T('downloadCsv')}</button>
          </div>
        </>
      )}
    </>
  );
}

/* ── Consolidated e-Way Bill ──────────────────────────────────── */

function ConsolidatedEwbView({ gstin, invoices, notify }: Gst7rPanelProps) {
  const cands = useMemo(() => ewbCandidates(getTable<{ invoice_id: string; eway_no?: string; eway_date?: string; eway_valid_upto?: string; vehicle?: string }>('einvoice_meta'), invoices), [invoices]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [paste, setPaste] = useState('');
  const [form, setForm] = useState({ userGstin: gstin, fromPlace: '', fromState: gstin.slice(0, 2), mode: 'ROAD' as EwayTransMode, vehicle: '', docNo: '', docDate: '' });
  const pasted = parseEwbList(paste);
  const all = [...new Set([...picked, ...pasted.numbers])];
  const res = buildConsolidatedEway({
    userGstin: form.userGstin, fromPlace: form.fromPlace, fromStateCode: form.fromState, transMode: form.mode, vehicleNo: form.vehicle, transDocNo: form.docNo, transDocDate: form.docDate, ewbNos: all,
    validUpto: Object.fromEntries(cands.map((c) => [c.ewb, c.validUpto])), today: todayIso(),
  });
  return (
    <>
      <Disclaimer text={`${r7T('cewbIntro')} ${CEWB_NOTE}`} />
      <div className={styles.formGrid}>
        <label className={controls.field}><span className={controls.label}>{r7T('cewbUser')}</span><input className={`${controls.input} ${controls.inputMono}`} maxLength={15} value={form.userGstin} onChange={(e) => setForm({ ...form, userGstin: e.target.value.toUpperCase() })} /></label>
        <label className={controls.field}><span className={controls.label}>{r7T('cewbPlace')}</span><input className={controls.input} maxLength={50} value={form.fromPlace} onChange={(e) => setForm({ ...form, fromPlace: e.target.value })} /></label>
        <label className={controls.field}><span className={controls.label}>{r7T('cewbState')}</span>
          <select className={controls.select} value={form.fromState} onChange={(e) => setForm({ ...form, fromState: e.target.value })}>
            <option value="">-</option>
            {INDIAN_STATES.map((s) => <option key={s.code} value={s.code}>{s.code} · {s.name}</option>)}
          </select>
        </label>
        <label className={controls.field}><span className={controls.label}>{r7T('cewbMode')}</span>
          <select className={controls.select} value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as EwayTransMode })}>
            {(['ROAD', 'RAIL', 'AIR', 'SHIP'] as const).map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label className={controls.field}><span className={controls.label}>{r7T('cewbVehicle')}</span><input className={`${controls.input} ${controls.inputMono}`} value={form.vehicle} onChange={(e) => setForm({ ...form, vehicle: e.target.value.toUpperCase() })} /></label>
        {form.mode !== 'ROAD' && <label className={controls.field}><span className={controls.label}>{r7T('cewbDocNo')}</span><input className={controls.input} value={form.docNo} onChange={(e) => setForm({ ...form, docNo: e.target.value })} /></label>}
        {form.mode !== 'ROAD' && <label className={controls.field}><span className={controls.label}>{r7T('cewbDocDate')}</span><input type="date" className={controls.input} value={form.docDate} onChange={(e) => setForm({ ...form, docDate: e.target.value })} /></label>}
      </div>
      <h3 className={local.tbHeading}>{r7T('cewbPick')}</h3>
      <div className={styles.scroll}>
        <table className={styles.grid} aria-label={r7T('cewbPick')}>
          <thead><tr><th scope="col"><span className={surface.srOnly}>{r7T('cewbInclude')}</span></th><th scope="col">EWB</th><th scope="col">{r7T('isdNumber')}</th><th scope="col">{r7T('date')}</th><th scope="col">{r7T('isdPartyName')}</th><th scope="col">{r7T('cewbValid')}</th></tr></thead>
          <tbody>
            {cands.length === 0 && <tr><td colSpan={6} className={styles.muted}>{r7T('cewbNoSaved')}</td></tr>}
            {cands.map((c) => (
              <tr key={c.ewb}>
                <td><input type="checkbox" aria-label={r7T('cewbInclude')} checked={picked.has(c.ewb)} onChange={(e) => {
                  const next = new Set(picked);
                  if (e.target.checked) next.add(c.ewb);
                  else next.delete(c.ewb);
                  setPicked(next);
                }} /></td>
                <td>{c.ewb}</td><td>{c.number}</td><td>{c.date ? formatDate(c.date) : '-'}</td><td>{c.party || '-'}</td>
                <td className={c.validUpto && c.validUpto < todayIso() ? styles.bad : undefined}>{c.validUpto ? formatDate(c.validUpto) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className={controls.field}>
        <span className={controls.label}>{r7T('cewbPaste')}</span>
        <textarea className={controls.textarea} rows={3} value={paste} onChange={(e) => setPaste(e.target.value)} />
      </label>
      {pasted.rejected.length > 0 && <p className={styles.muted}>{r7T('cewbRejected', { list: pasted.rejected.slice(0, 6).join(', ') })}</p>}
      {[...res.errors, ...res.warnings].length > 0 && <ul className={styles.muted}>{[...res.errors, ...res.warnings].map((w, i) => <li key={i}>{w}</li>)}</ul>}
      <div className={styles.actions}>
        <button
          type="button"
          className={`${controls.btn} ${controls.btnPrimary}`}
          disabled={!res.payload}
          onClick={() => {
            if (!res.payload) return;
            downloadText(`consolidated-ewb-${todayIso()}.json`, JSON.stringify(res.payload, null, 2), 'application/json');
            notify(r7T('cewbDone', { n: res.bills.length }));
          }}
        >
          <Download size={14} aria-hidden /> {r7T('cewbDownload', { n: res.bills.length })}
        </button>
      </div>
    </>
  );
}

/* ── By GSTIN ─────────────────────────────────────────────────── */

function ByGstinView({ period, invoices, purchases }: Gst7rPanelProps) {
  const result = useMemo(() => {
    const columns = gstinColumns(localDb.settings.get().profiles, getTable<{ gstin?: string; name?: string }>('branches'), invoices);
    return buildByGstin(invoices, purchases, {
      period,
      columns,
      branches: getTable<{ id: string; gstin?: string }>('branches'),
      purchaseNotes: getTable<PurchaseReturn>('purchase_returns'),
    });
  }, [invoices, purchases, period]);
  const csv = () => toCsv([
    [r7T('byGstinNote')],
    [r7T('byGstinRow'), ...result.columns.map((c) => `${c.label}${c.gstin ? ` (${c.gstin})` : ''}`), r7T('colTotal')],
    ...result.rows.map((r) => (r.heading ? [r.label] : [r.label, ...r.values, r.total])),
    [],
    ...result.warnings.map((w) => [w]),
  ]);
  if (result.columns.length < 2) return <p className={styles.muted}>{r7T('byGstinOne')}</p>;
  return (
    <>
      <Disclaimer text={r7T('byGstinNote')} />
      <div className={styles.scroll}>
        <table className={styles.grid} aria-label={r7T('byGstinTitle')}>
          <thead>
            <tr>
              <th scope="col">{r7T('byGstinRow')}</th>
              {result.columns.map((c) => <th key={c.gstin || 'none'} scope="col">{c.label}<br /><span className={styles.muted}>{c.gstin || '-'}</span></th>)}
              <th scope="col">{r7T('colTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {result.rows.map((r) => (r.heading ? (
              <tr key={r.id}><td colSpan={result.columns.length + 2}><strong>{r.label}</strong></td></tr>
            ) : (
              <tr key={r.id}>
                <td>{r.label}</td>
                {r.values.map((v, i) => <td key={i}>{r.id === 'docs' ? v : formatMoney(v)}</td>)}
                <td><strong>{r.id === 'docs' ? r.total : formatMoney(r.total)}</strong></td>
              </tr>
            )))}
          </tbody>
        </table>
      </div>
      {result.warnings.length > 0 && <div className={styles.warn} role="note"><ul>{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
      <div className={styles.actions}>
        <button type="button" className={`${controls.btn} ${controls.btnOutline}`} onClick={() => downloadText(`GST_by_GSTIN_${periodRange(period).from}.csv`, csv(), 'text/csv')}><Download size={14} aria-hidden /> {r7T('downloadCsv')}</button>
      </div>
    </>
  );
}

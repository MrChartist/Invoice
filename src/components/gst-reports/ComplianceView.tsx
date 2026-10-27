import { lazy, Suspense, useMemo, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import {
  FORM_LABELS,
  complianceCalendar,
  filedFor,
  loadFiled,
  qrmp3bDay,
  returnStatus,
  saveFiled,
  setFiled,
  type FiledReturn,
  type FilerFrequency,
  type ReturnDue,
  type ReturnStatus,
} from '../../lib/compliance';
import { estimateFor } from '../../lib/gst-penalties';
import { buildGstReport, journalItcReversals, periodForDate } from '../../lib/gst-reports';
import { compositionLateInputs } from '../../lib/gstr4-annual';
import { localDb } from '../../lib/localDb';
import { isPackOn } from '../../lib/industry-packs';
import { QRMP_TURNOVER_LIMIT, todayIso } from '../../lib/tax-rules';
import { readLinks } from '../../lib/documents';
import { formatDate } from '../../lib/utils';
import type { InvoiceRecord } from '../../types/invoice';
import type { PurchaseReturn } from '../../types/purchases';
import { getTable } from '../../lib/storage';
import { DataTable, Money } from './DataTable';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import local from './gst-reports.module.css';
import { useT } from '../../i18n';
import { gvT } from '../../i18n/areas/gst-views';
import { nodes } from '../../i18n/areas/nodes';

// 7O (7.96): TDS deposit / 26Q due dates — loads the TDS engine only when this tab is open.
const TdsDueCalendar = lazy(() => import('../tds/TdsDueCalendar'));
// 8D (8.62): returns becoming time-barred (three years from the due date).
const Gst8dPanel = lazy(() => import('./Gst8dPanel'));
// R8-C (TR-C2): composition-limit tracker (composition profiles only, lazy).
const CompositionTracker = lazy(() => import('../trade/CompositionTracker'));
// R12 (AG-D5): producer company / co-operative reminders (fpo pack only, lazy).
const MembersCalendar = lazy(() => import('../agri/MembersCalendar'));
// R13 (MF-D3 / D4): Form-1, export-obligation and incentive reminders (shopfloor pack only, lazy).
const MfgCalendar = lazy(() => import('../mfg/MfgCalendar'));
// R14 (PS-C2): EDF and services-realisation reminders (svcexport pack only, lazy).
const ExportSvcCalendar = lazy(() => import('../prof/ExportSvcCalendar'));

export interface ComplianceViewProps {
  invoices: InvoiceRecord[];
  purchases: unknown[];
  /** Selected filer GSTIN ('' = all profiles). */
  gstin: string;
  /** Filer state code (QRMP GSTR-3B day). */
  stateCode: string;
  /** Preceding-FY aggregate turnover, ₹. */
  turnover: number;
  notify: (msg: string, tone?: 'error') => void;
}

const STATUS: Record<ReturnStatus, { label: 'stOverdue' | 'stDueSoon' | 'stUpcoming' | 'stFiled'; cls: string; rank: number }> = {
  overdue: { label: 'stOverdue', cls: surface.badgeOverdue, rank: 0 },
  'due-soon': { label: 'stDueSoon', cls: surface.badgePartial, rank: 1 },
  upcoming: { label: 'stUpcoming', cls: surface.badgeDraft, rank: 2 },
  filed: { label: 'stFiled', cls: surface.badgePaid, rank: 3 },
};

interface Row {
  r: ReturnDue;
  status: ReturnStatus;
  filed?: FiledReturn;
  days: number;
  lateFee: number;
  interest: number;
}

export function ComplianceView({ invoices, purchases, gstin, stateCode, turnover, notify }: ComplianceViewProps) {
  useT();
  const today = todayIso();
  const [frequency, setFrequency] = useState<FilerFrequency>(
    () => localDb.settings.get().gst_filing_frequency ?? (localDb.settings.activeProfile()?.gst_scheme === 'composition' ? 'composition' : 'monthly'),
  );
  const [filedRows, setFiledRows] = useState<FiledReturn[]>(loadFiled);

  const since = useMemo(() => {
    let s = '';
    for (const i of invoices) {
      const d = String(i?.issue_date ?? '').slice(0, 10);
      const g = (i?.sender?.companyGstin ?? '').trim().toUpperCase();
      if ((i?.doc_type === 'INVOICE' || i?.doc_type === 'TAX_INVOICE' || i?.doc_type === 'BILL_OF_SUPPLY') && i.status !== 'Draft' && i.status !== 'Cancelled' && d && (!gstin || !g || g === gstin) && (!s || d < s)) s = d;
    }
    return s;
  }, [invoices, gstin]);

  const rows = useMemo<Row[]>(() => {
    if (!since) return [];
    const links = readLinks();
    // 7O (7.93): supplier notes reduce the month's ITC, so the late-fee / interest base follows the 3B.
    const purchaseNotes = getTable<PurchaseReturn>('purchase_returns');
    // R6-C4: Rule 42 / 43 common-credit journals raise the 3B tax payable in cash, so the interest base follows.
    const itcReversals = journalItcReversals(getTable('vouchers'));
    return complianceCalendar({ frequency, stateCode, today, since })
      .map((r) => {
        const filed = filedFor(filedRows, r, gstin);
        const status = returnStatus(r, today, filed);
        const filedOn = filed?.filed_on || today;
        let cashTax = 0;
        let nil = false;
        if (!r.optional && filedOn > r.due && (r.form === 'GSTR1' || r.form === 'GSTR3B')) {
          const period = periodForDate(r.periodKey.includes('-Q') ? 'quarter' : 'month', r.from);
          const rep = buildGstReport(invoices, purchases, { period, gstin, filerStateCode: stateCode, links, purchaseNotes, itcReversals });
          const p = rep.gstr3b.payment;
          cashTax = p.cash.igst + p.cash.cgst + p.cash.sgst + (p.cess ?? 0);
          nil = rep.gstr1.counts.included === 0 && (r.form === 'GSTR1' || rep.gstr3b.purchasesConsidered === 0);
        }
        if (!r.optional && filedOn > r.due && (r.form === 'CMP08' || r.form === 'GSTR4')) ({ cashTax, nil } = compositionLateInputs(r, invoices, purchases, { gstin, filerStateCode: stateCode }));
        return { r, status, filed, ...estimateFor(r, { filedOn, turnover, cashTax, nil }) };
      })
      .sort((a, b) => STATUS[a.status].rank - STATUS[b.status].rank || a.r.due.localeCompare(b.r.due));
  }, [since, frequency, stateCode, today, filedRows, gstin, invoices, purchases, turnover]);

  const changeFrequency = (f: FilerFrequency) => {
    setFrequency(f);
    try {
      localDb.settings.save({ ...localDb.settings.get(), gst_filing_frequency: f });
    } catch {
      notify(gvT('freqSaveFailed'), 'error');
    }
  };

  const mark = (r: ReturnDue, filedOn: string | null) => {
    const next = setFiled(filedRows, r, gstin, filedOn);
    setFiledRows(next);
    try {
      saveFiled(next);
    } catch {
      notify(gvT('saveFailedFull'), 'error');
    }
  };

  const open = rows.filter((x) => x.status === 'overdue');
  const exposure = open.reduce((s, x) => s + x.lateFee + x.interest, 0);

  return (
    <>
      <div className={local.toolbar}>
        <label className={local.periodField}>
          <span className={controls.label}>{gvT('filingFrequency')}</span>
          <select className={controls.select} value={frequency} onChange={(e) => changeFrequency(e.target.value as FilerFrequency)}>
            <option value="monthly">{gvT('freqMonthly')}</option>
            <option value="qrmp">{gvT('freqQrmp', { day: qrmp3bDay(stateCode, today) })}</option>
            <option value="composition">{gvT('freqComposition')}</option>
          </select>
        </label>
        <p className={controls.hint} style={{ margin: 0 }}>
          <CalendarClock size={14} aria-hidden style={{ verticalAlign: '-2px' }} /> {open.length
            ? nodes(gvT('overdueExposure'), { n: open.length, amount: <strong><Money value={exposure} /></strong> })
            : gvT('nothingOverdue')}
        </p>
      </div>
      {frequency === 'qrmp' && turnover > QRMP_TURNOVER_LIMIT && (
        <p className={controls.error} style={{ margin: 0 }}>{gvT('qrmpLimit')}</p>
      )}
      {!since ? (
        <p className={surface.sectionNote}>{gvT('noReturns')}</p>
      ) : (
        <DataTable
          caption={gvT('capCalendar')}
          emptyText=""
          rows={rows}
          rowKey={(x) => x.r.id}
          columns={[
            { key: 'f', label: gvT('colReturn'), render: (x) => FORM_LABELS[x.r.form] },
            { key: 'p', label: gvT('period'), render: (x) => x.r.label },
            { key: 'd', label: gvT('colDue'), render: (x) => formatDate(x.r.due) },
            { key: 's', label: gvT('colStatus'), render: (x) => <span className={`${surface.badge} ${STATUS[x.status].cls}`}>{gvT(STATUS[x.status].label)}{x.days > 0 && !x.r.optional ? gvT('daysLate', { n: x.days }) : ''}</span> },
            {
              key: 'filed',
              label: gvT('colFiled'),
              render: (x) => (
                <span style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
                  <label className={controls.check}>
                    <input type="checkbox" checked={!!x.filed} onChange={(e) => mark(x.r, e.target.checked ? today : null)} aria-label={gvT('filedAria', { form: FORM_LABELS[x.r.form], period: x.r.label })} />
                  </label>
                  {x.filed && (
                    <input type="date" className={controls.input} style={{ width: 'auto' }} value={x.filed.filed_on} max={today}
                      aria-label={gvT('filedOn')} onChange={(e) => e.target.value && mark(x.r, e.target.value)} />
                  )}
                </span>
              ),
            },
            { key: 'lf', label: gvT('colLateFee'), numeric: true, render: (x) => (x.lateFee ? <Money value={x.lateFee} /> : '-'), total: (x) => x.lateFee },
            { key: 'in', label: gvT('colInterest'), numeric: true, render: (x) => (x.interest ? <Money value={x.interest} /> : '-'), total: (x) => x.interest },
          ]}
        />
      )}
      <Suspense fallback={null}>
        <Gst8dPanel view="timebar" frequency={frequency} stateCode={stateCode} since={since} gstin={gstin} filed={filedRows} onMark={mark} />
      </Suspense>
      <Suspense fallback={null}>
        <TdsDueCalendar today={today} />
      </Suspense>
      <Suspense fallback={null}><CompositionTracker invoices={invoices} stateCode={stateCode} today={today} /></Suspense>
      {isPackOn(localDb.settings.get(), 'fpo') && <Suspense fallback={null}><MembersCalendar today={today} /></Suspense>}
      {isPackOn(localDb.settings.get(), 'shopfloor') && <Suspense fallback={null}><MfgCalendar today={today} /></Suspense>}
      {isPackOn(localDb.settings.get(), 'svcexport') && <Suspense fallback={null}><ExportSvcCalendar today={today} /></Suspense>}
      <ul className={local.notes}>
        <li><strong>{gvT('ncEstimates')}</strong> {gvT('ncDue')}</li>
        <li>{gvT('ncLateFee')}</li>
        <li>{gvT('ncInterest')}</li>
        <li>{gvT('ncFiled')}</li>
      </ul>
    </>
  );
}

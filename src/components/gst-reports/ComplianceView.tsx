import { useMemo, useState } from 'react';
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
import { buildGstReport, periodForDate } from '../../lib/gst-reports';
import { localDb } from '../../lib/localDb';
import { QRMP_TURNOVER_LIMIT, todayIso } from '../../lib/tax-rules';
import { readLinks } from '../../lib/documents';
import { formatDate } from '../../lib/utils';
import type { InvoiceRecord } from '../../types/invoice';
import { DataTable, Money } from './DataTable';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import local from './gst-reports.module.css';

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

const STATUS: Record<ReturnStatus, { label: string; cls: string; rank: number }> = {
  overdue: { label: 'Overdue', cls: surface.badgeOverdue, rank: 0 },
  'due-soon': { label: 'Due soon', cls: surface.badgePartial, rank: 1 },
  upcoming: { label: 'Upcoming', cls: surface.badgeDraft, rank: 2 },
  filed: { label: 'Filed', cls: surface.badgePaid, rank: 3 },
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
  const today = todayIso();
  const [frequency, setFrequency] = useState<FilerFrequency>(() => localDb.settings.get().gst_filing_frequency ?? 'monthly');
  const [filedRows, setFiledRows] = useState<FiledReturn[]>(loadFiled);

  const since = useMemo(() => {
    let s = '';
    for (const i of invoices) {
      const d = String(i?.issue_date ?? '').slice(0, 10);
      const g = (i?.sender?.companyGstin ?? '').trim().toUpperCase();
      if ((i?.doc_type === 'INVOICE' || i?.doc_type === 'TAX_INVOICE') && i.status !== 'Draft' && i.status !== 'Cancelled' && d && (!gstin || !g || g === gstin) && (!s || d < s)) s = d;
    }
    return s;
  }, [invoices, gstin]);

  const rows = useMemo<Row[]>(() => {
    if (!since) return [];
    const links = readLinks();
    return complianceCalendar({ frequency, stateCode, today, since })
      .map((r) => {
        const filed = filedFor(filedRows, r, gstin);
        const status = returnStatus(r, today, filed);
        const filedOn = filed?.filed_on || today;
        let cashTax = 0;
        let nil = false;
        if (!r.optional && filedOn > r.due && (r.form === 'GSTR1' || r.form === 'GSTR3B')) {
          const period = periodForDate(r.periodKey.includes('-Q') ? 'quarter' : 'month', r.from);
          const rep = buildGstReport(invoices, purchases, { period, gstin, filerStateCode: stateCode, links });
          const p = rep.gstr3b.payment;
          cashTax = p.cash.igst + p.cash.cgst + p.cash.sgst + (p.cess ?? 0);
          nil = rep.gstr1.counts.included === 0 && (r.form === 'GSTR1' || rep.gstr3b.purchasesConsidered === 0);
        }
        return { r, status, filed, ...estimateFor(r, { filedOn, turnover, cashTax, nil }) };
      })
      .sort((a, b) => STATUS[a.status].rank - STATUS[b.status].rank || a.r.due.localeCompare(b.r.due));
  }, [since, frequency, stateCode, today, filedRows, gstin, invoices, purchases, turnover]);

  const changeFrequency = (f: FilerFrequency) => {
    setFrequency(f);
    try {
      localDb.settings.save({ ...localDb.settings.get(), gst_filing_frequency: f });
    } catch {
      notify('Could not save the filing frequency', 'error');
    }
  };

  const mark = (r: ReturnDue, filedOn: string | null) => {
    const next = setFiled(filedRows, r, gstin, filedOn);
    setFiledRows(next);
    try {
      saveFiled(next);
    } catch {
      notify('Could not save — browser storage may be full', 'error');
    }
  };

  const open = rows.filter((x) => x.status === 'overdue');
  const exposure = open.reduce((s, x) => s + x.lateFee + x.interest, 0);

  return (
    <>
      <div className={local.toolbar}>
        <label className={local.periodField}>
          <span className={controls.label}>Filing frequency</span>
          <select className={controls.select} value={frequency} onChange={(e) => changeFrequency(e.target.value as FilerFrequency)}>
            <option value="monthly">Monthly (GSTR-1 by 11th, GSTR-3B by 20th)</option>
            <option value="qrmp">Quarterly — QRMP (GSTR-1 by 13th, GSTR-3B by {qrmp3bDay(stateCode, today)}th)</option>
          </select>
        </label>
        <p className={controls.hint} style={{ margin: 0 }}>
          <CalendarClock size={14} aria-hidden style={{ verticalAlign: '-2px' }} /> {open.length
            ? <>{open.length} overdue · estimated late fee + interest if filed today <strong><Money value={exposure} /></strong></>
            : 'Nothing overdue.'}
        </p>
      </div>
      {frequency === 'qrmp' && turnover > QRMP_TURNOVER_LIMIT && (
        <p className={controls.error} style={{ margin: 0 }}>QRMP is only open up to ₹5 crore of last-FY turnover; your entered turnover is above that.</p>
      )}
      {!since ? (
        <p className={surface.sectionNote}>No issued tax invoices yet, so no returns are tracked. Returns appear from the month of your first tax invoice (up to 12 months back).</p>
      ) : (
        <DataTable
          caption="GST return calendar"
          emptyText=""
          rows={rows}
          rowKey={(x) => x.r.id}
          columns={[
            { key: 'f', label: 'Return', render: (x) => FORM_LABELS[x.r.form] },
            { key: 'p', label: 'Period', render: (x) => x.r.label },
            { key: 'd', label: 'Due', render: (x) => formatDate(x.r.due) },
            { key: 's', label: 'Status', render: (x) => <span className={`${surface.badge} ${STATUS[x.status].cls}`}>{STATUS[x.status].label}{x.days > 0 && !x.r.optional ? ` · ${x.days}d late` : ''}</span> },
            {
              key: 'filed',
              label: 'Filed',
              render: (x) => (
                <span style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
                  <label className={controls.check}>
                    <input type="checkbox" checked={!!x.filed} onChange={(e) => mark(x.r, e.target.checked ? today : null)} aria-label={`${FORM_LABELS[x.r.form]} ${x.r.label} filed`} />
                  </label>
                  {x.filed && (
                    <input type="date" className={controls.input} style={{ width: 'auto' }} value={x.filed.filed_on} max={today}
                      aria-label="Filed on" onChange={(e) => e.target.value && mark(x.r, e.target.value)} />
                  )}
                </span>
              ),
            },
            { key: 'lf', label: 'Late fee (est.)', numeric: true, render: (x) => (x.lateFee ? <Money value={x.lateFee} /> : '-'), total: (x) => x.lateFee },
            { key: 'in', label: 'Interest (est.)', numeric: true, render: (x) => (x.interest ? <Money value={x.interest} /> : '-'), total: (x) => x.interest },
          ]}
        />
      )}
      <ul className={local.notes}>
        <li><strong>Estimates — verify with your CA.</strong> Due dates are the regular ones from the rules (Rules 59/61, QRMP Notifications 84-85/2020-CT); one-off extensions notified by CBIC are not tracked, so check the portal.</li>
        <li>Late fee: ₹50/day (₹20/day for a nil return) per GSTR-1 / GSTR-3B, capped by last-FY turnover (Notifications 19/2021 and 20/2021-CT: ₹2,000 up to ₹1.5 crore, ₹5,000 up to ₹5 crore, ₹10,000 above; nil ₹500). GSTR-9 per Notification 7/2023-CT, capped on the turnover entered above.</li>
        <li>Interest u/s 50(1): 18% p.a. simple, per day, on the net cash tax of the period's GSTR-3B (after ITC), counted from the day after the due date. For QRMP, monthly PMT-06 deposits are not modelled — interest is on the quarter's cash tax.</li>
        <li>Filed marks are stored on this device (and in backups) per GSTIN. GSTR-9 is optional up to ₹2 crore turnover.</li>
      </ul>
    </>
  );
}

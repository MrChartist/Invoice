import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/ui/PageHeader';
import { useToast } from '../components/ui/useToast';
import { Download, FileJson, FileSpreadsheet, Printer, ShieldAlert } from 'lucide-react';
import { getTable } from '../lib/storage';
import { localDb } from '../lib/localDb';
import { formatDate, formatMoney } from '../lib/utils';
import { stateByCode } from '../lib/india-states';
import {
  buildGstReport,
  periodForDate,
  periodLabel,
  type CdnRow,
  type DocRow,
  type ExportRow,
  type ReportPeriod,
} from '../lib/gst-reports';
import {
  buildGstr1Json,
  buildSummaryHtml,
  gstr3bCsv,
  nilLabel,
  sectionCsv,
  type SectionId,
} from '../lib/gstr-json';
import type { InvoiceRecord, SenderProfile } from '../types/invoice';
import { DataTable, Money, type Column } from '../components/gst-reports/DataTable';
import { Gstr3bView } from '../components/gst-reports/Gstr3bView';
import { PeriodPicker } from '../components/gst-reports/PeriodPicker';
import { ReconBanner } from '../components/gst-reports/ReconBanner';
import surface from '../styles/surface.module.css';
import controls from '../styles/controls.module.css';
import styles from './GstReports.module.css';
import local from '../components/gst-reports/gst-reports.module.css';

const TURNOVER_KEY = 'mrchartist_inv_gstr1_turnover';

type TabId = 'overview' | 'b2b' | 'b2cl' | 'b2cs' | 'cdnr' | 'cdnur' | 'exp' | 'nil' | 'hsn' | 'docs' | 'gstr3b';

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'b2b', label: 'B2B' },
  { id: 'b2cl', label: 'B2CL' },
  { id: 'b2cs', label: 'B2CS' },
  { id: 'cdnr', label: 'CDNR' },
  { id: 'cdnur', label: 'CDNUR' },
  { id: 'exp', label: 'Exports' },
  { id: 'nil', label: 'Nil / Exempt' },
  { id: 'hsn', label: 'HSN' },
  { id: 'docs', label: 'Documents' },
  { id: 'gstr3b', label: 'GSTR-3B' },
];

function download(name: string, mime: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const pos = (code: string) => {
  if (code === '96') return '96 - Other Countries';
  const s = stateByCode(code);
  return s ? `${s.code} - ${s.name}` : code || '-';
};

export function GstReports() {
  const { notify, toastNode } = useToast();
  const invoices = useMemo(() => getTable<InvoiceRecord>('invoices'), []);
  const purchases = useMemo(() => getTable<unknown>('purchases'), []);
  const profiles = useMemo<SenderProfile[]>(() => localDb.settings.get().profiles, []);

  const gstins = useMemo(() => {
    const set = new Set<string>();
    for (const p of profiles) if (p?.companyGstin) set.add(p.companyGstin.trim().toUpperCase());
    for (const i of invoices) if (i?.sender?.companyGstin) set.add(i.sender.companyGstin.trim().toUpperCase());
    return [...set];
  }, [profiles, invoices]);

  const fyOptions = useMemo(() => {
    const now = periodForDate('fy', new Date()).fyStart;
    const years = new Set<number>([now, now - 1]);
    for (const i of invoices) if (i?.issue_date) years.add(periodForDate('fy', i.issue_date).fyStart);
    return [...years].sort((a, b) => b - a);
  }, [invoices]);

  const [period, setPeriod] = useState<ReportPeriod>(() => {
    // Default to the previous month — the one that is normally being filed.
    // Build from the 1st: setMonth(-1) on e.g. 31 Oct would overflow into October again.
    const now = new Date();
    return periodForDate('month', new Date(now.getFullYear(), now.getMonth() - 1, 1));
  });
  const [gstin, setGstin] = useState<string>(() => gstins[0] ?? '');
  const [tab, setTab] = useState<TabId>('overview');
  // Aggregate turnover for the JSON header — entered by the filer, remembered on this device.
  const [turnover, setTurnover] = useState<{ gt: string; curGt: string }>(() => {
    try {
      const v = JSON.parse(localStorage.getItem(TURNOVER_KEY) || '{}');
      return { gt: String(v.gt ?? ''), curGt: String(v.curGt ?? '') };
    } catch {
      return { gt: '', curGt: '' };
    }
  });
  const patchTurnover = (next: { gt: string; curGt: string }) => {
    setTurnover(next);
    try {
      localStorage.setItem(TURNOVER_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — value stays for this session */
    }
  };

  const report = useMemo(() => {
    const prof = profiles.find((p) => p?.companyGstin?.trim().toUpperCase() === gstin);
    return buildGstReport(invoices, purchases, { period, gstin, filerStateCode: prof?.stateCode });
  }, [invoices, purchases, profiles, period, gstin]);

  const { gstr1: g1, gstr3b: g3, issues } = report;
  const label = periodLabel(period);
  const fileBase = `GSTR1_${gstin || 'all'}_${g1.fp}`;
  const hasData = g1.counts.included > 0;

  const counts: Partial<Record<TabId, number>> = {
    b2b: g1.b2b.length, b2cl: g1.b2cl.length, b2cs: g1.b2cs.length, cdnr: g1.cdnr.length,
    cdnur: g1.cdnur.length, exp: g1.exp.length, nil: g1.nil.length, hsn: g1.hsn.length, docs: g1.docIssue.length,
  };

  const printSummary = () => {
    const html = buildSummaryHtml(report, label, profiles.find((p) => p?.companyGstin?.trim().toUpperCase() === gstin)?.companyName);
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const w = window.open(url, '_blank');
    if (w) w.addEventListener('load', () => w.print());
    else notify('Your browser blocked the print window — allow pop-ups for this site and try again', 'error');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  /* ── column sets ── */
  const docCols = <T extends DocRow>(isNote = false): Column<T>[] => [
    { key: 'ctin', label: 'GSTIN', render: (r) => <span className={surface.mono}>{r.ctin || '-'}</span> },
    { key: 'party', label: 'Receiver', render: (r) => r.partyName || '-' },
    {
      key: 'no',
      label: isNote ? 'Note no' : 'Invoice no',
      render: (r) => <Link to={`/invoice/${r.invoiceId}`} className={local.issueLink}>{r.number || '(no number)'}</Link>,
    },
    { key: 'date', label: 'Date', render: (r) => formatDate(r.date) },
    { key: 'value', label: 'Value', numeric: true, render: (r) => <Money value={r.value} />, total: (r) => r.value },
    { key: 'pos', label: 'Place of supply', render: (r) => pos(r.pos) },
    { key: 'rate', label: 'Rate %', numeric: true, render: (r) => r.items.map((i) => i.rate).join(', ') || '-' },
    { key: 'txval', label: 'Taxable', numeric: true, render: (r) => <Money value={r.taxable} />, total: (r) => r.taxable },
    { key: 'igst', label: 'IGST', numeric: true, render: (r) => <Money value={r.igst} />, total: (r) => r.igst },
    { key: 'cgst', label: 'CGST', numeric: true, render: (r) => <Money value={r.cgst} />, total: (r) => r.cgst },
    { key: 'sgst', label: 'SGST', numeric: true, render: (r) => <Money value={r.sgst} />, total: (r) => r.sgst },
  ];

  const sectionBody = () => {
    switch (tab) {
      case 'b2b':
        return <DataTable columns={docCols()} rows={g1.b2b} rowKey={(r) => r.invoiceId} caption="B2B invoices" emptyText="No invoices to registered businesses in this period." />;
      case 'b2cl':
        return <DataTable columns={docCols()} rows={g1.b2cl} rowKey={(r) => r.invoiceId} caption="B2CL invoices" emptyText="No inter-state invoices above ₹2.5 lakh to unregistered buyers." />;
      case 'cdnr':
        return <DataTable columns={docCols(true)} rows={g1.cdnr} rowKey={(r) => r.invoiceId} caption="Credit notes to registered persons" emptyText="No credit notes to registered persons." />;
      case 'cdnur': {
        const cols: Column<CdnRow>[] = [
          ...docCols<CdnRow>(true),
          { key: 'typ', label: 'UR type', render: (r) => r.unregType ?? '' },
        ];
        return <DataTable columns={cols} rows={g1.cdnur} rowKey={(r) => r.invoiceId} caption="Credit notes to unregistered persons" emptyText="No unregistered credit notes need separate reporting. Smaller ones are netted in B2CS." />;
      }
      case 'exp': {
        const cols: Column<ExportRow>[] = [
          ...docCols<ExportRow>().filter((c) => c.key !== 'ctin'),
          { key: 'typ', label: 'Type', render: (r) => (r.expType === 'WPAY' ? 'With IGST' : 'Without IGST (LUT)') },
        ];
        return <DataTable columns={cols} rows={g1.exp} rowKey={(r) => r.invoiceId} caption="Export invoices" emptyText="No export invoices (place of supply 96 - Other Countries)." />;
      }
      case 'b2cs':
        return (
          <DataTable
            caption="B2CS summary"
            emptyText="No small B2C supplies in this period."
            rows={g1.b2cs}
            rowKey={(r) => `${r.supply}${r.pos}${r.rate}`}
            columns={[
              { key: 'sply', label: 'Supply', render: (r) => (r.supply === 'INTRA' ? 'Intra-state' : 'Inter-state') },
              { key: 'pos', label: 'Place of supply', render: (r) => pos(r.pos) },
              { key: 'rate', label: 'Rate %', numeric: true, render: (r) => r.rate },
              { key: 'tx', label: 'Taxable', numeric: true, render: (r) => <Money value={r.txval} />, total: (r) => r.txval },
              { key: 'i', label: 'IGST', numeric: true, render: (r) => <Money value={r.igst} />, total: (r) => r.igst },
              { key: 'c', label: 'CGST', numeric: true, render: (r) => <Money value={r.cgst} />, total: (r) => r.cgst },
              { key: 's', label: 'SGST', numeric: true, render: (r) => <Money value={r.sgst} />, total: (r) => r.sgst },
            ]}
          />
        );
      case 'nil':
        return (
          <DataTable
            caption="Nil-rated, exempt and non-GST outward supplies"
            emptyText="No nil-rated or non-GST supplies."
            rows={g1.nil}
            rowKey={(r) => r.type}
            columns={[
              { key: 'd', label: 'Description', render: (r) => nilLabel(r.type) },
              { key: 'n', label: 'Nil rated', numeric: true, render: (r) => <Money value={r.nil} />, total: (r) => r.nil },
              { key: 'e', label: 'Exempted', numeric: true, render: (r) => <Money value={r.exempt} />, total: (r) => r.exempt },
              { key: 'g', label: 'Non-GST', numeric: true, render: (r) => <Money value={r.nonGst} />, total: (r) => r.nonGst },
            ]}
          />
        );
      case 'hsn':
        return (
          <DataTable
            caption="HSN-wise summary"
            emptyText="No HSN/SAC data in this period."
            rows={g1.hsn}
            rowKey={(r) => `${r.hsn}${r.uqc}${r.rate}`}
            columns={[
              { key: 'h', label: 'HSN/SAC', render: (r) => <span className={surface.mono}>{r.hsn}</span> },
              { key: 'd', label: 'Description', render: (r) => r.description },
              { key: 'u', label: 'UQC', render: (r) => r.uqc },
              { key: 'q', label: 'Qty', numeric: true, render: (r) => r.qty },
              { key: 'v', label: 'Total value', numeric: true, render: (r) => <Money value={r.value} />, total: (r) => r.value },
              { key: 'r', label: 'Rate %', numeric: true, render: (r) => r.rate },
              { key: 't', label: 'Taxable', numeric: true, render: (r) => <Money value={r.taxable} />, total: (r) => r.taxable },
              { key: 'i', label: 'IGST', numeric: true, render: (r) => <Money value={r.igst} />, total: (r) => r.igst },
              { key: 'c', label: 'CGST', numeric: true, render: (r) => <Money value={r.cgst} />, total: (r) => r.cgst },
              { key: 's', label: 'SGST', numeric: true, render: (r) => <Money value={r.sgst} />, total: (r) => r.sgst },
            ]}
          />
        );
      case 'docs':
        return (
          <DataTable
            caption="Documents issued"
            emptyText="No numbered tax documents in this period."
            rows={g1.docIssue}
            rowKey={(r) => `${r.docType}${r.series}`}
            columns={[
              { key: 't', label: 'Document type', render: (r) => r.docType },
              { key: 's', label: 'Series', render: (r) => <span className={surface.mono}>{r.series}</span> },
              { key: 'f', label: 'From', render: (r) => <span className={surface.mono}>{r.from}</span> },
              { key: 'to', label: 'To', render: (r) => <span className={surface.mono}>{r.to}</span> },
              { key: 'tot', label: 'Total', numeric: true, render: (r) => r.total, total: (r) => r.total, totalFormat: String },
              { key: 'c', label: 'Cancelled', numeric: true, render: (r) => r.cancelled, total: (r) => r.cancelled, totalFormat: String },
              { key: 'n', label: 'Net issued', numeric: true, render: (r) => r.netIssued, total: (r) => r.netIssued, totalFormat: String },
            ]}
          />
        );
      case 'gstr3b':
        return <Gstr3bView report={g3} />;
      default:
        return null;
    }
  };

  const csvTabs: SectionId[] = ['b2b', 'b2cl', 'b2cs', 'cdnr', 'cdnur', 'exp', 'nil', 'hsn', 'docs'];
  const isCsvTab = (csvTabs as string[]).includes(tab);

  const t = g1.totals;
  const tiles: { label: string; value: string; hint: string }[] = [
    { label: 'Taxable value', value: formatMoney(t.taxable), hint: `${g1.counts.included} documents, net of credit notes` },
    { label: 'IGST', value: formatMoney(t.igst), hint: 'Outward, net' },
    { label: 'CGST + SGST', value: formatMoney(t.cgst + t.sgst), hint: `CGST ${formatMoney(t.cgst)} · SGST ${formatMoney(t.sgst)}` },
    { label: 'Payable in cash (3B)', value: formatMoney(g3.payment.cash.igst + g3.payment.cash.cgst + g3.payment.cash.sgst), hint: 'After ITC set-off' },
  ];

  return (
    <div className={surface.page}>
      <PageHeader
        title="GST reports"
        subtitle="GSTR-1 sections and GSTR-3B summary, prepared offline from your invoices and purchases."
        actions={
          <>
          <button type="button" className={`${controls.btn} ${controls.btnPrimary}`} disabled={!hasData || !gstin} title={!gstin ? 'Add a GSTIN in Settings to export GSTR-1 JSON' : undefined}
            onClick={() => download(`${fileBase}.json`, 'application/json', JSON.stringify(buildGstr1Json(g1, { gt: Number(turnover.gt) || 0, curGt: Number(turnover.curGt) || 0 }), null, 2))}>
            <FileJson size={16} aria-hidden /> GSTR-1 JSON
          </button>
          <button type="button" className={`${controls.btn} ${controls.btnOutline}`} disabled={!hasData}
            onClick={() => download(`GSTR3B_${gstin || 'all'}_${g1.fp}.csv`, 'text/csv', gstr3bCsv(g3))}>
            <FileSpreadsheet size={16} aria-hidden /> GSTR-3B CSV
          </button>
          <button type="button" className={`${controls.btn} ${controls.btnOutline}`} disabled={!hasData} onClick={printSummary}>
            <Printer size={16} aria-hidden /> Print summary
          </button>
          </>
        }
      />

      <section className={`${surface.card} ${styles.filters}`} aria-label="Report filters">
        <PeriodPicker value={period} onChange={setPeriod} fyOptions={fyOptions} />
        <label className={local.periodField}>
          <span className={controls.label}>Filer GSTIN</span>
          <select className={controls.select} value={gstin} onChange={(e) => setGstin(e.target.value)}>
            <option value="">All sender profiles</option>
            {gstins.map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </select>
        </label>
        <label className={local.periodField}>
          <span className={controls.label}>Last FY turnover (₹)</span>
          <input className={controls.input} inputMode="decimal" placeholder="0" value={turnover.gt}
            onChange={(e) => patchTurnover({ ...turnover, gt: e.target.value.replace(/[^0-9.]/g, '') })} />
        </label>
        <label className={local.periodField}>
          <span className={controls.label}>This FY turnover so far (₹)</span>
          <input className={controls.input} inputMode="decimal" placeholder="0" value={turnover.curGt}
            onChange={(e) => patchTurnover({ ...turnover, curGt: e.target.value.replace(/[^0-9.]/g, '') })} />
        </label>
        <p className={controls.hint} style={{ margin: 0, flexBasis: '100%' }}>
          Written to the JSON as <code>gt</code> / <code>cur_gt</code>. Enter from your books; needs verification with your CA.
        </p>
        {period.kind !== 'month' && (
          <p className={controls.hint} style={{ margin: 0 }}>
            Return period in the JSON is {g1.fp} (last month covered). GSTN files GSTR-1 monthly or quarterly (QRMP); upload one month at a time unless you are a quarterly filer.
          </p>
        )}
      </section>

      <div className={`${surface.card} ${local.disclaimer}`} role="note">
        <ShieldAlert size={18} aria-hidden style={{ flexShrink: 0, color: 'var(--warning)' }} />
        <span>
          <strong>Verify with your CA before filing.</strong> This is a working paper, not a filed return. Based on issue date, non-draft, non-cancelled tax documents; composition, ISD, imports, e-commerce (TCS), amendments and interest/late fee are not handled. B2CL threshold is ₹2.5 lakh. JSON follows the GST offline-tool layout but is not schema-validated against the portal.
        </span>
      </div>

      <ReconBanner issues={issues} />

      <div className={surface.statGrid}>
        {tiles.map((x) => (
          <div key={x.label} className={surface.stat}>
            <div className={surface.statTop}><span className={surface.statLabel}>{x.label}</span></div>
            <div className={surface.statValue}>{x.value}</div>
            <div className={surface.statHint}>{x.hint}</div>
          </div>
        ))}
      </div>

      <section className={surface.card} aria-label="Report sections">
        <div className={local.tabs} role="tablist" aria-label="Report sections">
          {TABS.map((x) => (
            <button
              key={x.id}
              type="button"
              role="tab"
              id={`gst-tab-${x.id}`}
              aria-selected={tab === x.id}
              aria-controls="gst-panel"
              className={tab === x.id ? local.tabActive : local.tab}
              onClick={() => setTab(x.id)}
            >
              {x.label}
              {counts[x.id] ? <span className={local.tabCount}>{counts[x.id]}</span> : null}
            </button>
          ))}
        </div>
        <div className={local.tabBody} role="tabpanel" id="gst-panel" aria-labelledby={`gst-tab-${tab}`}>
          <div className={local.toolbar}>
            <h2 className={local.tbHeading}>{TABS.find((x) => x.id === tab)?.label} · {label}</h2>
            {isCsvTab && (
              <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`}
                onClick={() => download(`${fileBase}_${tab}.csv`, 'text/csv', sectionCsv(g1, tab as SectionId))}>
                <Download size={14} aria-hidden /> Download CSV
              </button>
            )}
          </div>
          {tab === 'overview' ? (
            <Overview />
          ) : (
            sectionBody()
          )}
        </div>
      </section>
      {toastNode}
    </div>
  );

  function Overview() {
    if (!hasData) {
      return (
        <p className={surface.sectionNote}>
          No reportable tax documents in {label}. Create a tax invoice from <Link to="/invoice" className={local.issueLink}>the invoice creator</Link>; drafts, cancelled documents, quotations, proformas and challans are excluded.
        </p>
      );
    }
    const rows = [
      { id: 'b2b' as const, name: 'B2B - registered recipients', n: g1.b2b.length, tx: sumOf(g1.b2b, 'taxable'), tax: sumOf(g1.b2b, 'igst') + sumOf(g1.b2b, 'cgst') + sumOf(g1.b2b, 'sgst') },
      { id: 'b2cl' as const, name: 'B2CL - large inter-state B2C', n: g1.b2cl.length, tx: sumOf(g1.b2cl, 'taxable'), tax: sumOf(g1.b2cl, 'igst') },
      { id: 'b2cs' as const, name: 'B2CS - other B2C (net)', n: g1.b2cs.length, tx: sumOf(g1.b2cs, 'txval'), tax: sumOf(g1.b2cs, 'igst') + sumOf(g1.b2cs, 'cgst') + sumOf(g1.b2cs, 'sgst') },
      { id: 'cdnr' as const, name: 'CDNR - credit notes (registered)', n: g1.cdnr.length, tx: sumOf(g1.cdnr, 'taxable'), tax: sumOf(g1.cdnr, 'igst') + sumOf(g1.cdnr, 'cgst') + sumOf(g1.cdnr, 'sgst') },
      { id: 'cdnur' as const, name: 'CDNUR - credit notes (unregistered / export)', n: g1.cdnur.length, tx: sumOf(g1.cdnur, 'taxable'), tax: sumOf(g1.cdnur, 'igst') + sumOf(g1.cdnur, 'cgst') + sumOf(g1.cdnur, 'sgst') },
      { id: 'exp' as const, name: 'Exports', n: g1.exp.length, tx: sumOf(g1.exp, 'taxable'), tax: sumOf(g1.exp, 'igst') },
    ];
    return (
      <>
        <DataTable
          caption="GSTR-1 overview"
          emptyText=""
          rows={rows}
          rowKey={(r) => r.id}
          columns={[
            { key: 'n', label: 'Section', render: (r) => <button type="button" className={local.issueLink} style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }} onClick={() => setTab(r.id)}>{r.name}</button> },
            { key: 'c', label: 'Rows', numeric: true, render: (r) => r.n },
            { key: 'tx', label: 'Taxable', numeric: true, render: (r) => <Money value={r.tx} /> },
            { key: 'tax', label: 'Tax', numeric: true, render: (r) => <Money value={r.tax} /> },
          ]}
        />
        <p className={surface.sectionNote}>
          Excluded in this period: {g1.counts.drafts} draft, {g1.counts.cancelled} cancelled, {g1.counts.notTaxDocs} non-tax document(s) (quotation / proforma / challan). Credit notes are shown positive in CDNR/CDNUR and netted in totals, B2CS, nil, HSN and 3B.
        </p>
      </>
    );
  }
}

function sumOf<T>(rows: T[], key: string): number {
  return Math.round(rows.reduce((s, r) => s + ((r as Record<string, number>)[key] ?? 0), 0) * 100) / 100;
}

export default GstReports;

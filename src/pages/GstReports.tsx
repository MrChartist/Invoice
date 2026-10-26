import { lazy, Suspense, useMemo, useState, type KeyboardEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/ui/PageHeader';
import { useToast } from '../components/ui/useToast';
import { CalendarRange, CheckCircle2, Download, FileJson, FileSpreadsheet, Files, Printer, ShieldAlert } from 'lucide-react';
import { getTable, peekTable, readRaw, writeRaw } from '../lib/storage';
import { localDb } from '../lib/localDb';
import { formatDate, formatMoney } from '../lib/utils';
import { stateByCode } from '../lib/india-states';
import { readLinks } from '../lib/documents';
import { loadIsdInward } from '../lib/isd';
import { seriesGaps } from '../lib/invoice-number';
import {
  buildGstReport,
  periodForDate,
  periodLabel,
  periodRange,
  type AdvanceTableRow,
  type AmendCdnRow,
  type AmendDocRow,
  type CdnRow,
  type DocRow,
  type ExportRow,
  type ReportPeriod,
} from '../lib/gst-reports';
import {
  buildGstr1Json,
  buildSummaryHtml,
  gstr3bCsv,
  buildGstr3bJson,
  nilLabel,
  sectionCsv,
  type SectionId,
} from '../lib/gstr-json';
import { buildIffJson, iffCheck, isIffMonth } from '../lib/iff';
import { o7T } from '../i18n/areas/gst-tds-7o';
import type { InvoiceRecord, Payment, SenderProfile } from '../types/invoice';
import type { AdvanceRecord } from '../types/advances';
import type { PurchaseReturn } from '../types/purchases';
import { advanceTaxEvents } from '../lib/advance-tax';
import { buildItemIndex, stockDb } from '../lib/inventory';
import { unitsDb } from '../lib/units';
import { DataTable, Money, type Column } from '../components/gst-reports/DataTable';
import { Gstr3bView } from '../components/gst-reports/Gstr3bView';
import { PeriodPicker } from '../components/gst-reports/PeriodPicker';
import { ReconBanner } from '../components/gst-reports/ReconBanner';
import { ComplianceView } from '../components/gst-reports/ComplianceView';
// GSTR-2B matcher (+ its xlsx/zip reader) loads only when the tab is opened.
const Gstr2bView = lazy(() => import('../components/gst-reports/Gstr2bView'));
// Composition returns (CMP-08 / GSTR-4, roadmap 5.9): loaded when the tab is opened.
const CompositionView = lazy(() => import('../components/gst-reports/CompositionView'));
// E-commerce operators (GSTR-1 Table 14, 3B 3.1.1): loaded when the tab is opened.
const EcoView = lazy(() => import('../components/gst-reports/EcoView'));
import { checkGstin } from '../lib/gstin';
import { GST_TABS, GST_TAB_GROUPS, resolveGstTab, tabForKey, type GstTabGroupId, type GstTabId } from '../lib/gst-tabs';
import { buildPreflight, needsPreflight, preflightCount, type PreflightForm } from '../lib/gst-preflight';
import { aatoFor, gstExceptions } from '../lib/gst-guards';
import { filedFor, loadFiled, saveFiled, setFiled, type FiledReturn, type ReturnDue } from '../lib/compliance';
import { todayIso } from '../lib/tax-rules';
import { fiT } from '../i18n/areas/filing';
import filing from '../components/gst-reports/filing.module.css';
import { parseCsv } from '../lib/csv';
import type { HsnRow } from '../lib/gst-reports';
import surface from '../styles/surface.module.css';
import controls from '../styles/controls.module.css';
import styles from './GstReports.module.css';
import local from '../components/gst-reports/gst-reports.module.css';
import { useT } from '../i18n';
import { gstT } from '../i18n/areas/gst';
import { dkT } from '../i18n/areas/desks-r3'; // R3-C4 / C5 tab names
import { nodes } from '../i18n/areas/nodes';

const TURNOVER_KEY = 'mrchartist_inv_gstr1_turnover';
// Same table as `EINVOICE_META_TABLE` in einvoice.ts — read directly so the e-invoice builder stays out of this chunk.
const EINVOICE_META_TABLE = 'einvoice_meta';

// Annual GSTR-9 working paper (5.2) and bulk e-Invoice / e-Way + IRP response import (6.24): loaded on open.
const Gstr9Modal = lazy(() => import('../components/gst-reports/Gstr9Modal'));
const BulkEInvoiceModal = lazy(() => import('../components/einvoice/BulkEInvoiceModal'));
// WP-6 GST depth: set-off & PMT-06 challans, purchase HSN register, monthly 1-vs-3B-vs-books, HSN master, GSTR-9C.
const SetOffPanel = lazy(() => import('../components/gst-reports/SetOffPanel'));
const PurchaseHsnView = lazy(() => import('../components/gst-reports/PurchaseHsnView'));
const ReconMonthly = lazy(() => import('../components/gst-reports/ReconMonthly'));
const HsnMasterPanel = lazy(() => import('../components/gst-reports/HsnMasterPanel'));
const Gstr9cView = lazy(() => import('../components/gst-reports/Gstr9cView'));
// 7O: RCM self-invoices (Rule 46(f)) and payment vouchers (Rule 52); IFF B2B working paper.
const RcmDocsPanel = lazy(() => import('../components/gst-reports/RcmDocsPanel'));
// 7R: cash ledger / PMT-09 / refunds, ISD + GSTR-6, consolidated e-Way Bill, GSTR-1 / 3B per GSTIN (one lazy chunk).
const Gst7rPanel = lazy(() => import('../components/gst-reports/Gst7rPanel'));
// 8D: GST guards 2025-26 (IRP window, exceptions, GSTR-1A, Table 3.2, pushed 2B ITC).
const Gst8dPanel = lazy(() => import('../components/gst-reports/Gst8dPanel'));

type TabId = GstTabId;
const TABS = GST_TABS;
const GROUP_LABEL: Record<GstTabGroupId, Parameters<typeof fiT>[0]> = { gstr1: 'groupGstr1', gstr3b: 'groupGstr3b', recon: 'groupRecon', tools: 'groupTools' };
// 8I: the check before a JSON download — loaded when there is something to show.
// R3-C4 / C5: GSTR-1 portal files and the e-Way desk (lazy tabs; working papers).
const PortalFilesView = lazy(() => import('../components/gst-reports/PortalFilesView'));
const EwayDesk = lazy(() => import('../components/gst-reports/EwayDesk'));
const PreflightDialog = lazy(() => import('../components/gst-reports/PreflightDialog'));

const tabLabel = (x: { label: string; key?: Parameters<typeof gstT>[0]; desk?: 'tab.portal' | 'tab.eway' } | undefined) => (x?.desk ? dkT(x.desk) : x?.key ? gstT(x.key) : x?.label);

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
  if (code === '96') return gstT('otherCountries');
  const s = stateByCode(code);
  return s ? `${s.code} - ${s.name}` : code || '-';
};

export function GstReports() {
  useT();
  const { notify, toastNode } = useToast();
  // PERF-2: shared, parsed-once rows. The report builders and panels only read them (never mutate).
  const invoices = useMemo(() => peekTable<InvoiceRecord>('invoices') as InvoiceRecord[], []);
  const purchases = useMemo(() => peekTable<unknown>('purchases') as unknown[], []);
  // Advance receipts (5.3): GSTR-1 Table 11 and their effect on 3B 3.1(a).
  const advances = useMemo(
    () => advanceTaxEvents(getTable<AdvanceRecord>('advances'), peekTable<Payment>('transactions') as Payment[], invoices),
    [invoices],
  );
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
  const [params] = useSearchParams();
  // A composition profile files CMP-08 / GSTR-4, not GSTR-1 / 3B (Sec 10; Rule 62).
  const compositionProfile = useMemo(() => {
    const prof = gstin ? profiles.find((p) => p?.companyGstin?.trim().toUpperCase() === gstin) : localDb.settings.activeProfile();
    return prof?.gst_scheme === 'composition' ? prof : null;
  }, [profiles, gstin]);
  const [tab, setTab] = useState<TabId>(() => {
    const t = resolveGstTab(params.get('tab'));
    if (t) return t;
    const prof = gstins[0] ? profiles.find((p) => p?.companyGstin?.trim().toUpperCase() === gstins[0]) : localDb.settings.activeProfile();
    return prof?.gst_scheme === 'composition' ? 'composition' : 'overview';
  });
  // Aggregate turnover for the JSON header — entered by the filer, remembered on this device.
  const [turnover, setTurnover] = useState<{ gt: string; curGt: string }>(() => {
    try {
      const v = JSON.parse(readRaw(TURNOVER_KEY) || '{}');
      return { gt: String(v.gt ?? ''), curGt: String(v.curGt ?? '') };
    } catch {
      return { gt: '', curGt: '' };
    }
  });
  const patchTurnover = (next: { gt: string; curGt: string }) => {
    setTurnover(next);
    try {
      writeRaw(TURNOVER_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — value stays for this session */
    }
  };

  const lastFyTurnover = Number(turnover.gt) || 0;
  const [annualOpen, setAnnualOpen] = useState<'' | 'gstr9' | 'bulk'>('');
  const filerStateCode = useMemo(() => {
    const prof = profiles.find((p) => p?.companyGstin?.trim().toUpperCase() === gstin) ?? localDb.settings.activeProfile();
    return checkGstin(gstin || prof?.companyGstin || '').stateCode ?? prof?.stateCode ?? '';
  }, [profiles, gstin]);
  // Rule 46 series gaps across the whole FY of the selected period (issued tax documents only).
  const fyLabel = `${String(period.fyStart).slice(2)}-${String(period.fyStart + 1).slice(2)}`;
  const gaps = useMemo(
    () =>
      seriesGaps(
        invoices
          .filter((i) => i && i.status !== 'Draft' && ['INVOICE', 'TAX_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'BILL_OF_SUPPLY'].includes(i.doc_type))
          .map((i) => i.invoice_number),
        fyLabel,
      ),
    [invoices, fyLabel],
  );

  const report = useMemo(() => {
    const prof = profiles.find((p) => p?.companyGstin?.trim().toUpperCase() === gstin);
    return buildGstReport(invoices, purchases, {
      period, gstin, filerStateCode: prof?.stateCode, links: readLinks(), turnover: lastFyTurnover, advances,
      purchaseNotes: getTable<PurchaseReturn>('purchase_returns'),
      // 7R: ISD credit received by our unit(s) — 3B 4A(4).
      isdInward: loadIsdInward(),
      // WP-8: user-defined UQCs, and alternate-unit lines summarised in the item's base unit.
      units: unitsDb.stored(),
      items: buildItemIndex(stockDb.items()),
    });
  }, [invoices, purchases, profiles, period, gstin, lastFyTurnover, advances]);

  const { gstr1: g1, gstr3b: g3, issues } = report;
  const label = periodLabel(period);
  const fileBase = `GSTR1_${gstin || 'all'}_${g1.fp}`;
  const am = g1.amendments;
  const amendCount = am ? (am.expa?.length ?? 0) + am.b2ba.length + am.b2cla.length + am.cdnra.length + am.cdnura.length + am.b2csa.length : 0;
  const hasData = g1.counts.included > 0 || amendCount > 0 || !!g1.at?.length || !!g1.txpd?.length;

  // 8I (8.161): what to look at before the JSON leaves the app — GST exceptions, the report's errors / warnings
  // and the Rule 46 series gaps, grouped. Same data as the guards tab, the recon banner and the Documents tab.
  const preflight = useMemo(() => {
    const irnIds = new Set(getTable<{ invoice_id?: string; irn?: string }>(EINVOICE_META_TABLE).filter((m) => m?.irn && m.invoice_id).map((m) => m.invoice_id as string));
    const s = localDb.settings.get();
    const active = s.profiles.find((p) => p.id === s.activeProfileId) ?? null;
    const exceptions = gstExceptions(invoices, { ...periodRange(period), irnIds, aato: (inv) => aatoFor(inv, s.profiles, active), today: todayIso(), gstin });
    return buildPreflight({ exceptions, issues, gaps });
  }, [invoices, period, gstin, issues, gaps]);
  const checkCount = preflightCount(preflight);
  // R3-C4: unresolved portal errors of this period × GSTIN add an optional step to the filing strip.
  // Same count as `openPortalErrors` (gst-portal-files.ts), inlined so the reader stays in its lazy tab chunk.
  const portalErrors = (() => getTable<{ kind?: string; period?: string; gstin?: string; findings?: { key: string }[]; resolved?: Record<string, true> }>('gst_portal_files')
      .filter((r) => r?.kind === 'gstr1_error' && r.period === g1.fp && (!gstin || !r.gstin || r.gstin === gstin))
      .reduce((n, r) => n + (r.findings ?? []).filter((f) => !r.resolved?.[f.key]).length, 0))();
  const navigate = useNavigate();
  const [pending, setPending] = useState<null | { form: PreflightForm | null; run?: () => boolean }>(null);
  const [downloaded, setDownloaded] = useState('');
  const FORM_NAME: Record<PreflightForm, string> = { GSTR1: 'GSTR-1 JSON', GSTR3B: 'GSTR-3B JSON', IFF: 'IFF JSON' };
  const downloadGstr1 = () => {
    download(`${fileBase}.json`, 'application/json', JSON.stringify(buildGstr1Json(g1, { gt: Number(turnover.gt) || 0, curGt: Number(turnover.curGt) || 0 }), null, 2));
    return true;
  };
  const downloadIff = () => {
    // 7O (7.98): IFF for QRMP months 1–2 — B2B / CDNR only, ₹50 lakh a month (working paper).
    const chk = iffCheck(g1, period, periodRange(period).from);
    if (chk.warnings.includes('OVER_LIMIT')) notify(o7T('iffOver', { value: formatMoney(chk.value) }), 'error');
    else if (chk.warnings.includes('EMPTY')) {
      notify(o7T('iffEmpty'), 'info');
      return false;
    }
    download(`IFF_${gstin}_${g1.fp}.json`, 'application/json', JSON.stringify(buildIffJson(g1), null, 2));
    return true;
  };
  const downloadGstr3b = () => {
    download(`GSTR3B_${gstin}_${g1.fp}.json`, 'application/json', JSON.stringify(buildGstr3bJson(g3, gstin, g1.fp), null, 2));
    return true;
  };
  const periodTag = `${g1.fp}|${gstin}`;
  /** Clean → download now; otherwise show the grouped problems first ("Download anyway" / "Review"). */
  const guarded = (form: PreflightForm, run: () => boolean) => {
    if (needsPreflight(preflight)) return setPending({ form, run });
    if (run()) setDownloaded(periodTag);
  };
  const badge = checkCount > 0 ? <span className={filing.badge} title={fiT('badgeTitle', { n: checkCount })} data-json-badge>· {checkCount} ⚠</span> : null;

  // Step 4: mark GSTR-1 / GSTR-3B filed for this period (same `compliance` table as the Compliance tab).
  const [filedRows, setFiledRows] = useState<FiledReturn[]>(() => loadFiled());
  const periodKey = period.kind === 'month' ? periodRange(period).from.slice(0, 7) : period.kind === 'quarter' ? `${period.fyStart}-Q${period.quarter}` : '';
  const returnFor = (form: 'GSTR1' | 'GSTR3B'): ReturnDue => {
    const { from, to } = periodRange(period);
    return { id: `${form}:${periodKey}`, form, periodKey, label, from, to, due: to, optional: false };
  };
  const isFiled = (form: 'GSTR1' | 'GSTR3B') => !!periodKey && !!filedFor(filedRows, returnFor(form), gstin);
  const toggleFiled = (form: 'GSTR1' | 'GSTR3B') => {
    const next = setFiled(filedRows, returnFor(form), gstin, isFiled(form) ? null : todayIso());
    setFiledRows(next);
    try {
      saveFiled(next);
    } catch {
      notify(fiT('markFailed'), 'error');
    }
  };

  // Arrow keys move between section tabs across the groups (Tab still walks every tab button).
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const next = tabForKey(tab, e.key);
    if (!next) return;
    e.preventDefault();
    setTab(next);
    requestAnimationFrame(() => document.getElementById(`gst-tab-${next}`)?.focus());
  };

  const counts: Partial<Record<TabId, number>> = {
    b2b: g1.b2b.length, b2cl: g1.b2cl.length, b2cs: g1.b2cs.length, cdnr: g1.cdnr.length,
    cdnur: g1.cdnur.length, exp: g1.exp.length, nil: g1.nil.length, at: g1.at?.length ?? 0, txpd: g1.txpd?.length ?? 0, hsn: g1.hsn.length, docs: g1.docIssue.length,
    amend: amendCount,
    eco: (g1.eco?.tcs.length ?? 0) + (g1.eco?.pay95.length ?? 0),
  };

  const printSummary = () => {
    const html = buildSummaryHtml(report, label, profiles.find((p) => p?.companyGstin?.trim().toUpperCase() === gstin)?.companyName);
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    const w = window.open(url, '_blank');
    if (w) w.addEventListener('load', () => w.print());
    else notify(gstT('popupBlocked'), 'error');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  /* ── column sets ── */
  const docCols = <T extends DocRow>(isNote = false): Column<T>[] => [
    { key: 'ctin', label: gstT('colGstin'), render: (r) => <span className={surface.mono}>{r.ctin || '-'}</span> },
    { key: 'party', label: gstT('colReceiver'), render: (r) => r.partyName || '-' },
    {
      key: 'no',
      label: isNote ? gstT('colNoteNo') : gstT('colInvoiceNo'),
      render: (r) => <Link to={`/invoice/${r.invoiceId}`} className={local.issueLink}>{r.number || gstT('noNumber')}</Link>,
    },
    { key: 'date', label: gstT('colDate'), render: (r) => formatDate(r.date) },
    { key: 'value', label: gstT('colValue'), numeric: true, render: (r) => <Money value={r.value} />, total: (r) => r.value },
    { key: 'pos', label: gstT('colPos'), render: (r) => pos(r.pos) },
    { key: 'rate', label: gstT('colRate'), numeric: true, render: (r) => r.items.map((i) => i.rate).join(', ') || '-' },
    { key: 'txval', label: gstT('colTaxable'), numeric: true, render: (r) => <Money value={r.taxable} />, total: (r) => r.taxable },
    { key: 'igst', label: 'IGST', numeric: true, render: (r) => <Money value={r.igst} />, total: (r) => r.igst },
    { key: 'cgst', label: 'CGST', numeric: true, render: (r) => <Money value={r.cgst} />, total: (r) => r.cgst },
    { key: 'sgst', label: 'SGST', numeric: true, render: (r) => <Money value={r.sgst} />, total: (r) => r.sgst },
  ];

  const hsnTable = (rows: HsnRow[], caption: string) => (
    <DataTable
      caption={caption}
      emptyText={gstT('noHsn')}
      rows={rows}
      rowKey={(r) => `${r.hsn}${r.uqc}${r.rate}`}
      columns={[
        { key: 'h', label: 'HSN/SAC', render: (r) => <span className={surface.mono}>{r.hsn}</span> },
        { key: 'd', label: gstT('colDescription'), render: (r) => r.description },
        { key: 'u', label: gstT('colUqc'), render: (r) => r.uqc },
        { key: 'q', label: gstT('colQty'), numeric: true, render: (r) => r.qty },
        { key: 'v', label: gstT('colTotalValue'), numeric: true, render: (r) => <Money value={r.value} />, total: (r) => r.value },
        { key: 'r', label: gstT('colRate'), numeric: true, render: (r) => r.rate },
        { key: 't', label: gstT('colTaxable'), numeric: true, render: (r) => <Money value={r.taxable} />, total: (r) => r.taxable },
        { key: 'i', label: 'IGST', numeric: true, render: (r) => <Money value={r.igst} />, total: (r) => r.igst },
        { key: 'c', label: 'CGST', numeric: true, render: (r) => <Money value={r.cgst} />, total: (r) => r.cgst },
        { key: 's', label: 'SGST', numeric: true, render: (r) => <Money value={r.sgst} />, total: (r) => r.sgst },
      ]}
    />
  );

  const sectionBody = () => {
    switch (tab) {
      case 'b2b':
        return <DataTable columns={docCols()} rows={g1.b2b} rowKey={(r) => r.invoiceId} caption={gstT('capB2b')} emptyText={gstT('emptyB2b')} />;
      case 'b2cl':
        return <DataTable columns={docCols()} rows={g1.b2cl} rowKey={(r) => r.invoiceId} caption={gstT('capB2cl')} emptyText={gstT('emptyB2cl')} />;
      case 'cdnr':
        return <DataTable columns={docCols(true)} rows={g1.cdnr} rowKey={(r) => r.invoiceId} caption={gstT('capCdnr')} emptyText={gstT('emptyCdnr')} />;
      case 'cdnur': {
        const cols: Column<CdnRow>[] = [
          ...docCols<CdnRow>(true),
          { key: 'typ', label: gstT('colUrType'), render: (r) => r.unregType ?? '' },
        ];
        return <DataTable columns={cols} rows={g1.cdnur} rowKey={(r) => r.invoiceId} caption={gstT('capCdnur')} emptyText={gstT('emptyCdnur')} />;
      }
      case 'exp': {
        const cols: Column<ExportRow>[] = [
          ...docCols<ExportRow>().filter((c) => c.key !== 'ctin'),
          { key: 'typ', label: gstT('colType'), render: (r) => (r.expType === 'WPAY' ? gstT('withIgst') : gstT('withoutIgst')) },
        ];
        return <DataTable columns={cols} rows={g1.exp} rowKey={(r) => r.invoiceId} caption={gstT('capExp')} emptyText={gstT('emptyExp')} />;
      }
      case 'b2cs':
        return (
          <DataTable
            caption={gstT('capB2cs')}
            emptyText={gstT('emptyB2cs')}
            rows={g1.b2cs}
            rowKey={(r) => `${r.supply}${r.pos}${r.rate}`}
            columns={[
              { key: 'sply', label: gstT('colSupply'), render: (r) => (r.supply === 'INTRA' ? gstT('intra') : gstT('inter')) },
              { key: 'pos', label: gstT('colPos'), render: (r) => pos(r.pos) },
              { key: 'rate', label: gstT('colRate'), numeric: true, render: (r) => r.rate },
              { key: 'tx', label: gstT('colTaxable'), numeric: true, render: (r) => <Money value={r.txval} />, total: (r) => r.txval },
              { key: 'i', label: 'IGST', numeric: true, render: (r) => <Money value={r.igst} />, total: (r) => r.igst },
              { key: 'c', label: 'CGST', numeric: true, render: (r) => <Money value={r.cgst} />, total: (r) => r.cgst },
              { key: 's', label: 'SGST', numeric: true, render: (r) => <Money value={r.sgst} />, total: (r) => r.sgst },
            ]}
          />
        );
      case 'nil':
        return (
          <DataTable
            caption={gstT('capNil')}
            emptyText={gstT('emptyNil')}
            rows={g1.nil}
            rowKey={(r) => r.type}
            columns={[
              { key: 'd', label: gstT('colDescription'), render: (r) => nilLabel(r.type) },
              { key: 'n', label: gstT('colNil'), numeric: true, render: (r) => <Money value={r.nil} />, total: (r) => r.nil },
              { key: 'e', label: gstT('colExempt'), numeric: true, render: (r) => <Money value={r.exempt} />, total: (r) => r.exempt },
              { key: 'g', label: gstT('colNonGst'), numeric: true, render: (r) => <Money value={r.nonGst} />, total: (r) => r.nonGst },
            ]}
          />
        );
      case 'at':
      case 'txpd': {
        const rows = (tab === 'at' ? g1.at : g1.txpd) ?? [];
        const cols: Column<AdvanceTableRow>[] = [
          { key: 'pos', label: gstT('colPos'), render: (r) => pos(r.pos) },
          { key: 'sply', label: gstT('colSupply'), render: (r) => (r.supply === 'INTRA' ? gstT('intra') : gstT('inter')) },
          { key: 'rate', label: gstT('colRate'), numeric: true, render: (r) => r.rate },
          { key: 'g', label: gstT('colGross'), numeric: true, render: (r) => <Money value={r.gross} />, total: (r) => r.gross },
          { key: 'tx', label: tab === 'at' ? gstT('colAdvReceived') : gstT('colAdvAdjusted'), numeric: true, render: (r) => <Money value={r.taxable} />, total: (r) => r.taxable },
          { key: 'i', label: 'IGST', numeric: true, render: (r) => <Money value={r.igst} />, total: (r) => r.igst },
          { key: 'c', label: 'CGST', numeric: true, render: (r) => <Money value={r.cgst} />, total: (r) => r.cgst },
          { key: 's', label: 'SGST', numeric: true, render: (r) => <Money value={r.sgst} />, total: (r) => r.sgst },
        ];
        return (
          <>
            <p className={controls.hint} style={{ margin: 0 }}>
              {tab === 'at' ? gstT('hint11a') : gstT('hint11b')}
              {' '}{gstT('alsoIn3b')} <Link to="/receivables?tab=advances" className={local.issueLink}>{gstT('openAdvances')}</Link>. {gstT('verifyCa')}
            </p>
            <DataTable columns={cols} rows={rows} rowKey={(r) => `${r.pos}${r.rate}${r.supply}`} caption={tab === 'at' ? gstT('cap11a') : gstT('cap11b')}
              emptyText={tab === 'at' ? gstT('empty11a') : gstT('empty11b')} />
          </>
        );
      }
      case 'hsn': {
        const hint = (
          <p className={controls.hint} style={{ margin: 0 }}>
            {gstT('hsnHint', { digits: g1.hsnMinDigits, turnover: lastFyTurnover ? formatMoney(lastFyTurnover) : gstT('hsnNotEntered') })}
            {g1.hsnSplit ? ` ${gstT('hsnSplit')}` : ''}
          </p>
        );
        if (!g1.hsnSplit) return <>{hint}{hsnTable(g1.hsn, gstT('capHsn'))}</>;
        return (
          <>
            {hint}
            <h3 className={local.tbHeading}>{gstT('hsnB2bHead')}</h3>
            {hsnTable(g1.hsnB2b, gstT('capHsnB2b'))}
            <h3 className={local.tbHeading}>{gstT('hsnB2cHead')}</h3>
            {hsnTable(g1.hsnB2c, gstT('capHsnB2c'))}
          </>
        );
      }
      case 'docs':
        return (
          <>
          <DataTable
            caption={gstT('capDocs')}
            emptyText={gstT('emptyDocs')}
            rows={g1.docIssue}
            rowKey={(r) => `${r.docType}${r.series}`}
            columns={[
              { key: 't', label: gstT('colDocType'), render: (r) => r.docType },
              { key: 's', label: gstT('colSeries'), render: (r) => <span className={surface.mono}>{r.series}</span> },
              { key: 'f', label: gstT('colFrom'), render: (r) => <span className={surface.mono}>{r.from}</span> },
              { key: 'to', label: gstT('colTo'), render: (r) => <span className={surface.mono}>{r.to}</span> },
              { key: 'tot', label: gstT('colTotal'), numeric: true, render: (r) => r.total, total: (r) => r.total, totalFormat: String },
              { key: 'c', label: gstT('colCancelled'), numeric: true, render: (r) => r.cancelled, total: (r) => r.cancelled, totalFormat: String },
              { key: 'n', label: gstT('colNetIssued'), numeric: true, render: (r) => r.netIssued, total: (r) => r.netIssued, totalFormat: String },
            ]}
          />
          <h3 className={local.tbHeading}>{gstT('gapsHead', { fy: fyLabel })}</h3>
          {gaps.length === 0 ? (
            <p className={controls.hint}>{gstT('noGaps')}</p>
          ) : (
            <ul className={local.gapList}>
              {gaps.map((g) => (
                <li key={`${g.prefix}${g.fy}`}>
                  <strong className={surface.mono}>{g.prefix}/FY{g.fy}</strong>: {gstT(g.missingCount === 1 ? 'gapOne' : 'gapMany', { n: g.missingCount, highest: String(g.highest).padStart(4, '0') })}{' '}
                  <span className={surface.mono}>{g.missingNumbers.slice(0, 12).join(', ')}{g.missingCount > 12 ? ' …' : ''}</span>
                </li>
              ))}
            </ul>
          )}
          <p className={controls.hint}>
            {gstT('rule46')}
          </p>
          </>
        );
      case 'amend': {
        const amendCols = <T extends AmendDocRow>(isNote = false): Column<T>[] => [
          { key: 'orig', label: isNote ? gstT('colOrigNote') : gstT('colOrigInvoice'), render: (r) => <span className={surface.mono}>{r.origNumber} · {formatDate(r.origDate)}</span> },
          { key: 'op', label: gstT('colFiledIn'), render: (r) => `${r.origPeriod.slice(0, 2)}/${r.origPeriod.slice(2)}` },
          ...docCols<T>(isNote),
        ];
        const empty = gstT('noneInPeriod');
        return (
          <>
            <p className={controls.hint} style={{ margin: 0 }}>
              {gstT('amendHint', { period: label })}
            </p>
            {!!am?.expa?.length && <DataTable columns={amendCols()} rows={am.expa} rowKey={(r) => r.invoiceId} caption="EXPA" emptyText={empty} />}
            <h3 className={local.tbHeading}>{gstT('b2baHead')}</h3>
            <DataTable columns={amendCols()} rows={am?.b2ba ?? []} rowKey={(r) => r.invoiceId} caption="B2BA" emptyText={empty} />
            <h3 className={local.tbHeading}>{gstT('b2claHead')}</h3>
            <DataTable columns={amendCols()} rows={am?.b2cla ?? []} rowKey={(r) => r.invoiceId} caption="B2CLA" emptyText={empty} />
            <h3 className={local.tbHeading}>{gstT('cdnraHead')}</h3>
            <DataTable columns={amendCols<AmendCdnRow>(true)} rows={am?.cdnra ?? []} rowKey={(r) => r.invoiceId} caption="CDNRA" emptyText={empty} />
            <h3 className={local.tbHeading}>{gstT('cdnuraHead')}</h3>
            <DataTable columns={amendCols<AmendCdnRow>(true)} rows={am?.cdnura ?? []} rowKey={(r) => r.invoiceId} caption="CDNURA" emptyText={empty} />
            <h3 className={local.tbHeading}>{gstT('b2csaHead')}</h3>
            <DataTable
              caption="B2CSA"
              emptyText={empty}
              rows={am?.b2csa ?? []}
              rowKey={(r) => `${r.omon}${r.supply}${r.pos}${r.rate}`}
              columns={[
                { key: 'm', label: gstT('colOrigMonth'), render: (r) => `${r.omon.slice(0, 2)}/${r.omon.slice(2)}` },
                { key: 'sply', label: gstT('colSupply'), render: (r) => (r.supply === 'INTRA' ? gstT('intra') : gstT('inter')) },
                { key: 'pos', label: gstT('colPos'), render: (r) => pos(r.pos) },
                { key: 'rate', label: gstT('colRate'), numeric: true, render: (r) => r.rate },
                { key: 'tx', label: gstT('colTaxableRevised'), numeric: true, render: (r) => <Money value={r.txval} /> },
                { key: 'i', label: 'IGST', numeric: true, render: (r) => <Money value={r.igst} /> },
                { key: 'c', label: 'CGST', numeric: true, render: (r) => <Money value={r.cgst} /> },
                { key: 's', label: 'SGST', numeric: true, render: (r) => <Money value={r.sgst} /> },
              ]}
            />
          </>
        );
      }
      case 'eco':
        return (
          <Suspense fallback={<p className={controls.hint}>Loading…</p>}>
            <EcoView g1={g1} g3={g3} />
          </Suspense>
        );
      case 'composition':
        return (
          <Suspense fallback={<p className={controls.hint}>{gstT('loading')}</p>}>
            <CompositionView invoices={invoices} purchases={purchases} period={period} gstin={gstin} filerStateCode={filerStateCode} category={compositionProfile?.composition_category} />
          </Suspense>
        );
      case 'gstr3b':
        return (
          <>
            <Gstr3bView report={g3} onOpenSetOff={() => setTab('setoff')} />
            <Suspense fallback={null}><Gst8dPanel view="3b" period={period} gstin={gstin} g1={g1} g3={g3} /></Suspense>
          </>
        );
      case 'guards':
        return (
          <Suspense fallback={<p className={controls.hint}>{gstT('loading')}</p>}>
            <Gst8dPanel view="guards" period={period} gstin={gstin} g1={g1} g3={g3} invoices={invoices} notify={notify} />
          </Suspense>
        );
      case 'setoff':
      case 'purhsn':
      case 'recon':
      case 'hsnmaster':
      case 'gstr9c':
      case 'rcmdocs':
        return (
          <Suspense fallback={<p className={controls.hint}>{gstT('loading')}</p>}>
            {tab === 'setoff' && <SetOffPanel report={g3} period={period} gstin={gstin} stateCode={filerStateCode} turnover={lastFyTurnover} notify={notify} />}
            {tab === 'purhsn' && <PurchaseHsnView period={period} filerStateCode={filerStateCode} />}
            {tab === 'recon' && <ReconMonthly period={period} gstin={gstin} filerStateCode={filerStateCode} />}
            {tab === 'hsnmaster' && <HsnMasterPanel notify={notify} />}
            {tab === 'rcmdocs' && <RcmDocsPanel notify={notify} />}
            {tab === 'gstr9c' && <Gstr9cView fyStart={period.fyStart} gstin={gstin} filerStateCode={filerStateCode} turnover={Number(turnover.curGt) || 0} />}
          </Suspense>
        );
      case 'cashref':
      case 'isd':
      case 'ewbcons':
      case 'bygstin':
        return (
          <Suspense fallback={<p className={controls.hint}>{gstT('loading')}</p>}>
            <Gst7rPanel view={tab} period={period} gstin={gstin} g1={g1} g3={g3} invoices={invoices} purchases={purchases} notify={notify} />
          </Suspense>
        );
      case 'gstr2b':
        return (
          <Suspense fallback={<p className={controls.hint}>{gstT('loading')}</p>}>
            <Gstr2bView period={period} gstin={gstin} filerStateCode={filerStateCode} notify={notify} />
          </Suspense>
        );
      case 'portal-files':
      case 'eway-desk':
        return (
          <Suspense fallback={<p className={controls.hint}>{gstT('loading')}</p>}>
            {tab === 'portal-files'
              ? <PortalFilesView g1={g1} period={period} gstin={gstin} turnover={{ gt: Number(turnover.gt) || 0, curGt: Number(turnover.curGt) || 0 }} notify={notify} />
              : <EwayDesk notify={notify} />}
          </Suspense>
        );
      case 'compliance':
        return <ComplianceView invoices={invoices} purchases={purchases} gstin={gstin} stateCode={filerStateCode} turnover={lastFyTurnover} notify={notify} />;
      default:
        return null;
    }
  };

  // Same rows as the CSV, as an Excel workbook (writer loaded on demand).
  const downloadSectionXlsx = async () => {
    try {
      const { downloadXlsx, csvRowsToCells } = await import('../lib/xlsx');
      const rows = csvRowsToCells(parseCsv(sectionCsv(g1, tab as SectionId), { delimiter: ',' }));
      await downloadXlsx(`${fileBase}_${tab}.xlsx`, [{ name: TABS.find((x) => x.id === tab)?.label ?? tab, rows }]);
    } catch {
      notify(gstT('xlsxFailed'), 'error');
    }
  };

  const csvTabs: SectionId[] = ['b2b', 'b2cl', 'b2cs', 'cdnr', 'cdnur', 'exp', 'nil', 'at', 'txpd', 'hsn', 'docs', 'amend', 'eco'];
  const isCsvTab = (csvTabs as string[]).includes(tab);

  const t = g1.totals;
  const tiles: { label: string; value: string; hint: string }[] = [
    { label: gstT('tileTaxable'), value: formatMoney(t.taxable), hint: gstT('tileTaxableHint', { n: g1.counts.included }) },
    { label: 'IGST', value: formatMoney(t.igst), hint: gstT('tileIgstHint') },
    { label: 'CGST + SGST', value: formatMoney(t.cgst + t.sgst), hint: `CGST ${formatMoney(t.cgst)} · SGST ${formatMoney(t.sgst)}` },
    { label: gstT('tileCash'), value: formatMoney(g3.payment.cash.igst + g3.payment.cash.cgst + g3.payment.cash.sgst), hint: gstT('tileCashHint') },
  ];

  return (
    <div className={surface.page}>
      <PageHeader
        title={gstT('title')}
        subtitle={gstT('subtitle')}
        actions={
          <>
          <button type="button" className={`${controls.btn} ${controls.btnPrimary}`} disabled={!hasData || !gstin} title={!gstin ? gstT('needGstin1') : undefined}
            onClick={() => guarded('GSTR1', downloadGstr1)} data-gstr1-json>
            <FileJson size={16} aria-hidden /> GSTR-1 JSON {badge}
          </button>
          {period.kind === 'month' && isIffMonth(period) && (
            <button type="button" className={`${controls.btn} ${controls.btnOutline}`} disabled={!hasData || !gstin} title={o7T('iffTitle')} data-iff-json
              onClick={() => guarded('IFF', downloadIff)}>
              <FileJson size={16} aria-hidden /> IFF JSON {badge}
            </button>
          )}
          <button type="button" className={`${controls.btn} ${controls.btnOutline}`} disabled={!hasData}
            onClick={() => download(`GSTR3B_${gstin || 'all'}_${g1.fp}.csv`, 'text/csv', gstr3bCsv(g3))}>
            <FileSpreadsheet size={16} aria-hidden /> GSTR-3B CSV
          </button>
          <button type="button" className={`${controls.btn} ${controls.btnOutline}`} disabled={!hasData || !gstin} title={!gstin ? gstT('needGstin3b') : gstT('json3bTitle')}
            onClick={() => guarded('GSTR3B', downloadGstr3b)} data-gstr3b-json>
            <FileJson size={16} aria-hidden /> GSTR-3B JSON {badge}
          </button>
          <button type="button" className={`${controls.btn} ${controls.btnOutline}`} disabled={!hasData} onClick={printSummary}>
            <Printer size={16} aria-hidden /> {gstT('printSummary')}
          </button>
          <button type="button" className={`${controls.btn} ${controls.btnOutline}`} onClick={() => setAnnualOpen('gstr9')} title={gstT('gstr9Title')}>
            <CalendarRange size={16} aria-hidden /> GSTR-9
          </button>
          <button type="button" className={`${controls.btn} ${controls.btnOutline}`} onClick={() => setAnnualOpen('bulk')} title={gstT('bulkTitle')}>
            <Files size={16} aria-hidden /> {gstT('bulk')}
          </button>
          </>
        }
      />

      {annualOpen && (
        <Suspense fallback={null}>
          <Gstr9Modal open={annualOpen === 'gstr9'} onClose={() => setAnnualOpen('')} fyStart={period.fyStart} fyOptions={fyOptions}
            gstin={gstin} filerStateCode={filerStateCode} storedTurnover={{ gt: lastFyTurnover, curGt: Number(turnover.curGt) || 0 }}
            filerName={profiles.find((p) => p?.companyGstin?.trim().toUpperCase() === gstin)?.companyName} />
          <BulkEInvoiceModal open={annualOpen === 'bulk'} onClose={() => setAnnualOpen('')}
            from={periodRange(period).from} to={periodRange(period).to} periodLabel={label} />
        </Suspense>
      )}

      {pending && (
        <Suspense fallback={null}>
          <PreflightDialog
            form={pending.form ? FORM_NAME[pending.form] : null}
            groups={preflight}
            onClose={() => setPending(null)}
            onDownload={pending.run ? () => {
              const run = pending.run;
              setPending(null);
              if (run?.()) setDownloaded(periodTag);
            } : undefined}
            onReview={() => {
              setPending(null);
              setTab('guards');
              navigate('/gst-reports?tab=guards', { replace: true });
            }}
          />
        </Suspense>
      )}

      <section className={`${surface.card} ${styles.filters}`} aria-label={gstT('filters')}>
        <PeriodPicker value={period} onChange={setPeriod} fyOptions={fyOptions} />
        <label className={local.periodField}>
          <span className={controls.label}>{gstT('filerGstin')}</span>
          <select className={controls.select} value={gstin} onChange={(e) => setGstin(e.target.value)}>
            <option value="">{gstT('allProfiles')}</option>
            {gstins.map((x) => (
              <option key={x} value={x}>{x}</option>
            ))}
          </select>
        </label>
        <label className={local.periodField}>
          <span className={controls.label}>{gstT('lastFyTurnover')}</span>
          <input className={controls.input} inputMode="decimal" placeholder="0" value={turnover.gt}
            onChange={(e) => patchTurnover({ ...turnover, gt: e.target.value.replace(/[^0-9.]/g, '') })} />
        </label>
        <label className={local.periodField}>
          <span className={controls.label}>{gstT('thisFyTurnover')}</span>
          <input className={controls.input} inputMode="decimal" placeholder="0" value={turnover.curGt}
            onChange={(e) => patchTurnover({ ...turnover, curGt: e.target.value.replace(/[^0-9.]/g, '') })} />
        </label>
        <p className={controls.hint} style={{ margin: 0, flexBasis: '100%' }}>
          {nodes(gstT('turnoverHint'), { gt: <code>gt</code>, curGt: <code>cur_gt</code> })}
        </p>
        {period.kind !== 'month' && (
          <p className={controls.hint} style={{ margin: 0 }}>
            {gstT('qrmpHint', { fp: g1.fp })}
          </p>
        )}
      </section>

      <div className={`${surface.card} ${local.disclaimer}`} role="note">
        <ShieldAlert size={18} aria-hidden style={{ flexShrink: 0, color: 'var(--warning)' }} />
        <span>
          <strong>{gstT('disclaimerStrong')}</strong> {gstT('disclaimer')}
        </span>
      </div>

      {compositionProfile && (
        <div className={`${surface.card} ${local.disclaimer}`} role="note" data-composition-banner>
          <ShieldAlert size={18} aria-hidden style={{ flexShrink: 0, color: 'var(--warning)' }} />
          <span>
            <strong>{gstT('compositionStrong', { name: compositionProfile.companyName || gstT('thisProfile') })}</strong> {gstT('compositionText')}
          </span>
        </div>
      )}

      {!compositionProfile && (
        <ol className={`${surface.card} ${filing.strip}`} aria-label={fiT('stripLabel')} data-filing-strip>
          <li className={filing.stepDone}>
            <span className={filing.stepName}>{fiT('stepPeriod')}</span>
            <span className={filing.stepSub}>{label}{gstin ? ` · ${gstin}` : ''}</span>
          </li>
          <li className={checkCount ? filing.stepWarn : filing.stepDone}>
            <button type="button" className={filing.stepBtn} onClick={() => setPending({ form: null })} title={fiT('checkTitle')} data-filing-check>
              {fiT('stepCheck')} ({checkCount})
            </button>
          </li>
          {portalErrors > 0 && (
            <li className={filing.stepWarn} data-filing-portal-errors>
              <button type="button" className={filing.stepBtn} onClick={() => setTab('portal-files')}>{dkT('tab.portal')} ({portalErrors})</button>
            </li>
          )}
          <li className={downloaded === periodTag ? filing.stepDone : filing.step}>
            <span className={filing.stepName}>{fiT('stepDownload')}</span>
            <span className={filing.stepBtns}>
              <button type="button" className={filing.stepBtn} disabled={!hasData || !gstin} title={!gstin ? gstT('needGstin1') : undefined} onClick={() => guarded('GSTR1', downloadGstr1)}>GSTR-1</button>
              <button type="button" className={filing.stepBtn} disabled={!hasData || !gstin} title={!gstin ? gstT('needGstin3b') : undefined} onClick={() => guarded('GSTR3B', downloadGstr3b)}>GSTR-3B</button>
            </span>
          </li>
          <li className={isFiled('GSTR1') && isFiled('GSTR3B') ? filing.stepDone : filing.step}>
            <span className={filing.stepName}>{fiT('stepFiled')}</span>
            <span className={filing.stepBtns}>
              {(['GSTR1', 'GSTR3B'] as const).map((f) => (
                <button key={f} type="button" className={filing.stepBtn} aria-pressed={isFiled(f)} disabled={!periodKey}
                  title={periodKey ? fiT('markHint') : fiT('markFyHint')} onClick={() => toggleFiled(f)}>
                  {isFiled(f) ? <CheckCircle2 size={14} aria-hidden /> : null} {fiT(f === 'GSTR1' ? 'markG1' : 'markG3')}
                </button>
              ))}
            </span>
          </li>
        </ol>
      )}

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

      <section className={surface.card} aria-label={gstT('sections')}>
        <div className={filing.tabGroups}>
          {GST_TAB_GROUPS.map((g) => (
            <div key={g.id} className={filing.tabGroup} role="tablist" aria-label={fiT(GROUP_LABEL[g.id])} data-tab-group={g.id}>
              <span className={filing.groupLabel} aria-hidden>{fiT(GROUP_LABEL[g.id])}</span>
              {g.tabs.map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  id={`gst-tab-${id}`}
                  aria-selected={tab === id}
                  aria-controls="gst-panel"
                  className={tab === id ? local.tabActive : local.tab}
                  onClick={() => setTab(id)}
                  onKeyDown={onTabKey}
                >
                  {tabLabel(TABS.find((x) => x.id === id))}
                  {counts[id] ? <span className={local.tabCount}>{counts[id]}</span> : null}
                </button>
              ))}
            </div>
          ))}
        </div>
        <label className={filing.tabSelect}>
          <span className={controls.label}>{fiT('sectionSelect')}</span>
          <select className={controls.select} value={tab} onChange={(e) => setTab(resolveGstTab(e.target.value) ?? 'overview')} data-gst-tab-select>
            {GST_TAB_GROUPS.map((g) => (
              <optgroup key={g.id} label={fiT(GROUP_LABEL[g.id])}>
                {g.tabs.map((id) => (
                  <option key={id} value={id}>{tabLabel(TABS.find((x) => x.id === id))}{counts[id] ? ` (${counts[id]})` : ''}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <div className={local.tabBody} role="tabpanel" id="gst-panel" aria-labelledby={`gst-tab-${tab}`}>
          <div className={local.toolbar}>
            <h2 className={local.tbHeading}>{tabLabel(TABS.find((x) => x.id === tab))}{tab === 'compliance' || tab === 'hsnmaster' || tab === 'rcmdocs' || tab === 'isd' || tab === 'ewbcons' ? '' : tab === 'recon' || tab === 'gstr9c' ? ` · FY ${String(period.fyStart).slice(2)}-${String(period.fyStart + 1).slice(2)}` : ` · ${label}`}</h2>
            {isCsvTab && (
              <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`}
                onClick={() => download(`${fileBase}_${tab}.csv`, 'text/csv', sectionCsv(g1, tab as SectionId))}>
                <Download size={14} aria-hidden /> {gstT('downloadCsv')}
              </button>
            )}
            {isCsvTab && (
              <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`}
                onClick={() => void downloadSectionXlsx()}>
                <Download size={14} aria-hidden /> {gstT('downloadXlsx')}
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
          {nodes(gstT('noData'), { period: label, link: <Link to="/invoice" className={local.issueLink}>{gstT('creatorLink')}</Link> })}
        </p>
      );
    }
    const rows = [
      { id: 'b2b' as const, name: gstT('ovB2b'), n: g1.b2b.length, tx: sumOf(g1.b2b, 'taxable'), tax: sumOf(g1.b2b, 'igst') + sumOf(g1.b2b, 'cgst') + sumOf(g1.b2b, 'sgst') },
      { id: 'b2cl' as const, name: gstT('ovB2cl'), n: g1.b2cl.length, tx: sumOf(g1.b2cl, 'taxable'), tax: sumOf(g1.b2cl, 'igst') },
      { id: 'b2cs' as const, name: gstT('ovB2cs'), n: g1.b2cs.length, tx: sumOf(g1.b2cs, 'txval'), tax: sumOf(g1.b2cs, 'igst') + sumOf(g1.b2cs, 'cgst') + sumOf(g1.b2cs, 'sgst') },
      { id: 'cdnr' as const, name: gstT('ovCdnr'), n: g1.cdnr.length, tx: sumOf(g1.cdnr, 'taxable'), tax: sumOf(g1.cdnr, 'igst') + sumOf(g1.cdnr, 'cgst') + sumOf(g1.cdnr, 'sgst') },
      { id: 'cdnur' as const, name: gstT('ovCdnur'), n: g1.cdnur.length, tx: sumOf(g1.cdnur, 'taxable'), tax: sumOf(g1.cdnur, 'igst') + sumOf(g1.cdnur, 'cgst') + sumOf(g1.cdnur, 'sgst') },
      { id: 'exp' as const, name: gstT('ovExp'), n: g1.exp.length, tx: sumOf(g1.exp, 'taxable'), tax: sumOf(g1.exp, 'igst') },
      ...(g1.at?.length ? [{ id: 'at' as const, name: gstT('ovAt'), n: g1.at.length, tx: sumOf(g1.at, 'taxable'), tax: sumOf(g1.at, 'igst') + sumOf(g1.at, 'cgst') + sumOf(g1.at, 'sgst') }] : []),
      ...(g1.txpd?.length ? [{ id: 'txpd' as const, name: gstT('ovTxpd'), n: g1.txpd.length, tx: sumOf(g1.txpd, 'taxable'), tax: sumOf(g1.txpd, 'igst') + sumOf(g1.txpd, 'cgst') + sumOf(g1.txpd, 'sgst') }] : []),
    ];
    return (
      <>
        <DataTable
          caption={gstT('capOverview')}
          emptyText=""
          rows={rows}
          rowKey={(r) => r.id}
          columns={[
            { key: 'n', label: gstT('colSection'), render: (r) => <button type="button" className={local.issueLink} style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }} onClick={() => setTab(r.id)}>{r.name}</button> },
            { key: 'c', label: gstT('colRows'), numeric: true, render: (r) => r.n },
            { key: 'tx', label: gstT('colTaxable'), numeric: true, render: (r) => <Money value={r.tx} /> },
            { key: 'tax', label: gstT('colTax'), numeric: true, render: (r) => <Money value={r.tax} /> },
          ]}
        />
        <p className={surface.sectionNote}>
          {gstT('excluded', { drafts: g1.counts.drafts, cancelled: g1.counts.cancelled, notTax: g1.counts.notTaxDocs })}
        </p>
      </>
    );
  }
}

function sumOf<T>(rows: T[], key: string): number {
  return Math.round(rows.reduce((s, r) => s + ((r as Record<string, number>)[key] ?? 0), 0) * 100) / 100;
}

export default GstReports;

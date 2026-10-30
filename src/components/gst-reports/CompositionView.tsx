import { lazy, Suspense, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { buildCmp08, buildGstr4, cmp08Rows, gstr4Rows, type TaxHeads } from '../../lib/composition-returns';
import { periodForDate, periodRange, type ReportPeriod } from '../../lib/gst-reports';
import { toCsv } from '../../lib/gstr-json';
import { compositionRate, todayIso, type CompositionKind } from '../../lib/tax-rules';
import { COMPOSITION_CATEGORY_LABELS } from '../../lib/bill-of-supply';
import { downloadText } from '../../lib/download';
import type { InvoiceRecord } from '../../types/invoice';
import { DataTable, Money } from './DataTable';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import local from './gst-reports.module.css';
import { useT } from '../../i18n';
import { gvT } from '../../i18n/areas/gst-views';
import { nodes } from '../../i18n/areas/nodes';

// GSTR-4 Tables 7-9 + interest / late fee estimates: loaded when the GSTR-4 view is opened.
const Gstr4AnnualView = lazy(() => import('./Gstr4AnnualView'));

export interface CompositionViewProps {
  invoices: InvoiceRecord[];
  purchases: unknown[];
  /** Report period chosen on the page: its quarter is used for CMP-08 and its FY for GSTR-4. */
  period: ReportPeriod;
  gstin: string;
  filerStateCode: string;
  category?: CompositionKind;
}

interface Row {
  table: string;
  label: string;
  value?: number;
  igst?: number;
  cgst?: number;
  sgst?: number;
}

const heads = (table: string, label: string, h: TaxHeads): Row => ({ table, label, value: h.value, igst: h.igst, cgst: h.cgst, sgst: h.sgst });

const cols = () => [
  { key: 't', label: gvT('colTable'), render: (r: Row) => <span className={local.tag}>{r.table}</span> },
  { key: 'l', label: gvT('colDescription'), render: (r: Row) => r.label },
  ...(['value', 'igst', 'cgst', 'sgst'] as const).map((k) => ({
    key: k,
    label: k === 'value' ? gvT('colValue') : k.toUpperCase(),
    numeric: true,
    render: (r: Row) => (r[k] === undefined ? '' : <Money value={r[k] as number} />),
  })),
];

/** CMP-08 (quarter) and GSTR-4 (year) working papers for a composition profile (roadmap 5.9). */
export default function CompositionView({ invoices, purchases, period, gstin, filerStateCode, category }: CompositionViewProps) {
  useT();
  const COLS = cols();
  const quarter = useMemo<ReportPeriod>(
    // CMP-08 is quarterly: the quarter holding the chosen month (Q1 for a whole FY).
    () => (period.kind === 'quarter' ? period : periodForDate('quarter', periodRange(period).from)),
    [period],
  );
  const [view, setView] = useState<'cmp08' | 'gstr4'>('cmp08');
  const opts = { gstin, filerStateCode, category };
  const cmp = useMemo(() => buildCmp08(invoices, purchases, quarter, opts), [invoices, purchases, quarter, gstin, filerStateCode, category]); // eslint-disable-line react-hooks/exhaustive-deps
  const g4 = useMemo(() => buildGstr4(invoices, purchases, period.fyStart, opts), [invoices, purchases, period.fyStart, gstin, filerStateCode, category]); // eslint-disable-line react-hooks/exhaustive-deps
  const rate = compositionRate(category ?? 'trader', todayIso());

  const cmpRows: Row[] = [
    { table: '3(1)', label: 'Outward supplies (including exempt supplies)', value: cmp.outward.value, igst: 0, cgst: cmp.outward.cgst, sgst: cmp.outward.sgst },
    ...cmp.byRate.map((x): Row => ({ table: '3(1)', label: `of which taxed at ${x.rate}% (${x.rate / 2}% CGST + ${x.rate / 2}% SGST)`, value: x.base, cgst: x.cgst, sgst: x.sgst })),
    ...(cmp.outward.exempt ? [{ table: '3(1)', label: 'of which exempt (trader: not taxed)', value: cmp.outward.exempt } as Row] : []),
    heads('3(2)', 'Inward supplies attracting reverse charge, incl. import of services', cmp.rcm),
    { table: '3(3)', label: 'Tax payable (1 + 2)', igst: cmp.payable.igst, cgst: cmp.payable.cgst, sgst: cmp.payable.sgst },
  ];
  const g4Rows: Row[] = [
    heads('4A', 'Inward supplies from registered suppliers (forward charge)', g4.inward.registered),
    heads('4B', 'Inward supplies from registered suppliers (reverse charge)', g4.inward.registeredRcm),
    heads('4C', 'Inward supplies from unregistered suppliers', g4.inward.unregistered),
    heads('4D', 'Import of services', g4.inward.importServices),
    ...g4.quarters.map((q): Row => ({ table: '5', label: `CMP-08 ${q.label}`, value: q.outward.value, igst: q.payable.igst, cgst: q.payable.cgst, sgst: q.payable.sgst })),
    ...g4.outwardByRate.map((x): Row => ({ table: '6', label: `Outward supplies taxed at ${x.rate}%`, value: x.base, cgst: x.cgst, sgst: x.sgst })),
    ...(g4.totals.exempt ? [{ table: '6', label: 'Exempt outward supplies (trader: not taxed)', value: g4.totals.exempt } as Row] : []),
  ];
  const issues = view === 'cmp08' ? cmp.issues : g4.issues;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }} data-composition-view>
      <div className={local.toolbar}>
        <div className={controls.segment} role="group" aria-label={gvT('compReturn')}>
          <button type="button" aria-pressed={view === 'cmp08'} className={view === 'cmp08' ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setView('cmp08')}>
            CMP-08 · {cmp.label}
          </button>
          <button type="button" aria-pressed={view === 'gstr4'} className={view === 'gstr4' ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setView('gstr4')}>
            GSTR-4 · {g4.label}
          </button>
        </div>
        <button
          type="button"
          className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`}
          onClick={() =>
            view === 'cmp08'
              ? downloadText(`CMP08_${gstin || 'all'}_${cmp.fp}.csv`, toCsv(cmp08Rows(cmp)), 'text/csv')
              : downloadText(`GSTR4_${gstin || 'all'}_FY${g4.fyStart}.csv`, toCsv(gstr4Rows(g4)), 'text/csv')
          }
        >
          <Download size={14} aria-hidden /> {gvT('downloadCsv')}
        </button>
      </div>
      <p className={controls.hint}>
        {gvT('compHint', { category: COMPOSITION_CATEGORY_LABELS[category ?? 'trader'], rate: rate ?? '-' })}
      </p>
      {issues.length > 0 && (
        <ul className={local.gapList}>
          {issues.map((i) => (
            <li key={`${i.code}${i.invoiceId ?? ''}${i.message}`}>{i.message}</li>
          ))}
        </ul>
      )}
      {view === 'cmp08' ? (
        <>
          <DataTable caption={gvT('capCmp08')} emptyText="" rows={cmpRows} rowKey={(r, i) => `${r.table}${i}`} columns={COLS} />
          <p className={surface.sectionNote}>
            {nodes(gvT('cmpCounts'), { docs: cmp.counts.documents, drafts: cmp.counts.drafts, cancelled: cmp.counts.cancelled, amount: <strong><Money value={cmp.payable.total} /></strong> })}
            {cmp.itcNotClaimable > 0 && <> {nodes(gvT('cmpItc'), { amount: <Money value={cmp.itcNotClaimable} /> })}</>}
          </p>
        </>
      ) : (
        <>
          <DataTable caption={gvT('capGstr4')} emptyText="" rows={g4Rows} rowKey={(r, i) => `${r.table}${i}`} columns={COLS} />
          <p className={surface.sectionNote}>
            {nodes(gvT('g4Totals'), {
              turnover: <Money value={g4.totals.turnover} />,
              tax: <Money value={g4.totals.compositionTax} />,
              rcm: <Money value={g4.totals.rcmTax} />,
              total: <strong><Money value={g4.totals.payable} /></strong>,
            })}
          </p>
          <Suspense fallback={null}>
            <Gstr4AnnualView invoices={invoices} purchases={purchases} fyStart={period.fyStart} gstin={gstin} filerStateCode={filerStateCode} category={category} />
          </Suspense>
        </>
      )}
    </div>
  );
}

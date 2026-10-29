/**
 * CN-D4 material reconciliation (cement / steel) per site and material, extending the R5-B6 site statement (no stock
 * engine change): opening, received — own (transfers to the site), received — client issue (free: quantity only,
 * value 0; against recovery at the issue rate — typed on the site, or the CN-B4 `material_recovery` rows of the RA
 * bills that carry an item and quantity), theoretical (Σ measured qty × coefficient), actual (consumption journals),
 * variation %, permissible band (contract term per material, default −3% / +3% `WASTAGE_BAND_DEFAULTS`), quantity
 * beyond the band, recovery rate (issue rate × penal factor, default 2) and recovery on client-issued materials,
 * closing at site. Quantities in base units (`lineFactor` in `siteStatement`). Site terms and client issues live on
 * the site godown (`Godown.cn_reco`). Working paper — the agreement governs; verify with your CA (CN9, CN29).
 */
import './cn-registry';
import type { CnSiteReco } from '../../types/construction-r11';
import type { Godown, StockTransfer } from '../../types/stock';
import type { StockJournal } from '../../types/manufacturing';
import type { BoqCoefficient, RaMeasurement } from '../../types/transport-works-r5';
import type { InvoiceRecord } from '../../types/invoice';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { num, round2 } from '../invoice-calc';
import { ruleAt } from '../tax-rules';
import { siteOpening, siteStatement } from '../works/sites';
import { COEFFICIENT_STARTERS, WASTAGE_BAND_DEFAULTS } from '../construction-rules';
import { DAY } from './cn-subcon';
import { PRINT_FONT, PRINT_FONT_FACE } from '../print-fonts';

export const starters = (date: string) => ruleAt(COEFFICIENT_STARTERS, date);

export interface RecoRow {
  itemId: string;
  opening: number;
  own: number;
  clientFree: number;
  clientRecovery: number;
  theoretical: number;
  actual: number;
  variancePct: number | null;
  lo: number;
  hi: number;
  /** Quantity used beyond +hi% and below −lo% of the theoretical. */
  excess: number;
  recoveryRate: number;
  recovery: number;
  closing: number;
}

export interface RecoInput {
  site: Godown;
  period: { start: string; end: string };
  transfers: readonly StockTransfer[];
  journals: readonly StockJournal[];
  measurements: readonly RaMeasurement[];
  coefficients: readonly BoqCoefficient[];
  /** RA bills of the site's BOQ (CN-B4 `material_recovery` rows with `item_id` / `qty` / `rate`). */
  bills?: readonly Pick<InvoiceRecord, 'issue_date' | 'boq_id' | 'ra_deductions' | 'status'>[];
}

type Issue = { date: string; item_id: string; qty: number; mode: 'free' | 'recovery'; rate?: number };

/** Client issues of the site: typed on the godown plus CN-B4 recovery rows on RA bills of its BOQ. */
export function clientIssues(i: Pick<RecoInput, 'site' | 'bills'>): Issue[] {
  const out: Issue[] = [...(i.site.cn_reco?.issues ?? [])];
  for (const b of i.bills ?? []) {
    if (!i.site.boq_id || b.boq_id !== i.site.boq_id || b.status === 'Cancelled' || b.status === 'Draft') continue;
    for (const d of b.ra_deductions ?? []) {
      const x = d as { kind: string; item_id?: string; qty?: number; rate?: number };
      if (x.kind === 'material_recovery' && x.item_id && num(x.qty) > 0) out.push({ date: b.issue_date, item_id: x.item_id, qty: num(x.qty), mode: 'recovery', rate: num(x.rate) });
    }
  }
  return out;
}

/** Pure: the reconciliation statement. */
export function materialReco(i: RecoInput): RecoRow[] {
  const def = ruleAt(WASTAGE_BAND_DEFAULTS, i.period.end);
  const st = siteStatement({ ...i, period: i.period });
  const open = siteOpening(i, i.period.start);
  const issues = clientIssues(i);
  const ids = new Set([...st.map((r) => r.itemId), ...issues.map((x) => x.item_id)]);
  return [...ids].map((id) => {
    const s = st.find((r) => r.itemId === id);
    const mine = issues.filter((x) => x.item_id === id);
    const before = mine.filter((x) => x.date < i.period.start).reduce((a, x) => a + x.qty, 0);
    const inP = mine.filter((x) => x.date >= i.period.start && x.date <= i.period.end);
    const free = inP.filter((x) => x.mode === 'free').reduce((a, x) => a + x.qty, 0);
    const rec = inP.filter((x) => x.mode === 'recovery');
    const recQty = rec.reduce((a, x) => a + x.qty, 0);
    const t = i.site.cn_reco?.terms?.[id] ?? {};
    const lo = t.lo ?? def.lo, hi = t.hi ?? def.hi, penal = t.penal ?? def.penal;
    const theo = s?.theoretical ?? 0, actual = s?.consumed ?? 0;
    const excess = theo > 0 ? round2(Math.max(actual - theo * (1 + hi / 100), 0) + Math.max(theo * (1 - lo / 100) - actual, 0)) : 0;
    const issueRate = t.issue_rate ?? (recQty ? rec.reduce((a, x) => a + x.qty * num(x.rate), 0) / recQty : 0);
    const recoveryRate = round2(issueRate * penal);
    const opening = round2((open.get(id) ?? 0) + before);
    const own = s?.issued ?? 0;
    return {
      itemId: id, opening, own, clientFree: round2(free), clientRecovery: round2(recQty), theoretical: theo, actual, variancePct: s?.variancePct ?? null, lo, hi, excess, recoveryRate,
      recovery: free + recQty > 0 ? round2(excess * recoveryRate) : 0, closing: round2(opening + own + free + recQty - actual),
    };
  });
}

export const recoCsvRows = (rows: readonly RecoRow[], name: (id: string) => string): (string | number)[][] => [
  ['Material', 'Opening', 'Received — own', 'Client issue — free', 'Client issue — recovery', 'Theoretical', 'Actual', 'Variation %', 'Band −%', 'Band +%', 'Beyond band', 'Recovery rate', 'Recovery', 'Closing at site'],
  ...rows.map((r) => [name(r.itemId), r.opening, r.own, r.clientFree, r.clientRecovery, r.theoretical, r.actual, r.variancePct ?? '', r.lo, r.hi, r.excess, r.recoveryRate, r.recovery, r.closing]),
];

/** Printable "Material reconciliation statement" (CPWD-style columns). */
export function recoHtml(rows: readonly RecoRow[], name: (id: string) => string, head: { site: string; from: string; to: string; company: string }): string {
  const e = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const [h, ...body] = recoCsvRows(rows, name);
  return `<!doctype html><meta charset="utf-8"><title>Material reconciliation</title><style>${PRINT_FONT_FACE}body{font:12px ${PRINT_FONT};margin:20px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:3px;text-align:right}td:first-child,th:first-child{text-align:left}</style>
<h2>Material reconciliation statement</h2><p>${e(head.company)} · Site ${e(head.site)} · ${e(head.from)} to ${e(head.to)}</p>
<table><tr>${h.map((c) => `<th>${e(c)}</th>`).join('')}</tr>${body.map((r) => `<tr>${r.map((c) => `<td>${e(c)}</td>`).join('')}</tr>`).join('')}</table>
<p><small>Free-issue materials are shown by quantity only (value 0). Band, issue rate and penal factor are contract terms. Working paper — verify with your CA (CN9).</small></p>`;
}

/* ── Site terms and client issues (on the site godown) ── */

function editReco(siteId: string, fn: (r: CnSiteReco) => CnSiteReco): void {
  requireAccess('master.edit');
  const all = getTable<Godown>('godowns');
  const g = all.find((x) => x.id === siteId && x.kind === 'site');
  if (!g) throw new Error('Choose a site.');
  setTable('godowns', all.map((x) => (x.id === siteId ? { ...x, cn_reco: fn(x.cn_reco ?? {}) } : x)));
}

export function saveTerms(siteId: string, itemId: string, t: { lo?: number; hi?: number; issue_rate?: number; penal?: number }): void {
  if (!itemId) throw new Error('Choose the material.');
  editReco(siteId, (r) => ({ ...r, terms: { ...r.terms, [itemId]: Object.fromEntries(Object.entries(t).filter(([, v]) => v !== undefined && Number.isFinite(Number(v))).map(([k, v]) => [k, num(v)])) } }));
}

export function addIssue(siteId: string, x: { date: string; item_id: string; qty: number; mode: 'free' | 'recovery'; rate?: number; ref?: string }): void {
  if (!DAY.test(x.date) || !x.item_id || !(num(x.qty) > 0)) throw new Error('Enter the date, material and quantity issued by the client.');
  if (x.mode === 'recovery' && !(num(x.rate) > 0)) throw new Error('Enter the recovery (issue) rate.');
  editReco(siteId, (r) => ({ ...r, issues: [...(r.issues ?? []), { ...x, id: generateId(), qty: num(x.qty), ...(x.mode === 'recovery' ? { rate: num(x.rate) } : { rate: undefined }) }] }));
}

export const removeIssue = (siteId: string, id: string) => editReco(siteId, (r) => ({ ...r, issues: (r.issues ?? []).filter((x) => x.id !== id) }));

/** Pure: transfers / journals / measurements of a site, read once (the view passes the tables). */
export const recoTables = () => ({ transfers: getTable<StockTransfer>('stock_transfers'), journals: getTable<StockJournal>('stock_journals') });

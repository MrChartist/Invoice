/**
 * Annual accounts pack (R2-C1): cover, index, Schedule III balance sheet and P&L with the previous-year
 * column, cash-flow statement (AS 3), trial balance and notes to accounts — one draft for the CA.
 *
 * Every figure comes from the same builders as Books / the Gateway (`ledgerBalanceSheet`,
 * `ledgerProfitAndLoss`, `cashFlowStatement`, `trialBalance`) with the valuer from `loadStockValuer()`,
 * so closing stock is never counted twice. Output: script-free print HTML (`annualPackHtml`), the same
 * pages as a fragment for the PDF capture (`annualPackBody`), and XLSX sheets of the numeric schedules.
 * Text notes are stored per FY in `notes_to_accounts`. Draft — verify with your CA.
 */

import type { InvoiceRecord } from '../../types/invoice';
import type { Vendor } from '../../types/purchases';
import type { EntityType, NoteText, NotesToAccounts } from '../../types/books-r2';
import { requireAccess } from '../access';
import { audit } from '../audit';
import { fyPeriod } from '../books';
import { getTable, setTable } from '../storage';
import { formatDate, formatMoney } from '../utils';
import { esc } from '../voucher-print';
import { groupOf } from './accounts';
import type { FixedAsset } from './assets';
import type { StockValuer } from './closing-stock';
import type { Ledger } from './postings';
import {
  cashFlowStatement,
  ledgerBalanceSheet,
  ledgerProfitAndLoss,
  trialBalance,
  type BsSection,
  type CashFlowStatement,
  type LedgerBalanceSheet,
  type LedgerProfitLoss,
  type TrialBalance,
} from './reports';
import { buildNotes, capitalTitle, reservesTitle, TEXT_NOTES, type NoteCell, type PackNote } from './notes-auto';

export const NOTES_TABLE = 'notes_to_accounts';
export const ENTITY_TYPES: readonly EntityType[] = ['proprietorship', 'partnership', 'llp', 'company'];
export const DRAFT_LINE = 'Draft — prepared from books, verify with your CA';

export const fyId = (startYear: number) => `FY${String(startYear).slice(2)}-${String(startYear + 1).slice(2)}`;
const fyText = (startYear: number) => `FY ${startYear}-${String(startYear + 1).slice(2)}`;

/* ── Notes storage ────────────────────────────────────────────── */

export const notesDb = {
  all: (): NotesToAccounts[] => getTable<NotesToAccounts>(NOTES_TABLE).filter((r) => r && typeof r.id === 'string' && r.notes && typeof r.notes === 'object'),
  get: (id: string): NotesToAccounts | null => notesDb.all().find((r) => r.id === id) ?? null,
  /** Replace the FY's notes (blank texts dropped, so a reset note falls back to the starter text). */
  save(id: string, notes: Record<string, NoteText>, entity?: EntityType): NotesToAccounts {
    requireAccess('books.edit');
    const clean: Record<string, NoteText> = {};
    for (const [k, v] of Object.entries(notes)) {
      const text = typeof v?.text === 'string' ? v.text.trim().slice(0, 8000) : '';
      const extra = typeof v?.extra === 'string' ? v.extra.trim().slice(0, 4000) : '';
      if (text || extra) clean[k] = { ...(text ? { text } : {}), ...(extra ? { extra } : {}) };
    }
    const row: NotesToAccounts = { id, notes: clean, ...(entity ? { entity_type: entity } : {}), updated_at: new Date().toISOString() };
    const prev = notesDb.get(id);
    setTable(NOTES_TABLE, [...notesDb.all().filter((r) => r.id !== id), row]);
    audit.record({ entity: 'settings', entity_id: id, action: prev ? 'update' : 'create', summary: `Notes to accounts for ${id} saved (${Object.keys(clean).length} note(s))` });
    return row;
  },
};

/* ── Model ────────────────────────────────────────────────────── */

export interface AnnualPackInput {
  ledger: Ledger;
  stock?: StockValuer;
  fyStartYear: number;
  assets: readonly FixedAsset[];
  vendors: readonly Vendor[];
  invoices: readonly InvoiceRecord[];
  company: { name: string; address?: string; gstin?: string; pan?: string };
  entity?: EntityType;
  notes?: NotesToAccounts | null;
  /** Shown on the cover, e.g. a branch name. */
  scopeLabel?: string;
  generatedOn?: string;
  /**
   * As-at date the user picked for a year still running (QA-3 F18). Ignored once the FY has ended: a closed year is
   * always drawn to 31 March. While it runs, the statements stop at this date (or `generatedOn`) and say "interim".
   */
  asAt?: string;
}

/** The date the pack's statements run to: the FY end once the FY has ended, else the picked as-at date (or today) inside the FY. */
export function packAsAt(fy: { start: string; end: string }, today: string, asAt?: string): { asAt: string; interim: boolean } {
  const t = today.slice(0, 10);
  if (t > fy.end) return { asAt: fy.end, interim: false };
  const picked = (asAt ?? '').slice(0, 10);
  // A picked date outside this FY (the shared report period may be another year) falls back to today.
  let d = picked && picked >= fy.start && picked <= fy.end ? picked : t;
  if (d > t) d = t; // never a date in the future
  if (d < fy.start) d = fy.start;
  return { asAt: d, interim: d < fy.end };
}

export interface AnnualPack {
  fy: { start: string; end: string; label: string; id: string };
  prev: { start: string; end: string; label: string };
  company: AnnualPackInput['company'];
  entity: EntityType;
  scopeLabel?: string;
  generatedOn: string;
  /** Last day the statements cover (the FY end for a closed year). */
  asAt: string;
  /** True while the FY is still running: the pack is an interim draft to `asAt`. */
  interim: boolean;
  bs: LedgerBalanceSheet;
  bsPrev: LedgerBalanceSheet;
  pl: LedgerProfitLoss;
  plPrev: LedgerProfitLoss;
  cf: CashFlowStatement;
  tb: TrialBalance;
  notes: PackNote[];
  /** Balance-sheet difference at the year end (0 when the books tie). */
  difference: number;
}

export function buildAnnualPack(input: AnnualPackInput): AnnualPack {
  const fyP = fyPeriod(input.fyStartYear);
  const prevP = fyPeriod(input.fyStartYear - 1);
  const fy = { ...fyP, label: fyText(input.fyStartYear), id: fyId(input.fyStartYear) };
  const prev = { ...prevP, label: fyText(input.fyStartYear - 1) };
  const entity = input.entity ?? input.notes?.entity_type ?? 'proprietorship';
  const generatedOn = input.generatedOn ?? new Date().toISOString().slice(0, 10);
  // QA-3 F18: a year still running is drawn to the as-at date, not to a 31 March that has not come yet.
  const { asAt, interim } = packAsAt(fyP, generatedOn, input.asAt);
  const curP = { start: fyP.start, end: asAt };
  const bs = ledgerBalanceSheet(input.ledger, asAt, input.stock);
  const bsPrev = ledgerBalanceSheet(input.ledger, prev.end, input.stock);
  const pl = ledgerProfitAndLoss(input.ledger, curP, input.stock);
  const plPrev = ledgerProfitAndLoss(input.ledger, prevP, input.stock);
  const cf = cashFlowStatement(input.ledger, curP, input.stock);
  const tb = trialBalance(input.ledger, curP);
  const notes = buildNotes({ ledger: input.ledger, fy: { ...fy, end: asAt }, prev, bs, bsPrev, pl, plPrev, stock: input.stock, assets: input.assets, vendors: input.vendors, invoices: input.invoices, entity, stored: input.notes ?? null });
  return {
    fy, prev, company: input.company, entity, scopeLabel: input.scopeLabel, generatedOn, asAt, interim,
    bs, bsPrev, pl, plPrev, cf, tb, notes, difference: bs.difference,
  };
}

/* ── Statement rows (shared by HTML and XLSX) ─────────────────── */

export interface StatementLine {
  label: string;
  note?: number;
  cur?: number;
  prev?: number;
  /** 0 heading, 1 item, 2 sub-total, 3 grand total. */
  level: 0 | 1 | 2 | 3;
}

const ITEM_NOTE: Record<string, string> = {
  CAPITAL: 'capital', RESERVES: 'reserves', LOANS_LT: 'borrowings', LOANS_ST: 'borrowings', TRADE_PAYABLES: 'payables',
  OTHER_CL: 'taxes', LOANS_ADV_ST: 'taxes', FIXED_ASSETS: 'fixed_assets', INVENTORIES: 'inventory', TRADE_RECEIVABLES: 'receivables',
};

function itemLabel(pack: AnnualPack, groupId: string | undefined, label: string): string {
  if (groupId === 'CAPITAL') return capitalTitle(pack.entity);
  if (groupId === 'RESERVES') return reservesTitle(pack.entity);
  return label;
}

/** Schedule III balance sheet rows with the previous-year column and note numbers. */
export function balanceSheetLines(pack: AnnualPack): StatementLine[] {
  const noteNo = (id?: string) => (id ? pack.notes.find((n) => n.id === id)?.no : undefined);
  const out: StatementLine[] = [];
  const side = (title: string, cur: BsSection[], prev: BsSection[], total: number, totalPrev: number) => {
    out.push({ label: title, level: 0 });
    const keys = [...new Set([...cur.map((s) => s.key), ...prev.map((s) => s.key)])];
    for (const k of keys) {
      const s = cur.find((x) => x.key === k);
      const p = prev.find((x) => x.key === k);
      const label = (s ?? p)!.label;
      out.push({ label: pack.entity === 'company' && k === 'funds' ? "Shareholders' funds" : label, level: 0 });
      const items = [...new Set([...(s?.items ?? []).map((i) => i.groupId ?? i.label), ...(p?.items ?? []).map((i) => i.groupId ?? i.label)])];
      for (const id of items) {
        const a = s?.items.find((i) => (i.groupId ?? i.label) === id);
        const b = p?.items.find((i) => (i.groupId ?? i.label) === id);
        const any = (a ?? b)!;
        out.push({ label: itemLabel(pack, any.groupId, any.label), note: noteNo(any.groupId ? ITEM_NOTE[any.groupId] : undefined), cur: a?.amount ?? 0, prev: b?.amount ?? 0, level: 1 });
      }
      out.push({ label: `Total ${label.toLowerCase()}`, cur: s?.total ?? 0, prev: p?.total ?? 0, level: 2 });
    }
    out.push({ label: 'TOTAL', cur: total, prev: totalPrev, level: 3 });
  };
  side('I. EQUITY AND LIABILITIES', pack.bs.equityAndLiabilities, pack.bsPrev.equityAndLiabilities, pack.bs.totalEquityAndLiabilities, pack.bsPrev.totalEquityAndLiabilities);
  side('II. ASSETS', pack.bs.assets, pack.bsPrev.assets, pack.bs.totalAssets, pack.bsPrev.totalAssets);
  return out;
}

/** Statement of profit and loss (Schedule III order) with the previous year. */
export function profitLossLines(pack: AnnualPack): StatementLine[] {
  const noteNo = (id: string) => pack.notes.find((n) => n.id === id)?.no;
  const group = (pl: LedgerProfitLoss, g: string) => [...pl.income, ...pl.expenses].filter((s) => s.group === g).reduce((x, s) => x + s.total, 0);
  const groups = (pl: LedgerProfitLoss, nature: 'income' | 'expense') => (nature === 'income' ? pl.income : pl.expenses).map((s) => s.group);
  const out: StatementLine[] = [];
  const cur = pack.pl;
  const prev = pack.plPrev;
  out.push({ label: 'Revenue from operations', note: noteNo('revenue'), cur: group(cur, 'SALES'), prev: group(prev, 'SALES'), level: 1 });
  const otherIncome = (pl: LedgerProfitLoss) => pl.totalIncome - group(pl, 'SALES');
  out.push({ label: 'Other income', cur: otherIncome(cur), prev: otherIncome(prev), level: 1 });
  out.push({ label: 'Total income', cur: cur.totalIncome, prev: prev.totalIncome, level: 2 });
  out.push({ label: 'Expenses', level: 0 });
  const expGroups = [...new Set([...groups(cur, 'expense'), ...groups(prev, 'expense')])];
  for (const g of expGroups) out.push({ label: groupOf(g).label, note: g === 'DEPRECIATION' ? noteNo('fixed_assets') : undefined, cur: group(cur, g), prev: group(prev, g), level: 1 });
  const change = (pl: LedgerProfitLoss) => pl.trading.openingStock - pl.trading.closingStock;
  if (change(cur) || change(prev)) out.push({ label: 'Changes in inventories (opening − closing)', note: noteNo('inventory'), cur: change(cur), prev: change(prev), level: 1 });
  out.push({ label: 'Total expenses', cur: cur.totalExpenses + change(cur), prev: prev.totalExpenses + change(prev), level: 2 });
  out.push({ label: 'Profit / (loss) for the year', cur: cur.netProfit, prev: prev.netProfit, level: 3 });
  return out;
}

/* ── HTML ─────────────────────────────────────────────────────── */

const amt = (p: number | undefined) => {
  if (p === undefined) return '';
  if (!p) return '–';
  const s = formatMoney(Math.abs(p) / 100);
  return p < 0 ? `(${s})` : s;
};
const cell = (c: NoteCell) => (typeof c === 'number' ? `<td class="n">${esc(amt(c))}</td>` : `<td>${esc(c)}</td>`);

const PACK_CSS = `
.ap-root { font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; color: #111; font-size: 12px; line-height: 1.45; background: #fff; }
.ap-root .ap-page { width: 794px; min-height: 1123px; box-sizing: border-box; padding: 48px 56px; background: #fff; break-after: page; page-break-after: always; }
.ap-root .ap-page:last-child { break-after: auto; page-break-after: auto; }
.ap-root h1 { font-size: 22px; margin: 0 0 4px; }
.ap-root h2 { font-size: 15px; margin: 0 0 4px; text-transform: uppercase; letter-spacing: 0.05em; }
.ap-root h3 { font-size: 13px; margin: 18px 0 6px; }
.ap-root .sub { color: #444; white-space: pre-line; }
.ap-root .draft { display: inline-block; margin-top: 14px; padding: 4px 10px; border: 1.5px solid #8a5a14; color: #8a5a14; font-weight: 700; }
.ap-root .cover { display: flex; flex-direction: column; justify-content: center; min-height: 900px; }
.ap-root .cover h1 { font-size: 30px; }
.ap-root table { width: 100%; border-collapse: collapse; margin-top: 8px; }
.ap-root th, .ap-root td { padding: 4px 6px; border-bottom: 1px solid #ddd; text-align: left; vertical-align: top; }
.ap-root th { font-size: 10px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1.5px solid #222; }
.ap-root td.n, .ap-root th.n { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.ap-root td.c, .ap-root th.c { text-align: center; width: 48px; }
.ap-root tr.l0 td { font-weight: 700; padding-top: 10px; }
.ap-root tr.l1 td:first-child { padding-left: 18px; }
.ap-root tr.l2 td { font-weight: 600; border-top: 1px solid #999; }
.ap-root tr.l3 td { font-weight: 800; border-top: 1.5px solid #222; border-bottom: 3px double #222; }
.ap-root .meta { color: #555; font-size: 11px; margin-bottom: 10px; }
.ap-root .warn { color: #b74443; font-weight: 600; }
.ap-root ol.index li { padding: 3px 0; }
.ap-root .note { margin-bottom: 16px; break-inside: avoid; }
.ap-root .note p { margin: 4px 0; }
.ap-root .foot { margin-top: 18px; color: #777; font-size: 10px; }
.ap-root .sign { display: flex; justify-content: space-between; margin-top: 48px; }
.ap-root .sign div { border-top: 1px solid #222; padding-top: 4px; min-width: 200px; text-align: center; }
@media print { .ap-root .ap-page { width: auto; min-height: 0; padding: 0; } }
`;

function header(pack: AnnualPack, title: string, sub: string): string {
  return `<h2>${esc(pack.company.name || 'Your business')}</h2><h1>${esc(title)}</h1><div class="meta">${esc(sub)} · Amounts in ₹ · ${esc(DRAFT_LINE)}</div>`;
}

function statementTable(lines: StatementLine[], curLabel: string, prevLabel: string, withNotes = true): string {
  const rows = lines
    .map((l) => `<tr class="l${l.level}"><td>${esc(l.label)}</td>${withNotes ? `<td class="c">${l.note ?? ''}</td>` : ''}<td class="n">${esc(amt(l.cur))}</td><td class="n">${esc(amt(l.prev))}</td></tr>`)
    .join('');
  return `<table><thead><tr><th>Particulars</th>${withNotes ? '<th class="c">Note</th>' : ''}<th class="n">${esc(curLabel)}</th><th class="n">${esc(prevLabel)}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function cashFlowHtml(c: CashFlowStatement): string {
  const line = (label: string, v: number, cls = 'l1') => `<tr class="${cls}"><td>${esc(label)}</td><td class="n">${esc(amt(v))}</td></tr>`;
  return `<table><thead><tr><th>Particulars</th><th class="n">Amount</th></tr></thead><tbody>
  <tr class="l0"><td colspan="2">A. Cash flow from operating activities</td></tr>
  ${line('Net profit / (loss)', c.netProfit)}${c.operating.adjustments.map((l) => line(l.label, l.amount)).join('')}${c.operating.workingCapital.map((l) => line(l.label, l.amount)).join('')}
  ${line('Net cash from operating activities', c.operating.total, 'l2')}
  <tr class="l0"><td colspan="2">B. Cash flow from investing activities</td></tr>${c.investing.lines.map((l) => line(l.label, l.amount)).join('')}${line('Net cash from investing activities', c.investing.total, 'l2')}
  <tr class="l0"><td colspan="2">C. Cash flow from financing activities</td></tr>${c.financing.lines.map((l) => line(l.label, l.amount)).join('')}${line('Net cash from financing activities', c.financing.total, 'l2')}
  ${line('Net increase / (decrease) in cash & cash equivalents', c.netChange, 'l2')}${line('Cash & cash equivalents at the beginning', c.openingCash)}${line('Cash & cash equivalents at the end', c.closingCash, 'l3')}
  </tbody></table>${c.difference ? `<p class="warn">Cash-flow difference ₹${esc(amt(c.difference))} — check the books.</p>` : ''}`;
}

function trialBalanceHtml(tb: TrialBalance): string {
  const rows = tb.rows
    .map((r) => `<tr class="l1"><td>${esc(r.account.code)} ${esc(r.account.name)}</td><td>${esc(groupOf(r.account.group).label)}</td><td class="n">${r.closing > 0 ? esc(amt(r.closing)) : ''}</td><td class="n">${r.closing < 0 ? esc(amt(-r.closing)) : ''}</td></tr>`)
    .join('');
  return `<table><thead><tr><th>Account</th><th>Group</th><th class="n">Debit</th><th class="n">Credit</th></tr></thead><tbody>${rows}
  <tr class="l3"><td colspan="2">Total</td><td class="n">${esc(amt(tb.totals.closingDr))}</td><td class="n">${esc(amt(tb.totals.closingCr))}</td></tr></tbody></table>`;
}

function noteHtml(n: PackNote): string {
  const tables = n.tables
    .map((t) => `${t.title ? `<h3>${esc(t.title)}</h3>` : ''}<table><thead><tr>${t.columns.map((c, i) => `<th${i ? ' class="n"' : ''}>${esc(c)}</th>`).join('')}</tr></thead><tbody>${t.rows.map((r) => `<tr class="${String(r[0]).startsWith('Total') ? 'l2' : 'l1'}">${r.map(cell).join('')}</tr>`).join('')}</tbody></table>`)
    .join('');
  return `<div class="note"><h3>${n.no}. ${esc(n.title)}</h3>${n.paragraphs.map((p) => `<p>${esc(p)}</p>`).join('')}${tables}${n.extra ? n.extra.split('\n').map((p) => `<p>${esc(p)}</p>`).join('') : ''}</div>`;
}

const SECTIONS = ['Balance sheet', 'Statement of profit and loss', 'Cash-flow statement', 'Trial balance', 'Notes to accounts'];

/** The pack's pages as one `.ap-root` fragment (scoped CSS included) — for the PDF capture and the preview. */
export function annualPackBody(pack: AnnualPack): string {
  const c = pack.company;
  const sub = [c.address, c.gstin ? `GSTIN: ${c.gstin}` : '', c.pan ? `PAN: ${c.pan}` : ''].filter(Boolean).join('\n');
  const ent = { proprietorship: 'Proprietorship', partnership: 'Partnership firm', llp: 'Limited liability partnership', company: 'Company' }[pack.entity];
  const asAt = pack.interim ? `As at ${formatDate(pack.asAt)} (interim — the year ends ${formatDate(pack.fy.end)})` : `As at ${formatDate(pack.fy.end)}`;
  const period = pack.interim ? `For the period ${formatDate(pack.fy.start)} to ${formatDate(pack.asAt)} (interim)` : `For the year ended ${formatDate(pack.fy.end)}`;
  const tie = pack.difference ? `<p class="warn">The balance sheet does not tie: difference ₹${esc(amt(pack.difference))}. Check the Vouchers warnings in Books before sharing.</p>` : '';
  const pages = [
    `<section class="ap-page"><div class="cover"><h2>${esc(ent)}</h2><h1>${esc(c.name || 'Your business')}</h1>${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
      <h2 style="margin-top:28px">Annual accounts · ${esc(pack.fy.label)}</h2><div class="sub">${esc(`${formatDate(pack.fy.start)} to ${formatDate(pack.interim ? pack.asAt : pack.fy.end)}${pack.interim ? ' · Interim, figures to date' : ''}`)}${pack.scopeLabel ? ` · ${esc(pack.scopeLabel)}` : ''}</div>
      <div class="draft">${esc(DRAFT_LINE)}</div>
      <h3 style="margin-top:36px">Contents</h3><ol class="index">${SECTIONS.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      <p class="foot">Prepared on ${esc(formatDate(pack.generatedOn))} from the books kept in Mr. Chartist Invoice. Figures are the same as Books → Balance sheet / P&amp;L. Not audited.</p></div></section>`,
    `<section class="ap-page">${header(pack, 'Balance sheet', asAt)}${tie}${statementTable(balanceSheetLines(pack), pack.fy.label, pack.prev.label)}
      <div class="sign"><div>For the business</div><div>Prepared by / for the auditor</div></div></section>`,
    `<section class="ap-page">${header(pack, 'Statement of profit and loss', period)}${statementTable(profitLossLines(pack), pack.fy.label, pack.prev.label)}${pack.pl.stockLabel ? `<p class="foot">Closing stock: ${esc(pack.pl.stockLabel)}.</p>` : ''}</section>`,
    `<section class="ap-page">${header(pack, 'Cash-flow statement (AS 3, indirect method)', period)}${cashFlowHtml(pack.cf)}</section>`,
    `<section class="ap-page">${header(pack, 'Trial balance', asAt)}${trialBalanceHtml(pack.tb)}</section>`,
    `<section class="ap-page">${header(pack, 'Notes to accounts', period)}${pack.notes.map(noteHtml).join('')}<p class="foot">${esc(DRAFT_LINE)}. Schedule III wording for ${esc(ent.toLowerCase())} and the notes required for your entity — verify with your CA.</p></section>`,
  ];
  return `<div class="ap-root"><style>${PACK_CSS}</style>${pages.join('\n')}</div>`;
}

/** Complete, script-free print document. */
export function annualPackHtml(pack: AnnualPack): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(`${pack.company.name || 'Annual accounts'} — ${pack.fy.label}`)}</title>
<style>@page { size: 210mm 297mm; margin: 14mm; } body { margin: 0; background: #fff; }</style></head>
<body>${annualPackBody(pack)}</body></html>`;
}

/* ── XLSX (numeric schedules, rupees) ─────────────────────────── */

const rupees = (p: number | undefined) => (p === undefined ? '' : Math.round(p) / 100);

export function annualPackSheets(pack: AnnualPack): { name: string; rows: (string | number)[][]; header?: boolean }[] {
  const stmt = (lines: StatementLine[]) => [['Particulars', 'Note', pack.fy.label, pack.prev.label], ...lines.map((l) => [l.label, l.note ?? '', rupees(l.cur), rupees(l.prev)])];
  const cf = pack.cf;
  const cfRows: (string | number)[][] = [
    ['Particulars', 'Amount'],
    ['Net profit / (loss)', rupees(cf.netProfit)],
    ...cf.operating.adjustments.map((l) => [l.label, rupees(l.amount)]),
    ...cf.operating.workingCapital.map((l) => [l.label, rupees(l.amount)]),
    ['Net cash from operating activities', rupees(cf.operating.total)],
    ...cf.investing.lines.map((l) => [l.label, rupees(l.amount)]),
    ['Net cash from investing activities', rupees(cf.investing.total)],
    ...cf.financing.lines.map((l) => [l.label, rupees(l.amount)]),
    ['Net cash from financing activities', rupees(cf.financing.total)],
    ['Net change in cash', rupees(cf.netChange)],
    ['Opening cash', rupees(cf.openingCash)],
    ['Closing cash', rupees(cf.closingCash)],
  ];
  const tb: (string | number)[][] = [['Code', 'Account', 'Group', 'Opening', 'Debit', 'Credit', 'Closing (Dr +)'], ...pack.tb.rows.map((r) => [r.account.code, r.account.name, groupOf(r.account.group).label, rupees(r.opening), rupees(r.debit), rupees(r.credit), rupees(r.closing)])];
  const notes: (string | number)[][] = [[`Notes to accounts — ${pack.fy.label}`, DRAFT_LINE]];
  for (const n of pack.notes) {
    if (!n.tables.length) continue;
    notes.push([], [`${n.no}. ${n.title}`]);
    for (const t of n.tables) {
      if (t.title) notes.push([t.title]);
      notes.push(t.columns);
      for (const r of t.rows) notes.push(r.map((c) => (typeof c === 'number' ? rupees(c) : c)));
    }
  }
  return [
    { name: 'Balance sheet', rows: stmt(balanceSheetLines(pack)) },
    { name: 'Profit & loss', rows: stmt(profitLossLines(pack)) },
    { name: 'Cash flow', rows: cfRows },
    { name: 'Trial balance', rows: tb },
    { name: 'Notes', rows: notes, header: false },
  ];
}

/** Ids of the editable text notes (for the notes editor). */
export const TEXT_NOTE_IDS = TEXT_NOTES.map((t) => t.id);

/**
 * Notes to accounts built from the books (R2-C1) — capital / reserves movement, borrowings, trade payables
 * with the MSME split and ageing, trade receivables ageing, fixed-asset schedule (gross block, additions,
 * deletions, depreciation, net block — tied to the register), inventories (closing stock through the same
 * valuer as every statement), revenue split goods / services, and GST / TDS balances; plus editable text
 * notes with starter wording.
 *
 * Amounts are integer PAISE. Ageing is FIFO from the voucher date (not the due date) — Schedule III ages
 * from the due date: verify with your CA. Pure.
 */

import type { InvoiceRecord } from '../../types/invoice';
import type { Vendor } from '../../types/purchases';
import type { EntityType, NotesToAccounts } from '../../types/books-r2';
import { isMse } from '../msme';
import { isRevenueDoc } from '../stats';
import { A, groupOf, type Account, type GroupId } from './accounts';
import { depreciationSchedule, type FixedAsset } from './assets';
import type { Ledger } from './postings';
import { closingBalances, type LedgerBalanceSheet, type LedgerProfitLoss } from './reports';
import type { StockValuer } from './closing-stock';

/** A table cell: text, or a number = an amount in paise. */
export type NoteCell = string | number;

export interface NoteTable {
  title?: string;
  columns: string[];
  rows: NoteCell[][];
}

export interface PackNote {
  id: string;
  /** Printed note number (1, 2, …), set by the pack. */
  no?: number;
  title: string;
  kind: 'auto' | 'text';
  paragraphs: string[];
  tables: NoteTable[];
  /** User's extra paragraph under an automatic note. */
  extra?: string;
}

export interface NotesContext {
  ledger: Ledger;
  fy: { start: string; end: string; label: string };
  prev: { start: string; end: string; label: string };
  bs: LedgerBalanceSheet;
  bsPrev: LedgerBalanceSheet;
  pl: LedgerProfitLoss;
  plPrev: LedgerProfitLoss;
  stock?: StockValuer;
  assets: readonly FixedAsset[];
  vendors: readonly Vendor[];
  invoices: readonly InvoiceRecord[];
  entity: EntityType;
  stored: NotesToAccounts | null;
  /**
   * MF-D5 (optional): Schedule III sub-heads of the Inventories line (paise; `mfg/mf-inventories.ts` `noteRows`). Absent
   * or empty = the one-line note as before.
   */
  inventoryRows?: readonly { label: string; cur: number; prev: number }[];
  /**
   * PS-D1 (optional): partners' capital and current account statements for the FY (paise; `prof/ps-partner-post.ts`
   * `partnerStatements`). Absent or empty = the note as before.
   */
  partnerRows?: readonly PartnerNoteRow[];
}

/** One partner's line in the partners' note (paise). */
/** QA17 R7: `other` = TDS u/s 194T, interest on drawings and any other entry, so each row foots to its closing. */
export interface PartnerNoteRow { name: string; opening: number; introduced: number; drawings: number; interest: number; remuneration: number; share: number; other?: number; closing: number }

/* ── Wording ──────────────────────────────────────────────────── */

export function capitalTitle(entity: EntityType): string {
  if (entity === 'company') return 'Share capital';
  if (entity === 'partnership') return "Partners' capital accounts";
  if (entity === 'llp') return "Partners' contribution";
  return "Proprietor's capital account";
}

export function reservesTitle(entity: EntityType): string {
  return entity === 'company' ? 'Other equity (reserves & surplus)' : 'Reserves & surplus';
}

/** Editable notes and their starter text. */
export const TEXT_NOTES: ReadonlyArray<{ id: string; title: string; starter: (e: EntityType) => string }> = [
  {
    id: 'policies',
    title: 'Significant accounting policies',
    starter: (e) =>
      [
        `Basis of preparation: the financial statements are prepared on the accrual basis under the historical cost convention${e === 'company' ? ', in the format of Schedule III to the Companies Act, 2013' : ''}.`,
        'Revenue: sales are recognised when goods are delivered / services rendered, net of GST. Amounts billed in advance are deferred over the service period.',
        'Property, plant & equipment: stated at cost less accumulated depreciation. Depreciation is charged on the written-down value at the rates of the Income-tax Act (verify the method and rates for your books).',
        'Inventories: valued at the lower of cost and net realisable value; cost by the method set in the app.',
        'GST: input tax credit availed is not included in the cost of purchases.',
      ].join('\n'),
  },
  { id: 'contingent', title: 'Contingent liabilities and commitments', starter: () => 'Claims against the business not acknowledged as debts: Nil.\nGuarantees given: Nil.\nCapital commitments: Nil.' },
  { id: 'related', title: 'Related party disclosures', starter: (e) => (e === 'company' ? 'Key managerial personnel and their relatives, and transactions with them during the year: (list).' : 'Transactions with the proprietor / partners and their relatives during the year: (list).') },
  { id: 'events', title: 'Events after the balance sheet date', starter: () => 'No significant events have occurred after the balance sheet date that require adjustment or disclosure.' },
];

/* ── Ledger helpers ───────────────────────────────────────────── */

const days = (from: string, to: string) => {
  const u = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((u(to) - u(from)) / 86_400_000);
};

/** Debits and credits of an account inside [start, end] (paise). */
function movement(ledger: Ledger, accountId: string, start: string, end: string): { dr: number; cr: number } {
  let dr = 0;
  let cr = 0;
  for (const v of ledger.vouchers) {
    if (v.date < start || v.date > end) continue;
    for (const l of v.lines) {
      if (l.account !== accountId) continue;
      dr += l.dr;
      cr += l.cr;
    }
  }
  return { dr, cr };
}

const inGroup = (ledger: Ledger, ...groups: GroupId[]) => ledger.accounts.filter((a) => groups.includes(a.group));

export interface AgeingResult {
  buckets: string[];
  /** party → amount per bucket (paise, positive). */
  parties: Map<string, number[]>;
  totals: number[];
}

/**
 * FIFO ageing of party balances on a control account at `asOf`: the outstanding balance is made of the
 * most recent bills (payments settle the oldest first). `side` 'dr' = receivables (debit balances).
 */
export function ageParties(ledger: Ledger, accountId: string, asOf: string, side: 'dr' | 'cr', limits: number[], labels: string[]): AgeingResult {
  const per = new Map<string, { bal: number; bills: { date: string; amt: number }[] }>();
  for (const v of ledger.vouchers) {
    if (v.date > asOf) continue;
    for (const l of v.lines) {
      if (l.account !== accountId) continue;
      const p = l.party || '(no party)';
      const e = per.get(p) ?? { bal: 0, bills: [] };
      e.bal += l.dr - l.cr;
      const amt = side === 'dr' ? l.dr : l.cr;
      if (amt > 0) e.bills.push({ date: v.date, amt });
      per.set(p, e);
    }
  }
  const parties = new Map<string, number[]>();
  const totals = labels.map(() => 0);
  for (const [p, e] of per) {
    let left = side === 'dr' ? e.bal : -e.bal;
    if (left <= 0) continue;
    const row = labels.map(() => 0);
    const bills = [...e.bills].sort((a, b) => b.date.localeCompare(a.date));
    for (const b of bills) {
      if (left <= 0) break;
      const take = Math.min(left, b.amt);
      const age = days(b.date, asOf);
      let k = limits.findIndex((lim) => age < lim);
      if (k < 0) k = labels.length - 1;
      row[k] += take;
      left -= take;
    }
    if (left > 0) row[labels.length - 1] += left; // opening balances with no dated bill
    parties.set(p, row);
    row.forEach((x, i) => (totals[i] += x));
  }
  return { buckets: labels, parties, totals };
}

export const RECEIVABLE_BUCKETS = { limits: [183, 365, 730, 1095], labels: ['< 6 months', '6 months – 1 year', '1–2 years', '2–3 years', '> 3 years'] };
export const PAYABLE_BUCKETS = { limits: [365, 730, 1095], labels: ['< 1 year', '1–2 years', '2–3 years', '> 3 years'] };

/* ── Notes ────────────────────────────────────────────────────── */

function capitalNote(c: NotesContext): PackNote {
  const rows: NoteCell[][] = [];
  const opening = closingBalances(c.ledger, c.prev.end);
  for (const a of inGroup(c.ledger, 'CAPITAL')) {
    const m = movement(c.ledger, a.id, c.fy.start, c.fy.end);
    const open = -(opening.get(a.id) ?? 0);
    const close = open + m.cr - m.dr;
    if (!open && !m.cr && !m.dr) continue;
    rows.push([a.name, open, m.cr, m.dr, close]);
  }
  if (c.bs.openingStock) rows.push(['Opening stock (difference in opening balances)', c.bs.openingStock, 0, 0, c.bs.openingStock]);
  const sum = (i: number) => rows.reduce((s, r) => s + (r[i] as number), 0);
  if (rows.length > 1) rows.push(['Total', sum(1), sum(2), sum(3), sum(4)]);
  return {
    id: 'capital',
    title: capitalTitle(c.entity),
    kind: 'auto',
    paragraphs: c.entity === 'company' ? ['Authorised, issued, subscribed and paid-up share capital, and the shareholding of promoters: (add details).'] : [],
    tables: [
      { columns: ['Account', `Opening ${c.fy.start}`, 'Introduced / credited', 'Withdrawn / debited', `Closing ${c.fy.end}`], rows },
      // PS-D1: partner-wise capital and current accounts (only when the firm desk has partners).
      ...(c.partnerRows?.length ? [{ title: 'Partner-wise capital and current accounts (verify with your CA)', columns: ['Partner', 'Opening', 'Introduced', 'Drawings', 'Interest on capital', 'Remuneration', 'Share of profit', 'TDS 194T and other', 'Closing'], rows: c.partnerRows.map((p) => [p.name, p.opening, p.introduced, p.drawings, p.interest, p.remuneration, p.share, p.other ?? p.closing - p.opening - p.introduced + p.drawings - p.interest - p.remuneration - p.share, p.closing]) }] : []),
    ],
  };
}

function reservesNote(c: NotesContext): PackNote {
  const item = c.bs.equityAndLiabilities.flatMap((s) => s.items).find((i) => i.groupId === 'RESERVES');
  const direct = item?.detail.find((d) => d.accountId === A.reserves)?.amount ?? 0;
  const rows: NoteCell[][] = [
    ['Surplus brought forward (earlier years)', c.bs.profitBroughtForward],
    ['Profit / (loss) for the year', c.bs.profitForYear],
  ];
  if (direct) rows.push(['Direct entries to reserves', direct]);
  rows.push(['Closing balance', item?.amount ?? c.bs.profitBroughtForward + c.bs.profitForYear]);
  return {
    id: 'reserves',
    title: reservesTitle(c.entity),
    kind: 'auto',
    paragraphs: c.entity === 'company' ? [] : ['For a proprietorship / firm the profit is normally carried to the capital account(s); here it is shown as surplus — verify the presentation with your CA.'],
    tables: [{ columns: ['Particulars', c.fy.label], rows }],
  };
}

function compareAccounts(c: NotesContext, groups: GroupId[], sign: 1 | -1): NoteTable {
  const cur = closingBalances(c.ledger, c.fy.end);
  const prev = closingBalances(c.ledger, c.prev.end);
  const rows: NoteCell[][] = [];
  for (const a of inGroup(c.ledger, ...groups)) {
    const x = sign * (cur.get(a.id) ?? 0);
    const y = sign * (prev.get(a.id) ?? 0);
    if (!x && !y) continue;
    rows.push([`${a.name} (${groupOf(a.group).label})`, x, y]);
  }
  rows.push(['Total', rows.reduce((s, r) => s + (r[1] as number), 0), rows.reduce((s, r) => s + (r[2] as number), 0)]);
  return { columns: ['Account', c.fy.label, c.prev.label], rows };
}

function borrowingsNote(c: NotesContext): PackNote {
  return {
    id: 'borrowings',
    title: 'Borrowings',
    kind: 'auto',
    paragraphs: ['Security, terms of repayment and rate of interest for each loan: (add details).'],
    tables: [compareAccounts(c, ['LOANS_LT', 'LOANS_ST'], -1)],
  };
}

function payablesNote(c: NotesContext): PackNote {
  const ag = ageParties(c.ledger, A.creditors, c.fy.end, 'cr', PAYABLE_BUCKETS.limits, PAYABLE_BUCKETS.labels);
  const vendorByName = new Map(c.vendors.map((v) => [v.name.trim().toLowerCase(), v]));
  const msme = PAYABLE_BUCKETS.labels.map(() => 0);
  const others = PAYABLE_BUCKETS.labels.map(() => 0);
  const msmeParties: string[] = [];
  for (const [p, row] of ag.parties) {
    const isM = isMse(vendorByName.get(p.trim().toLowerCase()));
    if (isM) msmeParties.push(p);
    row.forEach((x, i) => ((isM ? msme : others)[i] += x));
  }
  const tot = (r: number[]) => r.reduce((s, x) => s + x, 0);
  return {
    id: 'payables',
    title: 'Trade payables',
    kind: 'auto',
    paragraphs: [
      `Micro and small enterprises are identified from the Udyam category on the supplier master${msmeParties.length ? ` (${msmeParties.length} supplier(s))` : ''}. MSMED Act Sec 22 disclosure — principal and interest remaining unpaid, interest paid and payable: (add figures). Ageing is from the bill date, not the due date — verify with your CA.`,
    ],
    tables: [{
      columns: ['Particulars', ...PAYABLE_BUCKETS.labels, 'Total'],
      rows: [
        ['MSME', ...msme, tot(msme)],
        ['Others', ...others, tot(others)],
        ['Disputed dues — MSME', 0, 0, 0, 0, 0],
        ['Disputed dues — Others', 0, 0, 0, 0, 0],
        ['Total', ...ag.totals, tot(ag.totals)],
      ],
    }],
  };
}

function receivablesNote(c: NotesContext): PackNote {
  const ag = ageParties(c.ledger, A.debtors, c.fy.end, 'dr', RECEIVABLE_BUCKETS.limits, RECEIVABLE_BUCKETS.labels);
  const tot = ag.totals.reduce((s, x) => s + x, 0);
  return {
    id: 'receivables',
    title: 'Trade receivables',
    kind: 'auto',
    paragraphs: ['Secured / unsecured, considered good / doubtful: shown as unsecured, considered good — adjust as needed. Ageing is from the invoice date — verify with your CA.'],
    tables: [{
      columns: ['Particulars', ...RECEIVABLE_BUCKETS.labels, 'Total'],
      rows: [
        ['Undisputed — considered good (unsecured)', ...ag.totals, tot],
        ['Undisputed — considered doubtful', 0, 0, 0, 0, 0, 0],
        ['Disputed', 0, 0, 0, 0, 0, 0],
      ],
    }],
  };
}

export interface FixedAssetSchedule {
  rows: { account: Account; opening: number; additions: number; deletions: number; closing: number }[];
  gross: { opening: number; additions: number; deletions: number; closing: number };
  depreciation: { opening: number; charge: number; reversed: number; closing: number };
  net: { opening: number; closing: number };
  /** Written-down value of the register at the FY end (assets put to use by then), paise. */
  registerWdv: number;
}

/** Gross block / depreciation / net block roll-forward from the ledger, with the register's WDV beside it. */
export function fixedAssetSchedule(ledger: Ledger, fy: { start: string; end: string }, prevEnd: string, assets: readonly FixedAsset[]): FixedAssetSchedule {
  const open = closingBalances(ledger, prevEnd);
  const rows: FixedAssetSchedule['rows'] = [];
  const g = { opening: 0, additions: 0, deletions: 0, closing: 0 };
  for (const a of inGroup(ledger, 'FIXED_ASSETS')) {
    if (a.id === A.accDep) continue;
    const o = open.get(a.id) ?? 0;
    const m = movement(ledger, a.id, fy.start, fy.end);
    const row = { account: a, opening: o, additions: m.dr, deletions: m.cr, closing: o + m.dr - m.cr };
    if (!row.opening && !row.additions && !row.deletions) continue;
    rows.push(row);
    g.opening += row.opening;
    g.additions += row.additions;
    g.deletions += row.deletions;
    g.closing += row.closing;
  }
  const dOpen = -(open.get(A.accDep) ?? 0);
  const dm = movement(ledger, A.accDep, fy.start, fy.end);
  const dep = { opening: dOpen, charge: dm.cr, reversed: dm.dr, closing: dOpen + dm.cr - dm.dr };
  const fyStartYear = +fy.start.slice(0, 4);
  let registerWdv = 0;
  for (const asset of assets) {
    if (asset.put_to_use > fy.end) continue;
    const row = depreciationSchedule(asset, fy.end).find((r) => r.fyStartYear === fyStartYear);
    if (row) registerWdv += row.closingWdv;
  }
  return { rows, gross: g, depreciation: dep, net: { opening: g.opening - dep.opening, closing: g.closing - dep.closing }, registerWdv };
}

function fixedAssetsNote(c: NotesContext): PackNote {
  const s = fixedAssetSchedule(c.ledger, c.fy, c.prev.end, c.assets);
  const rows: NoteCell[][] = s.rows.map((r) => [r.account.name, r.opening, r.additions, r.deletions, r.closing]);
  rows.push(['Total gross block', s.gross.opening, s.gross.additions, s.gross.deletions, s.gross.closing]);
  const tie = s.registerWdv === s.net.closing;
  return {
    id: 'fixed_assets',
    title: 'Property, plant & equipment and intangible assets',
    kind: 'auto',
    paragraphs: [
      c.assets.length
        ? tie
          ? 'The net block agrees with the written-down value in the fixed-asset register.'
          : `Fixed-asset register written-down value at year end: ₹${(s.registerWdv / 100).toFixed(2)}; net block per books: ₹${(s.net.closing / 100).toFixed(2)}. Assets bought through purchase bills are in the books but may be missing from the register (or the reverse) — reconcile before finalising.`
        : 'No assets are recorded in the fixed-asset register; figures are from the ledger.',
      'Depreciation is on the written-down value at Income-tax Act rates as computed by the register — the Companies Act useful-life method may differ (verify with your CA).',
    ],
    tables: [
      { title: 'Gross block', columns: ['Asset class', `As at ${c.fy.start}`, 'Additions', 'Deletions', `As at ${c.fy.end}`], rows },
      {
        title: 'Depreciation and net block',
        columns: ['Particulars', 'Opening', 'For the year', 'On deletions', 'Closing'],
        rows: [
          ['Accumulated depreciation', s.depreciation.opening, s.depreciation.charge, s.depreciation.reversed, s.depreciation.closing],
          ['Net block', s.net.opening, '', '', s.net.closing],
        ],
      },
    ],
  };
}

const inventoriesOf = (bs: LedgerBalanceSheet) => bs.assets.flatMap((x) => x.items).filter((i) => i.groupId === 'INVENTORIES').reduce((t, i) => t + i.amount, 0);

/** MF-D5: the sub-head rows, a balancing row for what the split does not hold (ledger balances, typed figures), the total. */
function inventorySplitRows(rows: readonly { label: string; cur: number; prev: number }[], cur: number, prev: number): NoteCell[][] {
  const out: NoteCell[][] = rows.map((r) => [r.label, r.cur, r.prev]);
  const dc = cur - rows.reduce((t, r) => t + r.cur, 0);
  const dp = prev - rows.reduce((t, r) => t + r.prev, 0);
  if (dc || dp) out.push(['Other inventories (ledger balances / typed closing stock)', dc, dp]);
  out.push(['Total (at cost or net realisable value, whichever is lower)', cur, prev]);
  return out;
}

function inventoryNote(c: NotesContext): PackNote {
  return {
    id: 'inventory',
    title: 'Inventories',
    kind: 'auto',
    paragraphs: [
      c.stock
        ? `Closing stock valued from ${c.stock.label.toLowerCase()} (the same valuation as the Books balance sheet; any year-end closing-stock journal is netted off so stock is counted once).`
        : 'Closing stock is not valued in the books (Books → P&L → closing stock). Add it before finalising.',
    ],
    // The balance-sheet line (report-time valuation and / or an Inventories ledger, netted so it is counted once).
    tables: [{
      columns: ['Particulars', c.fy.label, c.prev.label],
      rows: c.inventoryRows?.length
        ? inventorySplitRows(c.inventoryRows, inventoriesOf(c.bs), inventoriesOf(c.bsPrev))
        : [['Stock-in-trade / goods (at cost or net realisable value, whichever is lower)', inventoriesOf(c.bs), inventoriesOf(c.bsPrev)]],
    }],
  };
}

/** Goods vs services share of revenue documents in a period (by line value). */
export function revenueShares(invoices: readonly InvoiceRecord[], start: string, end: string): { goods: number; services: number } {
  let goods = 0;
  let services = 0;
  for (const inv of invoices) {
    if (!isRevenueDoc(inv) || inv.doc_type === 'DEBIT_NOTE') continue;
    const d = String(inv.issue_date ?? '').slice(0, 10);
    if (d < start || d > end) continue;
    for (const it of inv.items ?? []) {
      const v = (Number(it.quantity) || 0) * (Number(it.rate) || 0) * (1 - Math.min(Math.max(Number(it.discount_percent) || 0, 0), 100) / 100);
      if (!(v > 0)) continue;
      const t = String(it.type ?? '').toLowerCase();
      const isService = t ? t.startsWith('serv') : String(it.hsn ?? '').startsWith('99');
      if (isService) services += v;
      else goods += v;
    }
  }
  return { goods, services };
}

function splitSales(total: number, shares: { goods: number; services: number }): [number, number] {
  const all = shares.goods + shares.services;
  if (!all) return [total, 0];
  const goods = Math.round((total * shares.goods) / all);
  return [goods, total - goods];
}

function revenueNote(c: NotesContext): PackNote {
  const salesOf = (pl: LedgerProfitLoss) => pl.income.filter((s) => s.group === 'SALES').reduce((x, s) => x + s.total, 0);
  const cur = splitSales(salesOf(c.pl), revenueShares(c.invoices, c.fy.start, c.fy.end));
  const prev = splitSales(salesOf(c.plPrev), revenueShares(c.invoices, c.prev.start, c.prev.end));
  return {
    id: 'revenue',
    title: 'Revenue from operations',
    kind: 'auto',
    paragraphs: ['Split between goods and services in proportion to the invoice lines of the year (item type, else SAC 99…); the total is the Sales ledger, net of returns.'],
    tables: [{ columns: ['Particulars', c.fy.label, c.prev.label], rows: [['Sale of goods', cur[0], prev[0]], ['Sale of services', cur[1], prev[1]], ['Total', cur[0] + cur[1], prev[0] + prev[1]]] }],
  };
}

function taxesNote(c: NotesContext): PackNote {
  const cur = closingBalances(c.ledger, c.fy.end);
  const prev = closingBalances(c.ledger, c.prev.end);
  const rows: NoteCell[][] = [];
  for (const a of inGroup(c.ledger, 'DUTIES_TAXES')) {
    const x = cur.get(a.id) ?? 0;
    const y = prev.get(a.id) ?? 0;
    if (!x && !y) continue;
    rows.push([a.name, x, y]);
  }
  return {
    id: 'taxes',
    title: 'GST and TDS balances',
    kind: 'auto',
    paragraphs: ['Debit balances (input credit, TDS receivable) are shown under short-term loans & advances; credit balances (output tax, TDS payable) under other current liabilities. Positive = debit. Reconcile with the GST portal ledgers and Form 26AS — verify with your CA.'],
    tables: [{ columns: ['Ledger', c.fy.label, c.prev.label], rows }],
  };
}

/** Every note in print order: policies first, automatic notes in balance-sheet order, then text notes. */
export function buildNotes(c: NotesContext): PackNote[] {
  const stored = c.stored?.notes ?? {};
  const text = (id: string) => {
    const def = TEXT_NOTES.find((t) => t.id === id)!;
    const t = stored[id]?.text;
    return { id, title: def.title, kind: 'text' as const, paragraphs: (t && t.trim() ? t : def.starter(c.entity)).split('\n').map((s) => s.trim()).filter(Boolean), tables: [] };
  };
  const autos = [capitalNote(c), reservesNote(c), borrowingsNote(c), payablesNote(c), taxesNote(c), fixedAssetsNote(c), inventoryNote(c), receivablesNote(c), revenueNote(c)];
  const all: PackNote[] = [text('policies'), ...autos.map((n) => ({ ...n, ...(stored[n.id]?.extra?.trim() ? { extra: stored[n.id]!.extra!.trim() } : {}) })), text('contingent'), text('related'), text('events')];
  return all.map((n, i) => ({ ...n, no: i + 1 }));
}

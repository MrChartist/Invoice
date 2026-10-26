/**
 * GST TCS / TDS credit (R5-A5) — three columns per operator (or deductor) GSTIN × month:
 *  - BOOKS EXPECTED  TCS: net value (sales − returns) of documents tagged `TCS_52` with that `eco_gstin` × the TCS
 *                    rate on each document's date (`ecoTcsRate`, 1% → 0.5% from 10 Jul 2024), IGST or CGST + SGST
 *                    by place of supply. TDS (Sec 51, GSTR-7): Σ `gst_tds` deductions on invoices (`ra_deductions`,
 *                    read by field name — R5-B writes them; nothing is imported from R5-B).
 *  - WITHHELD        Σ `tcs` bucket of the channel's settlements deposited in the month (A4).
 *  - PORTAL          rows typed or pasted from the portal's "TDS and TCS credit received" table (`eco_credits`).
 * Differences above ₹1 per head are flagged with a likely reason. "Accepted" rows post one journal:
 * Dr GST electronic cash ledger (2360) | Cr GST TCS receivable (or GST TDS receivable); rejected rows post nothing.
 *
 * 194-O: settlement `tds_194o` lines become non-invoice expected TDS lines (`TdsExpectedLine`) for the 26AS
 * reconciler, with a sanity estimate = gross sales × the 194-O rate.
 * Working paper — the portal statement is the authority; verify with your CA.
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { EcoCredit, SalesChannel, Settlement } from '../../types/marketplace-r5';
import { num, round2 } from '../invoice-calc';
import { ecoTcsRate } from '../tax-rules';
import { tds194oRate } from './tds-194o';
import { senderStateCode } from '../../store/invoice-defaults';
import { parseTable } from '../csv';
import { requireAccess } from '../access';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { withTablesRollback } from '../table-txn';
import { A } from '../ledger/accounts';
import { deleteVoucher, rupeesToPaise, saveVoucher } from '../ledger/vouchers';
import { cellOf, guessColumns, numOf, type SynonymTable } from './file-map';
import { ECO_CREDITS_TABLE, operatorGstinFor } from './channels';
import { ensureGstTdsReceivableAccount, ensureTcsReceivableAccount } from './settlement-post';

export const WORKING_PAPER = 'Working paper — the portal statement is the authority; verify with your CA.';

export type CreditKind = 'tcs' | 'tds';

export interface Heads {
  igst: number;
  cgst: number;
  sgst: number;
}

const zero = (): Heads => ({ igst: 0, cgst: 0, sgst: 0 });
const total = (h: Heads) => round2(h.igst + h.cgst + h.sgst);
const add = (a: Heads, b: Heads): Heads => ({ igst: round2(a.igst + b.igst), cgst: round2(a.cgst + b.cgst), sgst: round2(a.sgst + b.sgst) });

/** Split an amount by place of supply: IGST inter-state, else CGST + SGST halves. */
export function splitHeads(amount: number, interState: boolean): Heads {
  if (interState) return { igst: round2(amount), cgst: 0, sgst: 0 };
  const c = round2(amount / 2);
  return { igst: 0, cgst: c, sgst: round2(amount - c) };
}

export interface ExpectedRow {
  gstin: string;
  month: string;
  gross: number;
  returns: number;
  net: number;
  heads: Heads;
}

const live = (d: Pick<InvoiceRecord, 'status'>) => d.status !== 'Draft' && d.status !== 'Cancelled';

/** Books-expected TCS per operator GSTIN × month (supplier state = the document's sender snapshot state). */
export function expectedTcs(invoices: readonly InvoiceRecord[]): ExpectedRow[] {
  const out = new Map<string, ExpectedRow>();
  for (const d of invoices) {
    if (!live(d) || !d.eco_gstin || (d.eco_section && d.eco_section !== 'TCS_52')) continue;
    if (d.doc_type !== 'INVOICE' && d.doc_type !== 'TAX_INVOICE' && d.doc_type !== 'CREDIT_NOTE') continue;
    const month = String(d.issue_date ?? '').slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const gstin = d.eco_gstin.trim().toUpperCase();
    const k = `${gstin}|${month}`;
    const row = out.get(k) ?? { gstin, month, gross: 0, returns: 0, net: 0, heads: zero() };
    const value = num(d.taxable_value);
    const sign = d.doc_type === 'CREDIT_NOTE' ? -1 : 1;
    if (sign > 0) row.gross = round2(row.gross + value);
    else row.returns = round2(row.returns + value);
    row.net = round2(row.gross - row.returns);
    const tcs = round2((sign * value * ecoTcsRate(d.issue_date)) / 100);
    const home = senderStateCode(d.sender);
    row.heads = add(row.heads, splitHeads(tcs, !!home && !!d.place_of_supply && home !== d.place_of_supply));
    out.set(k, row);
  }
  return [...out.values()];
}

/** Books-expected GST TDS (Sec 51) per deductor GSTIN × month, from `ra_deductions` (read by field name). */
export function expectedGstTds(invoices: readonly InvoiceRecord[]): ExpectedRow[] {
  const out = new Map<string, ExpectedRow>();
  for (const d of invoices) {
    if (!live(d)) continue;
    const ra = (d as unknown as { ra_deductions?: unknown }).ra_deductions;
    let amount = 0;
    if (Array.isArray(ra)) {
      for (const x of ra) {
        const r = x as { kind?: unknown; type?: unknown; amount?: unknown } | null;
        if (r && (r.kind === 'gst_tds' || r.type === 'gst_tds')) amount += num(r.amount);
      }
    } else if (ra && typeof ra === 'object' && Object.hasOwn(ra, 'gst_tds')) amount = num((ra as { gst_tds?: unknown }).gst_tds);
    const gstin = String(d.client?.gstin ?? '').trim().toUpperCase();
    const month = String(d.issue_date ?? '').slice(0, 7);
    if (!(amount > 0) || !gstin || !/^\d{4}-\d{2}$/.test(month)) continue;
    const k = `${gstin}|${month}`;
    const row = out.get(k) ?? { gstin, month, gross: 0, returns: 0, net: 0, heads: zero() };
    row.gross = round2(row.gross + num(d.taxable_value));
    row.net = row.gross;
    const home = senderStateCode(d.sender);
    row.heads = add(row.heads, splitHeads(round2(amount), !!home && !!d.place_of_supply && home !== d.place_of_supply));
    out.set(k, row);
  }
  return [...out.values()];
}

/** TCS withheld per operator GSTIN × month (settlements by deposit month, attributed to our home state's GSTIN). */
export function withheldTcs(channels: readonly SalesChannel[], settlements: readonly Settlement[], homeState: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of settlements) {
    const c = channels.find((x) => x.id === s.channel_id);
    if (!c) continue;
    const gstin = operatorGstinFor(c, homeState);
    if (!gstin) continue;
    const amt = round2(-s.lines.filter((l) => l.bucket === 'tcs').reduce((a, l) => a + l.amount, 0));
    if (!amt) continue;
    const k = `${gstin}|${s.deposit_date.slice(0, 7)}`;
    out.set(k, round2((out.get(k) ?? 0) + amt));
  }
  return out;
}

/* ── Portal rows ────────────────────────────────────────────────── */

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "2026-10", "10-2026", "102026", "Oct-2026", "October 2026" → "2026-10" ('' when unreadable). */
export function parseMonth(raw: string): string {
  const s = raw.trim().toLowerCase();
  const pad = (m: number) => String(m).padStart(2, '0');
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})[-/.](\d{1,2})$/.exec(s)) && +m[2] >= 1 && +m[2] <= 12) return `${m[1]}-${pad(+m[2])}`;
  if ((m = /^(\d{1,2})[-/.]?(\d{4})$/.exec(s)) && +m[1] >= 1 && +m[1] <= 12) return `${m[2]}-${pad(+m[1])}`;
  if ((m = /^([a-z]{3})[a-z]*[-\s/,]+(\d{2}|\d{4})$/.exec(s)) && Object.hasOwn(MONTHS, m[1])) {
    const y = m[2].length === 2 ? 2000 + +m[2] : +m[2];
    return `${y}-${pad(MONTHS[m[1]])}`;
  }
  return '';
}

export const PORTAL_FIELDS: SynonymTable = {
  gstin: ['gstin of e commerce operator', 'gstin of operator', 'gstin of deductor', 'operator gstin', 'deductor gstin', 'gstin'],
  month: ['tax period', 'return period', 'month', 'period'],
  gross: ['gross value', 'gross value of supplies', 'gross amount'],
  returns: ['value of supplies returned', 'returns', 'supplies returned'],
  net: ['net value', 'net amount liable for tcs', 'net value of supplies', 'net amount'],
  igst: ['integrated tax', 'igst'],
  cgst: ['central tax', 'cgst'],
  sgst: ['state ut tax', 'state tax', 'sgst', 'sgst utgst'],
};

/** Portal rows from a pasted / downloaded table (header mapping by synonyms). Rows without GSTIN or month are listed. */
export function parsePortalRows(text: string, kind: CreditKind): { rows: Omit<EcoCredit, 'id'>[]; skipped: number[] } {
  const t = parseTable(text);
  const cols = guessColumns(t.headers, PORTAL_FIELDS);
  const rows: Omit<EcoCredit, 'id'>[] = [];
  const skipped: number[] = [];
  t.rows.forEach((r, i) => {
    const gstin = cellOf(r, cols, 'gstin').toUpperCase();
    const month = parseMonth(cellOf(r, cols, 'month'));
    if (!/^[0-9]{2}[A-Z0-9]{13}$/.test(gstin) || !month) {
      skipped.push(i + 2);
      return;
    }
    const n = (f: string) => round2(numOf(r, cols, f) ?? 0);
    const gross = n('gross');
    const returns = n('returns');
    rows.push({ kind, operator_gstin: gstin, month, gross, returns, net: cols.has('net') ? n('net') : round2(gross - returns), igst: n('igst'), cgst: n('cgst'), sgst: n('sgst'), source: 'paste' });
  });
  return { rows, skipped };
}

export function loadEcoCredits(kind?: CreditKind): readonly EcoCredit[] {
  const rows = peekTable<EcoCredit>(ECO_CREDITS_TABLE).filter((r) => r && typeof r.id === 'string');
  return kind ? rows.filter((r) => r.kind === kind) : rows;
}

/** Add portal rows (an existing GSTIN × month × kind row is replaced unless it was decided). */
export function savePortalRows(rows: readonly Omit<EcoCredit, 'id'>[]): { added: number; kept: number } {
  requireAccess('books.edit');
  const all = getTable<EcoCredit>(ECO_CREDITS_TABLE);
  let added = 0;
  let kept = 0;
  for (const r of rows) {
    const idx = all.findIndex((x) => x.kind === r.kind && x.operator_gstin === r.operator_gstin && x.month === r.month);
    if (idx >= 0 && all[idx].decision) {
      kept++;
      continue;
    }
    const row: EcoCredit = { ...r, id: idx >= 0 ? all[idx].id : generateId() };
    if (idx >= 0) all[idx] = row;
    else all.push(row);
    added++;
  }
  setTable(ECO_CREDITS_TABLE, all);
  return { added, kept };
}

/* ── The three-column view ──────────────────────────────────────── */

export type DiffReason = 'ok' | 'missing_portal' | 'missing_books' | 'value_mismatch' | 'month_shift';

export interface CreditRow {
  key: string;
  kind: CreditKind;
  gstin: string;
  month: string;
  books: Heads & { net: number };
  withheld: number;
  portal?: EcoCredit;
  diff: Heads;
  reason: DiffReason;
}

export function creditRows(kind: CreditKind, expected: readonly ExpectedRow[], withheld: ReadonlyMap<string, number>, portal: readonly EcoCredit[]): CreditRow[] {
  const keys = new Set<string>();
  const books = new Map(expected.map((e) => [`${e.gstin}|${e.month}`, e]));
  const port = new Map(portal.filter((p) => p.kind === kind).map((p) => [`${p.operator_gstin}|${p.month}`, p]));
  for (const k of [...books.keys(), ...port.keys(), ...(kind === 'tcs' ? withheld.keys() : [])]) keys.add(k);
  const rows: CreditRow[] = [];
  for (const k of keys) {
    const [gstin, month] = k.split('|');
    const b = books.get(k);
    const p = port.get(k);
    const bh = b?.heads ?? zero();
    const ph: Heads = p ? { igst: p.igst, cgst: p.cgst, sgst: p.sgst } : zero();
    const diff: Heads = { igst: round2(ph.igst - bh.igst), cgst: round2(ph.cgst - bh.cgst), sgst: round2(ph.sgst - bh.sgst) };
    const big = Math.abs(diff.igst) > 1 || Math.abs(diff.cgst) > 1 || Math.abs(diff.sgst) > 1;
    let reason: DiffReason = 'ok';
    if (!p && b && total(bh) > 0) reason = 'missing_portal';
    else if (p && !b) reason = 'missing_books';
    else if (big) {
      // A neighbouring month's books figure that matches the portal → the operator reported it in another month.
      const [y, m] = month.split('-').map(Number);
      const near = [m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`, m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`];
      const shifted = near.some((nm) => { const e = books.get(`${gstin}|${nm}`); return !!e && Math.abs(total(e.heads) - total(ph)) <= 1; });
      reason = shifted ? 'month_shift' : 'value_mismatch';
    }
    rows.push({ key: k, kind, gstin, month, books: { ...bh, net: b?.net ?? 0 }, withheld: withheld.get(k) ?? 0, ...(p ? { portal: p } : {}), diff, reason });
  }
  return rows.sort((a, b) => b.month.localeCompare(a.month) || a.gstin.localeCompare(b.gstin));
}

/* ── Accept / reject ────────────────────────────────────────────── */

export class CreditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreditError';
  }
}

/** Last day of a YYYY-MM month. */
export const monthEnd = (month: string): string => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return `${month}-${String(d.getUTCDate()).padStart(2, '0')}`;
};

/**
 * "Marked accepted on the portal": one journal Dr GST electronic cash ledger | Cr GST TCS receivable (or GST TDS
 * receivable) for the portal amount. Idempotent — an accepted row with its journal is returned unchanged.
 */
export function acceptCredit(id: string, date?: string): EcoCredit {
  requireAccess('books.edit');
  const all = getTable<EcoCredit>(ECO_CREDITS_TABLE);
  const row = all.find((r) => r.id === id);
  if (!row) throw new CreditError('Portal row not found.');
  if (row.decision === 'accepted' && row.journal_id) return row;
  const amount = round2(row.igst + row.cgst + row.sgst);
  if (!(amount > 0)) throw new CreditError('The portal row has no tax amount.');
  const day = date || monthEnd(row.month);
  return withTablesRollback([ECO_CREDITS_TABLE, 'vouchers', 'accounts'], () => {
    const credit = row.kind === 'tcs' ? ensureTcsReceivableAccount() : ensureGstTdsReceivableAccount();
    const p = rupeesToPaise(amount);
    const v = saveVoucher({
      type: 'JOURNAL', date: day, voucher_class: row.kind === 'tcs' ? 'GST TCS credit' : 'GST TDS credit',
      narration: `GST ${row.kind.toUpperCase()} credit accepted on the portal — ${row.operator_gstin}, ${row.month} (IGST ${row.igst}, CGST ${row.cgst}, SGST ${row.sgst}). ${WORKING_PAPER}`,
      lines: [{ account_id: A.gstCash, dr: p, cr: 0 }, { account_id: credit, dr: 0, cr: p }],
    });
    const next: EcoCredit = { ...row, decision: 'accepted', decided_on: day, journal_id: v.id };
    setTable(ECO_CREDITS_TABLE, getTable<EcoCredit>(ECO_CREDITS_TABLE).map((r) => (r.id === id ? next : r)));
    return next;
  });
}

/** Rejected on the portal: nothing posts; the row stays listed for follow-up. */
export function rejectCredit(id: string, date: string): EcoCredit {
  requireAccess('books.edit');
  const all = getTable<EcoCredit>(ECO_CREDITS_TABLE);
  const row = all.find((r) => r.id === id);
  if (!row) throw new CreditError('Portal row not found.');
  if (row.journal_id) throw new CreditError('Undo the acceptance first.');
  const next: EcoCredit = { ...row, decision: 'rejected', decided_on: date };
  setTable(ECO_CREDITS_TABLE, all.map((r) => (r.id === id ? next : r)));
  return next;
}

/** Clear a decision (an accepted row's journal is deleted; period lock applies). */
export function undoDecision(id: string): EcoCredit {
  requireAccess('books.edit');
  const row = getTable<EcoCredit>(ECO_CREDITS_TABLE).find((r) => r.id === id);
  if (!row) throw new CreditError('Portal row not found.');
  return withTablesRollback([ECO_CREDITS_TABLE, 'vouchers'], () => {
    if (row.journal_id) deleteVoucher(row.journal_id);
    const { decision: _d, decided_on: _o, journal_id: _j, ...rest } = row;
    void _d; void _o; void _j;
    setTable(ECO_CREDITS_TABLE, getTable<EcoCredit>(ECO_CREDITS_TABLE).map((r) => (r.id === id ? rest : r)));
    return rest;
  });
}

export function deleteCredit(id: string): void {
  requireAccess('books.edit');
  const row = getTable<EcoCredit>(ECO_CREDITS_TABLE).find((r) => r.id === id);
  if (row?.journal_id) throw new CreditError('Undo the acceptance first.');
  setTable(ECO_CREDITS_TABLE, getTable<EcoCredit>(ECO_CREDITS_TABLE).filter((r) => r.id !== id));
}

/* ── 194-O ──────────────────────────────────────────────────────── */

export { tds194oExpectedLines } from './tds-194o';

/** Sanity column: gross sales × the 194-O rate on the deposit date, per settlement. */
export function estimated194o(s: Pick<Settlement, 'deposit_date' | 'lines'>): number {
  const gross = s.lines.filter((l) => l.bucket === 'sale').reduce((a, l) => a + l.amount, 0);
  return round2((gross * tds194oRate(s.deposit_date)) / 100);
}

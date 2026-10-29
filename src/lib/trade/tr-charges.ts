/**
 * TR-B2 bill charges (mandi fee / market fee, aadat, hamali, tulai, palledari, bardana, dharmada) and the mandi registers.
 *
 * Heads (table `trade_charge_heads`, `master.edit`, audited "Bill charge head") carry no preset rate (§8 Q6, TR6).
 * A charge is a **document line** flagged `charge_head_id` (never a new total field), computed from the goods lines
 * (value, bags from the weighing, net quintals, quantity) and recomputed when they change:
 *  - `in_value` (default, §8 Q5): part of the goods' value at the HSN and rate of the highest-value goods line (as G5);
 *  - `own_rate`: its own SAC and rate;
 *  - `outside`: pure-agent reimbursement at 0% with the Rule 33 note (G7).
 * Charge lines are left out of the HSN summary **quantity** (their value counts, `gst-reports.ts`). They post with the
 * goods (Sales / Purchases): `ledger/postings.ts` is not edited (deviation noted in docs/features/trading-r8.md).
 * Working papers — verify with your CA (TR6, TR7). Pure above "Storage".
 */
import './tr-registry';
import type { ChargeHead, LineWeight } from '../../types/trade-r8';
import type { InvoiceRecord } from '../../types/invoice';
import { requireAccess } from '../access';
import { isRevenueDoc } from '../stats';
import { isoDay } from '../dates';
import { toCsv } from '../csv';
import { readPurchase, isVoidStatus } from '../purchase-normalize';
import { generateId, getTable, setTable } from '../storage';
import { lineBags } from './tr-weight';

export const CHARGE_HEADS_TABLE = 'trade_charge_heads'; // TR_TABLES.chargeHeads (tr-shared.ts), literal to stay in one chunk
import { PURE_AGENT_CHARGE } from './pure-agent';
export { PURE_AGENT_CHARGE };
/** Usual heads, added with blank rates (§8 Q6). */
export const USUAL_HEADS = ['Market fee', 'Aadat', 'Hamali', 'Tulai', 'Palledari', 'Bardana', 'Dharmada'] as const;

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100 || 0;

/** The goods side of a document line (invoice item or bill line). */
export interface GoodsLine {
  name?: string;
  hsn?: string;
  unit?: string;
  quantity?: number;
  rate?: number;
  tax_rate?: number;
  discount_percent?: number;
  wt?: LineWeight;
  charge_head_id?: string;
}

export interface ChargeBase {
  value: number;
  bags: number;
  qtl: number;
  qty: number;
  /** HSN and rate of the highest-value goods line. */
  hsn: string;
  taxRate: number;
}

const isGoods = (l: GoodsLine) => !l.charge_head_id && (!!String(l.name ?? '').trim() || n(l.rate) > 0);

/** Bases of a document's goods lines (charge lines excluded). */
export function chargeBase(lines: readonly GoodsLine[]): ChargeBase {
  const out: ChargeBase = { value: 0, bags: 0, qtl: 0, qty: 0, hsn: '', taxRate: 0 };
  let top = -1;
  for (const l of lines) {
    if (!isGoods(l)) continue;
    const v = n(l.quantity) * n(l.rate) * (1 - Math.min(Math.max(n(l.discount_percent), 0), 100) / 100);
    const b = lineBags(l);
    out.value += v;
    out.bags += b.bags;
    out.qtl += b.qtl;
    out.qty += n(l.quantity);
    if (v > top) [top, out.hsn, out.taxRate] = [v, l.hsn ?? '', n(l.tax_rate)];
  }
  return { ...out, value: r2(out.value), qtl: Math.round(out.qtl * 1000) / 1000 };
}

/** Base the head is charged on, and the amount. */
export function chargeAmount(h: Pick<ChargeHead, 'basis' | 'rate'>, b: ChargeBase): { base: number; amount: number } {
  const base = h.basis === 'percent' ? b.value : h.basis === 'per_package' ? b.bags : h.basis === 'per_qtl' ? b.qtl : h.basis === 'per_unit' ? b.qty : 1;
  return { base, amount: r2(h.basis === 'percent' ? (base * n(h.rate)) / 100 : base * n(h.rate)) };
}

/** The charge line of a head (shape shared by invoice items and bill lines). */
export function chargeLine(h: ChargeHead, b: ChargeBase) {
  const { amount } = chargeAmount(h, b);
  const own = h.gst === 'own_rate';
  return {
    name: h.name,
    hsn: own ? h.sac ?? '' : h.gst === 'outside' ? '' : b.hsn,
    unit: 'OTH',
    quantity: 1,
    rate: amount,
    tax_rate: own ? n(h.gst_rate) : h.gst === 'outside' ? 0 : b.taxRate,
    charge_head_id: h.id,
    ...(h.gst === 'outside' ? { description: PURE_AGENT_CHARGE } : {}),
  };
}

/**
 * The lines with the charge lines of `on` (head ids) recomputed from the goods (zero amounts dropped, existing line
 * ids kept, charge lines last). `make` turns a computed charge into the caller's line shape.
 */
export function withCharges<L extends GoodsLine & { id?: string }>(
  lines: readonly L[],
  heads: readonly ChargeHead[],
  on: ReadonlySet<string>,
  make: (c: ReturnType<typeof chargeLine>, prev: L | undefined) => L,
): L[] {
  const goods = lines.filter((l) => !l.charge_head_id);
  const b = chargeBase(goods);
  const out = [...goods, ...lines.filter((l) => l.charge_head_id === 'rule33')]; // R14 PS-B1: a pure-agent line, no head
  for (const h of [...heads].sort((x, y) => n(x.order) - n(y.order))) {
    if (!on.has(h.id)) continue;
    const c = chargeLine(h, b);
    if (c.rate > 0) out.push(make(c, lines.find((l) => l.charge_head_id === h.id)));
  }
  return out;
}

export const headsFor = (heads: readonly ChargeHead[], side: 'sale' | 'purchase') => heads.filter((h) => h.side === side || h.side === 'both');

/* ── Registers ────────────────────────────────────────────────── */

export interface RegisterRow {
  side: 'sale' | 'purchase';
  date: string;
  number: string;
  party: string;
  head_id: string;
  head: string;
  base: number;
  rate: number;
  amount: number;
}

/**
 * Charge lines of sales (revenue documents) and goods bills in the period. Purchases are read through `readPurchase`
 * (header) — its lines keep `charge_head_id` as stored.
 */
export function chargeRegister(period: { from: string; to: string }, data: { invoices: readonly InvoiceRecord[]; purchases: readonly unknown[]; heads: readonly ChargeHead[] }): RegisterRow[] {
  const heads = new Map(data.heads.map((h) => [h.id, h]));
  const rows: RegisterRow[] = [];
  const add = (side: RegisterRow['side'], date: string, number: string, party: string, lines: readonly GoodsLine[]) => {
    if (!date || date < period.from || date > period.to) return;
    const b = chargeBase(lines);
    for (const l of lines) {
      if (!l.charge_head_id || l.charge_head_id === 'rule33') continue; // R14 PS-B1: a timesheet reimbursement is no charge head
      const h = heads.get(l.charge_head_id);
      rows.push({ side, date, number, party, head_id: l.charge_head_id, head: h?.name ?? l.name ?? '', base: h ? chargeAmount(h, b).base : 0, rate: n(h?.rate), amount: r2(n(l.quantity) * n(l.rate)) });
    }
  };
  for (const inv of data.invoices) if (inv && isRevenueDoc(inv)) add('sale', isoDay(inv.issue_date), inv.invoice_number, inv.client?.name ?? '', inv.items ?? []);
  for (const raw of data.purchases) {
    const p = readPurchase(raw);
    if (!p || p.isExpense || isVoidStatus(p.status)) continue;
    add('purchase', p.date, p.number, p.partyName, ((raw as { lines?: GoodsLine[] }).lines ?? []));
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
}

/** Per head and side: documents, base, amount; and what is payable to the mandi (heads marked payable). */
export function registerSummary(rows: readonly RegisterRow[], heads: readonly ChargeHead[]) {
  const by = new Map<string, { head: string; side: string; docs: number; base: number; amount: number }>();
  for (const r of rows) {
    const k = `${r.head_id}|${r.side}`;
    const s = by.get(k) ?? { head: r.head, side: r.side, docs: 0, base: 0, amount: 0 };
    s.docs += 1;
    s.base = r2(s.base + r.base);
    s.amount = r2(s.amount + r.amount);
    by.set(k, s);
  }
  const pay = new Set(heads.filter((h) => h.payable).map((h) => h.id));
  return { heads: [...by.values()], payable: r2(rows.filter((r) => pay.has(r.head_id)).reduce((t, r) => t + r.amount, 0)) };
}

/** Market fee register (CSV working paper; State formats differ — verify with your CA). */
export function registerCsv(rows: readonly RegisterRow[], period: { from: string; to: string }): string {
  return toCsv([
    [`Market fee register ${period.from} to ${period.to}: working paper, verify with your CA`],
    ['Side', 'Date', 'Document', 'Party', 'Head', 'Base', 'Rate', 'Amount'],
    ...rows.map((r) => [r.side, r.date, r.number, r.party, r.head, r.base, r.rate, r.amount.toFixed(2)]),
    ['', '', '', '', 'Total', '', '', r2(rows.reduce((t, r) => t + r.amount, 0)).toFixed(2)],
  ]);
}

/* ── Storage ──────────────────────────────────────────────────── */

export const loadHeads = (): ChargeHead[] => getTable<ChargeHead>(CHARGE_HEADS_TABLE).filter((h) => h && typeof h.id === 'string');

export function saveHead(h: Partial<ChargeHead> & { name: string }): ChargeHead {
  requireAccess('master.edit');
  const all = loadHeads();
  const name = h.name.trim();
  if (!name) throw new Error('Give the charge a name.');
  if (all.some((x) => x.id !== h.id && x.name.toLowerCase() === name.toLowerCase())) throw new Error(`“${name}” already exists.`);
  if (n(h.rate) < 0 || (h.basis === 'percent' && n(h.rate) > 100)) throw new Error('Check the rate.');
  const prev = all.find((x) => x.id === h.id);
  const now = new Date().toISOString();
  const row: ChargeHead = {
    id: prev?.id ?? generateId(),
    name,
    side: h.side ?? 'both',
    basis: h.basis ?? 'percent',
    rate: n(h.rate),
    gst: h.gst ?? 'in_value',
    ...(h.gst === 'own_rate' ? { sac: h.sac?.trim() || '9967', gst_rate: n(h.gst_rate) } : {}),
    ...(h.payable ? { payable: true } : {}),
    ...(h.auto ? { auto: true } : {}),
    order: h.order ?? prev?.order ?? all.length,
    created_at: prev?.created_at ?? now,
    updated_at: now,
  };
  setTable(CHARGE_HEADS_TABLE, prev ? all.map((x) => (x.id === row.id ? row : x)) : [...all, row]);
  return row;
}

/** Adds the usual heads that are missing, with blank rates. */
export function addUsualHeads(): number {
  const have = new Set(loadHeads().map((h) => h.name.toLowerCase()));
  const missing = USUAL_HEADS.filter((x) => !have.has(x.toLowerCase()));
  for (const name of missing) saveHead({ name, basis: name === 'Market fee' || name === 'Aadat' || name === 'Dharmada' ? 'percent' : 'per_package', payable: name === 'Market fee' });
  return missing.length;
}

/** Delete through the data layer (copied to the recycle bin; documents keep their snapshot lines). */
export function removeHead(id: string): void {
  requireAccess('master.edit');
  setTable(CHARGE_HEADS_TABLE, loadHeads().filter((h) => h.id !== id));
}

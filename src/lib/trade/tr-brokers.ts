/**
 * TR-B3 brokers (dalali). A broker is a `sales_agents` row with `kind: 'broker'` (basis per bag / per quintal / per
 * unit / % of the goods' value, `paid_by` us or the other party). Sales name it in `broker_id`, goods bills in
 * `PurchaseRecord.broker_id` (default from `Client.broker_id` / `Vendor.broker_id`), separate from the salesman.
 *
 * Statement per broker and period (goods lines only — charge lines are not brokered); `paid_by: 'other_party'` rows
 * are memo only (§8 Q17). **Post** = one `saveVoucher` journal: Dr Brokerage | Cr Sundry creditors (broker) | Cr TDS
 * payable 194H, with the deduction from `suggestTds('194H', …)` over the broker's earlier postings of the FY (threshold
 * and catch-up, rate by posting date: 5% → 2% from 1 Oct 2024) and a row in the TDS register for 26Q. Table
 * `brokerage_postings` (non-overlapping periods). Working paper — verify with your CA (TR12, T15).
 * Pure readers here; posting / undo live in `tr-brokers-post.ts` (loaded on click, so the editor chunk stays light).
 */
import type { BrokeragePosting } from '../../types/trade-r8';
import type { InvoiceRecord } from '../../types/invoice';
import { isRevenueDoc } from '../stats';
import { isoDay } from '../dates';
import { toCsv } from '../csv';
import { isVoidStatus, readPurchase } from '../purchase-normalize';
import { getTable } from '../storage';
import type { SalesAgent } from '../sales-commission';
import { chargeBase, type GoodsLine } from './tr-charges';

export const BROKERAGE_TABLE = 'brokerage_postings'; // TR_TABLES.brokeragePostings (tr-shared.ts); literal keeps tr-shared out of the TR-B chunk

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const r2 = (x: number) => Math.round((x + Number.EPSILON) * 100) / 100 || 0;

export const isBroker = (a: Pick<SalesAgent, 'kind'> | undefined) => a?.kind === 'broker';
export const loadBrokers = (): SalesAgent[] => getTable<SalesAgent>('sales_agents').filter((a) => a && typeof a.id === 'string' && isBroker(a));
export const loadBrokeragePostings = (): BrokeragePosting[] => getTable<BrokeragePosting>(BROKERAGE_TABLE).filter((p) => p && typeof p.id === 'string');

export interface BrokerageLine {
  side: 'sale' | 'purchase';
  id: string;
  date: string;
  number: string;
  party: string;
  base: number;
  brokerage: number;
  memo: boolean;
}

/** Base (₹ value / bags / quintals / units of the goods lines) and brokerage of one document. */
export function docBrokerage(b: Pick<SalesAgent, 'brokerage_basis' | 'brokerage_rate'>, lines: readonly GoodsLine[]): { base: number; brokerage: number } {
  const c = chargeBase(lines);
  const basis = b.brokerage_basis ?? 'percent';
  const base = basis === 'percent' ? c.value : basis === 'per_package' ? c.bags : basis === 'per_qtl' ? c.qtl : c.qty;
  return { base, brokerage: r2(basis === 'percent' ? (base * n(b.brokerage_rate)) / 100 : base * n(b.brokerage_rate)) };
}

/** Statement of a broker for a period: sales by bill date, goods bills by bill date. Memo rows stay out of `total`. */
export function brokerageStatement(broker: SalesAgent, period: { from: string; to: string }, data: { invoices: readonly InvoiceRecord[]; purchases: readonly unknown[] }) {
  const memo = broker.paid_by === 'other_party';
  const lines: BrokerageLine[] = [];
  const add = (side: BrokerageLine['side'], id: string, date: string, number: string, party: string, l: readonly GoodsLine[]) => {
    if (!date || date < period.from || date > period.to) return;
    lines.push({ side, id, date, number, party, ...docBrokerage(broker, l), memo });
  };
  for (const inv of data.invoices) if (inv?.broker_id === broker.id && isRevenueDoc(inv)) add('sale', inv.id, isoDay(inv.issue_date), inv.invoice_number, inv.client?.name ?? '', inv.items ?? []);
  for (const raw of data.purchases) {
    if ((raw as { broker_id?: string })?.broker_id !== broker.id) continue;
    const p = readPurchase(raw);
    if (p && !p.isExpense && !isVoidStatus(p.status)) add('purchase', p.id, p.date, p.number, p.partyName, (raw as { lines?: GoodsLine[] }).lines ?? []);
  }
  lines.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
  return { lines, total: memo ? 0 : r2(lines.reduce((t, l) => t + l.brokerage, 0)), memoTotal: memo ? r2(lines.reduce((t, l) => t + l.brokerage, 0)) : 0 };
}

export function brokerageCsv(broker: SalesAgent, period: { from: string; to: string }, st: ReturnType<typeof brokerageStatement>): string {
  return toCsv([
    [`Brokerage statement — ${broker.name} ${period.from} to ${period.to}${st.memoTotal ? ' (paid by the other party: memo only)' : ''}`],
    ['Side', 'Date', 'Document', 'Party', 'Base', 'Rate', 'Brokerage'],
    ...st.lines.map((l) => [l.side, l.date, l.number, l.party, l.base, n(broker.brokerage_rate), l.brokerage.toFixed(2)]),
    ['', '', '', '', '', 'Total', (st.total || st.memoTotal).toFixed(2)],
    ['TDS u/s 194H on posting — working paper, verify with your CA.'],
  ]);
}

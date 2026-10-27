/**
 * AG-B5 household milk cards (table `milk_cards`, `doc.create`, audited): one row per customer per month with a default
 * daily quantity; a day typed in `days` overrides it (0 = skipped). "Bill month" raises ONE bill per card (a bill of
 * supply for nil fresh milk) with an `ag` line "31 days · 29.5 L"; re-billing a billed card is refused. Receivables,
 * reminders and UPI links are the existing ones.
 */
import './ag-registry';
import type { MilkCard } from '../../types/agri-r12';
import type { InvoiceRecord } from '../../types/invoice';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { num, round2 } from '../invoice-calc';
import { withTablesRollback } from '../table-txn';
import { localDb } from '../localDb';
import { blankClient } from '../../store/invoice-defaults';
import { AG_TABLES } from './ag-shared';
import { q3 } from './ag-rate-chart';
import { milkLine, milkSaleBill } from './ag-dispatch';

const T = AG_TABLES.milkCards;
export const loadCards = (): MilkCard[] => getTable<MilkCard>(T).filter((c) => c && typeof c.id === 'string');
/** Days in a `YYYY-MM` month. */
export const monthDays = (month: string): number => new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate();
/** Litres on a day: the typed value, else the default. */
export const cardQty = (c: Pick<MilkCard, 'days' | 'default_qty'>, day: number): number => {
  const v = c.days?.[String(day)];
  return q3(v === undefined ? num(c.default_qty) : num(v));
};
export function cardTotals(c: MilkCard): { days: number; litres: number; amount: number } {
  let days = 0;
  let litres = 0;
  for (let d = 1; d <= monthDays(c.month); d++) {
    const q = cardQty(c, d);
    if (q > 0) days++;
    litres += q;
  }
  return { days, litres: q3(litres), amount: round2(q3(litres) * num(c.rate)) };
}
const billed = (c: MilkCard) => !!c.invoice_id && !!localDb.invoices.getById(c.invoice_id);

/** Save a card (one per customer per month). A billed card is read-only. */
export function saveCard(input: Omit<MilkCard, 'id'> & { id?: string }): MilkCard {
  requireAccess('doc.create');
  if (!input.client_id || !/^\d{4}-\d{2}$/.test(input.month)) throw new Error('Pick the customer and the month.');
  const all = loadCards();
  const prev = input.id ? all.find((c) => c.id === input.id) : undefined;
  if (prev && billed(prev)) throw new Error('This card is billed: cancel the bill to change it.');
  if (all.some((c) => c.id !== prev?.id && c.client_id === input.client_id && c.month === input.month)) throw new Error('This customer already has a card for the month.');
  const days = Object.fromEntries(Object.entries(input.days ?? {}).filter(([k, v]) => Number(k) >= 1 && Number(k) <= monthDays(input.month) && num(v) >= 0).map(([k, v]) => [k, q3(v)]));
  const row: MilkCard = { ...prev, ...input, id: prev?.id ?? generateId(), days, rate: round2(input.rate), default_qty: q3(input.default_qty), updated_at: new Date().toISOString() };
  setTable(T, prev ? all.map((c) => (c.id === row.id ? row : c)) : [...all, row]);
  return row;
}

/** Delete an unbilled card (recycle bin). */
export function deleteCard(id: string): void {
  requireAccess('doc.create');
  const c = loadCards().find((x) => x.id === id);
  if (c && billed(c)) throw new Error('This card is billed: cancel the bill first.');
  setTable(T, loadCards().filter((x) => x.id !== id));
}

/** Copy last month's cards (unbilled defaults, no day overrides) into `month`; existing cards are kept. */
export function copyCards(from: string, month: string): number {
  const have = new Set(loadCards().filter((c) => c.month === month).map((c) => c.client_id));
  let n = 0;
  for (const c of loadCards().filter((x) => x.month === from && !have.has(x.client_id))) {
    saveCard({ client_id: c.client_id, client_name: c.client_name, month, milk: c.milk, rate: c.rate, default_qty: c.default_qty, days: {}, ...(c.delivered_by ? { delivered_by: c.delivered_by } : {}) });
    n++;
  }
  return n;
}

/** Bill one card for its month (refused when already billed or empty). */
export function billCard(id: string, date: string): InvoiceRecord {
  requireAccess('doc.create');
  const c = loadCards().find((x) => x.id === id);
  if (!c) throw new Error('Card not found.');
  if (billed(c)) throw new Error(`${c.client_name ?? 'This card'} is already billed for ${c.month}.`);
  const t = cardTotals(c);
  if (!(t.litres > 0)) throw new Error('No milk on this card.');
  const client = localDb.clients.getById(c.client_id) ?? { ...blankClient(), name: c.client_name ?? '' };
  const text = `${t.days} days · ${t.litres} L`;
  const item = milkLine(c.milk, t.litres, 'L', c.rate, `${c.month} · ${text}`);
  return withTablesRollback([T, 'invoices', 'clients', 'series_counters'], () => {
    const inv = milkSaleBill(client, [item], date, { kind: 'milk_sale', lines: { [item.id]: { litres: t.litres, text } } }, `Milk card ${c.month}.`);
    setTable(T, loadCards().map((x) => (x.id === id ? { ...x, invoice_id: inv.id } : x)));
    return inv;
  });
}

/** Bill every unbilled card of a month; returns the bills made and the cards skipped (with the reason). */
export function billMonth(month: string, date: string): { bills: InvoiceRecord[]; skipped: string[] } {
  const bills: InvoiceRecord[] = [];
  const skipped: string[] = [];
  for (const c of loadCards().filter((x) => x.month === month && !billed(x))) {
    try {
      bills.push(billCard(c.id, date));
    } catch (e) {
      skipped.push(`${c.client_name ?? c.client_id}: ${(e as Error).message}`);
    }
  }
  return { bills, skipped };
}

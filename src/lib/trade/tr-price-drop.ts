/**
 * TR-A3 price-drop runs (table `price_drops`, numbered PDR/FY…) and price-protection claims.
 *
 * Rows = each customer's quantity of the dropped items on issued, live sales in the window, less goods returned on
 * live credit notes against those bills; value = quantity × drop per unit. Issue (all or nothing, period lock):
 *  - default **financial credit note** per customer (`note_kind: 'financial'`, reason "Price drop", FCN/FY…, no GST:
 *    GST readers skip it through `isNonGstFinancialNote`); bills linked by `doc_links` relation `price_drop`
 *    (provenance only — the note is an on-account credit to the party, not allocated to one bill);
 *  - **GST credit note** per original bill ("Rate difference", goods not returned, linked `credit_note`) only when the
 *    run says the drop was agreed before supply, and never after the Sec 34(2) date (30 November after the FY of the
 *    bill — `gst-penalties.ts` `nextFyCutoff`).
 * Own stock held the day before the effective date is listed for the claim; "Claim" makes one `trade_claims` row
 * (kind `price_drop`) = notes + own stock × drop. Undo cancels the notes (numbers stay). §8 Q9, TR3 — verify with
 * your CA.
 */
import './tr-registry';
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { ClaimRow, PriceDropRun, TradeClaim } from '../../types/trade-r8';
import { calcInputFromRecord, calculateInvoice, num, round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { withTablesRollback } from '../table-txn';
import { localDb } from '../localDb';
import { getIndianFY } from '../invoice-number';
import { nextFyCutoff } from '../gst-penalties';
import { FCN_PREFIX } from '../financial-note';
import { buildFinancialNote } from '../settlement';
import { TR_SERIES, TR_TABLES } from './tr-shared';
import { liveSales, saveClaim, ClaimError } from './tr-claims';
import { computeStockDetailed, liveInputs, type StockPosition } from '../inventory';

export const PRICE_DROPS_TABLE = TR_TABLES.priceDrops;
const norm = (s: unknown) => String(s ?? '').trim().toLowerCase();
type Link = { from_id: string; to_id: string; relation: string };

export const loadPriceDrops = (): readonly PriceDropRun[] => peekTable<PriceDropRun>(PRICE_DROPS_TABLE).filter((r) => r && typeof r.id === 'string');

export interface DropSpec {
  items: { name: string; drop: number }[];
  from: string;
  to: string;
  client_ids?: string[];
}

/**
 * Rows of an issued run whose note is still live (QA8 T7: a note cancelled by hand frees its bills). Without `live`
 * every row of an issued run counts.
 */
export function liveRunRows(r: PriceDropRun, live?: { invoices: readonly InvoiceRecord[]; links: readonly Link[] }): PriceDropRun['rows'] {
  if (r.status !== 'issued') return [];
  if (!live) return r.rows;
  const ok = new Set(r.note_ids.filter((id) => live.invoices.some((i) => i.id === id && i.status !== 'Cancelled')));
  return r.rows.filter((x) => live.links.some((l) => l.from_id === x.invoice_id && ok.has(l.to_id)));
}

/** `invoiceId|item` pairs already on a live run (its note still live, when `live` is given). */
export const coveredPairs = (runs: readonly PriceDropRun[], live?: { invoices: readonly InvoiceRecord[]; links: readonly Link[] }) =>
  new Set(runs.flatMap((r) => liveRunRows(r, live).map((x) => `${x.invoice_id}|${norm(x.item)}`)));

/** Pure: the run's rows (one per bill × item with a positive net quantity). */
export function dropRows(invoices: readonly InvoiceRecord[], links: readonly Link[], spec: DropSpec, covered: ReadonlySet<string> = new Set()): PriceDropRun['rows'] {
  const drops = new Map(spec.items.filter((i) => norm(i.name) && num(i.drop) > 0).map((i) => [norm(i.name), num(i.drop)]));
  const byId = new Map(invoices.map((i) => [i.id, i]));
  const rows: PriceDropRun['rows'] = [];
  for (const inv of liveSales(invoices, spec.from, spec.to)) {
    if (spec.client_ids?.length && !spec.client_ids.includes(inv.client?.id ?? '')) continue;
    const notes = links.filter((l) => l.relation === 'credit_note' && l.from_id === inv.id).map((l) => byId.get(l.to_id)).filter((n): n is InvoiceRecord => !!n && n.status !== 'Cancelled' && n.goods_returned !== false && n.note_kind !== 'financial');
    const qty = new Map<string, number>();
    for (const l of inv.items ?? []) if (!l.free_of && drops.has(norm(l.name))) qty.set(norm(l.name), (qty.get(norm(l.name)) ?? 0) + num(l.quantity) - notes.reduce((t, n) => t + (n.items ?? []).filter((x) => x.id === l.id).reduce((a, x) => a + num(x.quantity), 0), 0));
    for (const [k, q] of qty) {
      if (!(q > 0) || covered.has(`${inv.id}|${k}`)) continue;
      const name = inv.items.find((l) => norm(l.name) === k)!.name;
      rows.push({ client_id: inv.client?.id, client_name: inv.client?.name ?? '', invoice_id: inv.id, invoice_number: inv.invoice_number, item: name, qty: q, value: round2(q * drops.get(k)!) });
    }
  }
  return rows;
}

/** Last day a GST credit note on a bill of `billDate` may be issued (Sec 34(2)). */
export const sec34Limit = (billDate: string) => nextFyCutoff(getIndianFY(billDate).startYear);

/** Pure: the GST "rate difference" note against `inv` for its rows (lines keep their HSN / GST rate). */
export function gstDropNote(inv: InvoiceRecord, rows: PriceDropRun['rows'], drops: ReadonlyMap<string, number>, date: string): InvoiceRecord {
  const items: InvoiceItem[] = rows.map((r) => {
    const l = inv.items.find((x) => norm(x.name) === norm(r.item))!;
    const rate = drops.get(norm(r.item))!;
    return { ...l, id: generateId(), description: `Rate difference: price drop ₹${rate} per unit`, quantity: r.qty, rate, discount_percent: 0, disc_chain: undefined, disc_per_unit: undefined, wt: undefined, amount: round2(r.qty * rate) };
  });
  const rec: InvoiceRecord = {
    ...inv, id: generateId(), invoice_number: '', doc_type: 'CREDIT_NOTE', issue_date: date, due_date: date, status: 'Sent', items, attachments: undefined,
    discount_type: 'PERCENT', discount_rate: 0, shipping: 0, other_charges: 0, amount_paid: 0, po_number: inv.invoice_number, goods_returned: false,
    notes: `Credit note against ${inv.invoice_number} dated ${inv.issue_date}. Reason: Rate difference (price drop agreed before supply, Sec 15(3) / 34 — verify with your CA).`,
    created_at: undefined, updated_at: undefined, approval: undefined, party_balance_snapshot: undefined, pos: undefined, transport: undefined, late_fee_for: undefined, recurring_id: undefined,
  };
  const t = calculateInvoice(calcInputFromRecord(rec));
  return { ...rec, subtotal: t.subtotal, discount_amount: t.discount_amount, taxable_value: t.taxable_value, cgst_amount: t.cgst_amount, sgst_amount: t.sgst_amount, igst_amount: t.igst_amount, tax_amount: t.tax_amount, cess_amount: t.cess_amount, round_off: t.round_off, total: t.total, balance_due: 0 };
}

export interface RunInput extends DropSpec {
  date: string;
  mode: 'financial' | 'gst';
  agreed?: boolean;
  /** Own stock held the day before `date` (item → qty), from the stock engine. */
  own_stock?: { item: string; qty: number }[];
}

/** Issue a run: the notes and the run row, all or nothing. */
export function issuePriceDrop(input: RunInput): PriceDropRun {
  requireAccess('payment.record');
  requireAccess('books.edit');
  if (input.mode === 'gst' && !input.agreed) throw new ClaimError('GST credit notes need the drop agreed before supply; issue financial notes instead.');
  const runs = getTable<PriceDropRun>(PRICE_DROPS_TABLE);
  const invoices = getTable<InvoiceRecord>('invoices');
  const allLinks = getTable<Link>('doc_links');
  const rows = dropRows(invoices, allLinks, input, coveredPairs(runs, { invoices, links: allLinks }));
  if (!rows.length) throw new ClaimError('No customer bought these items in the window (or they are already on a price-drop run).');
  if (input.mode === 'gst') {
    const late = rows.find((r) => input.date > sec34Limit(invoices.find((i) => i.id === r.invoice_id)!.issue_date));
    if (late) throw new ClaimError(`${late.invoice_number}: a GST credit note is past the Sec 34(2) date (${sec34Limit(invoices.find((i) => i.id === late.invoice_id)!.issue_date)}). Issue financial notes instead.`);
  }
  const id = generateId();
  const number = nextSeriesNumberFor(TR_SERIES.priceDrops, input.date, runs.map((r) => r.number));
  assertUnlocked({ id, issue_date: input.date, invoice_number: number }, 'create');
  const drops = new Map(input.items.map((i) => [norm(i.name), num(i.drop)]));
  return withTablesRollback(['invoices', 'doc_links', 'series_counters', PRICE_DROPS_TABLE, 'items_catalog'], () => {
    const catalogue = peekTable<unknown>('items_catalog');
    const notes: InvoiceRecord[] = [];
    const links: Link[] = [];
    const groups = new Map<string, PriceDropRun['rows']>();
    for (const r of rows) {
      const k = input.mode === 'gst' ? r.invoice_id : r.client_id || norm(r.client_name);
      groups.set(k, [...(groups.get(k) ?? []), r]);
    }
    for (const g of groups.values()) {
      const src = invoices.find((i) => i.id === g[g.length - 1].invoice_id)!;
      let note: InvoiceRecord;
      if (input.mode === 'gst') note = gstDropNote(src, g, drops, input.date);
      else {
        const amount = round2(g.reduce((t, r) => t + r.value, 0));
        const nn = nextSeriesNumberFor(FCN_PREFIX, input.date, getTable<InvoiceRecord>('invoices').map((i) => i.invoice_number));
        note = buildFinancialNote(src, { amount, reason: 'price_drop', date: input.date }, { id: generateId(), number: nn });
        note.items = [{ ...note.items[0], name: `Price drop ${number}`, description: g.map((r) => `${r.invoice_number}: ${r.item} ${r.qty} × ₹${drops.get(norm(r.item))}`).join('; ') }];
        note.notes = `Price drop ${number} (effective ${input.date}) on ${g.length} bill line(s). Financial credit note: no GST is adjusted.`;
        note.po_number = undefined;
      }
      const saved = localDb.invoices.save({ ...note, price_drop_id: id });
      recordSeries(saved.invoice_number);
      notes.push(saved);
      for (const b of new Set(g.map((r) => r.invoice_id))) links.push({ from_id: b, to_id: saved.id, relation: input.mode === 'gst' ? 'credit_note' : 'price_drop' });
    }
    if (peekTable<unknown>('items_catalog').length !== catalogue.length) setTable('items_catalog', catalogue as unknown[]);
    const now = new Date().toISOString();
    setTable('doc_links', [...getTable<Link>('doc_links'), ...links.map((l) => ({ ...l, id: generateId(), created_at: now, reason: input.mode === 'gst' ? 'Rate difference' : 'Price drop' }))]);
    const run: PriceDropRun = {
      id, number, date: input.date, items: input.items.filter((i) => num(i.drop) > 0), from: input.from, to: input.to, ...(input.client_ids?.length ? { client_ids: input.client_ids } : {}),
      mode: input.mode, ...(input.agreed ? { agreed: true } : {}), rows, own_stock: (input.own_stock ?? []).filter((s) => s.qty > 0), note_ids: notes.map((n) => n.id),
      total: round2(rows.reduce((t, r) => t + r.value, 0)), status: 'issued', created_at: now, updated_at: now,
    };
    setTable(PRICE_DROPS_TABLE, [...getTable<PriceDropRun>(PRICE_DROPS_TABLE), run]);
    recordSeries(number);
    return run;
  });
}

/** Undo: cancel the run's notes (their numbers stay used); the bills can be put on a new run. */
export function undoPriceDrop(id: string): PriceDropRun {
  requireAccess('books.edit');
  const all = getTable<PriceDropRun>(PRICE_DROPS_TABLE);
  const r = all.find((x) => x.id === id);
  if (!r || r.status !== 'issued') throw new ClaimError('Only an issued run can be undone.');
  // QA8 T7: the run's claim goes with it — a draft claim is rejected; a claim sent or settled must be dealt with first.
  const claim = r.claim_id ? getTable<TradeClaim>(TR_TABLES.claims).find((c) => c.id === r.claim_id) : undefined;
  if (claim && claim.status !== 'draft' && claim.status !== 'rejected') throw new ClaimError(`Claim ${claim.number} on this run is ${claim.status}: ${claim.status === 'sent' ? 'reject it' : 'undo its settlement and reject it'} first.`);
  return withTablesRollback(['invoices', PRICE_DROPS_TABLE, TR_TABLES.claims], () => {
    for (const n of r.note_ids) if (localDb.invoices.getById(n)?.status !== 'Cancelled') localDb.invoices.setStatus(n, 'Cancelled');
    if (claim?.status === 'draft') setTable(TR_TABLES.claims, getTable<TradeClaim>(TR_TABLES.claims).map((c) => (c.id === claim.id ? { ...c, status: 'rejected' as const, notes: `${c.notes ? `${c.notes} ` : ''}Price-drop run ${r.number} undone.`, updated_at: new Date().toISOString() } : c)));
    const next: PriceDropRun = { ...r, status: 'undone', claim_id: undefined, updated_at: new Date().toISOString() };
    setTable(PRICE_DROPS_TABLE, all.map((x) => (x.id === id ? next : x)));
    return next;
  });
}

/** Pure: the price-protection claim rows — notes issued (per bill line) and own stock × drop. */
export function protectionRows(r: PriceDropRun): ClaimRow[] {
  const drop = new Map(r.items.map((i) => [norm(i.name), num(i.drop)]));
  return [
    ...r.rows.map((x) => ({ invoice_id: x.invoice_id, invoice_number: x.invoice_number, date: r.date, party: x.client_name, item: x.item, qty: x.qty, free_qty: 0, value: x.value })),
    ...r.own_stock.map((s) => ({ invoice_number: 'Own stock', date: r.date, party: '', item: s.item, qty: s.qty, free_qty: 0, value: round2(s.qty * (drop.get(norm(s.item)) ?? 0)) })),
  ];
}

/** One claim to the principal for the run (once). */
export function claimPriceDrop(id: string, principal: { id: string; name: string }, date: string): TradeClaim {
  const r = loadPriceDrops().find((x) => x.id === id);
  if (!r || r.status !== 'issued') throw new ClaimError('Only an issued run can be claimed.');
  if (r.claim_id) throw new ClaimError(`Run ${r.number} is already claimed.`);
  // QA8 T7: only rows whose note is still live are claimed.
  const rows = liveRunRows(r, { invoices: getTable<InvoiceRecord>('invoices'), links: getTable<Link>('doc_links') });
  return withTablesRollback([TR_TABLES.claims, PRICE_DROPS_TABLE, 'series_counters'], () => {
    const c = saveClaim({ date, kind: 'price_drop', principal_id: principal.id, principal_name: principal.name, from: r.from, to: r.to, rows: protectionRows({ ...r, rows }), price_drop_id: r.id });
    setTable(PRICE_DROPS_TABLE, getTable<PriceDropRun>(PRICE_DROPS_TABLE).map((x) => (x.id === id ? { ...x, claim_id: c.id, principal_id: principal.id } : x)));
    return c;
  });
}

/** Pure: stock of each named item held at the end of the day before `date` (stock ledger running balance). */
export function stockBefore(positions: readonly StockPosition[], names: readonly string[], date: string): { item: string; qty: number }[] {
  return names.map((n) => {
    const p = positions.find((x) => norm(x.item.name) === norm(n));
    const rows = (p?.ledger ?? []).filter((r) => r.date < date);
    return { item: p?.item.name ?? n, qty: rows.length ? rows[rows.length - 1].balance : 0 };
  });
}

/** `stockBefore` from the live stock engine. */
export const liveStockBefore = (names: readonly string[], date: string) => stockBefore(computeStockDetailed(liveInputs()).positions, names, date);

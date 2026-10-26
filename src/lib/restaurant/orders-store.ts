/**
 * Restaurant storage (R3-A): masters (`dining_areas`, `dining_tables`, `modifier_groups`), the object
 * `restaurant_settings`, and running orders (`table_orders`, company data — backed up and folder-synced,
 * which is NOT real time: two phones at once is a non-goal).
 *
 * Guards: masters need `master.edit`, orders `doc.create` (also enforced by the table write guard).
 * Settling goes through `savePosBill` (numbering, stock, tenders, Z report, period lock) inside
 * `withTablesRollback`, so a refused part of a split bill leaves nothing behind.
 */
import type { Client, InvoiceItem, InvoiceRecord, Payment } from '../../types/invoice';
import type {
  CancelReason, DiningArea, DiningTable, Kot, ModifierGroup, OrderChannel, PayerRow, RestaurantSettings, TableOrder,
} from '../../types/restaurant';
import { DB_PREFIX, generateId, getJson, getTable, setJson, setTable } from '../storage';
import { currentRole, requireAccess } from '../access';
import { withTablesRollback } from '../table-txn';
import { assertUnlocked, isPeriodLockedError } from '../period-lock';
import { num, round2 } from '../invoice-calc';
import { localDb, type AppSettings } from '../localDb';
import { savePosBill, type PosSaveResult, type Tender } from '../pos';
import { counterUser } from '../pos-shifts';
import { priceLevelsDb, type PriceLevel } from '../pricing';
import {
  addItem, buildSettleRecord, isLive, localDay, mergeOrders, moveOrder, newOrder, repriceLines, starterMasters,
  transferLines, type AddLineOptions, type TransferPick,
} from './tables';
import { DEFAULT_CANCEL_CAP, changeQty, needsOwnerPin, sendKot, sentQty } from './kot';
import { partLines, reconcile, type PartPick, type Reconciliation } from './split-bill';
import { set86 } from './modifiers';

export const RT = {
  areas: 'dining_areas',
  tables: 'dining_tables',
  orders: 'table_orders',
  modifiers: 'modifier_groups',
} as const;
export const RESTAURANT_SETTINGS_KEY = `${DB_PREFIX}restaurant_settings`;

/** Tables a settle may write (rolled back together when any step is refused). */
const SETTLE_TABLES = ['invoices', 'transactions', RT.orders, 'items_catalog', 'clients', 'pos_returns'];

export const DEFAULT_SETTINGS: RestaurantSettings = { service_charge_default: 0, token_reset: 'daily', stations: {}, station_names: ['Kitchen', 'Tandoor', 'Chinese', 'Bar'], cancel_cap: { ...DEFAULT_CANCEL_CAP }, auto86: false };

const now = () => new Date();
const who = () => counterUser().name;

/* ── Masters ─────────────────────────────────────────────────── */

export const restaurantDb = {
  /** Stored areas, else the starter "Dine-in" (not written until the first save). */
  areas: (): DiningArea[] => {
    const rows = getTable<DiningArea>(RT.areas);
    return rows.length ? [...rows].sort((a, b) => num(a.sort) - num(b.sort) || a.name.localeCompare(b.name)) : starterMasters().areas;
  },
  tables: (): DiningTable[] => {
    const rows = getTable<DiningTable>(RT.tables);
    return rows.length ? rows : starterMasters().tables;
  },
  saveAreas: (rows: DiningArea[]): void => {
    requireAccess('master.edit');
    for (const a of rows) {
      if (!a.name.trim()) throw new Error('Every area needs a name.');
      if (num(a.service_charge_pct) < 0 || num(a.service_charge_pct) > 100) throw new Error('Service charge must be between 0 and 100%.');
    }
    setTable(RT.areas, rows.map((a) => ({ ...a, name: a.name.trim() })));
  },
  saveTables: (rows: DiningTable[]): void => {
    requireAccess('master.edit');
    const names = new Set<string>();
    for (const t of rows) {
      const key = `${t.area_id}|${t.name.trim().toLowerCase()}`;
      if (!t.name.trim()) throw new Error('Every table needs a name or number.');
      if (names.has(key)) throw new Error(`Table ${t.name} is listed twice in one area.`);
      names.add(key);
    }
    // Saving tables fixes the starter area too, so an order's area id never dangles.
    if (!getTable<DiningArea>(RT.areas).length) setTable(RT.areas, starterMasters().areas);
    setTable(RT.tables, rows.map((t) => ({ ...t, name: t.name.trim(), seats: Math.max(Math.floor(num(t.seats)), 1) })));
  },
  settings: (): RestaurantSettings => ({ ...DEFAULT_SETTINGS, ...getJson<Partial<RestaurantSettings>>(RESTAURANT_SETTINGS_KEY, {}) }),
  saveSettings: (s: RestaurantSettings): void => {
    requireAccess('master.edit');
    setJson(RESTAURANT_SETTINGS_KEY, s);
  },
  modifierGroups: (): ModifierGroup[] => getTable<ModifierGroup>(RT.modifiers),
  saveModifierGroups: (rows: ModifierGroup[]): void => {
    requireAccess('master.edit');
    setTable(RT.modifiers, rows);
  },
  levelOfArea: (areaId: string): PriceLevel | null => {
    const area = restaurantDb.areas().find((a) => a.id === areaId);
    return area?.price_level_id ? priceLevelsDb.all().find((l) => l.id === area.price_level_id) ?? null : null;
  },
};

/* ── Orders ──────────────────────────────────────────────────── */

export const ordersDb = {
  all: (): TableOrder[] => getTable<TableOrder>(RT.orders),
  live: (): TableOrder[] => ordersDb.all().filter(isLive),
  get: (id: string): TableOrder | undefined => ordersDb.all().find((o) => o.id === id),
  /** Write orders (replace by id). */
  put: (...changed: TableOrder[]): void => {
    requireAccess('doc.create');
    const ids = new Set(changed.map((o) => o.id));
    setTable(RT.orders, [...ordersDb.all().filter((o) => !ids.has(o.id)), ...changed]);
  },
};

function mustLive(id: string): TableOrder {
  const o = ordersDb.get(id);
  if (!o) throw new Error('This order no longer exists.');
  if (!isLive(o)) throw new Error('This order is already closed.');
  return o;
}

function mustOpen(id: string): TableOrder {
  const o = mustLive(id);
  if (o.status === 'printed') throw new Error('The bill is printed — reopen the order to change it.');
  return o;
}

export interface OpenOrderInput {
  channel: OrderChannel;
  table_id?: string;
  area_id?: string;
  covers?: number;
  captain?: { id: string; name: string };
  client?: TableOrder['client'];
  eco_gstin?: string;
  eco_name?: string;
  ref?: string;
}

export function openOrder(input: OpenOrderInput, at: Date = now()): TableOrder {
  requireAccess('doc.create');
  const all = ordersDb.all();
  const table = input.table_id ? restaurantDb.tables().find((t) => t.id === input.table_id) : undefined;
  if (input.channel === 'dine_in') {
    if (!table) throw new Error('Pick a table.');
    if (all.some((o) => isLive(o) && o.table_id === table.id)) throw new Error(`Table ${table.name} already has an order.`);
  }
  const areaId = table?.area_id ?? input.area_id ?? restaurantDb.areas()[0]?.id ?? starterMasters().areas[0].id;
  const area = restaurantDb.areas().find((a) => a.id === areaId);
  const order = newOrder({
    id: generateId(),
    channel: input.channel,
    area_id: areaId,
    table_id: table?.id,
    covers: input.covers,
    captain: input.captain ?? counterUser(),
    client: input.client,
    eco_gstin: input.eco_gstin,
    eco_name: input.eco_name,
    ref: input.ref,
    service_charge_pct: input.channel === 'dine_in' ? area?.service_charge_pct : 0,
    now: at,
    orders: all,
  });
  ordersDb.put(order);
  return order;
}

/** Add a catalogue item (priced for the order's area). */
export function addToOrder(orderId: string, source: InvoiceItem, opts: Omit<AddLineOptions, 'newId' | 'at' | 'level' | 'by'> = {}): { order: TableOrder; lineId: string } {
  const order = mustOpen(orderId);
  const r = addItem(order, source, { ...opts, newId: generateId, at: now().toISOString(), by: who(), level: restaurantDb.levelOfArea(order.area_id), fallbackTaxRate: opts.fallbackTaxRate ?? localDb.settings.get().defaultTaxRate });
  ordersDb.put(r.order);
  return r;
}

/** Edit a line's rate / seat / note / discount (quantity changes go through `changeLineQty`). */
export function patchLine(orderId: string, lineId: string, patch: { rate?: number; seat?: number; note?: string; discount_percent?: number }): TableOrder {
  const order = mustOpen(orderId);
  const lines = order.lines.map((l) => {
    if (l.id !== lineId) return l;
    const next = { ...l };
    if (patch.rate !== undefined) {
      next.rate = round2(Math.max(num(patch.rate), 0));
      next.typed_rate = true;
      delete next.price_basis;
    }
    if (patch.seat !== undefined) {
      if (patch.seat > 0) next.seat = Math.floor(patch.seat);
      else delete next.seat;
    }
    if (patch.note !== undefined) {
      if (patch.note.trim()) next.note = patch.note.trim();
      else delete next.note;
    }
    if (patch.discount_percent !== undefined) next.discount_percent = Math.min(Math.max(num(patch.discount_percent), 0), 100);
    next.amount = round2(num(next.quantity) * num(next.rate));
    return next;
  });
  // Children follow the parent's seat.
  const parent = lines.find((l) => l.id === lineId);
  const out = { ...order, lines: lines.map((l) => (l.modifier_of === lineId && parent ? { ...l, ...(parent.seat ? { seat: parent.seat } : {}) } : l)) };
  ordersDb.put(out);
  return out;
}

export class OwnerPinRequired extends Error {
  readonly code = 'OWNER_PIN';
  constructor() {
    super('This cancellation is above the limit for your role — the owner must confirm it with the PIN.');
    this.name = 'OwnerPinRequired';
  }
}
export const isOwnerPinRequired = (e: unknown): e is OwnerPinRequired => (e as { code?: string } | null)?.code === 'OWNER_PIN';

/** Change a line's quantity (0 removes it). Below what the kitchen has: reason + cancellation KOT; clerk cap → owner PIN. */
export function changeLineQty(orderId: string, lineId: string, qty: number, opts: { reason?: CancelReason; note?: string; ownerOk?: boolean } = {}): { order: TableOrder; kot?: Kot } {
  const order = mustOpen(orderId);
  const line = order.lines.find((l) => l.id === lineId);
  if (!line) throw new Error('This line is no longer on the order.');
  const cut = round2(sentQty(order, lineId) - Math.max(num(qty), 0));
  if (cut > 0 && !opts.ownerOk) {
    const cap = restaurantDb.settings().cancel_cap ?? DEFAULT_CANCEL_CAP;
    if (needsOwnerPin(currentRole(), order, cut * num(line.rate), cap)) throw new OwnerPinRequired();
  }
  const at = now();
  const r = changeQty(order, ordersDb.all(), restaurantDb.settings(), { lineId, qty, reason: opts.reason, note: opts.note, by: who(), at: at.toISOString(), day: localDay(at), newId: generateId });
  ordersDb.put(r.order);
  return r;
}

/** Send KOT: tickets for everything added since the last one (none when nothing is new). */
export function sendOrderKot(orderId: string): { order: TableOrder; kots: Kot[] } {
  const order = mustLive(orderId);
  const at = now();
  const r = sendKot(order, ordersDb.all(), restaurantDb.settings(), { by: who(), at: at.toISOString(), day: localDay(at), newId: generateId });
  if (r.kots.length) ordersDb.put(r.order);
  return r;
}

/** Mark a KOT reprinted (each copy prints "DUPLICATE"). */
export function noteReprint(orderId: string, kotId: string): TableOrder {
  const order = ordersDb.get(orderId);
  if (!order) throw new Error('This order no longer exists.');
  const at = now().toISOString();
  const kot = order.kots.find((k) => k.id === kotId);
  const out = { ...order, kots: order.kots.map((k) => (k.id === kotId ? { ...k, reprints: num(k.reprints) + 1 } : k)), log: [...order.log, { at, by: who(), kind: 'reprint' as const, note: kot?.number }] };
  ordersDb.put(out);
  return out;
}

/** Print bill: freezes the order (auto-sends any unsent lines to the kitchen first). */
export function printBill(orderId: string): { order: TableOrder; kots: Kot[] } {
  const sent = sendOrderKot(orderId);
  const order = sent.order;
  if (!order.lines.length) throw new Error('Add items before printing the bill.');
  const at = now().toISOString();
  const out: TableOrder = { ...order, status: 'printed', printed_at: at, log: [...order.log, { at, by: who(), kind: 'print' }] };
  ordersDb.put(out);
  return { order: out, kots: sent.kots };
}

export function reopenOrder(orderId: string, note?: string): TableOrder {
  const order = mustLive(orderId);
  if (order.payers?.some((p) => p.paid)) throw new Error('A part is already paid — finish the split settlement.');
  const at = now().toISOString();
  const out: TableOrder = { ...order, status: 'open', log: [...order.log, { at, by: who(), kind: 'reopen', ...(note?.trim() ? { note: note.trim() } : {}) }] };
  delete out.printed_at;
  ordersDb.put(out);
  return out;
}

/** Remove (or restore) the optional service charge on this bill. */
export function setServiceCharge(orderId: string, off: boolean): TableOrder {
  const order = mustOpen(orderId);
  const at = now().toISOString();
  const out: TableOrder = { ...order, service_charge_off: off, log: [...order.log, { at, by: who(), kind: 'service_charge', note: off ? 'removed' : 'restored' }] };
  if (!off) delete out.service_charge_off;
  ordersDb.put(out);
  return out;
}

export function updateOrderMeta(orderId: string, patch: { covers?: number; client?: TableOrder['client'] | null; captain?: { id: string; name: string }; eco_gstin?: string; ref?: string }): TableOrder {
  const order = mustLive(orderId);
  const out: TableOrder = { ...order };
  if (patch.covers !== undefined) out.covers = Math.max(Math.floor(num(patch.covers)), 0);
  if (patch.client === null) delete out.client;
  else if (patch.client?.name?.trim()) out.client = { ...patch.client, name: patch.client.name.trim() };
  if (patch.captain) {
    out.captain_id = patch.captain.id;
    out.captain_name = patch.captain.name;
  }
  if (patch.eco_gstin !== undefined && out.channel === 'aggregator') out.eco_gstin = patch.eco_gstin.trim().toUpperCase();
  if (patch.ref !== undefined && out.channel === 'aggregator') out.ref = patch.ref.trim();
  ordersDb.put(out);
  return out;
}

export function moveToTable(orderId: string, tableId: string): TableOrder {
  const order = mustLive(orderId);
  const to = restaurantDb.tables().find((t) => t.id === tableId);
  if (!to) throw new Error('Pick a table.');
  let out = moveOrder(order, to, ordersDb.all(), who(), now().toISOString());
  if (to.area_id !== order.area_id) {
    // The new area may sell at another price level; its service charge applies from now on.
    const level = restaurantDb.levelOfArea(to.area_id);
    const area = restaurantDb.areas().find((a) => a.id === to.area_id);
    out = { ...out, lines: repriceLines(out.lines, localDb.items.getAll(), level) };
    if (num(area?.service_charge_pct) > 0) out.service_charge_pct = num(area?.service_charge_pct);
    else delete out.service_charge_pct;
  }
  ordersDb.put(out);
  return out;
}

export function mergeInto(targetId: string, sourceId: string): TableOrder {
  const r = mergeOrders(mustLive(targetId), mustLive(sourceId), who(), now().toISOString());
  ordersDb.put(r.target, r.source);
  return r.target;
}

export function transferTo(fromId: string, toId: string, picks: readonly TransferPick[]): { from: TableOrder; to: TableOrder } {
  const r = transferLines(mustOpen(fromId), mustOpen(toId), picks, sentQty, generateId, who(), now().toISOString());
  ordersDb.put(r.from, r.to);
  return r;
}

/** Void an order with nothing sent to the kitchen, or with a reason (each sent line gets a cancellation KOT). */
export function voidOrder(orderId: string, opts: { reason?: CancelReason; ownerOk?: boolean } = {}): { order: TableOrder; kots: Kot[] } {
  let order = mustOpen(orderId);
  const kots: Kot[] = [];
  const sentValue = round2(order.lines.reduce((s, l) => s + Math.max(sentQty(order, l.id), 0) * num(l.rate), 0));
  if (sentValue > 0) {
    if (!opts.reason) throw new Error('Pick a reason: the kitchen already has some of this order.');
    const cap = restaurantDb.settings().cancel_cap ?? DEFAULT_CANCEL_CAP;
    const sentLines = order.lines.filter((l) => !l.modifier_of && sentQty(order, l.id) > 0).length;
    if (!opts.ownerOk && needsOwnerPin(currentRole(), order, sentValue, cap, sentLines)) throw new OwnerPinRequired();
  }
  const at = now();
  for (const l of order.lines.filter((x) => !x.modifier_of)) {
    const r = changeQty(order, ordersDb.all(), restaurantDb.settings(), { lineId: l.id, qty: 0, reason: opts.reason, by: who(), at: at.toISOString(), day: localDay(at), newId: generateId });
    order = r.order;
    if (r.kot) kots.push(r.kot);
  }
  const out: TableOrder = { ...order, status: 'void', log: [...order.log, { at: at.toISOString(), by: who(), kind: 'void', ...(opts.reason ? { reason: opts.reason } : {}) }] };
  ordersDb.put(out);
  return { order: out, kots };
}

/* ── Settle ──────────────────────────────────────────────────── */

interface Ctx {
  settings: AppSettings;
  sender: ReturnType<typeof localDb.settings.activeProfile>;
  templateId: string;
}
const ctxNow = (): Ctx => ({ settings: localDb.settings.get(), sender: localDb.settings.activeProfile(), templateId: localDb.template.get() });

/** The saved customer an order names (by id, else by name). */
function savedClient(order: TableOrder): Client | null {
  if (!order.client) return null;
  const all = localDb.clients.getAll();
  return all.find((c) => (order.client?.id && c.id === order.client.id)) ?? null;
}

/** The bill an order would settle into (unsaved): for the bill print and the totals panel. */
export function previewBill(order: TableOrder, day: string = localDay(), items?: InvoiceItem[]): InvoiceRecord {
  const c = ctxNow();
  return buildSettleRecord({ order, items, client: savedClient(order), settings: c.settings, sender: c.sender, templateId: c.templateId, day });
}

class SettleRefused extends Error {
  readonly result: PosSaveResult;
  constructor(result: PosSaveResult) {
    super(result.errors[0] ?? 'The bill could not be saved.');
    this.result = result;
  }
}

export interface SettleResult extends PosSaveResult {
  order?: TableOrder;
  records?: InvoiceRecord[];
}

/** Settle the whole order into one POS invoice with `tenders`. */
export function settleOrder(orderId: string, tenders: Tender[], opts: { day?: string; expiredOk?: boolean; allowCredit?: boolean } = {}): SettleResult {
  const order = mustLive(orderId);
  if (!order.lines.length) return { ok: false, errors: ['Add items before settling.'] };
  if (order.payers?.length) return { ok: false, errors: ['This order is being settled by payer — take the remaining payers.'] };
  const day = opts.day ?? localDay();
  const client = savedClient(order);
  try {
    return withTablesRollback(SETTLE_TABLES, () => {
      const record = previewBill(order, day);
      const res = savePosBill({ record, tenders, expiredOk: opts.expiredOk, allowCredit: !!client || !!opts.allowCredit });
      if (!res.ok || !res.record) throw new SettleRefused(res);
      const at = now().toISOString();
      const out: TableOrder = { ...order, status: 'settled', settled_at: at, invoice_ids: [res.record.id], log: [...order.log, { at, by: who(), kind: 'settle', note: res.record.invoice_number }] };
      ordersDb.put(out);
      return { ...res, order: out, records: [res.record] };
    });
  } catch (err) {
    if (err instanceof SettleRefused) return err.result;
    return { ok: false, errors: [(err as Error).message], locked: isPeriodLockedError(err) };
  }
}

/**
 * R7-B2 hotel "charge to room": the order closes onto a guest folio — no POS bill and no tax now (the check-out
 * invoice charges F&B at the hotel's restaurant rate). `post` writes the folio line for the pre-GST total and returns
 * the folio id; both roll back together.
 */
export function settleToFolio(orderId: string, post: (order: TableOrder, preTax: number) => string): TableOrder {
  const order = mustLive(orderId);
  if (!order.lines.length || order.payers?.length) throw new Error('Nothing to charge, or the order is being settled by payer.');
  return withTablesRollback([RT.orders, 'hotel_folios'], () => {
    const folio_id = post(order, previewBill(order).taxable_value);
    const at = now().toISOString();
    const out: TableOrder = { ...order, status: 'settled', settled_at: at, folio_id, log: [...order.log, { at, by: who(), kind: 'settle', note: 'Charged to room' }] };
    ordersDb.put(out);
    return out;
  });
}

/**
 * Equal / custom split: one invoice, settled payer by payer. The first payment saves the invoice (with
 * the rest left due); each next payer is a payment on it; the order is Settled when every row is paid.
 */
export function startPayers(orderId: string, payers: PayerRow[]): TableOrder {
  const order = mustLive(orderId);
  if (order.invoice_ids?.length) throw new Error('This order already has its bill.');
  const out: TableOrder = { ...order, payers: payers.map((p) => ({ amount: round2(num(p.amount)), ...(p.name?.trim() ? { name: p.name.trim() } : {}) })) };
  ordersDb.put(out);
  return out;
}

export function payPayer(orderId: string, index: number, tender: Tender, opts: { day?: string } = {}): SettleResult {
  const order = mustLive(orderId);
  const row = order.payers?.[index];
  if (!row) return { ok: false, errors: ['Pick a payer.'] };
  if (row.paid) return { ok: false, errors: ['This payer has already paid.'] };
  const day = opts.day ?? localDay();
  try {
    return withTablesRollback(SETTLE_TABLES, () => {
      let record: InvoiceRecord | undefined;
      let payment: Payment | undefined;
      let invoiceIds = order.invoice_ids ?? [];
      const t: Tender = { ...tender, amount: round2(num(row.amount)) };
      if (!invoiceIds.length) {
        const res = savePosBill({ record: previewBill(order, day), tenders: [t], allowCredit: true });
        if (!res.ok || !res.record) throw new SettleRefused(res);
        record = res.record;
        payment = res.payments?.[0];
        invoiceIds = [res.record.id];
        // The payer rows must add up to the bill as saved (round-off may differ from the preview).
        const sum = round2((order.payers ?? []).reduce((s, p) => s + num(p.amount), 0));
        if (Math.abs(sum - res.record.total) > 0.004) throw new SettleRefused({ ok: false, errors: [`The payers add up to ₹${sum.toFixed(2)} but the bill is ₹${res.record.total.toFixed(2)} — split again.`] });
      } else {
        payment = localDb.payments.record({ invoiceId: invoiceIds[0], amount: t.amount, method: t.method, reference: t.reference, date: day, note: 'POS', bankAccountId: t.bank_account_id });
        record = localDb.invoices.getById(invoiceIds[0]) ?? undefined;
      }
      const payers = (order.payers ?? []).map((p, i) => (i === index ? { ...p, paid: true, method: t.method, ...(payment ? { payment_id: payment.id } : {}) } : p));
      const done = payers.every((p) => p.paid);
      const at = now().toISOString();
      const out: TableOrder = {
        ...order,
        payers,
        invoice_ids: invoiceIds,
        log: [...order.log, { at, by: who(), kind: done ? 'settle' : 'part_paid', note: `${row.name || `Payer ${index + 1}`} ₹${t.amount.toFixed(2)} ${t.method}` }],
        ...(done ? { status: 'settled' as const, settled_at: at } : {}),
      };
      ordersDb.put(out);
      return { ok: true, errors: [], record, payments: payment ? [payment] : [], order: out, records: record ? [record] : [] };
    });
  } catch (err) {
    if (err instanceof SettleRefused) return err.result;
    return { ok: false, errors: [(err as Error).message], locked: isPeriodLockedError(err) };
  }
}

/** Item / seat split preview: the part records (unsaved) and the reconciliation strip against the whole bill. */
export function previewParts(order: TableOrder, picks: readonly PartPick[], parts: number, day: string = localDay()): { records: InvoiceRecord[]; whole: InvoiceRecord; recon: Reconciliation } {
  const whole = previewBill(order, day);
  const records = partLines(order, picks, parts, !!whole.price_includes_tax)
    .map((items, i) => ({ ...previewBill(order, day, items), split_of: { order_id: order.id, part: i + 1, parts } }))
    .filter((r) => r.items.length);
  return { records, whole, recon: reconcile(records, whole) };
}

/**
 * Item / seat split: one POS invoice per part, saved together (consecutive numbers), each paid with its
 * own tenders. All or nothing.
 */
export function settleParts(orderId: string, picks: readonly PartPick[], parts: number, tenders: readonly Tender[][], opts: { day?: string; expiredOk?: boolean } = {}): SettleResult {
  const order = mustLive(orderId);
  if (order.payers?.length) return { ok: false, errors: ['This order is being settled by payer.'] };
  const day = opts.day ?? localDay();
  const client = savedClient(order);
  try {
    return withTablesRollback(SETTLE_TABLES, () => {
      assertUnlocked({ issue_date: day }, 'create');
      const { records } = previewParts(order, picks, parts, day);
      if (records.length < 2) throw new SettleRefused({ ok: false, errors: ['A split needs at least two parts with items.'] });
      const saved: InvoiceRecord[] = [];
      const payments: Payment[] = [];
      records.forEach((record, i) => {
        const res = savePosBill({ record: { ...record, split_of: { order_id: order.id, part: i + 1, parts: records.length } }, tenders: [...(tenders[record.split_of!.part - 1] ?? [])], expiredOk: opts.expiredOk, allowCredit: !!client });
        if (!res.ok || !res.record) throw new SettleRefused({ ...res, errors: res.errors.map((e) => `Part ${i + 1}: ${e}`) });
        saved.push(res.record);
        payments.push(...(res.payments ?? []));
      });
      const at = now().toISOString();
      const out: TableOrder = { ...order, status: 'settled', settled_at: at, invoice_ids: saved.map((r) => r.id), log: [...order.log, { at, by: who(), kind: 'settle', note: saved.map((r) => r.invoice_number).join(', ') }] };
      ordersDb.put(out);
      return { ok: true, errors: [], record: saved[0], records: saved, payments, order: out };
    });
  } catch (err) {
    if (err instanceof SettleRefused) return err.result;
    return { ok: false, errors: [(err as Error).message], locked: isPeriodLockedError(err) };
  }
}

/* ── 86 ──────────────────────────────────────────────────────── */

/** Switch catalogue items off for today (or back on). Needs `master.edit`. */
export function set86Items(ids: readonly string[], off: boolean, day: string = localDay()): void {
  requireAccess('master.edit');
  setTable('items_catalog', set86(localDb.items.getAll(), ids, off, day));
}

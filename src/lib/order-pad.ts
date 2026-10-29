/**
 * Offline order pad (8.81 — Marg / BUSY salesman order booking, without a live server).
 *
 *  - Salesman mode (`/order-pad`): on the salesman's own device (a copy of the company's parties and items,
 *    e.g. restored from a backup) orders are booked per party into the outbox (`order_pad_outbox`) and
 *    exported as ONE signed order file (`.mcorder`): JSON with the orders and an HMAC-SHA256 signature made
 *    with a key derived (PBKDF2-SHA256, same helpers and limits as folder sync / backups) from a passphrase
 *    the office shares with its salesmen. Sent by Web Share, as a file, or shown as a QR code.
 *  - Office: the file is verified (a wrong passphrase or any edit fails the signature) and every order becomes
 *    a Sales Order (`SO/FY…`) for the party, with the salesman as the document's agent. Orders already imported
 *    (by order id, table `order_pad_imports`) are skipped, so the same file can be imported twice safely.
 *    One file imports all-or-nothing.
 *
 * No live sync, no network: the file is the transport. The signature proves the file came from someone who
 * knows the passphrase and was not altered; it is not encryption (the orders are readable). Pure above
 * "Storage" apart from WebCrypto.
 */

import type { Client, InvoiceItem, InvoiceRecord } from '../types/invoice';
import { base64ToBytes, bytesToBase64, constantTimeEqual, MIN_ITERATIONS, randomBytes } from './crypto';
import { num, round2 } from './invoice-calc';
import { isoDay } from './dates';
import { generateId, getTable, setTable } from './storage';
import { requireAccess } from './access';
import { audit } from './audit';
import { withTablesRollback } from './table-txn';

export const ORDER_FILE_APP = 'mrchartist-order-pad' as const;
export const ORDER_FILE_EXT = '.mcorder';
export const OUTBOX_TABLE = 'order_pad_outbox';
export const IMPORTS_TABLE = 'order_pad_imports';
const MAX_ITER = 2_000_000;
const MAX_ORDERS = 500;
const MAX_LINES = 300;

export interface PadLine { item_id?: string; name: string; qty: number; unit?: string; rate?: number }
export interface PadOrder {
  /** Made on the salesman's device; the office dedupes on it. */
  id: string;
  /** yyyy-mm-dd */
  date: string;
  client_id?: string;
  client_name: string;
  beat_id?: string;
  lines: PadLine[];
  note?: string;
  /** Outbox only: when it went out in a file. */
  exported_at?: string;
  created_at?: string;
}
export interface PadPayload {
  salesman: { agent_id?: string; name: string };
  created_at: string;
  orders: PadOrder[];
}
export interface OrderFile {
  app: typeof ORDER_FILE_APP;
  v: 1;
  kdf: 'PBKDF2-SHA256';
  iter: number;
  salt: string;
  /** The payload as signed (JSON text). */
  payload: string;
  /** HMAC-SHA256 (base64) of `app|v|salt|iter|payload`. */
  sig: string;
}

export class OrderFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OrderFileError';
  }
}

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new OrderFileError('Secure cryptography is not available in this browser context (HTTPS required).');
  return s;
}

const enc = new TextEncoder();
const signedText = (f: Pick<OrderFile, 'app' | 'v' | 'salt' | 'iter' | 'payload'>) => `${f.app}|${f.v}|${f.salt}|${f.iter}|${f.payload}`;

async function hmacKey(passphrase: string, salt: string, iter: number): Promise<CryptoKey> {
  if (!passphrase) throw new OrderFileError('Enter the order passphrase.');
  if (!Number.isInteger(iter) || iter < MIN_ITERATIONS || iter > MAX_ITER) throw new OrderFileError('This order file has unusual key settings.');
  const base = await subtle().importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: base64ToBytes(salt), iterations: iter }, base, 256);
  return subtle().importKey('raw', bits, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
}

/** Validate and normalise a payload (drops empty lines / orders). Throws OrderFileError. */
export function cleanPayload(raw: unknown): PadPayload {
  const p = raw as Partial<PadPayload> | null;
  if (!p || typeof p !== 'object' || !Array.isArray(p.orders)) throw new OrderFileError('This is not an order file.');
  if (p.orders.length > MAX_ORDERS) throw new OrderFileError(`An order file holds at most ${MAX_ORDERS} orders.`);
  const orders: PadOrder[] = [];
  for (const o of p.orders) {
    if (!o || typeof o.id !== 'string' || !o.id.trim() || !String(o.client_name ?? '').trim()) continue;
    const lines = (Array.isArray(o.lines) ? o.lines : []).slice(0, MAX_LINES)
      .filter((l) => l && String(l.name ?? '').trim() && num(l.qty) > 0)
      .map((l) => ({
        ...(typeof l.item_id === 'string' && l.item_id ? { item_id: l.item_id } : {}),
        name: String(l.name).trim().slice(0, 200), qty: round2(num(l.qty)),
        ...(l.unit ? { unit: String(l.unit).slice(0, 20) } : {}), ...(num(l.rate) > 0 ? { rate: round2(num(l.rate)) } : {}),
      }));
    if (!lines.length) continue;
    orders.push({
      id: o.id.trim().slice(0, 64), date: isoDay(o.date) || isoDay(p.created_at) || '', client_name: String(o.client_name).trim().slice(0, 200), lines,
      ...(typeof o.client_id === 'string' && o.client_id ? { client_id: o.client_id } : {}),
      ...(typeof o.beat_id === 'string' && o.beat_id ? { beat_id: o.beat_id } : {}),
      ...(o.note ? { note: String(o.note).slice(0, 500) } : {}),
    });
  }
  return { salesman: { name: String(p.salesman?.name ?? '').trim().slice(0, 120), ...(p.salesman?.agent_id ? { agent_id: String(p.salesman.agent_id) } : {}) }, created_at: String(p.created_at ?? ''), orders };
}

/** Sign a payload into an order file. */
export async function signOrderFile(payload: PadPayload, passphrase: string, iter = MIN_ITERATIONS): Promise<OrderFile> {
  const body = JSON.stringify(cleanPayload(payload));
  const salt = bytesToBase64(randomBytes(16));
  const head = { app: ORDER_FILE_APP as typeof ORDER_FILE_APP, v: 1 as const, salt, iter, payload: body };
  const key = await hmacKey(passphrase, salt, iter);
  const sig = new Uint8Array(await subtle().sign('HMAC', key, enc.encode(signedText(head))));
  return { ...head, kdf: 'PBKDF2-SHA256', sig: bytesToBase64(sig) };
}

/** Parse + verify an order file's text. Throws OrderFileError on a bad file, a wrong passphrase or an edit. */
export async function verifyOrderFile(text: string, passphrase: string): Promise<PadPayload> {
  let f: Partial<OrderFile>;
  try {
    f = JSON.parse(text.trim()) as Partial<OrderFile>;
  } catch {
    throw new OrderFileError('This is not an order file.');
  }
  if (!f || f.app !== ORDER_FILE_APP || f.v !== 1 || typeof f.payload !== 'string' || typeof f.sig !== 'string' || typeof f.salt !== 'string') {
    throw new OrderFileError('This is not an order file.');
  }
  const key = await hmacKey(passphrase, f.salt, Number(f.iter));
  const want = new Uint8Array(await subtle().sign('HMAC', key, enc.encode(signedText({ app: ORDER_FILE_APP, v: 1, salt: f.salt, iter: Number(f.iter), payload: f.payload }))));
  let got: Uint8Array;
  try {
    got = base64ToBytes(f.sig);
  } catch {
    throw new OrderFileError('The order file signature is damaged.');
  }
  if (!constantTimeEqual(want, got)) throw new OrderFileError('The signature does not match: wrong passphrase, or the file was changed after it was made.');
  let payload: unknown;
  try {
    payload = JSON.parse(f.payload);
  } catch {
    throw new OrderFileError('The order file is damaged.');
  }
  return cleanPayload(payload);
}

/* ── Office import (pure planning) ─────────────────────────────── */

export interface ImportRow { id: string; invoice_id: string; number: string; salesman: string; order_date: string; imported_at: string }

/** Orders not imported before (by id; repeats inside the file count once). */
export function newOrders(orders: readonly PadOrder[], imported: readonly Pick<ImportRow, 'id'>[]): { fresh: PadOrder[]; duplicates: PadOrder[] } {
  const seen = new Set(imported.map((r) => r.id));
  const fresh: PadOrder[] = [];
  const duplicates: PadOrder[] = [];
  for (const o of orders) {
    if (seen.has(o.id)) duplicates.push(o);
    else {
      seen.add(o.id);
      fresh.push(o);
    }
  }
  return { fresh, duplicates };
}

interface CatalogRow { id?: string; name: string; hsn?: string; unit?: string; rate?: number; sale_rate?: number; tax_rate?: number; type?: string }

/** Order lines as sales-order lines: HSN / unit / GST rate / rate from the stock item or catalogue when known. */
export function orderLines(order: PadOrder, stock: readonly CatalogRow[], catalog: readonly CatalogRow[], defaultTax: number, newId: () => string): InvoiceItem[] {
  const n = (s: unknown) => String(s ?? '').trim().toLowerCase();
  return order.lines.map((l) => {
    const st = (l.item_id ? stock.find((s) => s.id === l.item_id) : undefined) ?? stock.find((s) => n(s.name) === n(l.name));
    const cat = catalog.find((c) => n(c.name) === n(st?.name ?? l.name));
    const rate = num(l.rate) > 0 ? num(l.rate) : num(cat?.rate) || num(st?.sale_rate);
    const tax = typeof cat?.tax_rate === 'number' ? cat.tax_rate : typeof st?.tax_rate === 'number' ? st.tax_rate : defaultTax;
    const qty = num(l.qty);
    return {
      id: newId(), name: st?.name ?? l.name, type: (cat?.type as InvoiceItem['type']) || 'Product', hsn: st?.hsn ?? cat?.hsn ?? '',
      unit: l.unit || st?.unit || cat?.unit || 'NOS', quantity: qty, rate, tax_rate: tax, amount: round2(qty * rate),
    } as InvoiceItem;
  });
}

/* ── Storage ──────────────────────────────────────────────────── */

export const outboxDb = {
  all: (): PadOrder[] => getTable<PadOrder>(OUTBOX_TABLE).filter((o) => o && typeof o.id === 'string'),
  pending: (): PadOrder[] => outboxDb.all().filter((o) => !o.exported_at),
  save(o: Omit<PadOrder, 'id'> & { id?: string }): PadOrder {
    requireAccess('doc.create');
    const clean = cleanPayload({ salesman: { name: '' }, created_at: '', orders: [{ ...o, id: o.id || generateId() }] }).orders[0];
    if (!clean) throw new OrderFileError('Add the party and at least one item with a quantity.');
    const rows = outboxDb.all();
    const existing = rows.find((r) => r.id === clean.id);
    const row: PadOrder = { ...clean, created_at: existing?.created_at ?? new Date().toISOString() };
    setTable(OUTBOX_TABLE, existing ? rows.map((r) => (r.id === row.id ? row : r)) : [...rows, row]);
    return row;
  },
  remove(id: string): void {
    requireAccess('doc.create');
    setTable(OUTBOX_TABLE, outboxDb.all().filter((o) => o.id !== id));
  },
  markExported(ids: readonly string[]): void {
    const want = new Set(ids);
    const at = new Date().toISOString();
    setTable(OUTBOX_TABLE, outboxDb.all().map((o) => (want.has(o.id) ? { ...o, exported_at: at } : o)));
  },
};

export const importsDb = { all: (): ImportRow[] => getTable<ImportRow>(IMPORTS_TABLE).filter((r) => r && typeof r.id === 'string') };

export interface ImportDeps {
  /** Build a full sales-order record (number, sender, totals) for the party and lines. */
  buildOrder: (input: { client: Client; date: string; items: InvoiceItem[]; agentId?: string; note?: string }) => InvoiceRecord;
  save: (rec: InvoiceRecord) => InvoiceRecord;
  /** GST rate for an item the office does not know (settings default). */
  defaultTax: number;
}

/**
 * Import a verified payload as sales orders (all-or-nothing). Unknown parties are matched by name or added
 * to the client master through the normal save. Returns the created orders and the skipped duplicates.
 * 8.88 partial import: `only` (order ids) imports just those orders of the file; the others are not marked imported,
 * so the same file can bring them in later.
 */
export function importOrders(payload: PadPayload, deps: ImportDeps, opts: { only?: readonly string[] } = {}): { created: InvoiceRecord[]; duplicates: PadOrder[] } {
  requireAccess('doc.create');
  const split = newOrders(payload.orders, importsDb.all());
  const duplicates = split.duplicates;
  const only = opts.only ? new Set(opts.only) : null;
  const fresh = only ? split.fresh.filter((o) => only.has(o.id)) : split.fresh;
  if (!fresh.length) return { created: [], duplicates };
  const n = (s: unknown) => String(s ?? '').trim().toLowerCase();
  const clients = getTable<Client>('clients');
  const agents = getTable<{ id: string; name: string }>('sales_agents');
  const agentId = (payload.salesman.agent_id && agents.some((a) => a.id === payload.salesman.agent_id) ? payload.salesman.agent_id : undefined)
    ?? agents.find((a) => n(a.name) === n(payload.salesman.name) && n(a.name))?.id;
  const created = withTablesRollback(['invoices', IMPORTS_TABLE, 'clients', 'items_catalog', 'series_counters'], () => {
    const out: InvoiceRecord[] = [];
    const rows = importsDb.all();
    const stock = getTable<CatalogRow>('stock_items');
    const catalog = getTable<CatalogRow>('items_catalog');
    for (const o of fresh) {
      const master = (o.client_id ? clients.find((c) => c.id === o.client_id) : undefined) ?? clients.find((c) => n(c.name) === n(o.client_name));
      const client: Client = master ?? ({ name: o.client_name, email: '', address: '', city: '', zip: '' } as Client);
      const items = orderLines(o, stock, catalog, deps.defaultTax, generateId);
      const rec = deps.buildOrder({ client, date: o.date, items, agentId: agentId ?? master?.agent_id, note: [o.note, `Order pad · ${payload.salesman.name || 'salesman'} · ${o.id}`].filter(Boolean).join(', ') });
      const saved = deps.save(rec);
      out.push(saved);
      rows.push({ id: o.id, invoice_id: saved.id, number: saved.invoice_number, salesman: payload.salesman.name, order_date: o.date, imported_at: new Date().toISOString() });
    }
    setTable(IMPORTS_TABLE, rows);
    return out;
  });
  try {
    const left = split.fresh.length - fresh.length;
    audit.record({ entity: 'invoice', entity_id: created[0]?.id ?? 'order-pad', action: 'create', summary: `Order pad: ${created.length} sales order(s) imported from ${payload.salesman.name || 'a salesman'}${duplicates.length ? `, ${duplicates.length} already imported skipped` : ''}${left ? `, ${left} left for later` : ''}` });
  } catch {
    /* logging never blocks */
  }
  return { created, duplicates };
}

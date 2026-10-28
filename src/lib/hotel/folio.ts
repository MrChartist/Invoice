/**
 * R7-B1 folio operations: post a charge (routed by kind through `windowFor`), split a line between windows, transfer
 * lines to another window / another in-house folio (room-to-room) / a company or house folio, and void with a reason.
 * A folio is a running account, never a tax document: no GST, no tax-series number (the check-out invoice is the tax
 * document, B3). Voided lines stay on the folio, struck through, with who / when / why — never deleted. A clerk's voids
 * above `clerk_void_cap` per day need the owner's PIN (R3-A `needsOwnerPin` pattern). Invoiced lines (`src.invoice_id`)
 * cannot move or be voided. Writes go through `hotelDb.putFolios` (`doc.create`, audited).
 */
import type { Folio, FolioLine, FolioLineKind, Reservation } from '../../types/hotel-r7';
import { generateId } from '../storage';
import { round2 } from '../invoice-calc';
import { currentActor, currentRole } from '../access';
import { todayIso } from '../tax-rules';
import type { TableOrder } from '../../types/restaurant';
import { withTablesRollback } from '../table-txn';
import { ordersDb } from '../restaurant/orders-store';
import { HT, hotelDb } from './hotel-store';
import { HotelError } from './reservations';
import { ROOM_KINDS, folioOf, newFolio, windowFor } from './room-post';

export const who = (): string => currentActor()?.name || 'Owner';
const live = (l: FolioLine) => !l.void;
const free = (l: FolioLine) => live(l) && !l.src?.invoice_id;

/** Thrown when a clerk's void is above the daily cap: ask for the owner's PIN, then retry with `ownerOk`. */
export class VoidPinRequired extends HotelError {
  readonly code = 'OWNER_PIN';
}

export interface ChargeInput {
  kind: FolioLineKind;
  desc?: string;
  qty: number;
  rate: number;
  sac?: string;
  tax_rate?: number;
  room_no?: string;
  key?: string;
  src?: FolioLine['src'];
  band_value?: number;
}

/** A folio line from a charge (pure). An allowance is stored negative. */
export function chargeLine(c: ChargeInput, day: string): FolioLine {
  const qty = Number(c.qty) || 0;
  const rate = Math.abs(Number(c.rate) || 0);
  if (!(qty > 0) || !(rate > 0)) throw new HotelError('Enter the quantity and the rate.');
  const sign = c.kind === 'allowance' ? -1 : 1;
  const line: FolioLine = { id: generateId(), date: day, kind: c.kind, desc: (c.desc || c.kind).trim(), qty, rate: sign * rate, amount: round2(sign * qty * rate) };
  for (const k of ['sac', 'tax_rate', 'room_no', 'key', 'src', 'band_value'] as const) if (c[k] !== undefined && c[k] !== '') (line as unknown as Record<string, unknown>)[k] = c[k];
  return line;
}

const mustFolio = (folios: readonly Folio[], id: string): Folio => {
  const f = folios.find((x) => x.id === id);
  if (!f || f.status === 'invoiced') throw new HotelError('This folio is closed.');
  return f;
};

/** The open folio of (stay, window), created when missing (pure; the caller saves). */
export function windowFolio(folios: readonly Folio[], res: Reservation, lineId: string, window: number, day: string): Folio {
  return folioOf(folios, res.id, lineId, window) ?? newFolio(res, { id: lineId }, window, day);
}

/**
 * Window of a charge for a stay. QA9 H6: an allowance follows the charge it reduces — the window holding its linked
 * night's room line, else the window room charges route to — unless a routing rule names allowances.
 */
export function chargeWindow(folios: readonly Folio[], res: Reservation, lineId: string, c: Pick<ChargeInput, 'kind' | 'src'>): number {
  if (c.kind !== 'allowance' || (res.routing ?? []).some((r) => r.kinds.includes('allowance'))) return windowFor(res, c.kind);
  const night = c.src?.night;
  const held = night && folios.find((f) => f.reservation_id === res.id && f.line_id === lineId && f.lines.some((l) => !l.void && l.src?.night === night && ROOM_KINDS.has(l.kind)));
  return held ? held.window : windowFor(res, 'room');
}

/** Route a charge to its window for a stay (pure): returns the changed folio. */
export function routeCharge(folios: readonly Folio[], res: Reservation, lineId: string, c: ChargeInput, day: string): Folio {
  const f = windowFolio(folios, res, lineId, chargeWindow(folios, res, lineId, c), day);
  return { ...f, lines: [...f.lines, chargeLine(c, day)] };
}

/** Post a charge to a stay (routed) or straight to a folio (house / company). Returns the folio written. */
export function postCharge(target: { resId: string; lineId: string } | { folioId: string }, c: ChargeInput, day: string = hotelDb.settings().business_date): Folio {
  const folios = hotelDb.folios();
  let out: Folio;
  if ('folioId' in target) {
    const f = mustFolio(folios, target.folioId);
    out = { ...f, lines: [...f.lines, chargeLine(c, day)] };
  } else {
    const res = hotelDb.reservation(target.resId);
    const line = res?.lines.find((l) => l.id === target.lineId);
    if (!res || !line || (line.status !== 'checked_in' && !folios.some((f) => f.line_id === line.id && f.status === 'open'))) throw new HotelError('Post charges to an in-house room.');
    out = routeCharge(folios, res, line.id, c, day);
  }
  hotelDb.putFolios(out);
  return out;
}

/** Same stay, another window (created when missing). */
function sibling(folios: readonly Folio[], f: Folio, window: number, day: string): Folio {
  if (f.window === window) throw new HotelError('Pick another window.');
  const res = f.reservation_id ? hotelDb.reservation(f.reservation_id) : undefined;
  if (!res || !f.line_id) throw new HotelError('A house folio has one window — transfer to another folio.');
  return windowFolio(folios, res, f.line_id, window, day);
}

/** Split one line in two (by quantity or by amount); the part moves to `window`. Totals are kept (pure). */
export function splitLinePure(src: Folio, dst: Folio, lineId: string, by: { qty?: number; amount?: number }): [Folio, Folio] {
  const l = src.lines.find((x) => x.id === lineId);
  if (!l || !free(l)) throw new HotelError('This line cannot be split.');
  let part: FolioLine;
  let rest: FolioLine;
  if (by.qty) {
    const q = Number(by.qty);
    if (!(q > 0 && q < l.qty)) throw new HotelError(`Split between 0 and ${l.qty}.`);
    part = { ...l, id: generateId(), qty: q, amount: round2(q * l.rate) };
    rest = { ...l, qty: round2(l.qty - q), amount: round2(l.amount - part.amount) };
  } else {
    const a = round2(Math.abs(Number(by.amount) || 0) * Math.sign(l.amount));
    if (!(Math.abs(a) > 0 && Math.abs(a) < Math.abs(l.amount))) throw new HotelError('Split an amount below the line amount.');
    part = { ...l, id: generateId(), qty: 1, rate: a, amount: a };
    rest = { ...l, qty: 1, rate: round2(l.amount - a), amount: round2(l.amount - a) };
  }
  if (l.gross) {
    part.gross = round2((l.gross * part.amount) / l.amount);
    rest.gross = round2(l.gross - part.gross);
  }
  if (part.key) part.key = `${part.key}:s${part.id.slice(-4)}`;
  part.moved_from = src.name;
  return [{ ...src, lines: src.lines.map((x) => (x.id === lineId ? rest : x)) }, { ...dst, lines: [...dst.lines, part] }];
}

export function splitLine(folioId: string, lineId: string, by: { qty?: number; amount?: number }, window: number): Folio[] {
  const folios = hotelDb.folios();
  const src = mustFolio(folios, folioId);
  const out = splitLinePure(src, sibling(folios, src, window, hotelDb.settings().business_date), lineId, by);
  hotelDb.putFolios(...out);
  return out;
}

/** Move lines to another folio (pure). `moved_from` keeps the source folio's name. */
export function transferPure(src: Folio, dst: Folio, lineIds: readonly string[]): [Folio, Folio] {
  if (src.id === dst.id || dst.status === 'invoiced') throw new HotelError('Pick another open folio.');
  const ids = new Set(lineIds);
  const moving = src.lines.filter((l) => ids.has(l.id));
  if (!moving.length || moving.some((l) => !free(l))) throw new HotelError('Only open, unbilled lines can move.');
  return [{ ...src, lines: src.lines.filter((l) => !ids.has(l.id)) }, { ...dst, lines: [...dst.lines, ...moving.map((l) => ({ ...l, moved_from: src.name }))] }];
}

export function transferLines(folioId: string, lineIds: readonly string[], to: { window: number } | { folioId: string }): Folio[] {
  const folios = hotelDb.folios();
  const src = mustFolio(folios, folioId);
  const dst = 'window' in to ? sibling(folios, src, to.window, hotelDb.settings().business_date) : mustFolio(folios, to.folioId);
  const out = transferPure(src, dst, lineIds);
  hotelDb.putFolios(...out);
  return out;
}

/** Posted room nights may be voided only as a rate correction or a complimentary night. */
export const ROOM_VOID_REASONS = ['rate correction', 'complimentary'];

/** Does this clerk's void need the owner's PIN? (Voids by the same user on the same day, against the cap.) */
export function needsVoidPin(folios: readonly Folio[], line: Pick<FolioLine, 'amount'>, me: string, role: string, cap: { lines: number; amount: number }, at: Date): boolean {
  if (role === 'owner') return false;
  const day = todayIso(at);
  const mine = folios.flatMap((f) => f.lines).filter((l) => l.void && l.void.by === me && todayIso(new Date(l.void.at)) === day);
  const value = mine.reduce((s, l) => s + Math.abs(l.amount), Math.abs(line.amount));
  return mine.length + 1 > cap.lines || round2(value) > cap.amount;
}

export function voidLine(folioId: string, lineId: string, reason: string, opts: { ownerOk?: boolean; at?: Date } = {}): Folio {
  const at = opts.at ?? new Date();
  const folios = hotelDb.folios();
  const f = mustFolio(folios, folioId);
  const l = f.lines.find((x) => x.id === lineId);
  const why = reason.trim();
  if (!l || !free(l)) throw new HotelError('This line cannot be voided.');
  if (!why) throw new HotelError('Give a reason.');
  if (l.key?.startsWith('stay:') && !ROOM_VOID_REASONS.includes(why.toLowerCase())) throw new HotelError(`A posted room night is voided only as "${ROOM_VOID_REASONS.join('" or "')}".`);
  if (!opts.ownerOk && needsVoidPin(folios, l, who(), currentRole(), hotelDb.settings().clerk_void_cap, at)) throw new VoidPinRequired('Above the void limit — the owner\'s PIN is needed.');
  const out = { ...f, lines: f.lines.map((x) => (x.id === lineId ? { ...x, void: { by: who(), at: at.toISOString(), reason: why } } : x)) };
  const order = l.src?.table_order_id ? ordersDb.get(l.src.table_order_id) : undefined;
  // QA9 H13: voiding a restaurant room charge reopens its order (settle it at the table or charge it again).
  withTablesRollback([HT.folios, 'table_orders'], () => {
    hotelDb.putFolios(out);
    if (order?.folio_id) reopenOrder(order, `Room charge voided (${f.name}): ${why}`);
  });
  return out;
}

/** An order settled to a folio back to open (the room charge was undone or voided), logged. */
export function reopenOrder(order: TableOrder, note: string): TableOrder {
  const out: TableOrder = { ...order, status: 'open', log: [...order.log, { at: new Date().toISOString(), by: who(), kind: 'reopen', note }] };
  delete out.folio_id;
  delete out.settled_at;
  ordersDb.put(out);
  return out;
}

/** D10: a house folio (non-staying company / walk-in credit account), billed through B3 at the restaurant rate. */
export function openHouseFolio(payer: { client_id: string; name: string }, day: string = hotelDb.settings().business_date): Folio {
  const f: Folio = { id: generateId(), name: `House · ${payer.name}`, house: true, window: 1, payer: { kind: 'client', ...payer }, opened_on: day, lines: [], status: 'open' };
  hotelDb.putFolios(f);
  return f;
}

/** Folios of one stay (room line), by window. */
export const stayFolios = (folios: readonly Folio[], resId: string, lineId?: string): Folio[] =>
  folios.filter((f) => f.reservation_id === resId && (!lineId || f.line_id === lineId)).sort((a, b) => a.window - b.window);

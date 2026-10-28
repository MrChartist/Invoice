/**
 * R7-A6 nightly room post (pure) and the minimal folio contract R7-B builds on.
 *
 * A folio is a running account, not a tax document (no GST, no tax-series number). Check-in opens window 1 (the guest)
 * and, when the booking is billed to a company, window 2 (the company: room-type charges route there, D-B1.2). The
 * night audit adds, per in-house room line and night, from the booking's snapshot: the room (meal share noted as
 * information on composite plans, D5), extra bed, extra person, and — for a plan whose meals are priced separately —
 * one `fnb` meal line. Every line carries the key `stay:<line id>:<night>[:part]`; a night whose key is already on any
 * folio is skipped, so a re-run or a catch-up never posts twice. Complimentary / house-use lines post nothing (D14).
 */
import type { Folio, FolioLine, FolioLineKind, NightPrice, RatePlan, Reservation, RoomLine } from '../../types/hotel-r7';
import { generateId } from '../storage';
import { round2 } from '../invoice-calc';

/** Kinds that are accommodation (room revenue, ADR / RevPAR). */
export const ROOM_KINDS: ReadonlySet<FolioLineKind> = new Set(['room', 'extra_bed', 'extra_person', 'meal_plan']);
/** Kinds a company pays by default (window 2) when the booking has a bill-to. */
const COMPANY_KINDS: ReadonlySet<FolioLineKind> = ROOM_KINDS;

export const folioName = (res: Pick<Reservation, 'number'>, window: number): string => `${res.number} · W${window}`;

/** Window of a charge kind: the booking's routing rules, else company kinds → 2 when billed to a company, else 1. */
export function windowFor(res: Pick<Reservation, 'routing' | 'bill_to'>, kind: FolioLineKind): number {
  const rule = (res.routing ?? []).find((r) => r.kinds.includes(kind));
  if (rule) return rule.window;
  return res.bill_to && COMPANY_KINDS.has(kind) ? 2 : 1;
}

export function newFolio(res: Pick<Reservation, 'id' | 'number' | 'guest' | 'bill_to'>, line: Pick<RoomLine, 'id'> | null, window: number, day: string): Folio {
  const company = window === 2 && res.bill_to;
  return {
    id: generateId(), name: folioName(res, window), reservation_id: res.id, ...(line ? { line_id: line.id } : {}), window,
    payer: company ? { kind: 'client', client_id: res.bill_to!.client_id, name: res.bill_to!.name } : { kind: 'guest', name: res.guest.name },
    opened_on: day, lines: [], status: 'open',
  };
}

/** The folio of (booking, room line, window), if open. */
export const folioOf = (folios: readonly Folio[], resId: string, lineId: string, window: number): Folio | undefined =>
  folios.find((f) => f.reservation_id === resId && f.line_id === lineId && f.window === window && f.status === 'open');

/** Folios a check-in opens (window 1, and 2 when billed to a company) that do not exist yet. */
export function openFolios(res: Reservation, line: RoomLine, day: string, existing: readonly Folio[]): Folio[] {
  const windows = res.bill_to ? [1, 2] : [1];
  return windows.filter((w) => !folioOf(existing, res.id, line.id, w)).map((w) => newFolio(res, line, w, day));
}

const live = (l: FolioLine) => !l.void;
export const folioTotal = (f: Pick<Folio, 'lines'>): number => round2(f.lines.filter(live).reduce((s, l) => s + l.amount, 0));
export const folioBalance = (f: Pick<Folio, 'lines' | 'applied'>): number => round2(folioTotal(f) - (f.applied ?? []).reduce((s, a) => s + a.amount, 0));

export const stayKey = (lineId: string, night: string) => `stay:${lineId}:${night}`;
export const isPosted = (folios: readonly Folio[], lineId: string, night: string): boolean => {
  const k = stayKey(lineId, night);
  return folios.some((f) => f.lines.some((l) => !!l.key && (l.key === k || l.key.startsWith(`${k}:`))));
};

export interface PostCtx {
  roomNo: string;
  typeName: string;
  plan?: Pick<RatePlan, 'code' | 'meal_plan' | 'meals_separate'>;
  sacRoom: string;
  sacFnb: string;
}

/**
 * Folio lines (with keys) for one night of a room line, from its snapshot. Pure. A plan whose meals are priced
 * separately posts the room at its rate less the meal share and the meal as an `fnb` line, so the night still totals
 * the snapshot's `total` (QA9 H3: the meal is inside the plan rate, as `pricing.ts` and `premises.ts` read it). A
 * tax-inclusive night's accommodation lines carry their share of the agreed `gross` (QA9 H2).
 */
export function nightLines(line: Pick<RoomLine, 'id' | 'comp'>, price: NightPrice | undefined, night: string, ctx: PostCtx): Omit<FolioLine, 'id'>[] {
  if (!price || line.comp) return [];
  const key = stayKey(line.id, night);
  const base = { date: night, qty: 1, room_no: ctx.roomNo, src: { night, line_id: line.id } };
  const out: Omit<FolioLine, 'id'>[] = [];
  const add = (kind: FolioLineKind, part: string, desc: string, amount: number, sac: string, meal?: number) => {
    if (amount > 0) out.push({ ...base, key: part ? `${key}:${part}` : key, kind, desc, rate: round2(amount), amount: round2(amount), sac, ...(meal ? { meal } : {}) });
  };
  const separate = !!ctx.plan?.meals_separate;
  const meal = separate ? Math.min(Math.max(price.meal, 0), price.room) : 0;
  add('room', '', `Room ${ctx.roomNo} · ${ctx.typeName}${ctx.plan ? ` · ${ctx.plan.meal_plan}` : ''}`, round2(price.room - meal), ctx.sacRoom, separate ? 0 : price.meal);
  add('extra_bed', 'bed', `Extra bed · Room ${ctx.roomNo}`, price.extra_bed, ctx.sacRoom);
  add('extra_person', 'person', `Extra person · Room ${ctx.roomNo}`, round2(price.extra_adult + price.extra_child), ctx.sacRoom);
  if (price.gross && price.total > 0 && out.length) {
    const g = round2(price.gross * (1 - meal / price.total));
    for (const l of out) l.gross = round2((l.amount * price.gross) / price.total);
    out[0].gross = round2(out[0].gross! + g - out.reduce((s, l) => s + l.gross!, 0));
  }
  if (meal > 0) add('fnb', 'meal', `${ctx.plan!.meal_plan} meals · Room ${ctx.roomNo}`, meal, ctx.sacFnb);
  return out;
}

/** QA9 H1: nights of a room line before `end` (and its departure) that no folio holds yet (complimentary: none). */
export function pendingNights(res: Pick<Reservation, 'arrival' | 'departure'>, line: Pick<RoomLine, 'id' | 'comp' | 'arrival' | 'departure' | 'nightly'>, folios: readonly Folio[], end: string): string[] {
  if (line.comp) return [];
  const dep = line.departure || res.departure;
  return line.nightly.map((n) => n.night).filter((n) => n >= (line.arrival || res.arrival) && n < dep && n < end && !isPosted(folios, line.id, n));
}

/**
 * Post one night of a room line into its folios (routing by kind). Returns the folios that changed (new or with new
 * lines) and the keys posted; nothing when the night is already posted. Pure: the caller saves.
 */
export function postNight(res: Reservation, line: RoomLine, night: string, folios: readonly Folio[], ctx: PostCtx): { changed: Folio[]; keys: string[] } {
  if (isPosted(folios, line.id, night)) return { changed: [], keys: [] };
  const drafts = nightLines(line, line.nightly.find((x) => x.night === night), night, ctx);
  const changed = new Map<string, Folio>();
  for (const d of drafts) {
    const w = windowFor(res, d.kind);
    const f = changed.get(`w${w}`) ?? folioOf(folios, res.id, line.id, w) ?? newFolio(res, line, w, night);
    changed.set(`w${w}`, { ...f, lines: [...f.lines, { ...d, id: generateId() }] });
  }
  return { changed: [...changed.values()], keys: drafts.map((d) => d.key!) };
}

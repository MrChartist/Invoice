/**
 * R7-B3 check-out / interim invoice builder (pure). One folio window → one ordinary `InvoiceRecord` draft for the
 * existing engine (GSTR-1 / 3B, e-invoice, receivables, books, Tally and the recycle bin see it unchanged).
 *
 *  - Client = the window's payer (guest: B2C unless a GSTIN is given; or the company / agent client).
 *  - Place of supply = the property's state (IGST Sec 12(3)(b), F6): CGST + SGST for every guest, out-of-state company
 *    and foreign guest included.
 *  - Room-type lines (room, extra bed / person, meal plan; cancellation / no-show at the band of the night they
 *    replace, D13) are banded per unit-night: value = room + extras + composite meal share after the night's linked
 *    allowances, before GST (F3, F7, D2), `accommodationBand(value, invoice date)` — D6: the rate in force on the
 *    invoice date; nights under another rule row raise the "rate changed" chip. Grouped per room × rate × band, SAC
 *    996311. F&B at the restaurant rate (specified premises, C1 rule rows), SAC 996331. Other kinds at their own rate.
 *  - Night-wise detail → the R3-B4 annexure (printed on A4 only). `stay`, `folio_id`, `reservation_id`, `hotel_band`
 *    are snapshotted (Critical Rule 3: the sender profile is the snapshot `makeDraft` takes).
 *  - Unregistered or composition hotel → Bill of Supply (no tax); an unregistered hotel's OTA stay → `PAY_9_5`, tax 0.
 * Working paper — verify with your CA.
 */
import type { Client, InvoiceItem, InvoiceRecord, SenderProfile } from '../../types/invoice';
import type { Folio, FolioLine, HotelSettings, Reservation } from '../../types/hotel-r7';
import type { AnnexureRow } from '../../types/service-r3';
import type { AppSettings } from '../localDb';
import { makeDraft, senderStateCode } from '../../store/invoice-defaults';
import { withTotals } from '../pos';
import { round2 } from '../invoice-calc';
import { generateId } from '../storage';
import { shiftDay } from '../dates';
import { ACCOMMODATION_RATE_RULES, HOTEL_RESTAURANT_RATE_RULES, SPECIFIED_PREMISES_RULES, accommodationBand, ruleAt } from './hotel-rules';
import { NOTE_9_5, isRegistered } from './ota';
import { nextDay } from './business-date';

/** Kinds banded as accommodation (D2, D13). */
export const NIGHT_KINDS = new Set(['room', 'extra_bed', 'extra_person', 'meal_plan', 'cancellation', 'no_show']);
const live = (l: FolioLine) => !l.void;

/** Lines a window still has to bill: live, not invoiced, dated on / before `upTo`. */
export const billable = (f: Pick<Folio, 'lines'>, upTo?: string): FolioLine[] =>
  f.lines.filter((l) => live(l) && !l.src?.invoice_id && (!upTo || l.date <= upTo));

const fyStart = (day: string) => (Number(day.slice(5, 7)) >= 4 ? Number(day.slice(0, 4)) : Number(day.slice(0, 4)) - 1);
const startOf = (key: string) => Number(/\d{4}/.exec(key)?.[0] ?? 0);

/** Highest unit-night value posted in the FY starting `fy` (folios; cancellation charges excluded). */
export function fyMaxNight(folios: readonly Folio[], fy: number): number {
  const by = new Map<string, number>();
  for (const f of folios) for (const l of f.lines) {
    if (!live(l) || !NIGHT_KINDS.has(l.kind) || l.kind === 'cancellation' || l.kind === 'no_show' || !l.src?.night || fyStart(l.src.night) !== fy) continue;
    const k = `${l.src.line_id}|${l.src.night}`;
    by.set(k, (by.get(k) ?? 0) + l.amount);
  }
  return Math.max(0, ...[...by.values()].map(round2));
}

/**
 * Specified premises for the FY of `day` (minimal C1 reading until the GST desk lands `premisesStatus`): clause (a)
 * previous-FY unit-night value above the threshold (typed figure or the folios), else the latest opt-in / opt-out
 * declaration in force (an opt-out never undoes clause (a), D4). Before 1 Apr 2025: not specified.
 */
export function isSpecified(day: string, hs: Pick<HotelSettings, 'premises' | 'prev_fy_max_value'>, prevMax = 0): boolean {
  const rule = ruleAt(SPECIFIED_PREMISES_RULES, day);
  if (!rule) return false;
  const fy = fyStart(day);
  const typed = Object.entries(hs.prev_fy_max_value ?? {}).filter(([k]) => startOf(k) === fy - 1).reduce((m, [, v]) => Math.max(m, Number(v) || 0), 0);
  if (Math.max(typed, prevMax) > rule.threshold) return true;
  const decl = (hs.premises ?? []).filter((d) => startOf(d.fy) <= fy).sort((a, b) => startOf(a.fy) - startOf(b.fy) || a.filed_on.localeCompare(b.filed_on)).pop();
  return !!decl && decl.kind !== 'opt_out';
}

/** F&B rate on `day` (C1 rule rows): 18% in specified premises, else 5%. */
export const fnbRate = (day: string, specified: boolean): number => {
  const r = ruleAt(HOTEL_RESTAURANT_RATE_RULES, day);
  return (specified ? r.specified : r.other).rate;
};

/** `from` of the accommodation rule row in force on `day`. */
const ruleFrom = (day: string) => ACCOMMODATION_RATE_RULES.filter((v) => v.from <= day).pop()?.from ?? '';

/**
 * D7: interim invoice dates of a stay — every `days` nights from arrival, and 31 March when `yearEnd` — strictly
 * after arrival and before departure.
 */
export function interimDates(arrival: string, departure: string, days: number, yearEnd: boolean): string[] {
  const out = new Set<string>();
  if (days > 0) for (let d = shiftDay(arrival, days); d < departure; d = shiftDay(d, days)) out.add(d);
  if (yearEnd) for (let y = Number(arrival.slice(0, 4)); y <= Number(departure.slice(0, 4)); y++) {
    const d = `${y}-03-31`;
    if (d > arrival && d < departure) out.add(d);
  }
  return [...out].sort();
}

export interface CheckoutCtx {
  /** Invoice date (the business date). */
  day: string;
  settings: AppSettings;
  sender: SenderProfile | null;
  templateId?: string;
  client: Client;
  hs: Pick<HotelSettings, 'sac_room' | 'sac_fnb'>;
  /** F&B rate (`fnbRate`). */
  fnb: number;
  res?: Reservation;
  /** Room numbers of the stay (snapshot). */
  rooms?: string[];
  /** Extra record fields: OTA tags, TDS, due date, notes. */
  extra?: Partial<InvoiceRecord>;
}

export interface CheckoutDraft {
  record: InvoiceRecord;
  band?: 'low' | 'high' | 'mixed';
  /** D6 chip: nights under an older rule row, taxed at the invoice date's rate. */
  rateChange?: { from: string; nights: number };
  /** Folio line ids this invoice bills. */
  lineIds: string[];
}

const dm = (d: string) => `${Number(d.slice(8))}/${Number(d.slice(5, 7))}`;

/** One window's invoice draft (unsaved, unnumbered). `lines` default to the window's billable lines. */
export function buildCheckoutInvoice(folio: Folio, ctx: CheckoutCtx, lines: FolioLine[] = billable(folio)): CheckoutDraft {
  const { sender, day } = ctx;
  const home = senderStateCode(sender);
  const draft = makeDraft({ settings: ctx.settings, sender, templateId: ctx.templateId });
  const nine5 = ctx.extra?.eco_section === 'PAY_9_5';
  const bos = draft.doc_type === 'BILL_OF_SUPPLY' || (!isRegistered(sender) && !nine5);
  const untaxed = bos || nine5 || !isRegistered(sender);
  // Unit-nights: room-type lines (and allowances linked to a night) keyed by room line × night.
  const nights = new Map<string, FolioLine[]>();
  let discount = 0;
  for (const l of lines) {
    const linked = l.src?.line_id && l.src?.night;
    if (NIGHT_KINDS.has(l.kind) || (l.kind === 'allowance' && linked)) {
      const k = l.band_value ? l.id : linked ? `${l.src!.line_id}|${l.src!.night}` : l.id;
      nights.set(k, [...(nights.get(k) ?? []), l]);
    } else if (l.kind === 'allowance') discount = round2(discount - l.amount);
  }
  const groups = new Map<string, { item: InvoiceItem; dates: string[] }>();
  const add = (l: FolioLine, amount: number, rate: number, sac: string) => {
    const unit = round2(amount / (l.qty || 1));
    const key = [l.kind, l.room_no, l.desc, unit, rate, sac].join('|');
    const g = groups.get(key);
    if (g) {
      g.item.quantity = round2(g.item.quantity + (l.qty || 1));
      g.dates.push(l.src?.night ?? l.date);
    } else groups.set(key, { item: { id: generateId(), name: l.desc, description: '', type: 'Service', hsn: sac, unit: 'NOS', quantity: l.qty || 1, rate: unit, tax_rate: untaxed ? 0 : rate, discount_percent: 0, amount: 0 }, dates: [l.src?.night ?? l.date] });
  };
  const bands = new Set<'low' | 'high'>();
  const annexure: AnnexureRow[] = [];
  let changed = 0;
  for (const group of nights.values()) {
    const base = group.filter((l) => l.kind !== 'allowance');
    const allow = round2(group.filter((l) => l.kind === 'allowance').reduce((s, l) => s + l.amount, 0));
    const value = round2(group[0].band_value ?? group.reduce((s, l) => s + l.amount, 0));
    const b = accommodationBand(value, day);
    bands.add(b.band);
    const night = group[0].src?.night ?? group[0].date;
    if (ruleFrom(night) !== ruleFrom(day)) changed++;
    base.forEach((l, i) => {
      const amt = i === 0 ? round2(l.amount + allow) : l.amount; // linked allowance folds into the night's first line
      if (amt > 0) add(l, amt, b.exempt ? 0 : b.rate, l.sac || ctx.hs.sac_room);
      annexure.push({ date: night, who: l.room_no, description: `${l.kind.replace('_', ' ')} · ${l.desc}`, minutes: 0, billed_minutes: 0, rate: amt, amount: amt });
    });
  }
  for (const l of lines) {
    if (NIGHT_KINDS.has(l.kind) || l.kind === 'allowance') continue;
    add(l, l.amount, l.kind === 'fnb' ? ctx.fnb : l.tax_rate ?? ctx.settings.defaultTaxRate, l.sac || (l.kind === 'fnb' ? ctx.hs.sac_fnb : ''));
  }
  const items = [...groups.values()].map(({ item, dates }) => {
    const s = [...dates].sort();
    return { ...item, description: s.length > 1 || item.hsn === ctx.hs.sac_room ? `${s.length} × (${dm(s[0])}–${dm(nextDay(s[s.length - 1]))})` : '', amount: round2(item.quantity * item.rate) };
  });
  const band = bands.size === 2 ? 'mixed' : bands.has('high') ? 'high' : bands.has('low') ? 'low' : undefined;
  const res = ctx.res;
  const nightSet = new Set(lines.filter((l) => NIGHT_KINDS.has(l.kind) && l.src?.night).map((l) => l.src!.night!));
  const record = withTotals({
    ...draft,
    ...ctx.extra,
    doc_type: bos ? 'BILL_OF_SUPPLY' : draft.doc_type,
    issue_date: day,
    due_date: ctx.extra?.due_date ?? day,
    client: ctx.client,
    items,
    place_of_supply: home,
    gst_mode: untaxed ? 'NONE' : 'CGST_SGST',
    discount_type: 'AMOUNT',
    discount_rate: Math.max(discount, 0),
    folio_id: folio.id,
    ...(res ? { reservation_id: res.id, stay: { arrival: res.arrival, departure: res.departure, rooms: ctx.rooms ?? [], nights: nightSet.size, adults: res.lines.reduce((s, l) => s + l.adults, 0), children: res.lines.reduce((s, l) => s + l.children, 0) } } : {}),
    ...(band ? { hotel_band: band } : {}),
    ...(annexure.length ? { annexure: { kind: 'timesheet' as const, rows: annexure.sort((a, b) => a.date.localeCompare(b.date)) } } : {}),
    notes: [ctx.extra?.notes, nine5 ? NOTE_9_5 : '', res ? `${folio.name} · ${res.arrival} → ${res.departure}` : folio.name].filter(Boolean).join('\n'),
  });
  return { record, band, lineIds: lines.map((l) => l.id), ...(changed ? { rateChange: { from: ruleFrom(day), nights: changed } } : {}) };
}

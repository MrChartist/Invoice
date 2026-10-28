/**
 * R15-C1 air-ticket value (pure): the fare of a ticket (basic + taxes + the airline's GST — the airline's supply,
 * recovered at actual as a pure agent, never our output tax), the Rule 32(3) deemed value of the agent's service
 * (5 % of the basic fare domestic / 10 % international, by date) and the document lines: one pure-agent fare line per
 * ticket (`charge_head_id: 'rule33'`, so GSTR-1 / HSN / e-Invoice leave it out — `OthChrg`) with its particulars in
 * `tv.lines[lineId].tkt`, plus ONE service line (deemed value or the actual fee) at the rule's SAC and rate. Adding
 * tickets again replaces the service line (`tv.air.line_id`). Working papers — verify with your CA (TV11, TV12).
 */
import type { InvoiceItem } from '../../types/invoice';
import type { TvSnapshot, TvTicket } from '../../types/travel-r15';
import { ruleAt } from '../tax-rules';
import { round2 } from '../invoice-calc';
import { generateId } from '../storage';
import { PURE_AGENT_CHARGE } from '../trade/pure-agent';
import { AIR_AGENT_VALUE_RULES, AIR_FARE_GST_RULES, AIR_SAC_RULES } from '../travel-rules';

const n = (x: unknown) => Number(x) || 0;
export type AirMethod = 'deemed' | 'actual';

/** What the client pays for the ticket itself: basic + taxes + the airline's GST. */
export const fareOf = (t: TvTicket): number => round2(n(t.basic) + n(t.taxes) + n(t.airline_gst));

/** The airline's GST on the basic fare by class and date — a suggestion when the ticket does not show it (TV12). */
export const airlineGst = (t: TvTicket, date?: string): number => round2((n(t.basic) * ruleAt(AIR_FARE_GST_RULES, date)[t.class === 'other' ? 'other' : 'economy']) / 100);

/** Rule 32(3): 5 % (domestic) / 10 % (international) of each ticket's basic fare, summed. */
export function deemedValue(tickets: readonly TvTicket[], date?: string): number {
  const r = ruleAt(AIR_AGENT_VALUE_RULES, date);
  return round2(tickets.reduce((s, t) => s + (n(t.basic) * (t.intl ? r.intl : r.domestic)) / 100, 0));
}

/** Problems with a ticket ('' = fine). The ticket number is 13 digits when given (checksum not enforced). */
export function validateTicket(t: TvTicket): string {
  if (!(n(t.basic) > 0)) return 'Enter the basic fare of every ticket.';
  if (n(t.taxes) < 0 || n(t.airline_gst) < 0) return 'Taxes cannot be negative.';
  if (t.ticket_no && !/^\d{13}$/.test(t.ticket_no.replace(/[\s-]/g, ''))) return `Ticket no. ${t.ticket_no}: 13 digits.`;
  return '';
}

const clean = (t: TvTicket): TvTicket => {
  const out: TvTicket = { class: t.class === 'other' ? 'other' : 'economy', basic: round2(n(t.basic)), taxes: round2(n(t.taxes)), airline_gst: round2(n(t.airline_gst)) };
  for (const k of ['pax', 'airline', 'pnr', 'sector'] as const) if (t[k]?.trim()) out[k] = t[k]!.trim();
  if (t.ticket_no?.trim()) out.ticket_no = t.ticket_no.replace(/[\s-]/g, '');
  if (t.intl) out.intl = true;
  return out;
};

const svcLine = (name: string, hsn: string, rate: number, tax: number): InvoiceItem => ({ id: generateId(), name, type: 'Service', hsn, unit: 'NOS', quantity: 1, rate, amount: rate, tax_rate: tax, discount_percent: 0 });

/**
 * Add `add` to a document's lines: a pure-agent fare line each, then the one service line re-made over every ticket
 * still on the document. `fee` is the agency's own fee to the client (all tickets). `warn`: the fee is above the
 * deemed value (the deemed value is kept — check with your CA, TV11).
 */
export function mergeTickets(items: readonly InvoiceItem[], tv: TvSnapshot | undefined, add: readonly TvTicket[], o: { method: AirMethod; fee: number; date?: string }): { items: InvoiceItem[]; tv: TvSnapshot; warn: boolean; fareIds: string[] } {
  const lines = { ...(tv?.lines ?? {}) };
  const fares = add.map((raw) => {
    const t = clean(raw);
    const l = { ...svcLine(`Air ticket${t.sector ? ` — ${t.sector}` : ''}`, '', fareOf(t), 0), description: PURE_AGENT_CHARGE, charge_head_id: 'rule33' };
    delete l.hsn;
    lines[l.id] = { tkt: t };
    return l;
  });
  const all = [...items.filter((l) => l.id !== tv?.air?.line_id), ...fares];
  const ids = new Set(all.map((l) => l.id));
  for (const id of Object.keys(lines)) if (!ids.has(id)) delete lines[id];
  const tickets = Object.values(lines).map((v) => v.tkt).filter((t): t is TvTicket => !!t);
  const fee = round2(n(o.fee));
  const sac = ruleAt(AIR_SAC_RULES, o.date);
  const value = o.method === 'deemed' ? deemedValue(tickets, o.date) : fee;
  const svc = value > 0 ? svcLine(o.method === 'deemed' ? 'Air travel agent service — value under Rule 32(3)' : 'Service fee — air tickets', sac.air, value, sac.rate) : null;
  const r = ruleAt(AIR_AGENT_VALUE_RULES, o.date);
  const basic = round2(tickets.reduce((s, t) => s + n(t.basic), 0));
  const note = o.method === 'deemed' ? `Agent's service valued under Rule 32(3) at ${r.domestic} % / ${r.intl} % (domestic / international) of basic fare ₹${basic.toFixed(2)} = ₹${value.toFixed(2)}; fares at actual as pure agent. Verify with your CA.` : '';
  return {
    items: svc ? [...all, svc] : all,
    tv: { ...tv, lines, air: { method: o.method, fee, value, ...(svc ? { line_id: svc.id } : {}), ...(note ? { note } : {}) } },
    warn: o.method === 'deemed' && fee > value + 0.005,
    fareIds: fares.map((l) => l.id),
  };
}

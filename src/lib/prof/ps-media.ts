/**
 * R14 PS-B5 media and digital agencies: media bought for a client and re-billed (pure). A media bill carries
 * `PurchaseRecord.ps.media = { client_id, engagement_id?, ro_no?, medium, insert_from?, insert_to?, mode, commission_pct? }`.
 *  - `principal` (space bought in our name and resold — the default): the cost is part of our taxable supply, at our
 *    service rate unless the user picks the media class, plus the agency fee;
 *  - `agent` (the client contracts with the media / platform, Rule 33 conditions met): a pure-agent line (the B1 key)
 *    plus our fee line on the cost.
 * Media commission from a publisher is our service to the publisher (an ordinary invoice). TDS by the client on our bill
 * defaults to 194C (Circular 715); the 6 % equalisation levy ended on 1 Apr 2025 (help note). Bills are read through
 * `readPurchase` (tests/purchase-contract.test.ts). Working paper — verify with your CA (PS12, PS18, PS38).
 */
import type { InvoiceItem } from '../../types/invoice';
import { num, round2 } from '../invoice-calc';
import { ruleAt } from '../tax-rules';
import { isVoidStatus, readPurchase } from '../purchase-normalize';
import { PURE_AGENT_CHARGE } from '../trade/pure-agent';
import { MEDIA_RULES } from './ps-b-rules';

export type Medium = 'print' | 'tv' | 'radio' | 'outdoor' | 'digital' | 'other';
export const MEDIUMS: readonly Medium[] = ['print', 'tv', 'radio', 'outdoor', 'digital', 'other'];

export interface MediaBuy {
  client_id: string;
  engagement_id?: string;
  ro_no?: string;
  medium: Medium;
  /** Publication / channel / platform and the client's reference (release order). */
  publication?: string;
  client_ref?: string;
  insert_from?: string;
  insert_to?: string;
  mode: 'principal' | 'agent';
  commission_pct?: number;
}
export const mediaOf = (row: unknown): MediaBuy | undefined => ((row as { ps?: { media?: MediaBuy } } | null)?.ps?.media);

export interface MediaRow {
  id: string;
  date: string;
  vendor: string;
  ref: string;
  media: MediaBuy;
  /** What it cost us: taxable value when the ITC is claimed, else the full amount. */
  cost: number;
  /** Amount paid to the media (pure-agent recovery). */
  total: number;
}

/** Media bills for a client not yet re-billed (`billed(id)` says whether a live invoice bills it). */
export function unbilledMedia(purchases: readonly unknown[], clientId: string, billed: (id: string) => boolean): MediaRow[] {
  const out: MediaRow[] = [];
  for (const raw of purchases) {
    const m = mediaOf(raw);
    const id = (raw as { id?: string })?.id;
    if (!m || !id || m.client_id !== clientId || billed(id)) continue;
    const p = readPurchase(raw);
    if (!p || isVoidStatus(p.status)) continue;
    out.push({ id, date: p.date, vendor: p.partyName, ref: p.number, media: m, cost: round2(p.itcEligible ? p.taxable : p.total), total: round2(p.total) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export interface MediaBillPrefs {
  /** Agency fee / markup % on the media cost. */
  fee_pct: number;
  /** Our service SAC and GST rate. */
  sac: string;
  gst_rate: number;
  /** Principal mode only: bill the media at its own class (e.g. print space 5 %) instead of our service rate. */
  media_rate?: number;
  media_hsn?: string;
}

type Line = Omit<InvoiceItem, 'id' | 'amount' | 'type'> & { charge_head_id?: string };
const label = (r: MediaRow) => `${r.media.publication || r.vendor} — ${r.media.medium}${r.media.ro_no ? ` (RO ${r.media.ro_no})` : ''}`;

/** Invoice lines for media rows (principal: cost at the chosen rate + fee; agent: pure-agent recovery + fee). */
export function mediaLines(rows: readonly MediaRow[], prefs: MediaBillPrefs): Line[] {
  const out: Line[] = [];
  const fee = Math.max(num(prefs.fee_pct), 0);
  for (const r of rows) {
    if (r.media.mode === 'agent') {
      out.push({ name: `Media at actual — ${label(r)}`, description: PURE_AGENT_CHARGE, charge_head_id: 'rule33', unit: 'NOS', quantity: 1, rate: r.total, tax_rate: 0, discount_percent: 0, bill_refs: [r.id] });
    } else {
      const own = prefs.media_rate !== undefined;
      out.push({ name: `Media — ${label(r)}`, hsn: own ? prefs.media_hsn ?? prefs.sac : prefs.sac, unit: 'NOS', quantity: 1, rate: r.cost, tax_rate: own ? num(prefs.media_rate) : num(prefs.gst_rate), discount_percent: 0, bill_refs: [r.id] });
    }
    if (fee > 0) out.push({ name: `Agency service fee ${fee}% — ${label(r)}`, hsn: prefs.sac, unit: 'NOS', quantity: 1, rate: round2((r.cost * fee) / 100), tax_rate: num(prefs.gst_rate), discount_percent: 0 });
  }
  return out;
}

/** Pre-bill grouping: media rows by medium. */
export function byMedium(rows: readonly MediaRow[]): { medium: Medium; rows: MediaRow[]; cost: number }[] {
  return MEDIUMS.map((medium) => {
    const mine = rows.filter((r) => r.media.medium === medium);
    return { medium, rows: mine, cost: round2(mine.reduce((s, r) => s + r.cost, 0)) };
  }).filter((g) => g.rows.length);
}

/** Commission a publisher pays us: billed as our service to the publisher (an ordinary invoice line). */
export function commissionLine(publication: string, grossSpace: number, pct: number, prefs: Pick<MediaBillPrefs, 'sac' | 'gst_rate'>): Line {
  return { name: `Media commission ${num(pct)}% — ${publication}`, hsn: prefs.sac, unit: 'NOS', quantity: 1, rate: round2((num(grossSpace) * num(pct)) / 100), tax_rate: num(prefs.gst_rate), discount_percent: 0 };
}

/** TDS a client deducts on an advertising agency's bill (194C, Circular 715) and whether the 6 % levy still applies. */
export const mediaTds = (date: string): { section: string; levy: boolean } => {
  const r = ruleAt(MEDIA_RULES, date);
  return { section: r.client_tds, levy: r.levy };
};

/** The media schedule printed on the annexure (A5). */
export const mediaSchedule = (rows: readonly MediaRow[]) => rows.map((r) => ({ date: r.date, medium: r.media.medium, publication: r.media.publication || r.vendor, slots: [r.media.insert_from, r.media.insert_to].filter(Boolean).join(' – '), cost: r.cost, mode: r.media.mode }));

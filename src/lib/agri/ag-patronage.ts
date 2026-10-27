/**
 * AG-D5 patronage register: per member and FY, the value and quantity the member supplied (pooled cycle lines of
 * `farmer_cycles` and the member's own purchase vouchers, read through `readPurchase`) and bought (sales to the member's
 * client side). It is the basis for a patronage bonus / price difference (AG-A4 7, AG25) and for the members vs
 * non-members split of the co-operative working paper (AG16). Year-end distribution paper (drafts only): profit after
 * tax → statutory reserve (State Act %, typed), limited dividend on paid-up capital (typed %, capped), patronage bonus by
 * business, retained; it posts an OPTIONAL (draft) appropriation journal for the accountant — never automatic. Pure
 * above "Storage".
 */
import './ag-registry';
import type { InvoiceRecord } from '../../types/invoice';
import { num, round2 } from '../invoice-calc';
import { isRevenueDoc } from '../stats';
import { requireAccess } from '../access';
import { isVoidStatus, readPurchase, readPurchaseLines } from '../purchase-normalize';
import { A } from '../ledger/accounts';
import { saveVoucher, type ManualVoucher } from '../ledger/vouchers';
import { ensureLedger } from '../trade/tr-ledger';
import type { Member } from './ag-members';

export interface PatronageRow { member: Member; suppliedQty: number; suppliedValue: number; boughtValue: number; business: number; share: number }

/** FY (`2026` = 1 Apr 2026 – 31 Mar 2027) as a day range. */
export const fyRange = (fyStartYear: number) => ({ from: `${fyStartYear}-04-01`, to: `${fyStartYear + 1}-03-31` });
export const fyOf = (day: string) => (+day.slice(5, 7) >= 4 ? +day.slice(0, 4) : +day.slice(0, 4) - 1);

/**
 * Pure: the register for the FY. `farmerIds` marks every farmer vendor (member or not) so the non-member supplies are
 * known; cycles are read by their period end.
 */
export function patronage(fyStartYear: number, d: { members: readonly Member[]; cycles: readonly unknown[]; purchases: readonly unknown[]; invoices: readonly InvoiceRecord[]; farmerIds: ReadonlySet<string> }): { rows: PatronageRow[]; members: number; nonMembers: number; memberPct: number } {
  const { from, to } = fyRange(fyStartYear);
  const sup = new Map<string, { q: number; v: number }>();
  const add = (id: string, q: number, v: number) => { const r = sup.get(id) ?? { q: 0, v: 0 }; r.q += q; r.v += v; sup.set(id, r); };
  for (const c of d.cycles as { status?: string; period_to?: string; lines?: { farmer_id?: string; qty?: number; amount?: number }[] }[]) {
    if (!c || c.status === 'draft' || !c.period_to || c.period_to < from || c.period_to > to) continue;
    for (const l of c.lines ?? []) if (l.farmer_id) add(l.farmer_id, num(l.qty), num(l.amount));
  }
  for (const raw of d.purchases) {
    const p = readPurchase(raw);
    const vid = String((raw as { vendor_id?: string }).vendor_id ?? '');
    if (!p || p.isExpense || isVoidStatus(p.status) || !vid || p.date < from || p.date > to || (raw as { ag?: { cycle?: unknown } }).ag?.cycle) continue;
    add(vid, readPurchaseLines(raw).reduce((s, l) => s + l.quantity, 0), p.taxable);
  }
  const bought = new Map<string, number>();
  for (const i of d.invoices) if (isRevenueDoc(i) && i.client?.id && i.issue_date >= from && i.issue_date <= to) bought.set(i.client.id, (bought.get(i.client.id) ?? 0) + num(i.taxable_value ?? i.subtotal));
  const ids = (m: Member) => [m.id, m.other_id].filter(Boolean) as string[];
  const base = d.members.map((m) => {
    const s = ids(m).reduce((acc, id) => ({ q: acc.q + (sup.get(id)?.q ?? 0), v: acc.v + (sup.get(id)?.v ?? 0) }), { q: 0, v: 0 });
    const b = ids(m).reduce((t, id) => t + (bought.get(id) ?? 0), 0);
    return { member: m, suppliedQty: Math.round(s.q * 1000) / 1000, suppliedValue: round2(s.v), boughtValue: round2(b), business: round2(s.v + b), share: 0 };
  });
  const total = base.reduce((t, r) => t + r.business, 0);
  const rows = base.map((r) => ({ ...r, share: total > 0 ? Math.round((r.business / total) * 1e6) / 1e4 : 0 }));
  const memberIds = new Set(d.members.flatMap(ids));
  const members = round2([...sup].filter(([id]) => memberIds.has(id)).reduce((t, [, x]) => t + x.v, 0));
  const nonMembers = round2([...sup].filter(([id]) => !memberIds.has(id) && d.farmerIds.has(id)).reduce((t, [, x]) => t + x.v, 0));
  return { rows, members, nonMembers, memberPct: members + nonMembers > 0 ? round2((members / (members + nonMembers)) * 100) : 0 };
}

export interface Distribution { pat: number; reserve: number; dividend: number; patronage: number; retained: number; bonus: { member: Member; amount: number }[] }

/**
 * Pure: the year-end distribution of profit after tax. Reserve first (typed %), then dividend = min(typed %, cap %) of
 * paid-up capital (never more than what is left), then the patronage pool (typed, never more than what is left) split
 * by each member's business; the rest is retained.
 */
export function distribution(i: { pat: number; reservePct: number; dividendPct: number; dividendCapPct?: number; paidUp: number; patronagePool: number; rows: readonly PatronageRow[] }): Distribution {
  const pat = round2(Math.max(num(i.pat), 0));
  const reserve = round2((pat * Math.max(num(i.reservePct), 0)) / 100);
  let left = round2(pat - reserve);
  const pct = num(i.dividendCapPct) > 0 ? Math.min(num(i.dividendPct), num(i.dividendCapPct)) : num(i.dividendPct);
  const dividend = round2(Math.min((num(i.paidUp) * Math.max(pct, 0)) / 100, left));
  left = round2(left - dividend);
  const pool = round2(Math.min(Math.max(num(i.patronagePool), 0), left));
  const total = i.rows.reduce((t, r) => t + r.business, 0);
  const bonus = total > 0 ? i.rows.filter((r) => r.business > 0).map((r) => ({ member: r.member, amount: round2((pool * r.business) / total) })) : [];
  const drift = round2(pool - bonus.reduce((t, b) => t + b.amount, 0));
  if (bonus.length && drift) bonus[0].amount = round2(bonus[0].amount + drift);
  return { pat, reserve, dividend, patronage: pool, retained: round2(left - pool), bonus };
}

/* ── Storage ── */

/** Post the distribution as an OPTIONAL (draft) appropriation journal: Dr surplus | Cr reserve, dividend, patronage payable. */
export function draftAppropriation(dist: Distribution, date: string): ManualVoucher {
  requireAccess('books.edit');
  const p = (n: number) => Math.round(n * 100);
  const total = round2(dist.reserve + dist.dividend + dist.patronage);
  if (!(total > 0)) throw new Error('Nothing to appropriate.');
  const cr = [
    [dist.reserve, ensureLedger('Statutory reserve', 'RESERVES', 1170)],
    [dist.dividend, ensureLedger('Dividend payable — members', 'OTHER_CL', 2470)],
    [dist.patronage, ensureLedger('Patronage bonus payable — members', 'OTHER_CL', 2480)],
  ] as const;
  return saveVoucher({
    type: 'JOURNAL', date, variant: 'OPTIONAL', voucher_class: 'Appropriation (draft)',
    narration: `Draft appropriation of profit ₹${dist.pat.toFixed(2)}: reserve, dividend, patronage bonus — for the general meeting; verify with your CA (AG18, AG25)`,
    lines: [{ account_id: A.reserves, dr: p(total), cr: 0 }, ...cr.filter(([n]) => n > 0).map(([n, id]) => ({ account_id: id, dr: 0, cr: p(n) }))],
  });
}

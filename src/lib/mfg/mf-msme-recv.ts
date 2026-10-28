/**
 * MF-D3 MSE receivables — the seller's side of MSMED Act Sec 15 / 16 (pack `shopfloor`):
 *  - shown only when our profile carries a Udyam number with category micro / small (medium enterprises are not
 *    covered);
 *  - sales to business buyers (a GSTIN on the bill) past the Sec 15 limit — the agreed due date capped at 45 days from
 *    acceptance (the invoice date stands in), else 15 days — `msme.paymentLimit`;
 *  - Sec 16 interest to date with `msme.msmedInterest` (compound, monthly rests, 3 × the RBI bank rate), on late
 *    payments already made and on the open balance — the same maths as the payables side (`msme.ts`);
 *  - "the buyer's deduction for this amount moves to the year of payment (43B(h))" as information only;
 *  - a reminder text and an interest-claim letter citing the Act (MSME Samadhaan named as text only, no portal link-up).
 * Nothing is posted: interest becomes income only when the user raises a debit note (existing flow). Receipt rows that
 * moved no cash still settle the bill (they reduce what the buyer owes), so no cash test is needed here.
 * Pure. Working paper — verify MF20 with your CA.
 */
import type { InvoiceRecord, Payment } from '../../types/invoice';
import { num, round2 } from '../invoice-calc';
import { isRevenueDoc } from '../stats';
import { receivableTotal } from '../rcm';
import { daysBetween, msmedInterest, paymentLimit } from '../msme';

/** Micro / small on our own profile (`SenderProfile.msme_category`, any case) with a Udyam number. */
export function sellerIsMse(sender: { msme_udyam?: string; msme_category?: string } | null | undefined): boolean {
  const cat = String(sender?.msme_category ?? '').trim().toUpperCase();
  return !!sender?.msme_udyam?.trim() && (cat === 'MICRO' || cat === 'SMALL');
}

export interface MseReceivable {
  id: string;
  number: string;
  buyer: string;
  gstin: string;
  date: string;
  limit: string;
  total: number;
  unpaid: number;
  daysOverdue: number;
  /** Sec 16 interest to `asOf` (late payments made + the open balance). */
  interest: number;
  /** Paid in full, but late: interest only. */
  paidLate: boolean;
}

/**
 * Sales to GSTIN buyers past the Sec 15 limit on `asOf` (open, or paid late with interest), oldest limit first. QA16 P1:
 * credit notes linked to a bill (`doc_links` relation `credit_note`, issued on or before `asOf`) settle it from their
 * date like a receipt (returned goods / rate difference are not owed — no interest on them after the note).
 */
export function mseReceivables(invoices: readonly InvoiceRecord[], payments: readonly Payment[], asOf: string, links: readonly { from_id: string; to_id: string; relation: string }[] = []): MseReceivable[] {
  const byInv = new Map<string, { amount?: unknown; date?: unknown }[]>();
  for (const p of payments) if (p?.invoice_id) byInv.set(p.invoice_id, [...(byInv.get(p.invoice_id) ?? []), p]);
  const docById = new Map(invoices.map((i) => [i.id, i]));
  const credits = new Map<string, { amount: number; date: string }[]>();
  for (const l of links) {
    const cn = l?.relation === 'credit_note' ? docById.get(l.to_id) : undefined;
    if (!cn || cn.doc_type !== 'CREDIT_NOTE' || cn.status === 'Cancelled' || cn.status === 'Draft') continue;
    credits.set(l.from_id, [...(credits.get(l.from_id) ?? []), { amount: round2(receivableTotal(cn)), date: String(cn.issue_date ?? '').slice(0, 10) }]);
  }
  const out: MseReceivable[] = [];
  for (const inv of invoices) {
    if (!isRevenueDoc(inv) || inv.doc_type === 'DEBIT_NOTE') continue;
    const gstin = String(inv.client?.gstin ?? '').trim();
    const date = String(inv.issue_date ?? '').slice(0, 10);
    if (!gstin || !date || date > asOf) continue;
    const limit = paymentLimit(date, inv.due_date ? String(inv.due_date).slice(0, 10) : undefined);
    if (asOf <= limit) continue;
    // What the buyer must pay us: the bill less reverse-charge tax and any TDS the buyer deducted (credited to us).
    const total = round2(receivableTotal(inv) - num(inv.tds_amount));
    const rows = (byInv.get(inv.id) ?? []).map((p) => ({ amount: num(p.amount), date: String(p.date).slice(0, 10) }));
    const recorded = rows.reduce((s, p) => s + p.amount, 0);
    const extra = round2(num(inv.amount_paid) - recorded);
    if (extra > 0) rows.push({ amount: extra, date });
    rows.push(...(credits.get(inv.id) ?? []));
    rows.sort((a, b) => a.date.localeCompare(b.date));
    let open = total;
    let interest = 0;
    for (const p of rows.filter((r) => r.date <= asOf)) {
      const amt = Math.min(p.amount, open);
      if (amt <= 0) continue;
      if (p.date > limit) interest += msmedInterest(amt, limit, p.date);
      open = round2(open - amt);
    }
    if (open > 0.005) interest += msmedInterest(open, limit, asOf);
    interest = round2(interest);
    if (!(open > 0.005) && !(interest > 0)) continue;
    out.push({
      id: inv.id, number: inv.invoice_number, buyer: inv.client?.name ?? '', gstin, date, limit, total,
      unpaid: Math.max(round2(open), 0), daysOverdue: Math.max(daysBetween(limit, asOf), 0), interest, paidLate: !(open > 0.005),
    });
  }
  return out.sort((a, b) => a.limit.localeCompare(b.limit) || a.date.localeCompare(b.date));
}

/** Totals by buyer (GSTIN). */
export function byBuyer(rows: readonly MseReceivable[]): { buyer: string; gstin: string; unpaid: number; interest: number; bills: MseReceivable[] }[] {
  const m = new Map<string, { buyer: string; gstin: string; unpaid: number; interest: number; bills: MseReceivable[] }>();
  for (const r of rows) {
    const g = m.get(r.gstin) ?? { buyer: r.buyer, gstin: r.gstin, unpaid: 0, interest: 0, bills: [] };
    g.unpaid = round2(g.unpaid + r.unpaid);
    g.interest = round2(g.interest + r.interest);
    g.bills.push(r);
    m.set(r.gstin, g);
  }
  return [...m.values()].sort((a, b) => b.unpaid + b.interest - (a.unpaid + a.interest));
}

const rs = (v: number) => `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const HBH_NOTE = 'Information: an amount due to a micro / small enterprise and unpaid past the Sec 15 limit is deductible for the buyer only in the year it is paid (Income-tax Sec 43B(h)).';

/** Polite reminder (WhatsApp / e-mail text) citing MSMED Sec 15 / 16; `samadhaan` adds the MSME Samadhaan sentence. */
export function reminderText(seller: { name: string; udyam: string; category: string }, buyer: string, bills: readonly MseReceivable[], asOf: string, samadhaan = false): string {
  const lines = bills.map((b) => `• ${b.number} dated ${b.date}: ${rs(b.unpaid)} due by ${b.limit}${b.interest > 0 ? ` (interest u/s 16 to ${asOf}: ${rs(b.interest)})` : ''}`);
  return [
    `Dear ${buyer},`,
    `We are a ${seller.category.toLowerCase()} enterprise (Udyam ${seller.udyam}). Under Sec 15 of the MSMED Act 2006 payment is due within the agreed period, not beyond 45 days of acceptance; Sec 16 provides compound interest at three times the RBI bank rate on delayed payments.`,
    'The following bills are past that limit:',
    ...lines,
    'Kindly arrange payment at the earliest.',
    ...(samadhaan ? ['If the dues remain unpaid we may approach the MSE Facilitation Council (MSME Samadhaan) under Sec 18.'] : []),
    `Regards, ${seller.name}`,
  ].join('\n');
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!); // R16-A3: escapes ' too (f-mfg stays self-contained)

/** Interest-claim letter (A4 HTML body) for one buyer. */
export function interestLetterHtml(seller: { name: string; udyam: string; category: string }, buyer: string, gstin: string, bills: readonly MseReceivable[], asOf: string): string {
  const total = round2(bills.reduce((s, b) => s + b.interest, 0));
  const rows = bills.map((b) => `<tr><td>${esc(b.number)}</td><td>${b.date}</td><td>${b.limit}</td><td style="text-align:right">${rs(b.total)}</td><td style="text-align:right">${rs(b.unpaid)}</td><td style="text-align:right">${b.daysOverdue}</td><td style="text-align:right">${rs(b.interest)}</td></tr>`).join('');
  return `<h2>Claim for interest under Sec 16 of the MSMED Act 2006</h2>
<p>${asOf}</p><p>To: ${esc(buyer)} (GSTIN ${esc(gstin)})</p>
<p>From: ${esc(seller.name)} — ${esc(seller.category)} enterprise, Udyam ${esc(seller.udyam)}</p>
<p>The bills below were not paid within the period allowed by Sec 15. Interest under Sec 16 (compound, monthly rests, three times the RBI bank rate) to ${asOf}:</p>
<table border="1" cellspacing="0" cellpadding="4"><thead><tr><th>Bill</th><th>Date</th><th>Due by (Sec 15)</th><th>Amount</th><th>Unpaid</th><th>Days late</th><th>Interest</th></tr></thead><tbody>${rows}</tbody></table>
<p><b>Interest claimed: ${rs(total)}</b>. ${esc(HBH_NOTE)}</p>
<p style="font-size:smaller">Working paper — verify with your CA (MF20). Interest is booked only when a debit note is raised.</p>`;
}

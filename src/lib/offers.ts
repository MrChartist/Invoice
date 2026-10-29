/**
 * Bill-value offers (7U, roadmap 7.43): "5% off on bills of ₹5,000 or more", "₹200 off above ₹2,000".
 * Defined as schemes of `kind: 'bill_value'` (table `schemes`, `pricing.ts`); buy-A-get-B schemes are
 * free lines handled by `syncSchemeLines`.
 *
 * The bill value is the item value after line discounts and BEFORE any invoice discount (so the
 * offer does not shrink itself), after the price level / slab rate was chosen. The best slab of the
 * running offers applies; the discount joins the invoice's AMOUNT discount (like loyalty
 * redemption) and is remembered in `offer {scheme_id, label, value}`, printed / shown as its own line.
 * GST is charged on the value after the discount: a discount shown on the invoice at the time of
 * supply is excluded from the value (Sec 15(3)(a) CGST Act). Verify the treatment with your CA.
 * A % invoice discount blocks the offer (amount and % discounts cannot be combined here).
 *
 * PENDING 46: an offer may be limited to some customers (`client_ids`, matched on the bill's client id), and a
 * bill-value scheme may carry a combo price (`combo`): every full set of its items on the bill (lines matched by
 * name, after line discounts, free lines left out) costs the combo price; the saving is the offer. The single best
 * offer (slab or combo) applies — offers do not stack.
 *
 * Pure.
 */

import type { InvoiceRecord } from '../types/invoice';
import { calcInputFromRecord, calculateInvoice, num, round2 } from './invoice-calc';
import { schemeActive, type ComboOffer, type Scheme } from './pricing';

export interface BillOffer {
  scheme: Scheme;
  label: string;
  value: number;
}

/** The bill value an offer is measured on: items after line discounts, before the invoice discount. */
export function billValueOf(rec: InvoiceRecord): number {
  const t = calculateInvoice(calcInputFromRecord({ ...rec, discount_type: 'AMOUNT', discount_rate: 0 }));
  return round2(t.subtotal - t.line_discount_total);
}

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();

/** PENDING 46: the combo saving on a bill — full sets × (the sets' value at the bill's rates − the combo price). */
export function comboSaving(combo: ComboOffer, items: readonly Pick<InvoiceRecord['items'][number], 'name' | 'quantity' | 'rate' | 'discount_percent' | 'free_of'>[]): { sets: number; value: number } {
  let sets = Infinity;
  let setValue = 0;
  for (const c of combo.items) {
    const lines = items.filter((l) => !l.free_of && num(l.rate) > 0 && norm(l.name) === norm(c.item_name));
    const qty = lines.reduce((s, l) => s + num(l.quantity), 0);
    const need = num(c.qty);
    if (!(need > 0) || !(qty > 0)) return { sets: 0, value: 0 };
    sets = Math.min(sets, Math.floor((qty + 1e-9) / need));
    const lineValue = lines.reduce((s, l) => s + num(l.quantity) * num(l.rate) * (1 - num(l.discount_percent) / 100), 0);
    setValue += (lineValue / qty) * need;
  }
  if (!Number.isFinite(sets) || sets < 1) return { sets: 0, value: 0 };
  return { sets, value: round2(Math.max(0, sets * (setValue - num(combo.price)))) };
}

/**
 * The customer's master id: the snapshot's own id, else (QA23 W3) the master of the same name — a client picked in the
 * editor is copied without its id (`clientToParty`), so per-customer offers match by name like the credit check.
 */
function customerId(client: Pick<NonNullable<InvoiceRecord['client']>, 'id' | 'name'> | undefined, clients: readonly { id?: string; name?: string }[] = []): string {
  if (client?.id) return client.id;
  const name = norm(client?.name);
  return (name && clients.find((c) => norm(c.name) === name)?.id) || '';
}

/**
 * Best running bill-value offer for a bill value on `day` (null when none reaches). `rec` gives the customer and lines
 * (PENDING 46); `clients` resolves a customer snapshot without an id by name (QA23 W3).
 */
export function bestBillOffer(schemes: readonly Scheme[], billValue: number, day: string, rec?: Pick<InvoiceRecord, 'items' | 'client'>, clients?: readonly { id?: string; name?: string }[]): BillOffer | null {
  let best: BillOffer | null = null;
  const clientId = customerId(rec?.client, clients);
  for (const s of schemes) {
    if (s.kind !== 'bill_value' || !schemeActive(s, day)) continue;
    if (s.client_ids?.length && !s.client_ids.includes(clientId)) continue;
    if (s.combo) {
      const c = rec ? comboSaving(s.combo, rec.items ?? []) : { sets: 0, value: 0 };
      const value = round2(Math.min(c.value, billValue));
      if (!(value > 0)) continue;
      const label = `${s.label?.trim() || 'Combo'}: ${c.sets} × ${s.combo.items.map((x) => `${num(x.qty)} ${x.item_name}`).join(' + ')} @ ₹${num(s.combo.price)}`;
      if (!best || value > best.value) best = { scheme: s, label, value };
      continue;
    }
    const slab = (s.slabs ?? []).filter((x) => billValue + 0.004 >= num(x.min_value)).sort((a, b) => num(b.min_value) - num(a.min_value))[0];
    if (!slab) continue;
    const value = round2(Math.min(num(slab.percent) > 0 ? (billValue * num(slab.percent)) / 100 : num(slab.amount), billValue));
    if (!(value > 0)) continue;
    const label = `${s.label?.trim() || 'Bill offer'}: ${num(slab.percent) > 0 ? `${num(slab.percent)}%` : `₹${num(slab.amount)}`} off on ₹${num(slab.min_value)}+`;
    if (!best || value > best.value) best = { scheme: s, label, value };
  }
  return best;
}

const retotal = (rec: InvoiceRecord): InvoiceRecord => {
  const t = calculateInvoice(calcInputFromRecord(rec));
  return {
    ...rec,
    subtotal: t.subtotal, discount_amount: t.discount_amount, taxable_value: t.taxable_value, cgst_amount: t.cgst_amount,
    sgst_amount: t.sgst_amount, igst_amount: t.igst_amount, tax_amount: t.tax_amount, round_off: t.round_off, total: t.total,
    balance_due: t.balance_due, cess_amount: t.cess_amount, tcs_amount: t.tcs_amount, tds_amount: t.tds_amount,
  };
};

/** Take an applied offer off a record (its value leaves the AMOUNT discount). */
export function removeBillOffer(rec: InvoiceRecord): InvoiceRecord {
  if (!rec.offer) return rec;
  const next: InvoiceRecord = { ...rec };
  if (next.discount_type === 'AMOUNT') next.discount_rate = round2(Math.max(num(next.discount_rate) - num(rec.offer.value), 0));
  delete next.offer;
  return next;
}

/**
 * Apply the best running offer (or drop a stale one). Returns the same record when nothing changes.
 * `retotalRecord` = recompute the stored totals (POS cart); the editor recomputes them itself.
 */
export function applyBillOffer(rec: InvoiceRecord, schemes: readonly Scheme[], opts: { retotalRecord?: boolean; clients?: readonly { id?: string; name?: string }[] } = {}): InvoiceRecord {
  if (rec.doc_type === 'CREDIT_NOTE' || rec.doc_type === 'DEBIT_NOTE') return rec;
  const base = removeBillOffer(rec);
  const offer = base.discount_type === 'PERCENT' && num(base.discount_rate) > 0 ? null : bestBillOffer(schemes, billValueOf(base), rec.issue_date, base, opts.clients);

  if (!offer && !rec.offer) return rec;
  if (offer && rec.offer && rec.offer.scheme_id === offer.scheme.id && Math.abs(num(rec.offer.value) - offer.value) < 0.005 && rec.offer.label === offer.label && rec.discount_type === 'AMOUNT' && num(rec.discount_rate) + 0.004 >= offer.value) return rec;
  const next: InvoiceRecord = offer
    ? { ...base, discount_type: 'AMOUNT', discount_rate: round2((base.discount_type === 'AMOUNT' ? num(base.discount_rate) : 0) + offer.value), offer: { scheme_id: offer.scheme.id, label: offer.label, value: offer.value } }
    : base;
  return opts.retotalRecord ? retotal(next) : next;
}

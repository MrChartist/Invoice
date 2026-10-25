/**
 * Advances (roadmap 5.3) — the pure maths every reader shares: GST on an advance, what is still
 * unadjusted, and the dated movements (received / adjusted / refunded) with their share of the tax.
 *
 * No storage, no React: GST reports, the ledger, Books, receivables and Tally all read these
 * functions, so their figures agree. Working papers — verify with your CA.
 *
 * Rules (see docs/features/advances.md):
 *  - GST is tax-inclusive in the amount received: tax = amount × rate / (100 + rate), CGST/SGST
 *    halves when the place of supply is the supplier's state, else IGST. Cess is not modelled.
 *  - Services: tax is due on receipt (Sec 13). Goods: none since Notification 66/2017-CT
 *    (`advanceTaxable` in tax-rules.ts, date-keyed). Export (POS 96/99) and rate 0: none (LUT assumed).
 *  - An adjustment is a `transactions` row with `advance_id`. It counts only while its invoice
 *    exists and is issued (not draft / cancelled): cancelling the invoice gives the advance back.
 *  - The tax released by each adjustment / refund is its share of the advance's tax, worked out on
 *    the running total so the last movement takes the exact remainder (no paisa left behind).
 */

import type { AdvanceRecord, AdvanceSupply, AdvanceTax } from '../types/advances';
import type { InvoiceRecord, Payment } from '../types/invoice';
import { num, round2 } from './invoice-calc';
import { isoDay } from './dates';
import { advanceTaxable } from './tax-rules';

export const ADVANCES_TABLE = 'advances';

const FOREIGN_POS = new Set(['96', '99']);

/** GST inside `amount` (tax-inclusive) for an advance. */
export function computeAdvanceTax(input: {
  amount: number;
  rate: number;
  supply: AdvanceSupply;
  date: string;
  pos: string;
  /** Supplier's state code (from the GSTIN or the profile). Unknown = treated as intra-state. */
  senderState?: string;
}): AdvanceTax {
  const amount = round2(Math.max(num(input.amount), 0));
  const rate = Math.max(num(input.rate), 0);
  const pos = String(input.pos ?? '').trim();
  const sender = String(input.senderState ?? '').trim();
  const supplyType: 'INTRA' | 'INTER' = FOREIGN_POS.has(pos) || (sender && pos && sender !== pos) ? 'INTER' : 'INTRA';
  const applies = rate > 0 && amount > 0 && !FOREIGN_POS.has(pos) && advanceTaxable(input.supply, input.date);
  if (!applies) return { applies: false, supply_type: supplyType, taxable: amount, igst: 0, cgst: 0, sgst: 0 };
  const tax = round2((amount * rate) / (100 + rate));
  const cgst = supplyType === 'INTRA' ? round2(tax / 2) : 0;
  const sgst = supplyType === 'INTRA' ? round2(tax - cgst) : 0;
  const igst = supplyType === 'INTER' ? tax : 0;
  return { applies: true, supply_type: supplyType, taxable: round2(amount - tax), igst, cgst, sgst };
}

export const taxTotal = (t: Pick<AdvanceTax, 'igst' | 'cgst' | 'sgst'>): number => round2(num(t.igst) + num(t.cgst) + num(t.sgst));

/** Is this payment row an advance adjustment (not new money)? */
export const isAdvanceAdjustment = (p: Pick<Payment, 'advance_id'> | null | undefined): boolean => !!p?.advance_id;

/** Adjustments of `advanceId` that still count: the invoice exists and is issued (not draft / cancelled). */
export function liveAdjustments(
  advanceId: string,
  payments: readonly Payment[],
  invoices: readonly Pick<InvoiceRecord, 'id' | 'status'>[] | ReadonlyMap<string, Pick<InvoiceRecord, 'id' | 'status'>>,
): Payment[] {
  const byId = invoices instanceof Map ? invoices : new Map((invoices as readonly Pick<InvoiceRecord, 'id' | 'status'>[]).map((i) => [i.id, i]));
  return payments.filter((p) => {
    if (p.advance_id !== advanceId || !(num(p.amount) > 0)) return false;
    const inv = byId.get(p.invoice_id);
    return !!inv && inv.status !== 'Cancelled' && inv.status !== 'Draft';
  });
}

export interface AdvanceBalance {
  amount: number;
  adjusted: number;
  refunded: number;
  /** Still available to apply or refund. */
  open: number;
}

export function advanceBalance(
  adv: AdvanceRecord,
  payments: readonly Payment[],
  invoices: readonly Pick<InvoiceRecord, 'id' | 'status'>[] | ReadonlyMap<string, Pick<InvoiceRecord, 'id' | 'status'>>,
): AdvanceBalance {
  const amount = round2(num(adv.amount));
  const adjusted = round2(liveAdjustments(adv.id, payments, invoices).reduce((s, p) => s + num(p.amount), 0));
  const refunded = round2((adv.refunds ?? []).reduce((s, r) => s + num(r.amount), 0));
  return { amount, adjusted, refunded, open: round2(Math.max(amount - adjusted - refunded, 0)) };
}

/* ── Movements ────────────────────────────────────────────────── */

export type AdvanceMovementKind = 'received' | 'adjusted' | 'refunded';

export interface AdvanceMovement {
  kind: AdvanceMovementKind;
  advanceId: string;
  /** Advance voucher number (ADV/…). */
  number: string;
  /** Payment id (adjusted), refund id (refunded) or the advance id (received). */
  sourceId: string;
  date: string;
  pos: string;
  supply: 'INTRA' | 'INTER';
  rate: number;
  /** True when GST was charged on the advance (heads are then non-zero). */
  taxed: boolean;
  /** Rupees moved, tax inclusive. */
  gross: number;
  /** Gross less tax (GSTR-1 `ad_amt`). */
  taxable: number;
  igst: number;
  cgst: number;
  sgst: number;
  party: string;
  clientId?: string;
  senderGstin: string;
  /** Adjusted: the invoice it went against. */
  invoiceId?: string;
  invoiceNumber?: string;
  /** Refunded: the refund voucher number; adjusted / received: the payment method. */
  ref?: string;
  method?: string;
  /** Received / refunded: the bank account (multi-account BRS); missing = the main account. */
  bank_account_id?: string;
}

/**
 * Every advance movement, oldest first. Each adjustment / refund carries its share of the
 * advance's tax; the share is cut on the running total so the last one takes the remainder.
 */
export function advanceMovements(
  advances: readonly AdvanceRecord[],
  payments: readonly Payment[],
  invoices: readonly InvoiceRecord[],
): AdvanceMovement[] {
  const invById = new Map(invoices.map((i) => [i.id, i]));
  const out: AdvanceMovement[] = [];
  for (const adv of advances) {
    if (!adv || !adv.id) continue;
    const amount = round2(num(adv.amount));
    const date = isoDay(adv.date);
    if (!(amount > 0) || !date) continue;
    const t = adv.tax ?? { applies: false, supply_type: 'INTRA', taxable: amount, igst: 0, cgst: 0, sgst: 0 };
    const taxed = !!t.applies;
    const heads = { igst: taxed ? num(t.igst) : 0, cgst: taxed ? num(t.cgst) : 0, sgst: taxed ? num(t.sgst) : 0 };
    const base = {
      advanceId: adv.id,
      number: adv.number,
      pos: String(adv.place_of_supply ?? ''),
      supply: (t.supply_type === 'INTER' ? 'INTER' : 'INTRA') as 'INTRA' | 'INTER',
      rate: num(adv.tax_rate),
      taxed,
      party: adv.client?.name || 'Unknown customer',
      clientId: adv.client?.id,
      senderGstin: String(adv.sender?.companyGstin ?? '').trim().toUpperCase(),
    };
    out.push({
      ...base, kind: 'received', sourceId: adv.id, date, gross: amount,
      taxable: round2(amount - heads.igst - heads.cgst - heads.sgst), ...heads, method: adv.method, ref: adv.reference,
      bank_account_id: adv.bank_account_id,
    });

    const consumed: { kind: 'adjusted' | 'refunded'; id: string; date: string; amount: number; inv?: InvoiceRecord; ref?: string; method?: string; bank_account_id?: string }[] = [];
    for (const p of liveAdjustments(adv.id, payments, invById)) {
      const inv = invById.get(p.invoice_id);
      consumed.push({ kind: 'adjusted', id: String(p.id), date: isoDay(p.date) || date, amount: round2(num(p.amount)), inv, ref: p.reference, method: p.method });
    }
    for (const r of adv.refunds ?? []) {
      if (num(r.amount) > 0) consumed.push({ kind: 'refunded', id: r.id, date: isoDay(r.date) || date, amount: round2(num(r.amount)), ref: r.number, method: r.method, bank_account_id: r.bank_account_id });
    }
    consumed.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    // Tax share of the first `c` rupees consumed; the whole advance carries exactly its own tax.
    const share = (c: number) => {
      if (c >= amount - 0.004) return { ...heads };
      const f = c / amount;
      return { igst: round2(heads.igst * f), cgst: round2(heads.cgst * f), sgst: round2(heads.sgst * f) };
    };
    let used = 0;
    for (const m of consumed) {
      const before = share(used);
      used = round2(used + m.amount);
      const after = share(Math.min(used, amount));
      const igst = round2(after.igst - before.igst);
      const cgst = round2(after.cgst - before.cgst);
      const sgst = round2(after.sgst - before.sgst);
      out.push({
        ...base, kind: m.kind, sourceId: m.id, date: m.date, gross: m.amount,
        taxable: round2(m.amount - igst - cgst - sgst), igst, cgst, sgst,
        invoiceId: m.inv?.id, invoiceNumber: m.inv?.invoice_number, ref: m.ref, method: m.method,
        bank_account_id: m.bank_account_id,
      });
    }
  }
  const order: Record<AdvanceMovementKind, number> = { received: 0, adjusted: 1, refunded: 2 };
  return out.sort((a, b) => a.date.localeCompare(b.date) || order[a.kind] - order[b.kind] || a.number.localeCompare(b.number));
}

/** Movements that carry GST (the ones GSTR-1 Table 11 and GSTR-3B report). */
export function advanceTaxEvents(
  advances: readonly AdvanceRecord[],
  payments: readonly Payment[],
  invoices: readonly InvoiceRecord[],
): AdvanceMovement[] {
  return advanceMovements(advances, payments, invoices).filter((m) => m.taxed);
}

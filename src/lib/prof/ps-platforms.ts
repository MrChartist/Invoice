/**
 * R14 PS-C4: payment platforms (PayPal, Wise, Payoneer, Upwork, Skydo, Stripe, Razorpay …) kept in
 * `prof_settings.platforms[]`, and "Receive via platform" on a foreign-currency invoice (PS8). From the gross (FC), the
 * platform fee and conversion fee (FC) and the rupees credited it makes:
 *   - ONE receipt of the gross against the invoice at the realised rate (₹ credited ÷ net FC) — the existing receipt
 *     and `fx-gain.ts` book the exchange difference;
 *   - ONE expense bill for the fees (vendor = the platform), import of services under reverse charge when the platform
 *     is non-resident and the company is registered (IGST 18 %, ITC as for any RCM bill), paid from the same bank, so the
 *     bank shows what arrived;
 *   - the receipt note "Platform: <name>" — the short-realisation reason the export register's services view reads.
 * All three or none (`withTablesRollback`). Working paper — verify with your CA.
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { PurchaseRecord } from '../../types/purchases';
import './ps-registry';
import type { PsPlatform } from '../../types/prof-r14';
import { generateId } from '../storage';
import { readProfSettings, saveProfSettings } from './ps-settings';
export { PURPOSE_BY_KIND, purposeCodes } from '../prof-rules';
import { requireAccess } from '../access';
import { localDb } from '../localDb';
import { computePurchaseTotals, paymentsDb, purchasesDb } from '../purchases';
import { supplierPayableOf } from '../purchase-normalize';
import { withTablesRollback } from '../table-txn';
import { mulRound2, num, round2 } from '../invoice-calc';

export type Platform = PsPlatform;
export type PlatformKind = Platform['kind'];
export const PLATFORM_KINDS: readonly PlatformKind[] = ['paypal', 'wise', 'payoneer', 'upwork', 'skydo', 'stripe', 'razorpay', 'other'];
/** SAC of the platform's fee (financial and related services). */
export const PLATFORM_FEE_SAC = '997159';
export const RCM_IGST_RATE = 18;

const clean = (p: Partial<Platform>): Platform | null => {
  const name = String(p?.name ?? '').trim().slice(0, 40);
  if (!name) return null;
  const kind = (PLATFORM_KINDS as readonly string[]).includes(String(p.kind)) ? (p.kind as PlatformKind) : 'other';
  return { name, kind, ...(p.bank_account_id ? { bank_account_id: p.bank_account_id } : {}), ...(p.fee_ledger ? { fee_ledger: String(p.fee_ledger).slice(0, 60) } : {}), ...(p.vendor_id ? { vendor_id: p.vendor_id } : {}), ...(p.non_resident ? { non_resident: true } : {}) };
};

export const loadPlatforms = (): Platform[] => (readProfSettings().platforms ?? []).map(clean).filter((p): p is Platform => !!p);
/** Owner only: replace the list (`prof_settings`, audited). Names are unique. */
export function savePlatforms(list: readonly Partial<Platform>[]): Platform[] {
  const seen = new Set<string>();
  const platforms = list.map(clean).filter((p): p is Platform => !!p && !seen.has(p.name.toLowerCase()) && !!seen.add(p.name.toLowerCase()));
  saveProfSettings({ platforms });
  return platforms;
}

/** `prof_settings.export.purpose_code`: the default RBI purpose code for services (PS39); absent = by `prof_kind`. */
export const readPurposeCode = (): string | undefined => readProfSettings().export?.purpose_code || undefined;
export const savePurposeCode = (code: string): void => void saveProfSettings({ export: { ...readProfSettings().export, purpose_code: code.trim().toUpperCase().slice(0, 6) || undefined } });

export interface PlatformReceipt {
  gross: number;
  fee: number;
  conversion?: number;
  /** Rupees credited to the bank. */
  inr: number;
  date: string;
  reference?: string;
}
export interface PlatformPlan {
  net: number;
  rate: number;
  grossInr: number;
  feeFc: number;
  feeInr: number;
  rcm: boolean;
  igst: number;
}

/** Pure: the figures of a platform receipt (throws a reason key on bad input). */
export function planPlatformReceipt(r: PlatformReceipt, p: Partial<Pick<Platform, 'non_resident'>>, registered: boolean): PlatformPlan {
  const gross = round2(num(r.gross)), feeFc = round2(num(r.fee) + num(r.conversion));
  const net = round2(gross - feeFc);
  if (!(gross > 0) || feeFc < 0 || !(net > 0)) throw new Error('platGross');
  if (!(num(r.inr) > 0)) throw new Error('platInr');
  const rate = Math.round((num(r.inr) / net) * 10000) / 10000;
  const feeInr = round2(mulRound2(gross, rate) - num(r.inr));
  const rcm = !!p.non_resident && registered && feeInr > 0;
  return { net, rate, grossInr: mulRound2(gross, rate), feeFc, feeInr: Math.max(feeInr, 0), rcm, igst: rcm ? round2((feeInr * RCM_IGST_RATE) / 100) : 0 };
}

/** Record it: receipt + fee bill (+ its payment). Returns the plan and the ids written. */
export function receiveViaPlatform(inv: Pick<InvoiceRecord, 'id' | 'invoice_number' | 'currency'>, platform: Platform, r: PlatformReceipt, registered: boolean): PlatformPlan & { paymentId: string; billId?: string } {
  requireAccess('payment.record');
  if (String(inv.currency || 'INR').toUpperCase() === 'INR') throw new Error('platForeignOnly');
  const plan = planPlatformReceipt(r, platform, registered);
  return withTablesRollback(['transactions', 'invoices', 'purchases', 'purchase_payments'], () => {
    const pay = localDb.payments.record({ invoiceId: inv.id, amount: round2(num(r.gross)), method: 'Bank Transfer', reference: r.reference, note: `Platform: ${platform.name} (fees ${plan.feeFc} ${String(inv.currency).toUpperCase()})`, date: r.date, realisedRate: plan.rate, bankAccountId: platform.bank_account_id });
    if (!(plan.feeInr > 0)) return { ...plan, paymentId: pay.id };
    const lines = [{ id: generateId(), name: `${platform.name} fees: ${inv.invoice_number}`, hsn: PLATFORM_FEE_SAC, unit: 'NOS', quantity: 1, rate: plan.feeInr, tax_rate: plan.rcm ? RCM_IGST_RATE : 0 }];
    const t = computePurchaseTotals(lines, { placeOfSupply: '96', businessState: '00', gstApplies: plan.rcm });
    const bill: Omit<PurchaseRecord, 'id'> = {
      kind: 'EXPENSE', vendor_id: platform.vendor_id, vendor_name: platform.name, bill_number: `${platform.name.slice(0, 12)}/${r.reference || inv.invoice_number}`.slice(0, 40), date: r.date,
      category: platform.fee_ledger || 'Platform fees', lines, taxable: t.taxable, cgst: 0, sgst: 0, igst: t.igst, itc_eligible: plan.rcm, total: t.total, amount_paid: 0,
      ...(plan.rcm ? { import_type: 'SERVICES' as const } : {}),
      notes: `Fees deducted by ${platform.name} on ${inv.invoice_number}${plan.rcm ? ': import of services, reverse charge' : ''}`,
    };
    const saved = purchasesDb.save(bill);
    const owe = supplierPayableOf({ reverseCharge: false, importType: plan.rcm ? 'SERVICES' : '', tax: t.tax, taxable: t.taxable, total: t.total });
    paymentsDb.record(saved.id, { amount: owe, date: r.date, method: 'Bank transfer', reference: r.reference, bankAccountId: platform.bank_account_id });
    return { ...plan, paymentId: pay.id, billId: saved.id };
  });
}

/**
 * MF-C4 karigar piece bills `KPB/FY…`: ONE `purchases` row per karigar and period (vendor = the karigar, SAC 9988 job-work
 * lines, `PurchaseRecord.mf = { kind: 'piece_bill', piece }`), so books, GST, TDS and the payables read it like any bill.
 *  - GST: an unregistered karigar's bill carries no GST and no RCM (job work is not a notified RCM service); a registered
 *    fabricator's textile job work suggests 5% (`jw_textile`, MF2) — a typed rate wins.
 *  - TDS 194C (Sec 393 from 1 Apr 2026): the existing payables rules (`resolveBillTds`: thresholds, 206AA no-PAN rate,
 *    individual / HUF vs others) — a prompt, the user keeps or clears it (MF28).
 *  - Advances: a payment voucher Dr "Karigar advances" (party = the karigar); the bill recovers an instalment by a
 *    journal Dr Sundry creditors | Cr Karigar advances (no receipt, no cash moved), rolled into the bill's `amount_paid`
 *    (the R11 / R12 precedent) so the bill's balance is the net.
 *  - Pay: the existing purchase payment / bank upload file (`cycleUploadRows` shape) and a WhatsApp slip.
 * Deleting a bill goes through `purchasesDb.remove` (recycle bin) with its journal; the KPB number stays used.
 */
import './mf-registry';
import type { PurchaseRecord, Vendor } from '../../types/purchases';
import { generateId } from '../storage';
import { num, round2 } from '../invoice-calc';
import { ruleAt } from '../tax-rules';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { withTablesRollback } from '../table-txn';
import { purchasesDb } from '../purchases';
import { billTdsInputFor, priorCreditsFor, resolveBillTds, deducteeTypeFromPan, type BillTdsFields } from '../tds-payables';
import { sectionText } from '../ita2025';
import { A, chartOf, loadUserAccounts, saveUserAccount } from '../ledger/accounts';
import { deleteVoucher, loadVouchers, saveVoucher, VOUCHERS_TABLE } from '../ledger/vouchers';
import { cycleUploadRows, type UploadRow } from '../bank-upload';
import { ADVANCE_LEDGER, karigarBalance } from './mf-karigar';
import { MF_SERIES } from './mf-shared';
import { TEXTILE_CLASS_RULES } from '../mfg-rules';
import type { MfPieceBill, MfPieceLine } from '../../types/mfg-r13';

export const KPB = MF_SERIES.pieceBills;
export const PIECE_CATEGORY = 'Job work charges (karigars)';

/** The piece-bill part of a purchase row. */
export const pieceOf = (p: unknown): MfPieceBill | undefined => {
  const m = (p as { mf?: { kind?: string; piece?: MfPieceBill } } | undefined)?.mf;
  return m?.kind === 'piece_bill' && m.piece ? m.piece : undefined;
};

/** The 194C code for the karigar (individual / HUF → `194C-1`, else `194C-2`). */
export function tdsCode(v: Pick<Vendor, 'pan' | 'deductee_type'>): string {
  const t = v.deductee_type ?? deducteeTypeFromPan(v.pan);
  return !t || t === 'INDIVIDUAL' || t === 'HUF' ? '194C-1' : '194C-2';
}

/** GST rate suggested on the bill: none for an unregistered karigar; `jw_textile` for a registered fabricator. */
export const pieceGstRate = (v: Pick<Vendor, 'gstin'>, date: string): number => (v.gstin?.trim() ? num(ruleAt(TEXTILE_CLASS_RULES.jw_textile, date).rate) : 0);

export interface PieceBillDraft {
  bill: Omit<PurchaseRecord, 'id'>;
  tds: { fields: BillTdsFields; note: string; applies: boolean };
  net: number;
}

/**
 * The bill for a karigar: `lines` (pieces × rate), GST by registration (or `gstRate`), TDS 194C suggested (`tds: false`
 * clears it), `advance` recovered (capped at the bill's net and his outstanding advance — checked on save).
 */
export function draftPieceBill(v: Vendor, lines: readonly MfPieceLine[], x: { date: string; period: { from: string; to: string }; ourState?: string; gstRate?: number; tds?: boolean; advance?: number; purchases?: readonly unknown[]; number?: string }): PieceBillDraft {
  const live = lines.filter((l) => num(l.pieces) > 0 && num(l.rate) >= 0);
  if (!live.length) throw new Error('No pieces in this period.');
  const rate = x.gstRate ?? pieceGstRate(v, x.date);
  const taxable = round2(live.reduce((s, l) => s + num(l.pieces) * num(l.rate), 0));
  const tax = round2((taxable * rate) / 100);
  const inter = !!(v.gstin && x.ourState && v.gstin.slice(0, 2) !== x.ourState);
  const cgst = inter ? 0 : round2(tax / 2);
  const total = round2(taxable + tax);
  const tdsIn = { ...billTdsInputFor(null, v), section: x.tds === false ? '' : tdsCode(v) };
  const r = resolveBillTds(tdsIn, { date: x.date, taxable, prior: priorCreditsFor(x.purchases ?? [], v) });
  const tdsAmount = num(r.fields.tds_amount);
  const net = round2(total - tdsAmount);
  const advance = round2(Math.min(Math.max(num(x.advance), 0), net));
  const piece: MfPieceBill = { period: x.period, lines: live.map((l) => ({ ...l, amount: round2(num(l.pieces) * num(l.rate)) })), ...(advance ? { advance_recovered: advance } : {}) };
  const bill: Omit<PurchaseRecord, 'id'> = {
    kind: 'PURCHASE', vendor_id: v.id, vendor_name: v.name, ...(v.gstin ? { vendor_gstin: v.gstin } : {}), bill_number: x.number ?? '', date: x.date, category: PIECE_CATEGORY,
    lines: live.map((l) => ({ id: generateId(), name: `${l.op}${l.style ? `: ${l.style}` : ''}`, hsn: '9988', unit: 'PCS', quantity: num(l.pieces), rate: num(l.rate), tax_rate: rate })),
    taxable, cgst, sgst: inter ? 0 : round2(tax - cgst), igst: inter ? tax : 0, itc_eligible: rate > 0, total, amount_paid: advance,
    ...r.fields, notes: `Karigar piece bill ${x.period.from} to ${x.period.to}. Working paper: verify with your CA (MF28).`,
    mf: { kind: 'piece_bill', piece },
  } as Omit<PurchaseRecord, 'id'>;
  const code = tdsIn.section;
  const note = code ? `TDS ${sectionText(code, x.date)} may apply: ${r.suggestion?.applies ? `₹${tdsAmount.toFixed(2)}` : 'below the threshold'}. Verify with your CA (MF28).` : '';
  return { bill, tds: { fields: r.fields, note, applies: tdsAmount > 0 }, net: round2(net - advance) };
}

/** A ledger by name (created on first use under short-term loans and advances). */
function advanceLedger(): string {
  const chart = chartOf(loadUserAccounts());
  const hit = chart.find((a) => a.name.toLowerCase() === ADVANCE_LEDGER.toLowerCase());
  if (hit) return hit.id;
  const codes = new Set(chart.map((a) => a.code));
  let code = 3660;
  while (codes.has(String(code))) code++;
  return saveUserAccount({ code: String(code), name: ADVANCE_LEDGER, group: 'LOANS_ADV_ST' }).id;
}
export const advanceLedgerId = (): string | undefined => chartOf(loadUserAccounts()).find((a) => a.name.toLowerCase() === ADVANCE_LEDGER.toLowerCase())?.id;

/** His outstanding advance (vouchers on "Karigar advances"). */
export const advanceOutstanding = (v: Pick<Vendor, 'id' | 'name'>): number => karigarBalance(v, [], loadVouchers(), advanceLedgerId()).advance;

/** Pay an advance (books.edit): Dr Karigar advances (party) | Cr cash or the bank ledger. */
export function payAdvance(v: Pick<Vendor, 'name'>, x: { date: string; amount: number; from?: string; reference?: string }): string {
  const paise = Math.round(round2(num(x.amount)) * 100);
  if (!(paise > 0)) throw new Error('Enter the advance.');
  return saveVoucher({ type: 'PAYMENT', date: x.date, narration: `Advance to karigar ${v.name}${x.reference ? ` (${x.reference})` : ''}`, voucher_class: 'Karigar advance', lines: [{ account_id: advanceLedger(), dr: paise, cr: 0, party: v.name }, { account_id: x.from || A.cash, dr: 0, cr: paise }] } as Parameters<typeof saveVoucher>[0]).id;
}

/** Save a piece bill (KPB number; books.edit via `purchasesDb.save`) and its advance-recovery journal. */
export function savePieceBill(v: Vendor, d: PieceBillDraft): PurchaseRecord {
  const piece = pieceOf(d.bill)!;
  const adv = num(piece.advance_recovered);
  if (adv > advanceOutstanding(v) + 0.004) throw new Error(`${v.name} has only ₹${advanceOutstanding(v).toFixed(2)} of advance outstanding.`);
  const number = nextSeriesNumberFor(KPB, d.bill.date, purchasesDb.all().map((p) => p.bill_number));
  return withTablesRollback(['purchases', 'series_counters', VOUCHERS_TABLE, 'accounts'], () => {
    let jv: string | undefined;
    if (adv > 0) {
      const p = Math.round(adv * 100);
      jv = saveVoucher({ type: 'JOURNAL', date: d.bill.date, narration: `Advance recovered on ${number}`, voucher_class: 'Karigar advance recovery', lines: [{ account_id: A.creditors, dr: p, cr: 0, party: v.name }, { account_id: advanceLedger(), dr: 0, cr: p, party: v.name }] } as Parameters<typeof saveVoucher>[0]).id;
    }
    const row = purchasesDb.save({ ...d.bill, bill_number: number, mf: { kind: 'piece_bill', piece: { ...piece, ...(jv ? { advance_jv_id: jv } : {}) } } } as Omit<PurchaseRecord, 'id'>);
    recordSeries(number);
    return row;
  });
}

/** Delete a piece bill (recycle bin) with its recovery journal; the KPB number stays used. */
export function removePieceBill(id: string): void {
  const p = purchasesDb.get(id);
  const piece = pieceOf(p);
  if (!p || !piece) return;
  withTablesRollback(['purchases', 'purchase_payments', VOUCHERS_TABLE], () => {
    purchasesDb.remove(id);
    if (piece.advance_jv_id) deleteVoucher(piece.advance_jv_id);
  });
}

/** Bank upload rows (one per karigar with a bank account and a positive net) — the R12 adapter shape, formats unchanged. */
export function pieceUploadRows(bills: readonly { vendor: Vendor; net: number }[], reference: string): UploadRow[] {
  return cycleUploadRows(bills.map((b) => ({ farmer_id: b.vendor.id, name: b.vendor.beneficiary_name || b.vendor.name, net: b.net, bank: { account: b.vendor.bank_account_no, ifsc: b.vendor.bank_ifsc, name: b.vendor.bank_name } })), reference);
}

/** WhatsApp slip text: pieces by operation, amount, deductions, net. */
export function slipText(v: Pick<Vendor, 'name'>, number: string, piece: MfPieceBill, b: { total: number; tds: number; net: number }): string {
  const rows = piece.lines.map((l) => `${l.op}${l.style ? ` (${l.style})` : ''}: ${l.pieces} × ₹${num(l.rate).toFixed(2)} = ₹${num(l.amount).toFixed(2)}`);
  return [`${v.name}: ${number}`, `${piece.period.from} to ${piece.period.to}`, ...rows, `Total ₹${b.total.toFixed(2)}`, ...(b.tds ? [`TDS ₹${b.tds.toFixed(2)}`] : []), ...(piece.advance_recovered ? [`Advance recovered ₹${num(piece.advance_recovered).toFixed(2)}`] : []), `Net ₹${b.net.toFixed(2)}`].join('\n');
}

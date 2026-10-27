import type { CalcTotals } from '../../lib/invoice-calc';
import type { InvoiceItem, InvoiceRecord, Payment, SenderProfile } from '../../types/invoice';
import { getTable } from '../../lib/storage';
import { noCashKind } from '../../lib/advance-tax'; // no-cash.ts (QA6-1 F4)
import { upiLink } from '../../lib/share';
import { shiftDay } from '../../lib/dates';
import { weightText, wtHolds } from '../../lib/trade/tr-weight';
import type { JewelLine } from '../../types/retail-r9';
import type { AgSnapshot } from '../../types/agri-r12';

/** R9 (RT-E2) gold fineness by karat, for "22K (916)" on the bill (BIS Reg. 5(11); same table as `rt-jewel-rates.ts`). */
const KARAT: Readonly<Record<string, number>> = { '24K': 999, '23K': 958, '22K': 916, '21K': 875, '20K': 833, '18K': 750, '14K': 585, '9K': 375 };
const g3 = (x: number) => `${(Number(x) || 0).toFixed(3)} g`;
const rs = (x: number) => `₹${(Number(x) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** R9 (RT-E2): the printed jewellery sub-line — weights, purity in carat and fineness, HUID, rate and charges. */
export function jewelText(jw: JewelLine | undefined): string {
  if (!jw) return '';
  const m = jw.making;
  return [
    jw.tag && `Tag ${jw.tag}`,
    jw.stone_wt > 0 && `Gross ${g3(jw.gross_wt)} · Stones ${g3(jw.stone_wt)}`,
    jw.job_work ? `Customer's metal ${g3(jw.net_wt)} (memo)` : `Net ${g3(jw.net_wt)}`,
    jw.metal === 'gold' && KARAT[jw.purity] ? `${jw.purity} (${KARAT[jw.purity]})` : jw.purity,
    jw.huid && `HUID ${jw.huid}`,
    !jw.job_work && `${rs(jw.rate)}/g`,
    jw.wastage_g ? `Wastage ${g3(jw.wastage_g)}` : jw.wastage_pct > 0 && `Wastage ${jw.wastage_pct}%`,
    m?.value > 0 && `Making ${m.basis === 'percent' ? `${m.value}%` : rs(m.value)}${m.basis === 'per_gram' ? '/g' : ''}`,
    jw.stone_value > 0 && `Stones ${rs(jw.stone_value)}`,
    jw.hallmark_charge > 0 && `Hallmarking ${rs(jw.hallmark_charge)}`,
  ].filter(Boolean).join(' · ');
}

/** `YYYY-MM-DD` → `MM/YYYY`, the way batch dates are printed on packs. */
function monthYear(day: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(day);
  return m ? `${m[2]}/${m[1]}` : day;
}

/**
 * The batch / expiry / serial / warranty sub-line printed under a tracked stock line
 * (6.6 / 6.11), e.g. "Batch B12 · Mfg 01/2026 · Exp 06/2027" or "S/N: 3567…, 3567… · Warranty 12 months".
 * '' for untracked lines, so ordinary documents print exactly as before.
 */
export function trackingText(item: (Pick<InvoiceItem, 'batch_no' | 'batch_mfg' | 'batch_expiry' | 'serials' | 'serial_pairs' | 'warranty_months' | 'wt'> & Partial<Pick<InvoiceItem, 'disc_chain' | 'disc_per_unit' | 'quantity' | 'unit' | 'jw' | 'id' | 'sv'>> & { bin?: string }) | undefined, ag?: AgSnapshot): string {
  if (!item) return '';
  if (item.jw) return jewelText(item.jw); // R9 (RT-E2): the BIS sub-line (the tag no. is its serial)
  const parts: string[] = [];
  if (discountText(item)) parts.push(discountText(item)); // TR-A1
  if (item.bin) parts.push(`Bin ${item.bin}`); // 8.86: snapshot on delivery challan lines
  if (item.batch_no) parts.push(`Batch ${item.batch_no}`);
  if (item.batch_no && item.batch_mfg) parts.push(`Mfg ${monthYear(item.batch_mfg)}`);
  if (item.batch_no && item.batch_expiry) parts.push(`Exp ${monthYear(item.batch_expiry)}`);
  if (item.serials?.length) parts.push(`S/N: ${item.serials.map((s) => (item.serial_pairs?.[s] ? `${s} / ${item.serial_pairs[s]}` : s)).join(', ')}`); // R9 (RT-D1) dual IMEI
  if (item.serials?.length && item.warranty_months) parts.push(`Warranty ${item.warranty_months} month${item.warranty_months === 1 ? '' : 's'}`);
  if (item.wt && (item.quantity === undefined || wtHolds(item))) parts.push(weightText(item.wt)); // R8-B (TR-B1); QA8 T12 / T16: only while it still gives the quantity
  parts.push(agriLineText(item, ag)); // R12 (AG-A5): '' without the `ag` snapshot
  parts.push(staffText(item)); // R10 (SV-A): '' without the `sv.staff_print` snapshot
  return parts.filter(Boolean).join(' · ');
}

/** R10 (SV-A): "Staff: Asha" under a line, from the snapshot `sv.staff_print` only; '' otherwise (plain bills unchanged). */
export const staffText = (item: Partial<Pick<InvoiceItem, 'sv'>> | undefined): string => (item?.sv?.staff_print ? `Staff: ${item.sv.staff_print}` : '');

/** Printed UPI QR. Built by the validating `upiLink`, so a malformed or doctored VPA never reaches a QR. */
export function buildUpiUrl(sender: SenderProfile): string {
  if (!sender.upiId) return '';
  return upiLink({ pa: sender.upiId, pn: sender.accountName || sender.companyName }) ?? '';
}

/**
 * Split CGST + SGST is being charged (intra-state). IGST invoices are NOT "taxed" here: they
 * print an IGST line instead; counting them printed "CGST 0.00 / SGST 0.00" and no IGST at all.
 */
export function isTaxed(invoice: InvoiceRecord, totals: CalcTotals): boolean {
  return invoice.gst_mode === 'CGST_SGST' && totals.tax_amount > 0;
}

/**
 * Outward reverse charge calculated the current way (`rcm_tax_excluded`): the GST is printed as
 * "payable by the recipient" in its own note, never as a row that adds up to the total. Older
 * reverse-charge documents (tax inside their stored total) render exactly as they always did.
 */
export function isRcmTotals(totals: CalcTotals): boolean {
  return (totals.rcm_tax ?? 0) > 0;
}

/** Rule 46(p): the tax payable on reverse charge, printed under the totals. */
export function rcmTaxNote(totals: CalcTotals, money: (amount: number) => string): string {
  if (!isRcmTotals(totals)) return '';
  const heads = [
    totals.cgst_amount > 0 && `CGST ${money(totals.cgst_amount)}`,
    totals.sgst_amount > 0 && `SGST ${money(totals.sgst_amount)}`,
    totals.igst_amount > 0 && `IGST ${money(totals.igst_amount)}`,
    totals.cess_amount > 0 && `Cess ${money(totals.cess_amount)}`,
  ].filter(Boolean);
  return `Tax payable by the recipient under reverse charge (Sec 9(3)/9(4) CGST Act, Rule 46(p)): ${heads.join(', ')} — total ${money(totals.rcm_tax)}. Not included in the amount payable.`;
}

/** Legacy single "Tax" line. */
export function isSingleTax(invoice: InvoiceRecord, totals: CalcTotals): boolean {
  return invoice.gst_mode === 'SINGLE' && totals.tax_amount > 0;
}

/** TR-A1: the trade-discount snapshot of a line, e.g. "Disc 18 + 4 % + ₹5/unit" ('' without one). */
export function discountText(item: Partial<Pick<InvoiceItem, 'disc_chain' | 'disc_per_unit'>>): string {
  const chain = (item.disc_chain ?? []).filter((d) => d > 0);
  const t = [chain.length ? `${chain.join(' + ')} %` : '', (item.disc_per_unit ?? 0) > 0 ? `₹${item.disc_per_unit}/unit` : ''].filter(Boolean).join(' + ');
  return t ? `Disc ${t}` : '';
}

/** TR-A1: "2% cash discount if paid by 03-11-2026: ₹1,234.00" under the totals ('' without a term). */
export function cashDiscountText(invoice: Pick<InvoiceRecord, 'cash_discount' | 'issue_date' | 'doc_type'>, total: number, money: (amount: number) => string): string {
  const cd = invoice.cash_discount;
  if (!cd || !(cd.percent > 0) || invoice.doc_type === 'CREDIT_NOTE' || !(total > 0)) return '';
  const [y, m, d] = shiftDay(invoice.issue_date, cd.days).split('-');
  return `${cd.percent}% cash discount if paid by ${d}-${m}-${y}: ${money(Math.round(total * cd.percent) / 100)}`;
}

/** R8-B (TR-B1): "120 BAG · gross 6,072 kg − tare 72 kg − dhalta 60 kg = 5,940 kg" under a weighed line. */
export { weightText };

/** R9 (RT-B2): "Registered pharmacist: name (reg. no.)" from the sender snapshot ('' when none, so other bills print as before). */
export const pharmacistText = (sender: Pick<SenderProfile, 'pharmacist'>): string => (sender.pharmacist ? `Registered pharmacist: ${sender.pharmacist}` : '');
/** R9 (RT-D3 / E3): "Less: old gold (12.300 g @ 84%) ₹…" per exchange receipt on the bill (no cash; '' otherwise). */
export const exchangeText = (invoice: Pick<InvoiceRecord, 'id'>, money: (n: number) => string): string =>
  invoice.id ? getTable<Payment>('transactions').filter((p) => p?.invoice_id === invoice.id && noCashKind(p) === 'exchange').map((p) => `${p.note || 'Less: exchange'} ${money(p.amount)}`).join(' · ') : '';
/** R9 (RT-E2): the BIS verification line snapshotted on the bill's jewellery lines (printed under the totals; '' otherwise). */
export const bisText = (invoice: Pick<InvoiceRecord, 'items'>): string => invoice.items?.find((i) => i.jw?.bis)?.jw?.bis ?? '';

/**
 * R11 (CN-A3): the works sub-line under a bill line, from the document's construction snapshot only —
 * "Item 2.1.3 · MB 112/45–47 · Extra item (approval EE/123)". '' without `boq_terms.cn`, so other documents print as before.
 */
export function worksLineText(item: Pick<InvoiceItem, 'id'> | undefined, cn: { lines?: Record<string, { ref?: string; mb?: string; kind?: string; approval?: string; substitutes?: string }> } | undefined): string {
  const l = item && cn?.lines?.[item.id];
  if (!l) return '';
  const kind = l.kind === 'extra' ? 'Extra item' : l.kind === 'substituted' ? `Substituted item${l.substitutes ? ` for ${l.substitutes}` : ''}` : l.kind === 'deviation' ? 'Deviation' : '';
  return [l.ref && `Item ${l.ref}`, l.mb && `MB ${l.mb}`, kind && `${kind}${l.approval ? ` (approval ${l.approval})` : ''}`].filter(Boolean).join(' · ');
}

/** R11 (CN-A3): "Tax Invoice — Running Account Bill No. 4" / "… — Final Bill" for an RA bill; '' otherwise. */
export const raDocTitle = (inv: Pick<InvoiceRecord, 'ra_no' | 'ra_final'>, label: string): string =>
  inv.ra_no ? `${label} — ${inv.ra_final ? 'Final Bill' : `Running Account Bill No. ${inv.ra_no}`}` : '';

/**
 * R10 (SV-A4): Rule 46A — "Invoice-cum-Bill of Supply" for a tax invoice to a recipient without a GSTIN that carries
 * taxable and 0% (exempt / nil) lines, when the switch was on at save (`sv.rule46a`, a snapshot); '' otherwise.
 * Same test as `services/sv-tax.ts` `rule46aApplies` (kept inline so the paper chunk loads no Round 10 code).
 */
export function svDocTitle(inv: Pick<InvoiceRecord, 'doc_type' | 'client' | 'items' | 'sv'>): string {
  if (!inv.sv?.rule46a || (inv.doc_type !== 'INVOICE' && inv.doc_type !== 'TAX_INVOICE') || String(inv.client?.gstin ?? '').trim()) return '';
  const items = (inv.items ?? []).filter((i) => i && (Number(i.rate) || Number(i.quantity)));
  return items.some((i) => Number(i.tax_rate) > 0) && items.some((i) => Number(i.tax_rate) === 0) ? 'Invoice-cum-Bill of Supply' : '';
}

/**
 * R12 (AG-A5): the agri sub-line under a bill line, from the document's `ag` snapshot only — "Fat 6.8% · SNF 9.0% ·
 * 412.5 L" / "Lot CSR/26-27/0042 · 120 bags × ₹180 (season 2026)" / "Batch UR2611 · Exp 03/2028 · MRP ₹266.50 / bag".
 * '' without `ag`, so other documents print as before. Kept inline: the paper loads no Round 12 code.
 */
export function agriLineText(item: { id?: string } | undefined, ag: AgSnapshot | undefined): string {
  const l = item?.id ? ag?.lines?.[item.id] : undefined;
  if (!l) return '';
  return [
    l.fat !== undefined && `Fat ${l.fat}%`, l.snf !== undefined && `SNF ${l.snf}%`, l.litres !== undefined && `${l.litres} L`,
    l.lot && `Lot ${l.lot}`, l.bags !== undefined && `${l.bags} bags${l.rate_bag !== undefined ? ` × ${rs(l.rate_bag)}` : ''}${l.season ? ` (season ${l.season})` : ''}`,
    l.batch && `Batch ${l.batch}`, l.exp && `Exp ${l.exp}`, l.mrp_bag !== undefined && `MRP ${rs(l.mrp_bag)} / bag`, l.text,
  ].filter(Boolean).join(' · ');
}

/** R12 (AG-A5 / A3): classes that are agricultural produce sold loose (same list as `agri/ag-tax.ts` `isLooseProduce`). */
const AG_LOOSE = ['cereal_loose', 'pulses_loose', 'flour_loose', 'paddy', 'veg_fruit_fresh', 'potato', 'milk_fresh', 'curd_loose', 'broken_rice'];

/**
 * R12 (AG-A5): the agri declaration of a document — its snapshot's own text, else "Agricultural produce — not
 * pre-packaged and labelled" on a bill of supply with loose produce, "Exempt — storage of agricultural produce" on an
 * exempt rent bill, "Interest on loan — exempt" on an interest bill. '' otherwise. Verify with your CA (AG1, AG5, AG8, AG24).
 */
export function agriDeclaration(inv: Pick<InvoiceRecord, 'doc_type' | 'items' | 'ag'>): string {
  const ag = inv.ag;
  if (ag?.declaration) return ag.declaration;
  if (ag?.kind === 'rent' && ag.rent?.exempt) return 'Exempt — storage of agricultural produce (N 12/2017-CT(R) entry 54(e); verify with your CA, AG8).';
  if (ag?.kind === 'interest') return 'Interest on loan — exempt (verify with your CA, AG24).';
  return inv.doc_type === 'BILL_OF_SUPPLY' && (inv.items ?? []).some((i) => i?.ag_class && AG_LOOSE.includes(i.ag_class)) ? 'Agricultural produce — not pre-packaged and labelled.' : '';
}

/** R10 (SV-B1): "UHID … · Dr name (Reg. no. …) · Token n" under the bill-to, from the record snapshot `sv.visit`; '' otherwise. */
export function visitText(inv: Pick<InvoiceRecord, 'sv'>): string {
  const v = inv.sv?.visit;
  return v ? [v.uhid && `UHID ${v.uhid}`, v.doctor_name && `${v.doctor_name}${v.doctor_reg ? ` (Reg. no. ${v.doctor_reg})` : ''}`, v.token && `Token ${v.token}`].filter(Boolean).join(' · ') : '';
}
/** R10 (SV-B1): clinic registrations from the sender snapshot (CEA / state, council, NABL, PCPNDT); '' when none. */
export function svRegText(sender: Pick<SenderProfile, 'sv_regs'>): string {
  const r = sender.sv_regs;
  return r ? [r.cea && `Reg. ${r.cea}`, r.council && `Council reg. ${r.council}`, r.nabl && `NABL ${r.nabl}`, r.pcpndt && `PCPNDT ${r.pcpndt}`].filter(Boolean).join(' · ') : '';
}

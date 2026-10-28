import type { CalcTotals } from '../../lib/invoice-calc';
import type { InvoiceItem, InvoiceRecord, Payment, SenderProfile } from '../../types/invoice';
import { peekTable } from '../../lib/storage';
import { noCashKind } from '../../lib/advance-tax'; // no-cash.ts (QA6-1 F4)
import { upiLink } from '../../lib/share';
import { shiftDay } from '../../lib/dates';
import { weightText, wtHolds } from '../../lib/trade/tr-weight';
import type { JewelLine } from '../../types/retail-r9';
import type { AgSnapshot } from '../../types/agri-r12';
import type { MfSnapshot } from '../../types/mfg-r13';
import type { PsSnapshot } from '../../types/prof-r14';
import type { TvSnapshot } from '../../types/travel-r15';
import type { MpSnapshot } from '../../types/manpower-r17';
import type { HsSnapshot } from '../../types/society-r18';
import type { LgSnapshot } from '../../types/logistics-r19';
import { MSME_PAYMENT_DAYS } from '../../lib/tax-rules';

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
export function trackingText(item: (Pick<InvoiceItem, 'batch_no' | 'batch_mfg' | 'batch_expiry' | 'serials' | 'serial_pairs' | 'warranty_months' | 'wt'> & Partial<Pick<InvoiceItem, 'disc_chain' | 'disc_per_unit' | 'quantity' | 'unit' | 'jw' | 'id' | 'sv' | 'charge_head_id'>> & { bin?: string }) | undefined, ag?: AgSnapshot, mf?: MfSnapshot, ps?: PsSnapshot, tv?: TvSnapshot, mp?: MpSnapshot, hs?: HsSnapshot, lg?: LgSnapshot): string {
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
  parts.push(mfLineText(item, mf)); // R13 (MF-A5): '' without the `mf` snapshot
  parts.push(psLineText(item, ps)); // R14 (PS-A5): '' without the `ps` snapshot
  parts.push(tvLineText(item, tv)); // R15-B4: '' without the `tv` snapshot
  parts.push(mpLineText(item, mp)); // R17-A4: '' without the `mp` snapshot
  parts.push(hsLineText(item, hs)); // R18-A4: '' without the `hs` snapshot
  parts.push(lgLineText(item, lg)); // R19-A4: '' without the `lg` snapshot
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
  invoice.id ? peekTable<Payment>('transactions').filter((p) => p?.invoice_id === invoice.id && noCashKind(p) === 'exchange').map((p) => `${p.note || 'Less: exchange'} ${money(p.amount)}`).join(' · ') : '';
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

/* ── R13 (MF-A5): the manufacturing paper. Inline (the paper loads no Round 13 code); '' / nothing without the data. ── */

const dm = (d: string | undefined) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(2, 4)}` : d ?? '');

/**
 * The sub-line under a bill line from the document's `mf` snapshot: "Drg. 1145-B rev C · PO 20 · Heat H2231" /
 * "Batch NK2610 · Packed 12/10/26 · Best before 11/01/27 · MRP ₹40" / "Style KT-22 · Lot CUT/26-27/0014 · S6 M12 L12 XL6".
 */
export function mfLineText(item: { id?: string } | undefined, mf: MfSnapshot | undefined): string {
  const l = item?.id ? mf?.lines?.[item.id] : undefined;
  if (!l) return '';
  return [
    l.drawing && `Drg. ${l.drawing}${l.rev ? ` rev ${l.rev}` : ''}`, l.po_line && `PO ${l.po_line}`, l.heat && `Heat ${l.heat}`, l.grade && `Grade ${l.grade}`,
    l.batch && `Batch ${l.batch}`, l.packed_on && `Packed ${dm(l.packed_on)}`, l.best_before && `Best before ${dm(l.best_before)}`, l.use_by && `Use by ${dm(l.use_by)}`,
    l.mrp !== undefined && `MRP ${rs(l.mrp)}`, l.style && `Style ${l.style}`, l.lot && `Lot ${l.lot}`, l.sizes,
    l.epr_cat && `EPR ${l.epr_cat}`, l.recycled_pct !== undefined && `Recycled ${l.recycled_pct}%`,
  ].filter(Boolean).join(' · ');
}

const CAT: Readonly<Record<string, string>> = { MICRO: 'Micro', SMALL: 'Small', MEDIUM: 'Medium' };

/**
 * The seller's Udyam and FSSAI lines under the GSTIN, from the SENDER SNAPSHOT: "Udyam: UDYAM-MH-26-0012345 (Micro)"
 * prints once the profile carries the category (added with Round 13, so a document saved before prints nothing new)
 * unless "Print Udyam number" is off; "FSSAI Lic. No. …" whenever the snapshot has one (never on e-way JSON).
 */
export function mfSellerText(sender: Pick<SenderProfile, 'msme_udyam' | 'msme_category' | 'udyam_print' | 'fssai_no'> | null | undefined): string {
  if (!sender) return '';
  return [
    sender.msme_udyam && sender.msme_category && sender.udyam_print !== false && `Udyam: ${sender.msme_udyam} (${CAT[sender.msme_category] ?? sender.msme_category})`,
    sender.fssai_no && `FSSAI Lic. No. ${sender.fssai_no}`,
  ].filter(Boolean).join(' · ');
}

/**
 * The declarations of a manufacturing document: the snapshot's own text, else "Waste and scrap — TCS u/s 394(1)
 * collected" (scrap with TCS), "Goods supplied under Advance Authorisation no. …", "Recycled content x% (PWM Rules)";
 * plus the MSE payment clause (MSMED Act 2006 Sec 15 / 16) for a micro / small seller billing a GSTIN buyer, from the
 * document's own sender snapshot. Each sentence whose CA item is open says "verify".
 */
export function mfDeclaration(inv: Pick<InvoiceRecord, 'mf' | 'sender' | 'client' | 'doc_type'>): string {
  const mf = inv.mf;
  const out: string[] = [];
  if (mf?.declaration) out.push(mf.declaration);
  else {
    if (mf?.scrap?.tcs) out.push('Waste and scrap — TCS u/s 394(1) collected (verify with your CA, MF10).');
    if (mf?.export_aa?.aa_no) out.push(`Goods supplied under Advance Authorisation no. ${mf.export_aa.aa_no}${mf.export_aa.sion ? `, SION ${mf.export_aa.sion}` : ''} (verify, MF16).`);
    if (mf?.recycled_pct !== undefined) out.push(`Recycled content ${mf.recycled_pct}% (PWM Rules; verify, MF27).`);
  }
  const s = inv.sender;
  if (s?.msme_udyam && (s.msme_category === 'MICRO' || s.msme_category === 'SMALL') && inv.client?.gstin?.trim() && inv.doc_type !== 'QUOTATION') {
    out.push(`Payment due within ${MSME_PAYMENT_DAYS.agreed} days of acceptance — MSMED Act 2006 Sec 15; interest u/s 16 beyond (verify, MF22).`);
  }
  return out.join(' ');
}

/**
 * R14 (PS-A5): the sub-line under a fee-note line from the document's `ps` snapshot: "Matter RSK/014" / "UDIN …" /
 * "Stage 3 of 5 — working drawings" / "RO 0042" / "Covered by the agreed fee". '' without `ps` (plain bills unchanged).
 */
export function psLineText(item: { id?: string } | undefined, ps: PsSnapshot | undefined): string {
  const l = item?.id ? ps?.lines?.[item.id] : undefined;
  if (!l) return '';
  return [l.matter && `Matter ${l.matter}`, l.udin && `UDIN ${l.udin}`, l.stage, l.ro && `RO ${l.ro}`, l.covered && 'Covered by the agreed fee'].filter(Boolean).join(' · ');
}

/** R15-B4: ticket particulars under a line from the document's `tv.lines[lineId].tkt` (C1); '' otherwise. */
export function tvLineText(item: { id?: string } | undefined, tv: TvSnapshot | undefined): string {
  const k = item?.id ? tv?.lines?.[item.id]?.tkt : undefined;
  return k ? [k.pax, k.airline, k.ticket_no && `Tkt ${k.ticket_no}`, k.pnr && `PNR ${k.pnr}`, k.sector, k.basic && `Basic ${k.basic.toFixed(2)} + taxes ${(k.taxes ?? 0).toFixed(2)}${k.airline_gst ? ` + airline GST ${k.airline_gst.toFixed(2)}` : ''}`].filter(Boolean).join(' · ') : ''; // R15-C1: fare split
}

/** R17-A4: post particulars under a line from the document's `mp.posts` row of that line (B fills `line_id`); '' otherwise. */
export function mpLineText(item: { id?: string } | undefined, mp: MpSnapshot | undefined): string {
  const p = item?.id ? mp?.posts?.find((r) => r.line_id === item.id) : undefined;
  return p ? [p.site, `${p.post} × ${p.heads}`, p.duties != null && `${p.duties} duties`].filter(Boolean).join(' · ') : '';
}

/** R18-A4: the basis of a society head under its line, from the document's `hs.heads` row of that line (B fills `line_id`); '' otherwise. */
export function hsLineText(item: { id?: string } | undefined, hs: HsSnapshot | undefined): string {
  const h = item?.id ? hs?.heads?.find((r) => r.line_id === item.id) : undefined;
  return h?.basis ?? '';
}

/** R19-A4: under a pure-agent line of a job document (`charge_head_id: 'rule33'`), "Recovered at actual (Rule 33)"; '' otherwise. */
export function lgLineText(item: { charge_head_id?: string } | undefined, lg: LgSnapshot | undefined): string {
  return lg && item?.charge_head_id === 'rule33' ? 'Recovered at actual (Rule 33)' : '';
}

/**
 * R14 (PS-A5): the declarations of a professional document, from its snapshot only — the legal-services regime (B2),
 * disbursements recovered as pure agent (B1 lines carry `charge_head_id: 'rule33'`), the export check (C1) and the
 * unregistered supplier (C5). Each sentence whose CA item is open says "verify". '' without `ps`.
 */
export function psDeclaration(inv: Pick<InvoiceRecord, 'ps' | 'items'>): string {
  const ps = inv.ps;
  if (!ps) return '';
  const out: string[] = [];
  if (ps.legal?.regime === 'rcm') out.push('GST on this supply is payable by the recipient under reverse charge — N 13/2017-CT(R) entry 2 (verify, PS1).');
  if (ps.legal?.regime === 'exempt') out.push('Exempt legal services — N 12/2017-CT(R) entry 45 (verify, PS1).');
  if (inv.items?.some((i) => i.charge_head_id === 'rule33')) out.push('Disbursements recovered at actual as pure agent (Rule 33) — outside the taxable value (verify, PS3).');
  if (ps.export?.checks?.length) out.push(`Export of services: Sec 2(6) IGST conditions checked ${ps.export.checks.filter((c) => c.ok).length} of ${ps.export.checks.length} (verify, PS5).`);
  if (ps.unregistered) out.push('Supplier not registered under GST (verify, PS13).');
  return out.join(' ');
}

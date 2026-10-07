/**
 * Pre-flight validators for the e-Invoice and e-Way Bill JSON.
 *
 * `errors` block the upload (the portal would reject the file); `warnings`
 * are things worth a second look. Everything here is offline — GSTIN checks
 * are structural + checksum only, not a registration lookup.
 */

import type { InvoiceRecord } from '../types/invoice';
import { checkGstin } from './gstin';
import { stateByCode } from './india-states';
import { round2 } from './invoice-calc';
import {
  DOC_NO_REGEX,
  UQC_CODES,
  buildEInvoice,
  dayKey,
  eInvoiceDocType,
  isServiceHsn,
  isUnitGuessed,
  issue,
  nicDateKey,
  type EInvParty,
  type EInvoiceOptions,
  type EInvoicePayload,
  type PreflightIssue,
} from './einvoice';
import {
  EWAY_THRESHOLD,
  VEHICLE_REGEX,
  buildEway,
  type EwayBill,
  type EwayOptions,
} from './eway';

export interface PreflightResult {
  errors: PreflightIssue[];
  warnings: PreflightIssue[];
  /** No blocking errors. */
  ready: boolean;
}

export function splitIssues(all: PreflightIssue[]): PreflightResult {
  const errors = all.filter((i) => i.severity === 'error');
  const warnings = all.filter((i) => i.severity === 'warning');
  return { errors, warnings, ready: errors.length === 0 };
}

/** Tolerance, in rupees, for reconciling computed amounts. */
export const RECONCILE_TOLERANCE = 1;

const near = (a: number, b: number, tol = RECONCILE_TOLERANCE) => Math.abs(a - b) <= tol + 1e-9;

const PIN_RE = /^[1-9]\d{5}$/;

function checkParty(
  out: PreflightIssue[],
  label: 'Seller' | 'Buyer',
  p: EInvParty,
  opts: { foreign?: boolean },
) {
  const f = (s: string) => `${label} ${s}`;
  const who = label === 'Seller' ? 'seller (your sender profile)' : 'buyer (client)';

  if (opts.foreign && label === 'Buyer') {
    if (!p.LglNm) out.push(issue('error', 'BUYER_NAME', f('name'), 'Buyer name is missing.'));
    return;
  }

  const g = checkGstin(p.Gstin);
  if (!g.valid) {
    out.push(
      issue(
        'error',
        `${label.toUpperCase()}_GSTIN`,
        f('GSTIN'),
        p.Gstin
          ? `${label} GSTIN "${p.Gstin}" is invalid: ${g.message}.`
          : label === 'Seller'
            ? 'Seller GSTIN is missing — add it to the sender profile in Settings.'
            : 'Buyer GSTIN is missing. e-Invoicing applies to B2B supplies only; for unregistered buyers an IRN is not required.',
      ),
    );
  } else if (g.stateCode !== p.Stcd) {
    out.push(issue('error', `${label.toUpperCase()}_STATE_GSTIN`, f('state'), `${label} state code ${p.Stcd || '(blank)'} does not match the first two digits of the GSTIN (${g.stateCode}).`));
  }

  if (p.LglNm.length < 3 || p.LglNm.length > 100) {
    out.push(issue('error', `${label.toUpperCase()}_NAME`, f('name'), `${label} legal name must be 3–100 characters (currently ${p.LglNm.length}).`));
  }
  if (!p.Addr1 || p.Addr1.length > 100) {
    out.push(issue('error', `${label.toUpperCase()}_ADDR`, f('address'), `${label} address line 1 is required (max 100 characters). Fill the ${who} address.`));
  }
  if (!p.Loc || p.Loc.length < 3 || p.Loc.length > 50) {
    out.push(issue('error', `${label.toUpperCase()}_LOC`, f('place'), `${label} city/place must be 3–50 characters.`));
  }
  if (!PIN_RE.test(String(p.Pin))) {
    out.push(issue('error', `${label.toUpperCase()}_PIN`, f('PIN code'), `${label} PIN code must be 6 digits (found "${p.Pin || 'none'}").`));
  }
  if (!stateByCode(p.Stcd) || p.Stcd === '99') {
    out.push(issue('error', `${label.toUpperCase()}_STATE`, f('state'), `${label} state code "${p.Stcd}" is not a valid GST state code.`));
  }
  if (label === 'Buyer' && p.Pos && !stateByCode(p.Pos)) {
    out.push(issue('error', 'BUYER_POS', 'Place of supply', `Place of supply "${p.Pos}" is not a valid state code.`));
  }
}

/**
 * Validate a built e-Invoice payload. Optionally cross-checks the source
 * record so doc type, status and stored totals are covered too.
 */
export function validateEInvoice(
  payload: EInvoicePayload,
  record?: InvoiceRecord,
  opts: { now?: Date } = {},
): PreflightIssue[] {
  const out: PreflightIssue[] = [];
  const now = opts.now ?? new Date();
  // Deemed exports (DEXP) are supplies to domestic registered buyers, not overseas ones.
  const foreign = payload.TranDtls.SupTyp.startsWith('EXP');

  // ── Source document ──
  if (record) {
    if (!eInvoiceDocType(record)) {
      out.push(issue('error', 'DOC_TYPE', 'Document', `${record.doc_type.replace('_', ' ').toLowerCase()} documents are not reported to the IRP. Only tax invoices and credit/debit notes are.`));
    }
    if (record.status === 'Cancelled') {
      out.push(issue('error', 'CANCELLED', 'Document', 'This invoice is cancelled.'));
    } else if (record.status === 'Draft') {
      out.push(issue('warning', 'DRAFT', 'Document', 'Invoice is still a Draft — finalise it before reporting to the IRP.'));
    }
    if (record.gst_mode === 'NONE') {
      out.push(issue('warning', 'NO_GST', 'Tax', 'Invoice has no GST charged (mode: none). Confirm it is a nil-rated/exempt supply; the JSON reports 0% on every line.'));
    }
    if (record.gst_mode === 'SINGLE') {
      out.push(issue('warning', 'SINGLE_TAX', 'Tax', 'Invoice uses a single combined tax line; it is reported as IGST. Re-save it with CGST/SGST or IGST for an accurate split.'));
    }
    if (!record.client?.gstin && !foreign) {
      out.push(issue('warning', 'B2C', 'Buyer', 'No buyer GSTIN: this looks like a B2C sale, which does not need an e-Invoice.'));
    }
    for (const [i, raw] of (record.items ?? []).entries()) {
      if (isUnitGuessed(raw.unit)) {
        out.push(issue('warning', 'ITEM_UNIT_GUESS', `Item ${i + 1}`, `Item ${i + 1}: unit "${raw.unit}" has no standard UQC and is sent as OTH.`));
      }
    }
    const stored = Number(record.total);
    if (Number.isFinite(stored) && !near(stored, payload.ValDtls.TotInvVal)) {
      out.push(issue('warning', 'STORED_TOTAL', 'Totals', `Saved invoice total (₹${stored}) differs from the recalculated total (₹${payload.ValDtls.TotInvVal}). Open and re-save the invoice.`));
    }
  }

  // ── Document ──
  const doc = payload.DocDtls;
  if (!doc.No) {
    out.push(issue('error', 'DOC_NO_EMPTY', 'Document number', 'Invoice number is missing.'));
  } else if (doc.No.length > 16) {
    out.push(issue('error', 'DOC_NO_LEN', 'Document number', `Invoice number "${doc.No}" is ${doc.No.length} characters; the IRP allows at most 16. Shorten the invoice prefix in Settings.`));
  } else if (!DOC_NO_REGEX.test(doc.No)) {
    out.push(issue('error', 'DOC_NO_CHARS', 'Document number', `Invoice number "${doc.No}" has characters the IRP rejects. Use only letters, digits, "/" and "-", and do not start with 0, "/" or "-".`));
  }
  const dKey = nicDateKey(doc.Dt);
  if (!doc.Dt || dKey === null) {
    out.push(issue('error', 'DOC_DATE', 'Document date', 'Invoice date is missing or not a valid dd/mm/yyyy date.'));
  } else if (dKey > dayKey(now)) {
    out.push(issue('error', 'DOC_DATE_FUTURE', 'Document date', 'Invoice date is in the future; the IRP does not accept future-dated documents.'));
  }
  if (doc.Typ !== 'INV' && !payload.PrecDocDtls?.length) {
    out.push(issue('warning', 'PRECEDING_DOC', 'Document', 'Credit/debit notes should reference the original invoice (number and date).'));
  }
  for (const [i, p] of (payload.PrecDocDtls ?? []).entries()) {
    if (!p.InvNo || nicDateKey(p.InvDt) === null) {
      out.push(issue('error', 'PRECEDING_FMT', `Preceding document ${i + 1}`, 'Original invoice needs a number and a dd/mm/yyyy date.'));
    }
  }

  // ── Parties ──
  checkParty(out, 'Seller', payload.SellerDtls, {});
  checkParty(out, 'Buyer', payload.BuyerDtls, { foreign });

  const sg = payload.SellerDtls.Gstin;
  if (!foreign && sg && sg === payload.BuyerDtls.Gstin) {
    out.push(issue('error', 'SAME_GSTIN', 'Parties', 'Seller and buyer GSTIN are identical.'));
  }

  // ── Tax-type consistency ──
  const { CgstVal, SgstVal, IgstVal } = payload.ValDtls;
  const pos = payload.BuyerDtls.Pos ?? '';
  const sellerState = payload.SellerDtls.Stcd;
  if (!foreign) {
    if (pos && sellerState && pos === sellerState && IgstVal > 0 && payload.TranDtls.IgstOnIntra !== 'Y') {
      out.push(issue('error', 'IGST_INTRA', 'Tax', 'IGST charged on an intra-state supply (seller state = place of supply).'));
    }
    if (pos && sellerState && pos !== sellerState && (CgstVal > 0 || SgstVal > 0)) {
      out.push(issue('error', 'CGST_INTER', 'Tax', 'CGST/SGST charged on an inter-state supply (place of supply differs from seller state). Use IGST.'));
    }
    if (payload.TranDtls.IgstOnIntra === 'Y') {
      out.push(issue('warning', 'IGST_ON_INTRA', 'Tax', 'IGST is charged although seller state equals place of supply; the file sets IgstOnIntra = Y. This is only valid for specific cases (e.g. SEZ-related supplies).'));
    }
  }
  if (payload.TranDtls.SupTyp === 'EXPWOP' || payload.TranDtls.SupTyp === 'SEZWOP') {
    if (IgstVal > 0) {
      out.push(issue('error', 'IGST_WOP', 'Tax', 'Supply "without payment of tax" must not carry IGST.'));
    }
  }
  if (payload.TranDtls.SupTyp === 'EXPWP' || payload.TranDtls.SupTyp === 'SEZWP') {
    if (IgstVal <= 0 && payload.ValDtls.AssVal > 0) {
      out.push(issue('error', 'IGST_WP', 'Tax', 'Supply "with payment of tax" must carry IGST.'));
    }
  }
  if (foreign && !payload.ExpDtls?.CntCode) {
    out.push(issue('warning', 'EXPORT_COUNTRY', 'Export', 'Export country code (e.g. US) is not set — add it in the Export details.'));
  }

  // ── Items ──
  const items = payload.ItemList;
  if (items.length === 0) {
    out.push(issue('error', 'NO_ITEMS', 'Items', 'Invoice has no line items.'));
  }
  if (items.length > 1000) {
    out.push(issue('error', 'TOO_MANY_ITEMS', 'Items', 'The IRP accepts at most 1000 line items per invoice.'));
  }

  let sumAss = 0;
  let sumCgst = 0;
  let sumSgst = 0;
  let sumIgst = 0;
  let sumTot = 0;
  for (const it of items) {
    const f = `Item ${it.SlNo}`;
    const name = it.PrdDesc ? ` "${it.PrdDesc.slice(0, 30)}"` : '';
    const at = `${f}${name}`;
    if (!it.PrdDesc) out.push(issue('error', 'ITEM_DESC', f, `${f} has no description.`));
    if (!/^\d{4,8}$/.test(it.HsnCd)) {
      out.push(issue('error', 'ITEM_HSN', f, it.HsnCd ? `${at}: HSN/SAC "${it.HsnCd}" must be 4–8 digits.` : `${at}: HSN/SAC code is missing.`));
    } else {
      if (it.HsnCd.length < 6) {
        out.push(issue('warning', 'ITEM_HSN_SHORT', f, `${at}: HSN "${it.HsnCd}" has ${it.HsnCd.length} digits. 6 digits are mandatory if annual turnover exceeds ₹5 crore (4 is fine below that).`));
      }
      if (it.HsnCd.length === 7) {
        out.push(issue('error', 'ITEM_HSN_LEN', f, `${at}: HSN "${it.HsnCd}" must be 4, 6 or 8 digits.`));
      }
      if (isServiceHsn(it.HsnCd) !== (it.IsServc === 'Y')) {
        out.push(issue('warning', 'ITEM_SERVICE_FLAG', f, `${at}: service flag does not match the code type (SAC codes start with 99).`));
      }
    }
    if (!(UQC_CODES as readonly string[]).includes(it.Unit)) {
      out.push(issue('error', 'ITEM_UNIT', f, `${at}: unit "${it.Unit}" is not a valid UQC.`));
    }
    if (!(it.Qty >= 0)) out.push(issue('error', 'ITEM_QTY', f, `${at}: quantity cannot be negative.`));
    if (it.Qty === 0) out.push(issue('warning', 'ITEM_QTY_ZERO', f, `${at}: quantity is zero.`));
    if (!(it.UnitPrice >= 0)) out.push(issue('error', 'ITEM_PRICE', f, `${at}: unit price cannot be negative.`));
    if (!(it.TotAmt >= 0) || !(it.AssAmt >= 0) || !(it.TotItemVal >= 0) || !(it.Discount >= 0)) {
      out.push(issue('error', 'ITEM_NEGATIVE', f, `${at}: amounts must not be negative.`));
    }
    if (it.GstRt < 0 || it.GstRt > 40) {
      out.push(issue('error', 'ITEM_RATE', f, `${at}: GST rate ${it.GstRt}% is outside the accepted range.`));
    }
    if (!near(it.Qty * it.UnitPrice, it.TotAmt)) {
      out.push(issue('error', 'ITEM_TOTAMT', f, `${at}: quantity × unit price (${round2(it.Qty * it.UnitPrice)}) does not match gross amount (${it.TotAmt}).`));
    }
    if (!near(it.TotAmt - it.Discount, it.AssAmt)) {
      out.push(issue('error', 'ITEM_ASSAMT', f, `${at}: gross − discount (${round2(it.TotAmt - it.Discount)}) does not match taxable amount (${it.AssAmt}).`));
    }
    const taxSum = it.IgstAmt + it.CgstAmt + it.SgstAmt;
    if (!near((it.AssAmt * it.GstRt) / 100, taxSum)) {
      out.push(issue('error', 'ITEM_TAX', f, `${at}: tax amount (${round2(taxSum)}) does not match ${it.GstRt}% of taxable value (${round2((it.AssAmt * it.GstRt) / 100)}).`));
    }
    const cessSum = (it.CesAmt ?? 0) + (it.CesNonAdvlAmt ?? 0);
    if (!near(it.AssAmt + taxSum + cessSum, it.TotItemVal)) {
      out.push(issue('error', 'ITEM_TOTVAL', f, `${at}: item total (${it.TotItemVal}) does not equal taxable + tax (${round2(it.AssAmt + taxSum + cessSum)}).`));
    }
    sumAss += it.AssAmt;
    sumCgst += it.CgstAmt;
    sumSgst += it.SgstAmt;
    sumIgst += it.IgstAmt;
    sumTot += it.TotItemVal;
  }

  // ── Totals ──
  const v = payload.ValDtls;
  if (!(v.TotInvVal > 0)) {
    out.push(issue('error', 'TOTAL_ZERO', 'Totals', 'Invoice total must be greater than zero.'));
  }
  if (v.OthChrg !== undefined && v.OthChrg < 0) {
    out.push(issue('error', 'OTHCHRG_NEG', 'Totals', 'Net "other charges" are negative; the IRP does not allow a negative other-charges value. Use a discount instead.'));
  }
  if (!near(sumAss, v.AssVal)) {
    out.push(issue('error', 'SUM_ASSVAL', 'Totals', `Sum of item taxable values (${round2(sumAss)}) does not match the invoice taxable value (${v.AssVal}).`));
  }
  if (!near(sumCgst, v.CgstVal)) out.push(issue('error', 'SUM_CGST', 'Totals', `Item CGST (${round2(sumCgst)}) does not match invoice CGST (${v.CgstVal}).`));
  if (!near(sumSgst, v.SgstVal)) out.push(issue('error', 'SUM_SGST', 'Totals', `Item SGST (${round2(sumSgst)}) does not match invoice SGST (${v.SgstVal}).`));
  if (!near(sumIgst, v.IgstVal)) out.push(issue('error', 'SUM_IGST', 'Totals', `Item IGST (${round2(sumIgst)}) does not match invoice IGST (${v.IgstVal}).`));
  const expectTotal = sumTot + (v.OthChrg ?? 0) - (v.Disc ?? 0) + v.RndOffAmt;
  if (!near(expectTotal, v.TotInvVal)) {
    out.push(issue('error', 'SUM_TOTAL', 'Totals', `Invoice total (${v.TotInvVal}) does not reconcile with items + other charges + round-off (${round2(expectTotal)}).`));
  }
  if (Math.abs(v.RndOffAmt) > 5) {
    out.push(issue('error', 'ROUNDOFF', 'Totals', 'Round-off must be within ±₹5.'));
  }

  return out;
}

/** One call: build, validate, merge generator assumptions. */
export function preflightEInvoice(
  record: InvoiceRecord,
  options: EInvoiceOptions & { now?: Date } = {},
): PreflightResult & { payload: EInvoicePayload } {
  const { payload, assumptions } = buildEInvoice(record, options);
  const issues = [...validateEInvoice(payload, record, { now: options.now }), ...assumptions];
  return { ...splitIssues(issues), payload };
}

/* ── e-Way Bill ────────────────────────────────────────────────── */

export function validateEway(bill: EwayBill, record?: InvoiceRecord, opts: { now?: Date; skippedServiceLines?: number } = {}): PreflightIssue[] {
  const out: PreflightIssue[] = [];
  const now = opts.now ?? new Date();

  if (record && (record.doc_type === 'QUOTATION' || record.doc_type === 'PROFORMA')) {
    out.push(issue('error', 'EWB_DOC_TYPE', 'Document', 'Quotations and proforma invoices do not need an e-Way Bill.'));
  }

  const sg = checkGstin(bill.fromGstin);
  if (!sg.valid) out.push(issue('error', 'EWB_FROM_GSTIN', 'Dispatch from', `Seller GSTIN is invalid: ${sg.message}.`));
  if (bill.toGstin !== 'URP') {
    const bg = checkGstin(bill.toGstin);
    if (!bg.valid) out.push(issue('error', 'EWB_TO_GSTIN', 'Ship to', `Buyer GSTIN is invalid: ${bg.message}. Use "URP" for unregistered buyers.`));
  }

  if (!bill.docNo || bill.docNo.length > 16 || !DOC_NO_REGEX.test(bill.docNo)) {
    out.push(issue('error', 'EWB_DOC_NO', 'Document number', 'Document number must be 1–16 characters of letters, digits, "/" or "-".'));
  }
  const dk = nicDateKey(bill.docDate);
  if (dk === null) out.push(issue('error', 'EWB_DOC_DATE', 'Document date', 'Document date must be a valid dd/mm/yyyy date.'));
  else if (dk > dayKey(now)) out.push(issue('error', 'EWB_DOC_DATE_FUTURE', 'Document date', 'Document date cannot be in the future.'));

  if (!bill.fromTrdName) out.push(issue('error', 'EWB_FROM_NAME', 'Dispatch from', 'Seller name is missing.'));
  if (!bill.toTrdName) out.push(issue('error', 'EWB_TO_NAME', 'Ship to', 'Buyer name is missing.'));
  if (!PIN_RE.test(String(bill.fromPincode))) out.push(issue('error', 'EWB_FROM_PIN', 'Dispatch from', 'Dispatch PIN code must be 6 digits.'));
  if (!PIN_RE.test(String(bill.toPincode))) out.push(issue('error', 'EWB_TO_PIN', 'Ship to', 'Delivery PIN code must be 6 digits.'));
  if (!stateByCode(String(bill.fromStateCode).padStart(2, '0'))) out.push(issue('error', 'EWB_FROM_STATE', 'Dispatch from', 'Dispatch state code is not valid.'));
  if (!stateByCode(String(bill.toStateCode).padStart(2, '0'))) out.push(issue('error', 'EWB_TO_STATE', 'Ship to', 'Delivery state code is not valid.'));
  if (!bill.fromAddr1) out.push(issue('error', 'EWB_FROM_ADDR', 'Dispatch from', 'Dispatch address is missing.'));
  if (!bill.toAddr1) out.push(issue('error', 'EWB_TO_ADDR', 'Ship to', 'Delivery address is missing.'));
  if (!bill.fromPlace || !bill.toPlace) out.push(issue('error', 'EWB_PLACE', 'Places', 'Dispatch and delivery places (city) are required.'));

  // Value / threshold
  if (bill.itemList.length === 0) {
    out.push(issue('error', 'EWB_NO_GOODS', 'Items', 'No goods on this invoice — e-Way Bills apply to movement of goods, not services (SAC 99xxxx).'));
  } else if (opts.skippedServiceLines) {
    out.push(issue('warning', 'EWB_SERVICES_SKIPPED', 'Items', `${opts.skippedServiceLines} service line(s) were left out of the e-Way file; it covers goods only.`));
  }
  if (!(bill.totInvValue > 0)) out.push(issue('error', 'EWB_VALUE', 'Value', 'Consignment value must be greater than zero.'));
  if (bill.totInvValue <= EWAY_THRESHOLD && bill.itemList.length > 0) {
    out.push(issue('warning', 'EWB_BELOW_THRESHOLD', 'Value', `Consignment value is ₹${bill.totInvValue.toLocaleString('en-IN')}, at or below the ₹50,000 threshold. An e-Way Bill is not mandatory for it (some states and goods differ).`));
  }
  const parts = bill.totalValue + bill.cgstValue + bill.sgstValue + bill.igstValue + bill.cessValue + bill.TotNonAdvolVal + bill.OthValue;
  if (!near(parts, bill.totInvValue, 1 + 1) && bill.itemList.length > 0) {
    out.push(issue('warning', 'EWB_RECONCILE', 'Value', `Value breakup (${round2(parts)}) differs from the total (${bill.totInvValue}) by more than the round-off allowance.`));
  }
  if (bill.itemList.some((i) => !i.hsnCode || String(i.hsnCode).length < 4)) {
    out.push(issue('error', 'EWB_HSN', 'Items', 'Every goods line needs a 4–8 digit HSN code.'));
  }
  if (bill.itemList.some((i) => !(i.quantity > 0))) {
    out.push(issue('error', 'EWB_QTY', 'Items', 'Every goods line needs a quantity above zero.'));
  }

  // Transport
  const dist = Number(bill.transDistance);
  if (!Number.isInteger(dist) || dist < 0 || dist > 4000) {
    out.push(issue('error', 'EWB_DISTANCE', 'Transport', 'Distance must be a whole number of km between 0 and 4000 (0 lets the portal compute it).'));
  } else if (dist === 0) {
    out.push(issue('warning', 'EWB_DISTANCE_ZERO', 'Transport', 'Distance is 0 — the portal will calculate it from the PIN codes.'));
  }

  const road = bill.transMode === 1;
  if (bill.vehicleNo) {
    if (!road) {
      out.push(issue('warning', 'EWB_VEHICLE_MODE', 'Transport', 'A vehicle number is only used for road transport.'));
    } else if (!VEHICLE_REGEX.test(bill.vehicleNo)) {
      out.push(issue('error', 'EWB_VEHICLE', 'Transport', `Vehicle number "${bill.vehicleNo}" is not a valid registration (e.g. MH12AB1234, DL1CAB1234 or 22BH1234AA).`));
    }
  }
  if (bill.transporterId) {
    const tg = checkGstin(bill.transporterId);
    if (!tg.valid) out.push(issue('error', 'EWB_TRANSPORTER', 'Transport', `Transporter ID must be a valid GSTIN: ${tg.message}.`));
  }
  if (!bill.vehicleNo && !bill.transporterId) {
    out.push(issue('error', 'EWB_PARTB', 'Transport', 'Provide either a vehicle number or a transporter GSTIN to upload this bill (otherwise Part-B stays blank and the bill cannot be generated in bulk).'));
  }
  if (!road && bill.transporterId && (!bill.transDocNo || nicDateKey(bill.transDocDate) === null)) {
    out.push(issue('error', 'EWB_TRANSDOC', 'Transport', 'Rail/air/ship movements need the transport document number and date.'));
  }
  if (bill.transDocNo && bill.transDocDate) {
    const tk = nicDateKey(bill.transDocDate);
    if (tk !== null && dk !== null && tk < dk) {
      out.push(issue('error', 'EWB_TRANSDOC_DATE', 'Transport', 'Transport document date cannot be earlier than the invoice date.'));
    }
  }
  return out;
}

export function preflightEway(
  record: InvoiceRecord,
  options: EwayOptions & { now?: Date } = {},
): PreflightResult & { bill: EwayBill; skippedServiceLines: number } {
  const built = buildEway(record, options);
  const issues = [
    ...validateEway(built.bill, record, { now: options.now, skippedServiceLines: built.skippedServiceLines }),
    ...built.assumptions,
  ];
  return { ...splitIssues(issues), bill: built.bill, skippedServiceLines: built.skippedServiceLines };
}

/**
 * e-Invoice (GST IRP) JSON generator — NIC schema v1.1, fully offline.
 *
 * The app never talks to a GST portal. It produces the JSON a taxpayer uploads
 * to the IRP (single or bulk "offline tool"), and stores the IRN / Ack details
 * the portal hands back so they can be printed on the invoice later.
 *
 * Pure logic only (plus thin storage helpers for `einvoice_meta`) so it runs
 * under node:test.
 */

import type { InvoiceRecord, SenderProfile } from '../types/invoice';
import { calculateInvoice, num, round2 } from './invoice-calc';
import { stateByCode, stateByName } from './india-states';
import { getTable, setTable } from './storage';

/* ── Shared issue type (used by both validators) ───────────────── */

export type IssueSeverity = 'error' | 'warning';

export interface PreflightIssue {
  severity: IssueSeverity;
  /** Stable machine code, e.g. SELLER_PIN. */
  code: string;
  /** Human-readable location, e.g. "Seller", "Item 2". */
  field: string;
  message: string;
}

export function issue(
  severity: IssueSeverity,
  code: string,
  field: string,
  message: string,
): PreflightIssue {
  return { severity, code, field, message };
}

/* ── Schema types ──────────────────────────────────────────────── */

export type EInvoiceSupplyType = 'B2B' | 'SEZWP' | 'SEZWOP' | 'EXPWP' | 'EXPWOP' | 'DEXP';
export type EInvoiceDocType = 'INV' | 'CRN' | 'DBN';

export interface EInvParty {
  Gstin: string;
  LglNm: string;
  TrdNm?: string;
  Pos?: string;
  Addr1: string;
  Addr2?: string;
  Loc: string;
  Pin: number;
  Stcd: string;
  Ph?: string;
  Em?: string;
}

export interface EInvItem {
  SlNo: string;
  PrdDesc: string;
  IsServc: 'Y' | 'N';
  HsnCd: string;
  Qty: number;
  Unit: string;
  UnitPrice: number;
  TotAmt: number;
  Discount: number;
  AssAmt: number;
  GstRt: number;
  IgstAmt: number;
  CgstAmt: number;
  SgstAmt: number;
  TotItemVal: number;
}

export interface EInvValDtls {
  AssVal: number;
  CgstVal: number;
  SgstVal: number;
  IgstVal: number;
  Disc?: number;
  OthChrg?: number;
  RndOffAmt: number;
  TotInvVal: number;
}

export interface EInvExpDtls {
  ShipBNo?: string;
  ShipBDt?: string;
  Port?: string;
  RefClm?: 'Y' | 'N';
  ForCur?: string;
  CntCode?: string;
}

export interface EInvoicePayload {
  Version: '1.1';
  TranDtls: {
    TaxSch: 'GST';
    SupTyp: EInvoiceSupplyType;
    RegRev: 'Y' | 'N';
    IgstOnIntra: 'Y' | 'N';
  };
  DocDtls: { Typ: EInvoiceDocType; No: string; Dt: string };
  SellerDtls: EInvParty;
  BuyerDtls: EInvParty;
  ItemList: EInvItem[];
  ValDtls: EInvValDtls;
  PrecDocDtls?: { InvNo: string; InvDt: string }[];
  ExpDtls?: EInvExpDtls;
}

export interface EInvoiceOptions {
  /** Override the auto-detected supply type (SEZ / deemed export cannot be inferred). */
  supplyType?: EInvoiceSupplyType;
  /** Override INV/CRN; use DBN for debit notes (the app has no debit-note type). */
  docType?: EInvoiceDocType;
  /** Used when the invoice has no sender snapshot (legacy records). */
  fallbackSender?: SenderProfile | null;
  /** Manual fixes for fields the app does not store separately. */
  seller?: { loc?: string; pin?: string | number; addr1?: string; addr2?: string };
  buyer?: { loc?: string; pin?: string | number };
  /** Original invoice(s) a credit/debit note refers to. */
  preceding?: { no: string; date: string }[];
  /** Export extras. `date` is yyyy-mm-dd. */
  export?: { shipBillNo?: string; shipBillDate?: string; portCode?: string; countryCode?: string; refundClaim?: boolean };
}

export interface EInvoiceBuild {
  payload: EInvoicePayload;
  /** Fallbacks the generator had to guess — surfaced as warnings. */
  assumptions: PreflightIssue[];
}

/* ── Constants & small helpers ─────────────────────────────────── */

/** Unit Quantity Codes accepted by the IRP / e-Way portal. */
export const UQC_CODES = [
  'BAG', 'BAL', 'BDL', 'BKL', 'BOU', 'BOX', 'BTL', 'BUN', 'CAN', 'CBM', 'CCM', 'CMS', 'CTN',
  'DOZ', 'DRM', 'GGK', 'GMS', 'GRS', 'GYD', 'KGS', 'KLR', 'KME', 'LTR', 'MLT', 'MTR', 'MTS',
  'NOS', 'OTH', 'PAC', 'PCS', 'PRS', 'QTL', 'ROL', 'SET', 'SQF', 'SQM', 'SQY', 'TBS', 'TGM',
  'THD', 'TON', 'TUB', 'UGS', 'UNT', 'YDS',
] as const;

const UNIT_MAP: Record<string, string> = {
  NOS: 'NOS', NO: 'NOS', NUMBERS: 'NOS', PCS: 'PCS', PC: 'PCS', PIECE: 'PCS', PIECES: 'PCS',
  KG: 'KGS', KGS: 'KGS', KILOGRAM: 'KGS', G: 'GMS', GM: 'GMS', GMS: 'GMS', GRAM: 'GMS',
  LTR: 'LTR', L: 'LTR', LITRE: 'LTR', LITER: 'LTR', ML: 'MLT', MTR: 'MTR', M: 'MTR', METER: 'MTR',
  MTS: 'MTS', SQF: 'SQF', SQFT: 'SQF', SQM: 'SQM', BOX: 'BOX', BAG: 'BAG', SET: 'SET',
  SETS: 'SET', DOZ: 'DOZ', PAIR: 'PRS', PRS: 'PRS', PACK: 'PAC', PAC: 'PAC', ROLL: 'ROL',
  TON: 'TON', TONNE: 'TON', QTL: 'QTL', UNT: 'UNT', UNIT: 'UNT', UNITS: 'UNT', CTN: 'CTN',
  // Time / lot based units have no UQC — the portal expects OTH.
  HRS: 'OTH', HR: 'OTH', DAY: 'OTH', DAYS: 'OTH', MONTH: 'OTH', LOT: 'OTH',
};

/** Map the app's free unit text to a portal UQC (falls back to OTH). */
export function mapUnitToUqc(unit?: string): string {
  const key = (unit ?? '').trim().toUpperCase();
  if (!key) return 'OTH';
  if (UNIT_MAP[key]) return UNIT_MAP[key];
  return (UQC_CODES as readonly string[]).includes(key) ? key : 'OTH';
}

/** True when the unit text was not recognised and fell back to OTH by guesswork. */
export function isUnitGuessed(unit?: string): boolean {
  const key = (unit ?? '').trim().toUpperCase();
  return !!key && !(key in UNIT_MAP) && !(UQC_CODES as readonly string[]).includes(key);
}

export interface DateParts {
  y: number;
  m: number;
  d: number;
}

/** Parse yyyy-mm-dd (an ISO timestamp is tolerated) and reject impossible dates. */
export function parseIsoDate(value?: string): DateParts | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((value ?? '').trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return { y, m: mo, d };
}

/** yyyy-mm-dd -> dd/mm/yyyy (the IRP and e-Way date format). Empty string if invalid. */
export function toNicDate(value?: string): string {
  const p = parseIsoDate(value);
  if (!p) return '';
  return `${String(p.d).padStart(2, '0')}/${String(p.m).padStart(2, '0')}/${p.y}`;
}

/** dd/mm/yyyy -> comparable yyyymmdd number, or null. */
export function nicDateKey(value?: string): number | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value ?? '');
  if (!m) return null;
  const probe = new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  if (
    probe.getUTCFullYear() !== Number(m[3]) ||
    probe.getUTCMonth() !== Number(m[2]) - 1 ||
    probe.getUTCDate() !== Number(m[1])
  ) {
    return null;
  }
  return Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]);
}

/** Local calendar day of `now` as yyyymmdd. */
export function dayKey(now: Date): number {
  return now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
}

function clean(s?: string): string {
  return (s ?? '').replace(/\s+/g, ' ').trim();
}

export function normalisePhone(raw?: string): string {
  let digits = (raw ?? '').replace(/\D/g, '');
  if (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length > 10 && digits.startsWith('0')) digits = digits.replace(/^0+/, '');
  return digits.length >= 6 && digits.length <= 12 ? digits : '';
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export function normaliseEmail(raw?: string): string {
  const e = (raw ?? '').trim();
  return EMAIL_RE.test(e) && e.length >= 6 && e.length <= 100 ? e : '';
}

/** Pull a 6-digit PIN out of free-text address. */
export function extractPin(text?: string): number {
  const matches = (text ?? '').match(/(?<!\d)[1-9]\d{5}(?!\d)/g);
  return matches ? Number(matches[matches.length - 1]) : 0;
}

function toPin(value: unknown): number {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length === 6 ? Number(digits) : 0;
}

/** Split a long address into the two 100-char lines the schema allows. */
export function splitAddress(addr: string, max = 100): { addr1: string; addr2: string; truncated: boolean } {
  const text = clean(addr.replace(/\n+/g, ', '));
  if (text.length <= max) return { addr1: text, addr2: '', truncated: false };
  let cut = text.lastIndexOf(',', max);
  if (cut < max * 0.4) cut = text.lastIndexOf(' ', max);
  if (cut <= 0) cut = max;
  const addr1 = clean(text.slice(0, cut).replace(/,\s*$/, ''));
  const rest = clean(text.slice(cut).replace(/^[,\s]+/, ''));
  return { addr1, addr2: rest.slice(0, max), truncated: rest.length > max };
}

/** Best-effort locality: the last address part that is not a PIN or state name. */
export function guessLocality(addr: string, stateName?: string): string {
  const parts = addr
    .split(/[\n,]/)
    .map(clean)
    .filter(Boolean)
    .filter((p) => !/\b[1-9]\d{5}\b/.test(p))
    .filter((p) => !stateName || p.toLowerCase() !== stateName.toLowerCase());
  const last = parts[parts.length - 1] ?? '';
  return last.length >= 3 ? last.slice(0, 50) : '';
}

/** 'FY25-26'-style doc numbers: only A-Z 0-9 / - allowed, first char not 0, / or -. */
export const DOC_NO_REGEX = /^[A-Z1-9][A-Z0-9/-]{0,15}$/;

export function isServiceHsn(hsn?: string): boolean {
  return /^99/.test((hsn ?? '').trim());
}

export function sanitiseFileStem(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'invoice';
}

/** The document types the IRP accepts. Quotes, proformas and challans are not e-invoiceable. */
export function eInvoiceDocType(record: Pick<InvoiceRecord, 'doc_type'>, override?: EInvoiceDocType) {
  if (override) return override;
  if (record.doc_type === 'CREDIT_NOTE') return 'CRN' as const;
  if (record.doc_type === 'INVOICE' || record.doc_type === 'TAX_INVOICE') return 'INV' as const;
  return null;
}

/* ── Builder ───────────────────────────────────────────────────── */

const FOREIGN_STATE = '96';
const FOREIGN_PIN = 999999;

/**
 * Map an InvoiceRecord (+ its sender snapshot) to the IRP JSON for one invoice.
 * Always returns a payload — run `validateEInvoice` on it to find what the
 * portal would reject.
 */
export function buildEInvoice(record: InvoiceRecord, options: EInvoiceOptions = {}): EInvoiceBuild {
  const assumptions: PreflightIssue[] = [];
  const sender = record.sender ?? options.fallbackSender ?? null;
  const client = record.client ?? ({} as InvoiceRecord['client']);

  const calc = calculateInvoice({
    items: record.items ?? [],
    gst_mode: record.gst_mode,
    discount_type: record.discount_type,
    discount_rate: num(record.discount_rate),
    tax_rate: num(record.tax_rate),
    shipping: num(record.shipping),
    other_charges: num(record.other_charges),
    round_off_enabled: !!record.round_off_enabled,
    amount_paid: num(record.amount_paid),
  });

  // ── Seller ──
  const sellerGstin = clean(sender?.companyGstin).toUpperCase();
  const sellerStcd = stateByCode(sender?.stateCode)?.code ?? sellerGstin.slice(0, 2);
  const sellerState = stateByCode(sellerStcd);
  const sellerAddr = splitAddress(options.seller?.addr1 ?? sender?.companyAddress ?? '');
  if (sellerAddr.truncated) {
    assumptions.push(issue('warning', 'SELLER_ADDR_TRUNC', 'Seller', 'Seller address is longer than 200 characters and was truncated.'));
  }
  let sellerLoc = clean(options.seller?.loc) || clean(sender?.city) || guessLocality(sender?.companyAddress ?? '', sellerState?.name);
  if (sellerLoc.length < 3) {
    sellerLoc = sellerState?.name ?? '';
    assumptions.push(issue('warning', 'SELLER_LOC_GUESS', 'Seller', `Seller place could not be read from the address; using "${sellerLoc}". Edit the address so the city is the last line before the PIN.`));
  }
  const seller: EInvParty = {
    Gstin: sellerGstin,
    LglNm: clean(sender?.companyName),
    Addr1: sellerAddr.addr1,
    Loc: sellerLoc.slice(0, 50),
    Pin: toPin(options.seller?.pin) || toPin(sender?.pin) || extractPin(sender?.companyAddress),
    Stcd: sellerStcd,
  };
  if (options.seller?.addr2 ?? sellerAddr.addr2) seller.Addr2 = clean(options.seller?.addr2 ?? sellerAddr.addr2);
  const sellerPh = normalisePhone(sender?.companyPhone);
  if (sellerPh) seller.Ph = sellerPh;
  const sellerEm = normaliseEmail(sender?.companyEmail);
  if (sellerEm) seller.Em = sellerEm;

  // ── Supply classification ──
  const pos = (record.place_of_supply ?? '').trim();
  const isExport = pos === '99' || options.supplyType?.startsWith('EXP') === true || options.supplyType === 'DEXP';
  const hasIgst = calc.igst_amount > 0;
  const supTyp: EInvoiceSupplyType =
    options.supplyType ?? (isExport ? (hasIgst ? 'EXPWP' : 'EXPWOP') : 'B2B');

  // ── Buyer ──
  const buyerGstinRaw = clean(client.gstin).toUpperCase();
  let buyer: EInvParty;
  if (isExport) {
    const cityAddr = splitAddress(client.address ?? '');
    buyer = {
      Gstin: 'URP',
      LglNm: clean(client.company) || clean(client.name),
      Pos: FOREIGN_STATE,
      Addr1: cityAddr.addr1,
      Loc: (clean(options.buyer?.loc) || clean(client.city) || 'Overseas').slice(0, 50),
      Pin: FOREIGN_PIN,
      Stcd: FOREIGN_STATE,
    };
    if (cityAddr.addr2) buyer.Addr2 = cityAddr.addr2;
  } else {
    const gstinState = buyerGstinRaw.length >= 2 ? buyerGstinRaw.slice(0, 2) : '';
    const clientState =
      stateByCode(client.state_code)?.code ?? stateByName(client.state)?.code ?? '';
    if (gstinState && clientState && gstinState !== clientState) {
      assumptions.push(issue('warning', 'BUYER_STATE_MISMATCH', 'Buyer', `Buyer state code ${clientState} differs from the state in their GSTIN (${gstinState}); the GSTIN state is used for Stcd.`));
    }
    const stcd = gstinState || clientState;
    const addr = splitAddress(client.address ?? '');
    buyer = {
      Gstin: buyerGstinRaw,
      LglNm: clean(client.company) || clean(client.name),
      Pos: pos || stcd,
      Addr1: addr.addr1,
      Loc: (clean(options.buyer?.loc) || clean(client.city)).slice(0, 50),
      Pin: toPin(options.buyer?.pin) || toPin(client.zip) || extractPin(client.address),
      Stcd: stcd,
    };
    if (addr.addr2) buyer.Addr2 = addr.addr2;
    if (clean(client.company) && clean(client.name) && clean(client.company) !== clean(client.name)) {
      buyer.TrdNm = clean(client.name).slice(0, 100);
    }
    const ph = normalisePhone(client.phone);
    if (ph) buyer.Ph = ph;
    const em = normaliseEmail(client.email);
    if (em) buyer.Em = em;
  }

  // ── Items ──
  const noTax = record.gst_mode === 'NONE';
  const items: EInvItem[] = calc.lines.map((l, i) => {
    const raw = (record.items ?? [])[i];
    const description = clean(raw?.name) || clean(raw?.description) || `Item ${i + 1}`;
    const rate = noTax ? 0 : l.tax_rate;
    return {
      SlNo: String(i + 1),
      PrdDesc: description.slice(0, 300),
      IsServc: isServiceHsn(l.hsn) ? 'Y' : 'N',
      HsnCd: l.hsn,
      Qty: Math.round(l.quantity * 1000) / 1000,
      Unit: mapUnitToUqc(l.unit),
      UnitPrice: Math.round(l.rate * 1000) / 1000,
      TotAmt: l.gross,
      Discount: round2(l.line_discount + l.invoice_discount),
      AssAmt: l.taxable,
      GstRt: rate,
      IgstAmt: l.igst,
      CgstAmt: l.cgst,
      SgstAmt: l.sgst,
      TotItemVal: round2(l.taxable + l.cgst + l.sgst + l.igst),
    };
  });

  const intra = !!sellerStcd && pos === sellerStcd;
  const othChrg = round2(calc.shipping + calc.other_charges);
  const valDtls: EInvValDtls = {
    AssVal: calc.taxable_value,
    CgstVal: calc.cgst_amount,
    SgstVal: calc.sgst_amount,
    IgstVal: calc.igst_amount,
    RndOffAmt: calc.round_off,
    TotInvVal: calc.total,
  };
  if (othChrg !== 0) valDtls.OthChrg = othChrg;

  const docTyp = eInvoiceDocType(record, options.docType) ?? 'INV';
  const payload: EInvoicePayload = {
    Version: '1.1',
    TranDtls: {
      TaxSch: 'GST',
      SupTyp: supTyp,
      RegRev: record.reverse_charge ? 'Y' : 'N',
      IgstOnIntra: intra && hasIgst ? 'Y' : 'N',
    },
    DocDtls: {
      Typ: docTyp,
      No: clean(record.invoice_number).toUpperCase(),
      Dt: toNicDate(record.issue_date),
    },
    SellerDtls: seller,
    BuyerDtls: buyer,
    ItemList: items,
    ValDtls: valDtls,
  };

  if (options.preceding?.length) {
    payload.PrecDocDtls = options.preceding.map((p) => ({
      InvNo: clean(p.no).toUpperCase(),
      InvDt: p.date.includes('-') ? toNicDate(p.date) : p.date,
    }));
  }

  if (isExport) {
    const exp: EInvExpDtls = {};
    const e = options.export;
    if (e?.shipBillNo) exp.ShipBNo = e.shipBillNo;
    if (e?.shipBillDate) exp.ShipBDt = toNicDate(e.shipBillDate);
    if (e?.portCode) exp.Port = e.portCode.toUpperCase();
    if (e?.refundClaim !== undefined) exp.RefClm = e.refundClaim ? 'Y' : 'N';
    if (record.currency && record.currency !== 'INR') exp.ForCur = record.currency;
    if (e?.countryCode) exp.CntCode = e.countryCode.toUpperCase();
    if (Object.keys(exp).length) payload.ExpDtls = exp;
  }

  return { payload, assumptions };
}

/** Bulk upload wrapper — the IRP offline/bulk tool takes an array of invoices. */
export function buildEInvoiceBulk(payloads: EInvoicePayload[]): EInvoicePayload[] {
  return payloads.slice();
}

export function stringifyEInvoice(payload: EInvoicePayload | EInvoicePayload[]): string {
  // The portal accepts both a bare object and an array; always emit an array
  // so one-file-per-invoice and bulk files share a single code path.
  return JSON.stringify(Array.isArray(payload) ? payload : [payload], null, 2);
}

/* ── einvoice_meta (what the portal returned) ──────────────────── */

export const EINVOICE_META_TABLE = 'einvoice_meta';

export interface EInvoiceMeta {
  invoice_id: string;
  irn?: string;
  ack_no?: string;
  /** As printed by the portal, e.g. "2025-06-18 14:32:10". */
  ack_date?: string;
  /** Signed QR code payload (JWT string) returned by the IRP. */
  signed_qr?: string;
  eway_no?: string;
  eway_date?: string;
  eway_valid_upto?: string;
  /** Vehicle number used to build the e-Way JSON. */
  vehicle?: string;
  vehicle_type?: 'R' | 'O';
  transport?: 'ROAD' | 'RAIL' | 'AIR' | 'SHIP';
  transporter_id?: string;
  transporter_name?: string;
  transport_doc_no?: string;
  transport_doc_date?: string;
  /** Approximate distance in km (0 lets the portal calculate it). */
  distance?: number;
  updated_at?: string;
}

export function getAllEInvoiceMeta(): EInvoiceMeta[] {
  return getTable<EInvoiceMeta>(EINVOICE_META_TABLE);
}

/** Look up what the IRP returned for an invoice — print IRN + QR on templates with this. */
export function getEInvoiceMeta(invoiceId: string): EInvoiceMeta | undefined {
  return getAllEInvoiceMeta().find((m) => m.invoice_id === invoiceId);
}

/** Pure upsert; an all-empty record (besides the id) removes the row. */
export function upsertMeta(rows: EInvoiceMeta[], next: EInvoiceMeta): EInvoiceMeta[] {
  const others = rows.filter((r) => r.invoice_id !== next.invoice_id);
  const hasData = Object.entries(next).some(
    ([k, v]) => k !== 'invoice_id' && k !== 'updated_at' && v !== undefined && v !== '' && v !== null,
  );
  return hasData ? [...others, next] : others;
}

export function saveEInvoiceMeta(meta: EInvoiceMeta): EInvoiceMeta {
  const stamped: EInvoiceMeta = { ...meta, updated_at: new Date().toISOString() };
  setTable(EINVOICE_META_TABLE, upsertMeta(getAllEInvoiceMeta(), stamped));
  return stamped;
}

export function deleteEInvoiceMeta(invoiceId: string): void {
  setTable(
    EINVOICE_META_TABLE,
    getAllEInvoiceMeta().filter((m) => m.invoice_id !== invoiceId),
  );
}

/** Light format checks for what the user pastes back from the portal. */
export function validateMeta(meta: Partial<EInvoiceMeta>): PreflightIssue[] {
  const out: PreflightIssue[] = [];
  const irn = (meta.irn ?? '').trim();
  if (irn && !/^[0-9a-fA-F]{64}$/.test(irn)) {
    out.push(issue('error', 'IRN_FORMAT', 'IRN', 'IRN must be a 64-character hexadecimal hash.'));
  }
  const ack = (meta.ack_no ?? '').trim();
  if (ack && !/^\d{1,15}$/.test(ack)) {
    out.push(issue('error', 'ACK_FORMAT', 'Ack No', 'Ack No should be numeric (up to 15 digits).'));
  }
  const qr = (meta.signed_qr ?? '').trim();
  if (qr && qr.split('.').length !== 3) {
    out.push(issue('warning', 'QR_FORMAT', 'Signed QR', 'Signed QR is normally a three-part token (xxx.yyy.zzz). Paste the full string.'));
  }
  const ew = (meta.eway_no ?? '').trim();
  if (ew && !/^\d{12}$/.test(ew)) {
    out.push(issue('error', 'EWB_FORMAT', 'e-Way Bill No', 'e-Way Bill number is 12 digits.'));
  }
  if (irn && !ack) {
    out.push(issue('warning', 'ACK_MISSING', 'Ack No', 'IRN recorded without an Ack No.'));
  }
  return out;
}

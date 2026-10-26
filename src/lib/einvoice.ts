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

import { isNonGstFinancialNote } from './financial-note';
import { isPureAgentLine } from './trade/pure-agent';
import type { InvoiceRecord, SenderProfile } from '../types/invoice';
import { calcInputFromRecord, calculateInvoice, round2, type CalcLine } from './invoice-calc';
import { docCurrency, inrTotals, missingFxRate } from './fx';
import { stateByCode, stateByName } from './india-states';
import { getTable, setTable } from './storage';
import { uqcFor, type UnitMaster } from './units';

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
  /** Additive: ad valorem cess rate / amount and fixed (non-advol) cess amount. */
  CesRt?: number;
  CesAmt?: number;
  CesNonAdvlAmt?: number;
  TotItemVal: number;
}

export interface EInvValDtls {
  AssVal: number;
  CgstVal: number;
  SgstVal: number;
  IgstVal: number;
  /** Additive: total cess (ad valorem + fixed). */
  CesVal?: number;
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

/** Additive (WP-6): consignee when goods go somewhere other than the buyer's address (from `invoice.ship_to`). */
export interface EInvShipDtls {
  Gstin?: string;
  LglNm: string;
  TrdNm?: string;
  Addr1: string;
  Addr2?: string;
  Loc: string;
  Pin: number;
  Stcd: string;
}

/** Additive (WP-6): dispatch-from address when goods leave from somewhere other than the seller's address. */
export interface EInvDispDtls {
  Nm: string;
  Addr1: string;
  Addr2?: string;
  Loc: string;
  Pin: number;
  Stcd: string;
}

/** Additive (WP-6): payee / payment terms (from the sender's bank details and the due date). */
export interface EInvPayDtls {
  Nm?: string;
  AccDet?: string;
  Mode?: string;
  FinInsBr?: string;
  PayTerm?: string;
  PayInstr?: string;
  CrTrn?: string;
  DirDr?: string;
  CrDay?: number;
  PaidAmt?: number;
  PaymtDue?: number;
}

/** Additive (WP-6): Part-B e-Way details generated with the IRN (from `invoice.transport`). */
export interface EInvEwbDtls {
  TransId?: string;
  TransName?: string;
  TransMode?: '1' | '2' | '3' | '4';
  Distance: number;
  TransDocNo?: string;
  TransDocDt?: string;
  VehNo?: string;
  VehType?: 'R' | 'O';
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
  DispDtls?: EInvDispDtls;
  ShipDtls?: EInvShipDtls;
  PayDtls?: EInvPayDtls;
  EwbDtls?: EInvEwbDtls;
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
  /** Additive (WP-6): dispatch-from address (godown / branch) when it is not the seller's address. */
  dispatch?: { name?: string; address?: string; city?: string; pin?: string | number; state_code?: string };
  /** Additive (WP-6): leave out PayDtls (default: included when the sender has bank details). */
  withPayment?: boolean;
  /** Additive (WP-6): leave out EwbDtls (default: included when `invoice.transport` names a vehicle, transporter or LR). */
  withEwb?: boolean;
  /** Additive (WP-8): the units master (`unitsDb.stored()`): a unit with its own UQC is sent as that UQC. */
  units?: readonly UnitMaster[];
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

/**
 * Portal UQC of a line unit (WP-8): the units master's UQC when the unit has one (and it is a portal
 * code), else the built-in mapping (`mapUnitToUqc`).
 */
export function portalUqc(unit: string | undefined, units: readonly UnitMaster[] = []): string {
  const u = uqcFor(unit, units, mapUnitToUqc);
  return (UQC_CODES as readonly string[]).includes(u) ? u : mapUnitToUqc(unit);
}

/** Map the app's free unit text to a portal UQC (falls back to OTH). */
export function mapUnitToUqc(unit?: string): string {
  const key = (unit ?? '').trim().toUpperCase();
  if (!key) return 'OTH';
  if (UNIT_MAP[key]) return UNIT_MAP[key];
  return (UQC_CODES as readonly string[]).includes(key) ? key : 'OTH';
}

/** True when the unit text was not recognised and fell back to OTH by guesswork (a units-master UQC is not a guess). */
export function isUnitGuessed(unit?: string, units: readonly UnitMaster[] = []): boolean {
  if (units.length && (UQC_CODES as readonly string[]).includes(uqcFor(unit, units, () => ''))) return false;
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
export function eInvoiceDocType(record: Pick<InvoiceRecord, 'doc_type'> & Partial<InvoiceRecord>, override?: EInvoiceDocType) {
  // A Bill of Supply is outside e-invoicing (Rule 48(4) covers tax invoices and notes only), even with an override.
  if (record.doc_type === 'BILL_OF_SUPPLY') return null;
  // R2-A2: a financial credit note without GST (settlement discount / kasar / bad debt) is not reported to the IRP.
  if (isNonGstFinancialNote(record)) return null;
  if (override) return override;
  if (record.doc_type === 'CREDIT_NOTE') return 'CRN' as const;
  if (record.doc_type === 'DEBIT_NOTE') return 'DBN' as const;
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

  // Full record in: supply type, tax-inclusive pricing, cess, TCS and round mode all change ValDtls.
  // The IRP takes rupees only: a foreign-currency invoice is converted at its exchange rate
  // (ExpDtls.ForCur then names the original currency).
  // Reverse charge (RegRev 'Y'): the schema's value totals still include the tax shown on the invoice
  // (NIC adds AssVal + tax heads), so the recipient-pays tax is kept in TotInvVal here.
  const calc = inrTotals(calculateInvoice(calcInputFromRecord(record, { rcm_exclude_tax: false })), record);
  if (missingFxRate(record)) {
    assumptions.push(issue('error', 'FX_RATE_MISSING', 'Currency', `Amounts are in ${docCurrency(record)} but the invoice has no exchange rate. The IRP needs INR values — add the CBIC / shipping-bill rate on the invoice.`));
  }

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
  const st = record.supply_type;
  // "99" is the app's Other-Country code, "96" the GSTN one: both mean an overseas buyer.
  const isExport =
    pos === '99' ||
    pos === '96' ||
    st === 'EXPORT_LUT' ||
    st === 'EXPORT_WITH_PAYMENT' ||
    options.supplyType?.startsWith('EXP') === true;
  const hasIgst = calc.igst_amount > 0;
  const fromRecord: EInvoiceSupplyType | undefined =
    st === 'EXPORT_LUT' ? 'EXPWOP'
    : st === 'EXPORT_WITH_PAYMENT' ? 'EXPWP'
    : st === 'SEZ_WITH_PAYMENT' ? 'SEZWP'
    : st === 'SEZ_WITHOUT_PAYMENT' ? 'SEZWOP'
    : st === 'DEEMED_EXPORT' ? 'DEXP'
    : undefined;
  const supTyp: EInvoiceSupplyType =
    options.supplyType ?? fromRecord ?? (isExport ? (hasIgst ? 'EXPWP' : 'EXPWOP') : 'B2B');

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
  // QA8 T9: a pure-agent (Rule 33) reimbursement is not a supply: no item, its amount rides in OthChrg.
  const agentIds = new Set((record.items ?? []).filter(isPureAgentLine).map((x) => x.id));
  const agentLines = calc.lines.filter((l) => agentIds.has(l.id));
  const agentTotal = round2(agentLines.reduce((t, l) => t + l.total, 0));
  const agentTaxable = round2(agentLines.reduce((t, l) => t + l.taxable, 0));
  const items: EInvItem[] = calc.lines.map((l, i) => {
    const raw = (record.items ?? [])[i];
    const description = clean(raw?.name) || clean(raw?.description) || `Item ${i + 1}`;
    const rate = noTax ? 0 : l.tax_rate;
    const advol = round2(l.taxable * (l.cess_rate / 100));
    const nonAdvol = round2(l.cess - advol);
    // Tax-inclusive pricing: the IRP wants the EX-tax gross (TotAmt = Qty x UnitPrice, AssAmt = TotAmt - Discount),
    // so back the GST + ad valorem cess out of the inclusive amount instead of printing 11,800 against a 10,000 base.
    const inclusive =
      !!record.price_includes_tax && (l.tax_rate > 0 || l.cess_rate > 0 || l.cess_per_unit > 0);
    const fixedCess = round2(l.quantity * l.cess_per_unit);
    const totAmt = inclusive
      ? round2(Math.max(l.gross - fixedCess, 0) / (1 + (l.tax_rate + l.cess_rate) / 100))
      : l.gross;
    const discount = inclusive
      ? Math.max(round2(totAmt - l.taxable), 0)
      : round2(l.line_discount + l.invoice_discount);
    const unitPrice = inclusive && l.quantity ? totAmt / l.quantity : l.rate;
    return {
      SlNo: String(i + 1),
      PrdDesc: description.slice(0, 300),
      IsServc: isServiceHsn(l.hsn) ? 'Y' : 'N',
      HsnCd: l.hsn,
      Qty: Math.round(l.quantity * 1000) / 1000,
      Unit: portalUqc(l.unit, options.units),
      UnitPrice: Math.round(unitPrice * 1000) / 1000,
      TotAmt: totAmt,
      Discount: discount,
      AssAmt: l.taxable,
      GstRt: rate,
      IgstAmt: l.igst,
      CgstAmt: l.cgst,
      SgstAmt: l.sgst,
      ...(l.cess > 0
        ? { CesRt: l.cess_rate, CesAmt: advol, CesNonAdvlAmt: nonAdvol }
        : {}),
      TotItemVal: round2(l.taxable + l.cgst + l.sgst + l.igst + l.cess),
    };
  });
  if (agentIds.size) {
    const kept = items.filter((_, i) => !agentIds.has(calc.lines[i].id));
    items.length = 0;
    kept.forEach((it, i) => items.push({ ...it, SlNo: String(i + 1) }));
  }
  // Taxable freight / other charges travel as their own item (ValDtls.OthChrg is outside AssVal and
  // carries no tax), under the principal line's HSN and rate, so AssVal and the tax totals reconcile.
  if (calc.charges_line) items.push(chargesItem(calc.charges_line, items.length + 1, noTax));

  const intra = !!sellerStcd && pos === sellerStcd;
  // The IRP has no TCS field: it travels in "other charges" so TotInvVal still reconciles.
  // Untaxed freight / other charges ride there too; taxed ones are an item above.
  const othChrg = round2((calc.charges_line ? 0 : calc.shipping + calc.other_charges) + calc.tcs_amount + agentTotal);
  const valDtls: EInvValDtls = {
    AssVal: round2(calc.taxable_value - agentTaxable),
    CgstVal: calc.cgst_amount,
    SgstVal: calc.sgst_amount,
    IgstVal: calc.igst_amount,
    ...(calc.cess_amount > 0 ? { CesVal: calc.cess_amount } : {}),
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

  // ── Additive (WP-6): DispDtls / ShipDtls / PayDtls / EwbDtls ──
  const disp = options.dispatch;
  if (disp && (clean(disp.address) || clean(disp.state_code))) {
    const a = splitAddress(clean(disp.address));
    const stcd = stateByCode(disp.state_code)?.code ?? sellerStcd;
    const loc = clean(disp.city) || guessLocality(clean(disp.address), stateByCode(stcd)?.name) || (stateByCode(stcd)?.name ?? '');
    payload.DispDtls = { Nm: (clean(disp.name) || seller.LglNm).slice(0, 100), Addr1: a.addr1, Loc: loc.slice(0, 50), Pin: toPin(disp.pin) || extractPin(disp.address), Stcd: stcd };
    if (a.addr2) payload.DispDtls.Addr2 = a.addr2;
    if (!payload.DispDtls.Pin) assumptions.push(issue('warning', 'DISP_PIN', 'Dispatch', 'Dispatch-from address has no 6-digit PIN.'));
  }
  const ship = record.ship_to;
  if (ship && (clean(ship.address) || clean(ship.state_code))) {
    const a = splitAddress(clean(ship.address));
    const shipGstin = clean(ship.gstin).toUpperCase();
    const stcd = (isExport ? FOREIGN_STATE : stateByCode(ship.state_code)?.code) || (shipGstin.length >= 2 ? shipGstin.slice(0, 2) : buyer.Stcd);
    const loc = clean(ship.city) || guessLocality(clean(ship.address), stateByCode(stcd)?.name) || (stateByCode(stcd)?.name ?? '');
    const pin = isExport ? FOREIGN_PIN : toPin(ship.zip) || extractPin(ship.address);
    const sd: EInvShipDtls = { LglNm: (clean(ship.name) || buyer.LglNm).slice(0, 100), Addr1: a.addr1, Loc: loc.slice(0, 50), Pin: pin, Stcd: stcd };
    if (shipGstin) sd.Gstin = shipGstin;
    if (a.addr2) sd.Addr2 = a.addr2;
    payload.ShipDtls = sd;
    if (!pin) assumptions.push(issue('warning', 'SHIP_PIN', 'Ship to', 'Ship-to address has no 6-digit PIN; add it to the delivery address.'));
    if (shipGstin && shipGstin.slice(0, 2) !== stcd) assumptions.push(issue('warning', 'SHIP_STATE_MISMATCH', 'Ship to', `Ship-to state ${stcd} differs from the state in its GSTIN (${shipGstin.slice(0, 2)}).`));
  }
  const bankAcc = clean(sender?.accountNumber);
  if (options.withPayment !== false && (bankAcc || clean(sender?.ifsc))) {
    const pay: EInvPayDtls = {};
    const nm = clean(sender?.accountName) || seller.LglNm;
    if (nm) pay.Nm = nm.slice(0, 100);
    if (bankAcc) pay.AccDet = bankAcc.replace(/\s+/g, '').slice(0, 18);
    if (clean(sender?.ifsc)) pay.FinInsBr = clean(sender?.ifsc).toUpperCase().slice(0, 11);
    const terms = clean(record.terms).replace(/\s+/g, ' ');
    if (terms) pay.PayTerm = terms.slice(0, 100);
    const di = parseIsoDate(record.issue_date);
    const dd = parseIsoDate(record.due_date);
    if (di && dd) {
      const days = Math.round((Date.UTC(dd.y, dd.m - 1, dd.d) - Date.UTC(di.y, di.m - 1, di.d)) / 86400000);
      if (days > 0) pay.CrDay = days;
    }
    if (docCurrency(record) === 'INR') {
      const paid = round2(Math.max(Number(record.amount_paid) || 0, 0));
      if (paid > 0) pay.PaidAmt = paid;
      const due = round2(Math.max(calc.total - paid, 0));
      if (due > 0) pay.PaymtDue = due;
    }
    if (Object.keys(pay).length) payload.PayDtls = pay;
  }
  const t = record.transport;
  if (options.withEwb !== false && t && (clean(t.vehicle_no) || clean(t.transporter_id) || clean(t.lr_no))) {
    const modeCode = ({ ROAD: '1', RAIL: '2', AIR: '3', SHIP: '4' } as const)[t.mode ?? 'ROAD'];
    const ewb: EInvEwbDtls = { Distance: Math.max(Math.round(Number(t.distance_km) || 0), 0) };
    if (clean(t.transporter_id)) ewb.TransId = clean(t.transporter_id).toUpperCase();
    if (clean(t.transporter_name)) ewb.TransName = clean(t.transporter_name).slice(0, 100);
    if (clean(t.vehicle_no) || clean(t.lr_no)) ewb.TransMode = modeCode;
    if (clean(t.lr_no)) ewb.TransDocNo = clean(t.lr_no).slice(0, 15);
    if (clean(t.lr_date)) ewb.TransDocDt = toNicDate(t.lr_date);
    if (clean(t.vehicle_no)) {
      ewb.VehNo = clean(t.vehicle_no).toUpperCase().replace(/[\s-]/g, '');
      ewb.VehType = 'R';
    }
    payload.EwbDtls = ewb;
    if (!ewb.Distance) assumptions.push(issue('warning', 'EWB_DISTANCE', 'e-Way', 'Distance is 0: the portal then works out the PIN-to-PIN distance (verify).'));
  }

  if (isExport) {
    const exp: EInvExpDtls = {};
    const e = options.export;
    // Shipping-bill details saved on the invoice apply unless the caller overrides them.
    const shipBillNo = clean(e?.shipBillNo) || clean(record.shipping_bill_no);
    const shipBillDate = clean(e?.shipBillDate) || clean(record.shipping_bill_date);
    const portCode = clean(e?.portCode) || clean(record.port_code);
    if (shipBillNo) exp.ShipBNo = shipBillNo;
    if (shipBillDate) exp.ShipBDt = toNicDate(shipBillDate);
    if (portCode) exp.Port = portCode.toUpperCase();
    if (e?.refundClaim !== undefined) exp.RefClm = e.refundClaim ? 'Y' : 'N';
    if (docCurrency(record) !== 'INR') exp.ForCur = docCurrency(record);
    if (e?.countryCode) exp.CntCode = e.countryCode.toUpperCase();
    if (Object.keys(exp).length) payload.ExpDtls = exp;
  }

  return { payload, assumptions };
}

/** The taxable charges line as an e-Invoice item (Qty 1, unit OTH). */
function chargesItem(l: CalcLine, slNo: number, noTax: boolean): EInvItem {
  return {
    SlNo: String(slNo),
    PrdDesc: l.name,
    IsServc: isServiceHsn(l.hsn) ? 'Y' : 'N',
    HsnCd: l.hsn,
    Qty: 1,
    Unit: 'OTH',
    UnitPrice: l.taxable,
    TotAmt: l.taxable,
    Discount: 0,
    AssAmt: l.taxable,
    GstRt: noTax ? 0 : l.tax_rate,
    IgstAmt: l.igst,
    CgstAmt: l.cgst,
    SgstAmt: l.sgst,
    TotItemVal: round2(l.taxable + l.cgst + l.sgst + l.igst),
  };
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
  /** Additive (8D, 8.64): IRN / e-Way Bill cancellation prepared or done on the portal (`einvoice-cancel.ts`). */
  irn_cancel?: PortalCancel;
  ewb_cancel?: PortalCancel;
}

/** A portal cancellation step (8D cancel flow). */
export interface PortalCancel {
  status: 'prepared' | 'done';
  reason: 'duplicate' | 'data_entry' | 'order_cancelled' | 'other';
  remark: string;
  prepared_at: string;
  /** Day it was cancelled on the portal (status `done`). */
  done_on?: string;
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

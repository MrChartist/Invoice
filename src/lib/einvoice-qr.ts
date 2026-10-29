/**
 * Decode the signed QR code printed on a B2B e-invoice (8.40, supplier bill capture without OCR).
 *
 * The IRP prints a JWT: `header.payload.signature`, each part base64url. The payload is JSON whose
 * `data` field (a JSON string, sometimes an object) carries SellerGstin, BuyerGstin, DocNo, DocTyp,
 * DocDt (dd/mm/yyyy), TotInvVal, ItemCnt, MainHsnCode, Irn and IrnDt.
 *
 * The SIGNATURE IS NOT VERIFIED: that needs the NIC public key and is pointless offline. The decoded
 * values are a convenience to pre-fill a draft bill, never proof that the invoice is genuine —
 * verify the IRN on the e-invoice portal when it matters.
 *
 * Scanned text is untrusted: the token is length-capped, every field is cleaned and bounded, and
 * a bad field becomes a warning (or '' / 0), never an exception. Pure — tested in Node.
 */

import { checkGstin } from './gstin';

/** Longest QR text accepted (a real signed QR is ~700–1,300 characters). */
export const MAX_QR_TEXT = 4096;
/** Largest invoice value accepted from a QR (₹1,000 crore) — anything above is treated as garbage. */
const MAX_VALUE = 1e10;

export type EinvoiceDocType = 'INV' | 'CRN' | 'DBN' | '';

export interface EinvoiceQrData {
  sellerGstin: string;
  buyerGstin: string;
  docNo: string;
  docType: EinvoiceDocType;
  /** YYYY-MM-DD ('' when unreadable). */
  docDate: string;
  /** Invoice value including tax (₹). */
  total: number;
  itemCount: number;
  mainHsn: string;
  /** 64-character hex IRN ('' when missing / malformed). */
  irn: string;
  /** YYYY-MM-DD of the IRN ('' when missing). */
  irnDate: string;
}

export type QrWarning = 'sellerGstin' | 'buyerGstin' | 'docDate' | 'irn' | 'total' | 'docType';

export type QrDecodeResult =
  | { ok: true; data: EinvoiceQrData; warnings: QrWarning[] }
  | { ok: false; error: 'empty' | 'tooLong' | 'notSignedQr' | 'unreadable' | 'missing' };

function base64UrlToText(s: string): string {
  if (!/^[A-Za-z0-9_-]+={0,2}$/.test(s)) throw new Error('not base64url');
  const b64 = s.replace(/=+$/, '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

const scalar = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
/** Printable, single-line, capped. */
const cleanText = (v: unknown, max: number): string =>
  [...scalar(v)].filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127).join('').trim().slice(0, max);

/** `dd/mm/yyyy`, `dd-mm-yyyy` or `yyyy-mm-dd[ hh:mm:ss]` → YYYY-MM-DD, '' when not a real day. */
export function qrDay(raw: unknown): string {
  const s = cleanText(raw, 32);
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/.exec(s);
  const ymd = dmy ? null : /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!dmy && !ymd) return '';
  const [y, m, d] = dmy ? [Number(dmy[3]), Number(dmy[2]), Number(dmy[1])] : [Number(ymd![1]), Number(ymd![2]), Number(ymd![3])];
  if (y < 2017 || y > 2100 || m < 1 || m > 12 || d < 1) return '';
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  if (d > last) return '';
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Decode a scanned / pasted signed-QR text. Never throws. */
export function decodeEinvoiceQr(text: unknown): QrDecodeResult {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return { ok: false, error: 'empty' };
  if (raw.length > MAX_QR_TEXT) return { ok: false, error: 'tooLong' };
  const parts = raw.split('.');
  if (parts.length !== 3 || !parts[1]) return { ok: false, error: 'notSignedQr' };
  let data: Record<string, unknown>;
  try {
    const payload = JSON.parse(base64UrlToText(parts[1])) as unknown;
    if (!payload || typeof payload !== 'object') return { ok: false, error: 'unreadable' };
    const inner = (payload as Record<string, unknown>).data;
    const parsed = typeof inner === 'string' ? (JSON.parse(inner) as unknown) : inner;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'unreadable' };
    data = parsed as Record<string, unknown>;
  } catch {
    return { ok: false, error: 'unreadable' };
  }

  const fields = readQrFields(data);
  return fields ? { ok: true, ...fields } : { ok: false, error: 'missing' };
}

/** Clean the QR fields of a decoded payload (also the e-invoice JSON, mapped to the QR names). Null = nothing usable. */
function readQrFields(data: Record<string, unknown>): { data: EinvoiceQrData; warnings: QrWarning[] } | null {
  const warnings: QrWarning[] = [];
  const gstin = (v: unknown, w: QrWarning): string => {
    const g = cleanText(v, 20).toUpperCase().replace(/\s+/g, '');
    if (!g) return '';
    if (!checkGstin(g).valid) warnings.push(w);
    return /^[0-9A-Z]{15}$/.test(g) ? g : '';
  };
  const sellerGstin = gstin(data.SellerGstin, 'sellerGstin');
  const buyerGstin = gstin(data.BuyerGstin, 'buyerGstin');
  const docNo = cleanText(data.DocNo, 16);
  const typ = cleanText(data.DocTyp, 4).toUpperCase();
  const docType: EinvoiceDocType = typ === 'INV' || typ === 'CRN' || typ === 'DBN' ? typ : '';
  if (typ && !docType) warnings.push('docType');
  const docDate = qrDay(data.DocDt);
  if (!docDate) warnings.push('docDate');
  const totalRaw = Number(scalar(data.TotInvVal));
  const total = Number.isFinite(totalRaw) && totalRaw >= 0 && totalRaw < MAX_VALUE ? Math.round(totalRaw * 100) / 100 : 0;
  if (!(total > 0)) warnings.push('total');
  const countRaw = Number(scalar(data.ItemCnt));
  const itemCount = Number.isInteger(countRaw) && countRaw > 0 && countRaw < 10000 ? countRaw : 0;
  const hsn = cleanText(data.MainHsnCode, 8).replace(/\D/g, '');
  const mainHsn = hsn.length >= 4 ? hsn : '';
  const irnText = cleanText(data.Irn, 64).toLowerCase();
  const irn = /^[0-9a-f]{64}$/.test(irnText) ? irnText : '';
  if (!irn) warnings.push('irn');
  const irnDate = qrDay(data.IrnDt);

  if (!sellerGstin && !docNo && !irn) return null;
  return { data: { sellerGstin, buyerGstin, docNo, docType, docDate, total, itemCount, mainHsn, irn, irnDate }, warnings };
}

/* ── 8.46: the full e-invoice JSON (INV-01 schema, or the IRP's signed invoice) — lines and GST split ── */

/** Largest e-invoice JSON accepted (the IRP allows 1,000 lines). */
export const MAX_JSON_TEXT = 512 * 1024;

export interface EinvoiceJsonLine {
  name: string;
  hsn: string;
  qty: number;
  unit: string;
  /** Taxable value of the line (AssAmt). */
  taxable: number;
  /** GST rate %. */
  rate: number;
  cess: number;
}

export interface EinvoiceJsonData {
  qr: EinvoiceQrData;
  sellerName: string;
  /** Place of supply state code (BuyerDtls.Pos), '' when absent. */
  pos: string;
  lines: EinvoiceJsonLine[];
  cess: number;
}

export type JsonDecodeResult =
  | { ok: true; data: EinvoiceJsonData; warnings: QrWarning[] }
  | { ok: false; error: 'empty' | 'tooLong' | 'unreadable' | 'missing' | 'noItems' };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const amt = (v: unknown): number => {
  const n = Number(scalar(v));
  return Number.isFinite(n) && n >= 0 && n < MAX_VALUE ? Math.round(n * 100) / 100 : 0;
};

/** The invoice object inside pasted text: a JSON object / array, `{ data }`, the IRP's `SignedInvoice` or a signed JWT. */
function invoiceObject(text: string, depth = 0): Record<string, unknown> | null {
  let v: unknown;
  try {
    if (/^[[{]/.test(text)) v = JSON.parse(text);
    else {
      const parts = text.split('.');
      if (parts.length !== 3) return null;
      v = obj(JSON.parse(base64UrlToText(parts[1]))).data;
    }
    if (typeof v === 'string') v = JSON.parse(v);
  } catch {
    return null;
  }
  if (Array.isArray(v)) v = v[0];
  const o = obj(v);
  if (Array.isArray(o.ItemList)) return o;
  if (depth < 2 && typeof o.SignedInvoice === 'string') {
    const inner = invoiceObject(o.SignedInvoice.trim(), depth + 1);
    return inner && { ...inner, Irn: inner.Irn ?? o.Irn, AckDt: inner.AckDt ?? o.AckDt };
  }
  if (depth < 2 && o.data !== undefined) return invoiceObject(typeof o.data === 'string' ? o.data.trim() : JSON.stringify(o.data), depth + 1);
  return null;
}

/** Decode a supplier's full e-invoice JSON: the QR fields plus every line with its taxable value, GST rate and cess. Never throws. */
export function decodeEinvoiceJson(text: unknown): JsonDecodeResult {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return { ok: false, error: 'empty' };
  if (raw.length > MAX_JSON_TEXT) return { ok: false, error: 'tooLong' };
  const inv = invoiceObject(raw);
  if (!inv) return { ok: false, error: 'unreadable' };
  const doc = obj(inv.DocDtls), seller = obj(inv.SellerDtls), buyer = obj(inv.BuyerDtls), val = obj(inv.ValDtls);
  const items = (inv.ItemList as unknown[]).slice(0, 1000).map(obj);
  if (!items.length) return { ok: false, error: 'noItems' };
  const fields = readQrFields({
    SellerGstin: seller.Gstin, BuyerGstin: buyer.Gstin, DocNo: doc.No, DocTyp: doc.Typ, DocDt: doc.Dt,
    TotInvVal: val.TotInvVal, ItemCnt: items.length, MainHsnCode: items[0].HsnCd, Irn: inv.Irn, IrnDt: inv.AckDt,
  });
  if (!fields) return { ok: false, error: 'missing' };
  const lines = items.map((it, i): EinvoiceJsonLine => {
    const qty = amt(it.Qty);
    const rate = Number(scalar(it.GstRt));
    return {
      name: cleanText(it.PrdDesc, 120) || `Item ${i + 1}`,
      hsn: cleanText(it.HsnCd, 8).replace(/\D/g, ''),
      qty: qty > 0 ? qty : 1,
      unit: cleanText(it.Unit, 8).toUpperCase() || 'NOS',
      taxable: it.AssAmt !== undefined ? amt(it.AssAmt) : Math.max(amt(it.TotAmt) - amt(it.Discount), 0),
      rate: Number.isFinite(rate) && rate >= 0 && rate <= 40 ? rate : 0,
      cess: Math.round((amt(it.CesAmt) + amt(it.CesNonAdvlAmt) + amt(it.StateCesAmt)) * 100) / 100,
    };
  });
  const pos = cleanText(buyer.Pos, 2);
  return {
    ok: true,
    data: { qr: fields.data, sellerName: cleanText(seller.LglNm ?? seller.TrdNm, 100), pos: /^\d{2}$/.test(pos) ? pos : '', lines, cess: Math.round(lines.reduce((t, l) => t + l.cess, 0) * 100) / 100 },
    warnings: fields.warnings,
  };
}

/** Test / fixture helper: build an (unsigned) token the way the IRP lays it out. */
export function encodeEinvoiceQrForTest(data: Record<string, unknown>): string {
  const b64u = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64u(JSON.stringify({ data: JSON.stringify(data), iss: 'NIC' }))}.c2lnbmF0dXJl`;
}

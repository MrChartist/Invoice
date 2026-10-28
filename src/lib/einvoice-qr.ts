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

  if (!sellerGstin && !docNo && !irn) return { ok: false, error: 'missing' };
  return { ok: true, data: { sellerGstin, buyerGstin, docNo, docType, docDate, total, itemCount, mainHsn, irn, irnDate }, warnings };
}

/** Test / fixture helper: build an (unsigned) token the way the IRP lays it out. */
export function encodeEinvoiceQrForTest(data: Record<string, unknown>): string {
  const b64u = (s: string) => btoa(String.fromCharCode(...new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64u(JSON.stringify({ data: JSON.stringify(data), iss: 'NIC' }))}.c2lnbmF0dXJl`;
}

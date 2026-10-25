/**
 * Bulk e-Invoice / e-Way Bill files and bulk import of the IRP response (roadmap 6.24).
 *
 * Offline only: the app writes the JSON a taxpayer uploads to the IRP / e-Way portal and
 * reads back the file the portal (or its Excel bulk tool) returns. Nothing is sent anywhere.
 *
 *  - `buildBulkEInvoice` runs the existing single-invoice preflight on every selected
 *    invoice; the ones that pass go into ONE IRP bulk JSON (an array of v1.1 payloads,
 *    `buildEInvoiceBulk`); the rest are listed with their blocking reasons.
 *  - `buildBulkEway` does the same for e-Way Bills (`buildEwayBulk`, `billLists`). Bills of Supply (NIC
 *    document type `BIL`) are e-Way only: `bulkCandidates(…, { billsOfSupply: true })` offers them and
 *    `buildBulkEInvoice` lists them as blocked (no e-Invoice for a Bill of Supply).
 *  - `parseIrpResponse` + `applyIrpResponse` read the IRP bulk response and write IRN /
 *    Ack No / Ack date / signed QR (and e-Way Bill no. when the IRP generated one) into the
 *    existing `einvoice_meta` table, matched on the document number.
 *
 * IRP response — ASSUMPTIONS (the portal's bulk-response layout is not published as a
 * stable schema, so the reader is deliberately tolerant):
 *  - JSON: an array of result objects, an object holding such an array under any key, or a
 *    single object. A result may wrap its fields in `Data` / `data` (object or JSON string),
 *    as the IRP API does.
 *  - CSV (the Excel bulk tool's result sheet saved as CSV): one row per document with a
 *    header row.
 *  - Field names are matched case- and punctuation-insensitively: document number
 *    `DocNo` / `Doc No` / `Document Number` / `Invoice No` (or `DocDtls.No`), `AckNo`,
 *    `AckDt`, `Irn`, `SignedQRCode`, `EwbNo`, `EwbDt`, `EwbValidTill`, `Status`,
 *    `ErrorMessage` / `ErrorDetails` / `Remarks`.
 *  - When a result has no document number (the IRP API response carries none), it is read
 *    from the signed QR code: its middle part is base64url JSON whose `data` field holds
 *    `DocNo`, `DocDt`, `SellerGstin` and `Irn` (the IRP's documented QR payload).
 *  - A result with an error / failed status, or with no IRN, writes nothing and is listed.
 */

import type { InvoiceRecord, SenderProfile } from '../types/invoice';
import {
  EINVOICE_META_TABLE,
  buildEInvoiceBulk,
  getAllEInvoiceMeta,
  stringifyEInvoice,
  validateMeta,
  type EInvoiceMeta,
  type EInvoicePayload,
} from './einvoice';
import { buildEwayBulk, stringifyEway, type EwayBill, type EwayPayload, type EwayTransMode, type EwayTransport } from './eway';
import { preflightEInvoice, preflightEway } from './einvoice-validate';
import { parseTable, stripBom } from './csv';
import { getTable, setTable } from './storage';

/* ───────────────────────── Shared ───────────────────────── */

export interface BulkIncluded {
  invoiceId: string;
  number: string;
  warnings: string[];
}

export interface BulkBlocked {
  invoiceId: string;
  number: string;
  reasons: string[];
}

interface LinkLike {
  from_id: string;
  to_id: string;
  relation: string;
}

export interface BulkContext {
  now?: Date;
  /** Sender profile for legacy invoices without a snapshot. */
  fallbackSender?: SenderProfile | null;
  /** Current `einvoice_meta` rows (to skip documents that already have an IRN / EWB, and to reuse saved transport). */
  meta?: readonly EInvoiceMeta[];
  /** `doc_links` + every invoice, so a credit/debit note gets its original invoice as the preceding document. */
  links?: readonly LinkLike[];
  allInvoices?: readonly InvoiceRecord[];
  /** Include documents that already have an IRN (e-Invoice) / e-Way Bill no. (e-Way). Default false. */
  includeDone?: boolean;
}

const E_INVOICE_DOC_TYPES = new Set(['INVOICE', 'TAX_INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE']);
/** Documents that move goods on an e-Way Bill but never go to the IRP (NIC document type `BIL`). */
const EWAY_ONLY_DOC_TYPES = new Set(['BILL_OF_SUPPLY']);

/** True for a document that goes into the e-Way file only (a Bill of Supply). */
export const isEwayOnly = (inv: Pick<InvoiceRecord, 'doc_type'>) => EWAY_ONLY_DOC_TYPES.has(inv.doc_type);

const label = (inv: InvoiceRecord) => inv.invoice_number || inv.id;

/** Reasons that stop a document before the schema preflight runs. */
function statusReasons(inv: InvoiceRecord): string[] {
  if (inv.status === 'Draft') return ['Draft: finalise the document before reporting it.'];
  if (inv.status === 'Cancelled') return ['Cancelled documents are not reported.'];
  return [];
}

const fmtIssue = (i: { field: string; message: string }) => `${i.field}: ${i.message}`;

/**
 * Invoices worth offering for a bulk file: tax documents in [from, to] (issue date, local
 * YYYY-MM-DD) that are not drafts or cancelled. B2C invoices are kept (preflight will say
 * why they are blocked); `preselect` marks the B2B / SEZ / export ones without an IRN yet.
 * With `billsOfSupply`, Bills of Supply are offered too (`ewayOnly`, never preselected).
 */
export function bulkCandidates(
  invoices: readonly InvoiceRecord[],
  range: { from: string; to: string },
  meta: readonly EInvoiceMeta[] = [],
  opts: { billsOfSupply?: boolean } = {},
): { invoice: InvoiceRecord; preselect: boolean; hasIrn: boolean; hasEwb: boolean; ewayOnly?: boolean }[] {
  const byId = new Map(meta.map((m) => [m.invoice_id, m]));
  return invoices
    .filter((i) => {
      if (!i || !(E_INVOICE_DOC_TYPES.has(i.doc_type) || (opts.billsOfSupply && EWAY_ONLY_DOC_TYPES.has(i.doc_type)))) return false;
      if (i.status === 'Draft' || i.status === 'Cancelled') return false;
      const d = String(i.issue_date ?? '').slice(0, 10);
      return d >= range.from && d <= range.to;
    })
    .sort((a, b) => String(a.issue_date).localeCompare(String(b.issue_date)) || label(a).localeCompare(label(b)))
    .map((invoice) => {
      const m = byId.get(invoice.id);
      const hasIrn = !!m?.irn;
      const hasEwb = !!m?.eway_no;
      const gstin = (invoice.client?.gstin ?? '').trim();
      const exportPos = ['96', '99'].includes((invoice.place_of_supply ?? '').trim());
      if (EWAY_ONLY_DOC_TYPES.has(invoice.doc_type)) return { invoice, preselect: false, hasIrn, hasEwb, ewayOnly: true };
      return { invoice, preselect: !hasIrn && (/^[0-9]{2}[A-Z0-9]{13}$/i.test(gstin) || exportPos), hasIrn, hasEwb };
    });
}

/* ───────────────────────── Bulk e-Invoice ───────────────────────── */

export interface BulkEInvoiceResult {
  payloads: EInvoicePayload[];
  /** The upload file (always a JSON array). */
  json: string;
  included: BulkIncluded[];
  blocked: BulkBlocked[];
}

export function buildBulkEInvoice(invoices: readonly InvoiceRecord[], ctx: BulkContext = {}): BulkEInvoiceResult {
  const meta = new Map((ctx.meta ?? []).map((m) => [m.invoice_id, m]));
  const byId = new Map((ctx.allInvoices ?? invoices).map((i) => [i.id, i]));
  const included: BulkIncluded[] = [];
  const blocked: BulkBlocked[] = [];
  const payloads: EInvoicePayload[] = [];
  const seen = new Set<string>();

  for (const inv of invoices) {
    const number = label(inv);
    const reasons = statusReasons(inv);
    if (EWAY_ONLY_DOC_TYPES.has(inv.doc_type)) reasons.push('Bill of Supply: no e-Invoice (it goes into the e-Way file only, document type BIL).');
    else if (!E_INVOICE_DOC_TYPES.has(inv.doc_type)) reasons.push('Only tax invoices, credit notes and debit notes go to the IRP.');
    const m = meta.get(inv.id);
    if (m?.irn && !ctx.includeDone) reasons.push(`IRN already recorded (${m.irn.slice(0, 12)}…); generating it again would be rejected as a duplicate.`);
    const key = `${(inv.sender?.companyGstin ?? '').toUpperCase()}|${number.toUpperCase()}`;
    if (seen.has(key)) reasons.push('The same document number is already in this file.');
    if (reasons.length) {
      blocked.push({ invoiceId: inv.id, number, reasons });
      continue;
    }

    const isNote = inv.doc_type === 'CREDIT_NOTE' || inv.doc_type === 'DEBIT_NOTE';
    const link = isNote
      ? ctx.links?.find((l) => l.to_id === inv.id && (l.relation === 'credit_note' || l.relation === 'debit_note'))
      : undefined;
    const original = link ? byId.get(link.from_id) : undefined;
    const pf = preflightEInvoice(inv, {
      now: ctx.now,
      fallbackSender: inv.sender ? null : ctx.fallbackSender ?? null,
      preceding: original ? [{ no: original.invoice_number, date: String(original.issue_date).slice(0, 10) }] : undefined,
    });
    if (!pf.ready) {
      blocked.push({ invoiceId: inv.id, number, reasons: pf.errors.map(fmtIssue) });
      continue;
    }
    seen.add(key);
    payloads.push(pf.payload);
    included.push({ invoiceId: inv.id, number, warnings: pf.warnings.map(fmtIssue) });
  }
  const bulk = buildEInvoiceBulk(payloads);
  return { payloads: bulk, json: stringifyEInvoice(bulk), included, blocked };
}

/* ───────────────────────── Bulk e-Way ───────────────────────── */

export interface BulkEwayResult {
  payload: EwayPayload;
  json: string;
  included: BulkIncluded[];
  blocked: BulkBlocked[];
}

/** Transport saved with an invoice (e-Invoice modal → e-Way tab), if it names a vehicle or transporter. */
function savedTransport(m: EInvoiceMeta | undefined): EwayTransport | null {
  if (!m || !(m.vehicle || m.transporter_id)) return null;
  return {
    mode: (m.transport ?? 'ROAD') as EwayTransMode,
    vehicle: m.vehicle,
    vehicleType: m.vehicle_type,
    distance: m.distance,
    transporterId: m.transporter_id,
    transporterName: m.transporter_name,
    docNo: m.transport_doc_no,
    docDate: m.transport_doc_date,
  };
}

/**
 * One e-Way bulk file. Each invoice uses the transport saved with it (if any), else the
 * shared `transport` entered in the bulk dialog.
 */
export function buildBulkEway(
  invoices: readonly InvoiceRecord[],
  ctx: BulkContext & { transport?: EwayTransport } = {},
): BulkEwayResult {
  const meta = new Map((ctx.meta ?? []).map((m) => [m.invoice_id, m]));
  const included: BulkIncluded[] = [];
  const blocked: BulkBlocked[] = [];
  const bills: EwayBill[] = [];
  const seen = new Set<string>();

  for (const inv of invoices) {
    const number = label(inv);
    const reasons = statusReasons(inv);
    const m = meta.get(inv.id);
    if (m?.eway_no && !ctx.includeDone) reasons.push(`e-Way Bill ${m.eway_no} already recorded.`);
    const key = `${(inv.sender?.companyGstin ?? '').toUpperCase()}|${number.toUpperCase()}`;
    if (seen.has(key)) reasons.push('The same document number is already in this file.');
    if (reasons.length) {
      blocked.push({ invoiceId: inv.id, number, reasons });
      continue;
    }
    const pf = preflightEway(inv, {
      now: ctx.now,
      fallbackSender: inv.sender ? null : ctx.fallbackSender ?? null,
      transport: savedTransport(m) ?? ctx.transport ?? {},
    });
    if (!pf.ready) {
      blocked.push({ invoiceId: inv.id, number, reasons: pf.errors.map(fmtIssue) });
      continue;
    }
    seen.add(key);
    bills.push(pf.bill);
    included.push({ invoiceId: inv.id, number, warnings: pf.warnings.map(fmtIssue) });
  }
  const payload = buildEwayBulk(bills);
  return { payload, json: stringifyEway(payload), included, blocked };
}

/* ───────────────────────── IRP response import ───────────────────────── */

export interface IrpResponseRow {
  /** 1-based position in the file (data row for CSV, array index for JSON). */
  line: number;
  docNo: string;
  docDate: string;
  sellerGstin: string;
  irn: string;
  ackNo: string;
  ackDate: string;
  signedQr: string;
  ewbNo: string;
  ewbDate: string;
  ewbValidTill: string;
  status: string;
  error: string;
}

export interface ParsedIrpResponse {
  format: 'json' | 'csv';
  rows: IrpResponseRow[];
  /** File-level problems (not JSON / CSV, no rows). */
  errors: string[];
}

const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9]/g, '');

const ALIASES: Record<Exclude<keyof IrpResponseRow, 'line'>, string[]> = {
  docNo: ['docno', 'documentno', 'documentnumber', 'docnumber', 'invoiceno', 'invoicenumber', 'invno', 'docdtlsno'],
  docDate: ['docdt', 'docdate', 'documentdate', 'invoicedate', 'invdt', 'docdtlsdt'],
  sellerGstin: ['sellergstin', 'suppliergstin', 'sellerdtlsgstin', 'usergstin'],
  irn: ['irn', 'irnno', 'irnnumber'],
  ackNo: ['ackno', 'acknowledgementno', 'acknowledgementnumber', 'acknumber', 'acknum', 'acknowledgmentno'],
  ackDate: ['ackdt', 'ackdate', 'acknowledgementdate', 'acknowledgmentdate'],
  signedQr: ['signedqrcode', 'signedqr', 'qrcode', 'signedqrcodedata'],
  ewbNo: ['ewbno', 'ewaybillno', 'ewaybillnumber', 'ewbnumber', 'ewayno'],
  ewbDate: ['ewbdt', 'ewbdate', 'ewaybilldate'],
  ewbValidTill: ['ewbvalidtill', 'ewbvalidupto', 'validupto', 'validtill', 'ewayvalidupto', 'ewbvaliddate'],
  status: ['status', 'irnstatus'],
  error: ['errormessage', 'errordetails', 'errormsg', 'error', 'errors', 'remarks', 'errorcode'],
};

const scalar = (v: unknown): string =>
  typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '';

/** Flatten nested objects into normalised keys ("DocDtls.No" -> "docdtlsno"; leaf "No" too). */
function flatten(obj: unknown, prefix = '', out: Map<string, string> = new Map(), depth = 0): Map<string, string> {
  if (!obj || typeof obj !== 'object' || depth > 4) return out;
  if (Array.isArray(obj)) {
    // e.g. ErrorDetails: [{ ErrorCode, ErrorMessage }]
    const msgs = obj.map((x) => (x && typeof x === 'object' ? scalar((x as Record<string, unknown>).ErrorMessage ?? (x as Record<string, unknown>).errorMessage) : scalar(x))).filter(Boolean);
    if (msgs.length && prefix && !out.has(prefix)) out.set(prefix, msgs.join('; '));
    return out;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const nk = norm(k);
    if ((nk === 'data' || nk === 'result') && typeof v === 'string' && /^\s*[{[]/.test(v)) {
      try {
        flatten(JSON.parse(v), '', out, depth + 1);
      } catch {
        /* not JSON — ignore */
      }
      continue;
    }
    if (v && typeof v === 'object') {
      flatten(v, nk === 'data' || nk === 'result' ? '' : prefix + nk, out, depth + 1);
      continue;
    }
    const s = scalar(v);
    if (!s) continue;
    const full = prefix + nk;
    if (!out.has(full)) out.set(full, s);
    if (prefix && !out.has(nk)) out.set(nk, s);
  }
  return out;
}

function pick(fields: Map<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = fields.get(k);
    if (v) return v;
  }
  return '';
}

function base64UrlDecode(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/** The IRP signed QR is a JWT whose payload `data` holds DocNo / DocDt / SellerGstin / Irn. */
export function decodeSignedQr(token: string): { docNo: string; docDate: string; sellerGstin: string; irn: string } | null {
  const parts = (token ?? '').trim().split('.');
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(parts[1])) as Record<string, unknown>;
    const raw = payload.data;
    const data = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown> | undefined;
    if (!data || typeof data !== 'object') return null;
    return {
      docNo: scalar(data.DocNo),
      docDate: scalar(data.DocDt),
      sellerGstin: scalar(data.SellerGstin),
      irn: scalar(data.Irn),
    };
  } catch {
    return null;
  }
}

function toRow(fields: Map<string, string>, line: number): IrpResponseRow {
  const r: IrpResponseRow = { line, docNo: '', docDate: '', sellerGstin: '', irn: '', ackNo: '', ackDate: '', signedQr: '', ewbNo: '', ewbDate: '', ewbValidTill: '', status: '', error: '' };
  for (const key of Object.keys(ALIASES) as (keyof typeof ALIASES)[]) r[key] = pick(fields, ALIASES[key]);
  if (r.signedQr && (!r.docNo || !r.irn || !r.sellerGstin)) {
    const q = decodeSignedQr(r.signedQr);
    if (q) {
      r.docNo ||= q.docNo;
      r.docDate ||= q.docDate;
      r.sellerGstin ||= q.sellerGstin;
      r.irn ||= q.irn;
    }
  }
  return r;
}

/** First array of objects in a parsed JSON value (the value itself, or one level down). */
function resultArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object') {
    for (const x of Object.values(v as Record<string, unknown>)) {
      if (Array.isArray(x) && x.some((y) => y && typeof y === 'object')) return x;
    }
    return [v];
  }
  return [];
}

export function parseIrpResponse(text: string): ParsedIrpResponse {
  const src = stripBom(text ?? '').trim();
  if (!src) return { format: 'json', rows: [], errors: ['The file is empty.'] };
  if (src.startsWith('{') || src.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(src);
    } catch {
      return { format: 'json', rows: [], errors: ['The file looks like JSON but could not be read (damaged or cut short).'] };
    }
    const rows = resultArray(parsed)
      .map((o, i) => toRow(flatten(o), i + 1))
      .filter((r) => r.docNo || r.irn || r.ackNo || r.error);
    return { format: 'json', rows, errors: rows.length ? [] : ['No e-Invoice results were found in this JSON.'] };
  }
  const table = parseTable(src);
  if (!table.headers.length) return { format: 'csv', rows: [], errors: ['No header row found.'] };
  const keys = table.headers.map(norm);
  const rows = table.rows
    .map((cells, i) => {
      const m = new Map<string, string>();
      keys.forEach((k, j) => {
        const v = (cells[j] ?? '').trim();
        if (v && !m.has(k)) m.set(k, v);
      });
      return toRow(m, i + 1);
    })
    .filter((r) => r.docNo || r.irn || r.ackNo || r.error);
  return { format: 'csv', rows, errors: rows.length ? [] : ['No rows with a document number, IRN or Ack No were found. Check the header names.'] };
}

/** dd/mm/yyyy[ hh:mm[:ss][ AM|PM]] or yyyy-mm-dd[ T]hh:mm[:ss] -> "yyyy-mm-dd hh:mm:ss" (date only when no time). */
export function normaliseIrpDate(value: string, dateOnly = false): string {
  const s = (value ?? '').trim();
  if (!s) return '';
  const iso = /^(\d{4})-(\d{2})-(\d{2})[T ]?(.*)$/.exec(s);
  const dmy = iso ? null : /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})\s*(.*)$/.exec(s);
  if (!iso && !dmy) return s;
  const [y, mo, d, rest] = iso ? [iso[1], iso[2], iso[3], iso[4]] : [dmy![3], dmy![2], dmy![1], dmy![4]];
  const date = `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
  if (dateOnly) return date;
  const t = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?/.exec(rest.trim());
  if (!t) return date;
  let h = Number(t[1]);
  const ap = t[4]?.toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return `${date} ${String(h).padStart(2, '0')}:${t[2]}:${t[3] ?? '00'}`;
}

const FAILED_STATUS = new Set(['0', 'failed', 'failure', 'error', 'rejected', 'cancelled', 'cnl']);

export interface IrpImportWritten {
  line: number;
  invoiceId: string;
  number: string;
  irn: string;
  /** The row replaced an IRN that was already stored (only with `overwrite`). */
  replaced: boolean;
}

export interface IrpImportSkipped {
  line: number;
  docNo: string;
  reason: string;
}

export interface IrpImportResult {
  /** The full next `einvoice_meta` table. */
  meta: EInvoiceMeta[];
  written: IrpImportWritten[];
  /** Rows whose document number matches no invoice (or several). */
  unmatched: IrpImportSkipped[];
  /** Rows the IRP rejected, or that fail the IRN / Ack / EWB format checks, or would overwrite a different IRN. */
  failed: IrpImportSkipped[];
}

const docKey = (s: string) => (s ?? '').trim().toUpperCase();

/**
 * Pure: match each result row to an invoice by document number (disambiguated by seller
 * GSTIN, then by date, when the number repeats) and merge IRN / Ack / QR / EWB into its
 * meta row, keeping any transport details already saved.
 */
export function applyIrpResponse(
  rows: readonly IrpResponseRow[],
  invoices: readonly InvoiceRecord[],
  existing: readonly EInvoiceMeta[],
  opts: { overwrite?: boolean; now?: string } = {},
): IrpImportResult {
  const stamp = opts.now ?? new Date().toISOString();
  const byNo = new Map<string, InvoiceRecord[]>();
  for (const inv of invoices) {
    if (!inv?.invoice_number || inv.status === 'Draft') continue;
    const k = docKey(inv.invoice_number);
    byNo.set(k, [...(byNo.get(k) ?? []), inv]);
  }
  const meta = new Map(existing.map((m) => [m.invoice_id, { ...m }]));
  const written: IrpImportWritten[] = [];
  const unmatched: IrpImportSkipped[] = [];
  const failed: IrpImportSkipped[] = [];

  for (const r of rows) {
    const status = r.status.trim().toLowerCase();
    if (FAILED_STATUS.has(status) || (!r.irn && r.error)) {
      failed.push({ line: r.line, docNo: r.docNo, reason: `Rejected by the IRP${r.error ? `: ${r.error}` : ''}` });
      continue;
    }
    if (!r.irn) {
      failed.push({ line: r.line, docNo: r.docNo, reason: 'No IRN in this row.' });
      continue;
    }
    if (!r.docNo) {
      unmatched.push({ line: r.line, docNo: '', reason: 'No document number in this row (and none in the signed QR).' });
      continue;
    }
    let candidates = byNo.get(docKey(r.docNo)) ?? [];
    const seller = r.sellerGstin.trim().toUpperCase();
    if (candidates.length > 1 && seller) {
      candidates = candidates.filter((c) => (c.sender?.companyGstin ?? '').trim().toUpperCase() === seller);
    }
    if (candidates.length > 1 && r.docDate) {
      const day = normaliseIrpDate(r.docDate, true);
      candidates = candidates.filter((c) => String(c.issue_date).slice(0, 10) === day);
    }
    if (candidates.length === 0) {
      unmatched.push({ line: r.line, docNo: r.docNo, reason: 'No invoice with this number.' });
      continue;
    }
    if (candidates.length > 1) {
      unmatched.push({ line: r.line, docNo: r.docNo, reason: `${candidates.length} invoices share this number; record it from the invoice instead.` });
      continue;
    }
    const inv = candidates[0];
    const prev = meta.get(inv.id) ?? { invoice_id: inv.id };
    const irn = r.irn.trim().toLowerCase();
    const replaced = !!prev.irn && prev.irn.toLowerCase() !== irn;
    if (replaced && !opts.overwrite) {
      failed.push({ line: r.line, docNo: r.docNo, reason: `This invoice already has a different IRN (${prev.irn!.slice(0, 12)}…). Tick "replace" to overwrite.` });
      continue;
    }
    const next: EInvoiceMeta = {
      ...prev,
      invoice_id: inv.id,
      irn,
      ...(r.ackNo ? { ack_no: r.ackNo.trim() } : {}),
      ...(r.ackDate ? { ack_date: normaliseIrpDate(r.ackDate) } : {}),
      ...(r.signedQr ? { signed_qr: r.signedQr.trim() } : {}),
      ...(r.ewbNo ? { eway_no: r.ewbNo.trim() } : {}),
      ...(r.ewbDate ? { eway_date: normaliseIrpDate(r.ewbDate, true) } : {}),
      ...(r.ewbValidTill ? { eway_valid_upto: normaliseIrpDate(r.ewbValidTill, true) } : {}),
      updated_at: stamp,
    };
    const bad = validateMeta(next).filter((i) => i.severity === 'error');
    if (bad.length) {
      failed.push({ line: r.line, docNo: r.docNo, reason: bad.map((b) => b.message).join(' ') });
      continue;
    }
    meta.set(inv.id, next);
    written.push({ line: r.line, invoiceId: inv.id, number: inv.invoice_number, irn, replaced });
  }
  return { meta: [...meta.values()], written, unmatched, failed };
}

/**
 * Read an IRP response file and write the matches into `einvoice_meta` (one write).
 * Returns the parse result and what was written / skipped. Nothing is written when no row matched.
 */
export function importIrpResponse(
  text: string,
  opts: { overwrite?: boolean } = {},
): { parsed: ParsedIrpResponse; result: IrpImportResult } {
  const parsed = parseIrpResponse(text);
  const result = applyIrpResponse(parsed.rows, getTable<InvoiceRecord>('invoices'), getAllEInvoiceMeta(), opts);
  if (result.written.length) setTable(EINVOICE_META_TABLE, result.meta);
  return { parsed, result };
}

/**
 * Browser half of bill capture (8.40 / 8.41): read an e-invoice QR from a photo with the browser's
 * BarcodeDetector, keep the file in the documents inbox and draft a bill from the QR.
 *
 * Entry point for other features (the PWA share target, a later pass): `openCaptureFromFile(file)`
 * stores the file in `doc_inbox`, tries the QR, drafts the bill when it can and returns the route of
 * the inbox row (`/expenses?tab=inbox&doc=<id>`) for the caller to navigate to.
 *
 * PDFs (8.46): no page is rendered (that needs a PDF engine such as pdf.js, which the app does not ship); instead
 * the images embedded in the PDF are read (`pdf-images.ts`) and the QR is looked for in them. A QR drawn as
 * vectors is not found — scan the printed QR or a photo / screenshot of it instead. Images are size-capped before decoding; nothing leaves the device.
 */

import type { InboxDoc, InboxSource } from './doc-inbox';
import { inboxDb } from './doc-inbox';
import { decodeEinvoiceJson, decodeEinvoiceQr, MAX_JSON_TEXT, type EinvoiceJsonData, type EinvoiceQrData } from './einvoice-qr';
import { draftFromEinvoiceJson, draftFromQr, type CaptureContext } from './bill-capture';
import { draftsDb, type PurchaseDraft } from './purchase-drafts';
import { attachFile } from './attachment-upload';
import { MAX_IMAGE_INPUT_BYTES, MAX_PDF_BYTES, sniffMime, type AttachmentRef } from './attachments';
import { vendorsDb } from './vendors';
import { localDb } from './localDb';
import { getTable } from './storage';
import { todayInput } from './utils';
import { capT } from '../i18n/areas/capture';

export const INBOX_CHANGED_EVENT = 'mrc:inbox-changed';

interface Detector {
  detect(source: ImageBitmapSource | CanvasImageSource): Promise<{ rawValue: string }[]>;
}

export function qrImageSupported(): boolean {
  return typeof window !== 'undefined' && 'BarcodeDetector' in window && typeof createImageBitmap === 'function';
}

/** Read the first QR code in an image file; null when there is none / it cannot be read. */
export async function readQrFromImage(file: Blob): Promise<string | null> {
  if (!qrImageSupported() || file.size > MAX_IMAGE_INPUT_BYTES) return null;
  const Ctor = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
  const detector = new Ctor({ formats: ['qr_code'] });
  const tryOnce = async (opts?: ImageBitmapOptions): Promise<string | null> => {
    let bmp: ImageBitmap | undefined;
    try {
      bmp = opts ? await createImageBitmap(file, opts) : await createImageBitmap(file);
      const hits = await detector.detect(bmp);
      return hits.map((h) => h.rawValue).find((v) => typeof v === 'string' && v.split('.').length === 3) ?? hits[0]?.rawValue ?? null;
    } catch {
      return null;
    } finally {
      bmp?.close();
    }
  };
  // Full resolution first (dense signed QR), then a scaled copy (very large photos can fail to decode).
  return (await tryOnce()) ?? (await tryOnce({ resizeWidth: 1600, resizeQuality: 'high' }));
}

/** 8.46: the first e-invoice QR found in an image embedded in a PDF (null when none can be read). */
export async function readQrFromPdf(file: Blob): Promise<string | null> {
  if (!qrImageSupported() || file.size > MAX_PDF_BYTES) return null;
  const { pdfImages } = await import('./pdf-images');
  const Ctor = (window as unknown as { BarcodeDetector: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
  const detector = new Ctor({ formats: ['qr_code'] });
  for (const img of await pdfImages(new Uint8Array(await file.arrayBuffer()))) {
    let bmp: ImageBitmap | undefined;
    try {
      bmp = await createImageBitmap(img.kind === 'jpeg' ? new Blob([img.bytes as BlobPart], { type: 'image/jpeg' }) : new ImageData(img.rgba as never, img.width, img.height));
      const hit = (await detector.detect(bmp)).map((h) => h.rawValue).find((v) => typeof v === 'string' && v.split('.').length === 3);
      if (hit) return hit;
    } catch {
      /* next image */
    } finally {
      bmp?.close();
    }
  }
  return null;
}

/** Storage-backed capture context: vendors, our GSTINs and state, HSN master rates. */
export function captureContext(): CaptureContext {
  const settings = localDb.settings.get();
  const active = localDb.settings.activeProfile();
  const ourGstins = settings.profiles.map((p) => (p.companyGstin ?? '').trim().toUpperCase()).filter(Boolean);
  const gst = (active?.companyGstin ?? '').trim();
  type Row = { code?: string; rates?: { from: string; rate: number }[] };
  let master: Row[] = [];
  try {
    master = getTable<Row>('hsn_master');
  } catch {
    master = [];
  }
  return {
    vendors: vendorsDb.all(),
    ourGstins,
    businessState: active?.stateCode || (/^\d{2}/.test(gst) ? gst.slice(0, 2) : ''),
    today: todayInput(),
    hsnRate: (hsn, day) => {
      const row = master.filter((r) => r.code && hsn.startsWith(r.code)).sort((a, b) => (b.code ?? '').length - (a.code ?? '').length)[0];
      let hit: number | undefined;
      for (const r of row?.rates ?? []) if (r.from <= day) hit = r.rate;
      return hit;
    },
  };
}

/** Draft a bill from decoded QR values (+ optional stored file / inbox row). Null for a credit note. */
export function draftFromQrNow(qr: EinvoiceQrData, extra: { inboxId?: string; file?: AttachmentRef } = {}): PurchaseDraft | null {
  const res = draftFromQr(qr, captureContext(), { inboxId: extra.inboxId, attachments: extra.file ? [extra.file] : undefined });
  return res.bill ? draftsDb.save(res.bill) : null;
}

export interface CaptureOutcome {
  inbox: InboxDoc;
  draft?: PurchaseDraft;
  qr?: EinvoiceQrData;
  /** Why no draft was made ('' when one was). */
  note: string;
  route: string;
}

/**
 * Keep a picked / shared file in the inbox, read its e-invoice QR when it is an image, and draft the
 * bill. Throws a readable error for a file that cannot be kept (type / size).
 */
export async function openCaptureFromFile(file: File, opts: { source?: InboxSource; intent?: 'bill' | 'expense' } = {}): Promise<CaptureOutcome> {
  // 8.46: the supplier's e-invoice JSON file → a draft with every line and the GST split (the file itself is not kept).
  if (/\.json$/i.test(file.name) || file.type === 'application/json') {
    if (file.size > MAX_JSON_TEXT) throw new Error(capT('tooLarge'));
    const r = captureFromQrText(await file.text(), opts.source === 'share' ? 'share' : 'paste');
    const inbox = inboxDb.all().find((d) => d.id === r.inboxId);
    if (!inbox) throw new Error(r.message);
    return { inbox, draft: inbox.draft_id ? draftsDb.all().find((d) => d.id === inbox.draft_id) : undefined, qr: inbox.qr, note: '', route: r.route ?? '' };
  }
  if (file.size > Math.max(MAX_IMAGE_INPUT_BYTES, MAX_PDF_BYTES)) throw new Error(capT('tooLarge'));
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const mime = sniffMime(head);
  if (!mime) throw new Error(capT('badType'));
  // Decode BEFORE storing: the stored copy of a photo is downscaled, which can make a dense QR unreadable.
  let qrText: string | null = null;
  if (opts.intent !== 'expense') qrText = mime === 'application/pdf' ? await readQrFromPdf(file).catch(() => null) : await readQrFromImage(file);
  const ref = await attachFile(file);
  const decoded = qrText ? decodeEinvoiceQr(qrText) : null;
  const qr = decoded?.ok ? decoded.data : undefined;
  let note = '';
  if (opts.intent === 'expense') note = '';
  else if (mime === 'application/pdf' && !qrText) note = capT('notePdf');
  else if (!qrImageSupported()) note = capT('noDetector');
  else if (!qrText) note = capT('noQr');
  else if (!qr) note = capT('notEinvoice');
  else if (qr.docType === 'CRN') note = capT('creditNote');
  let inbox = inboxDb.add({ source: opts.source ?? 'upload', file: ref, intent: opts.intent, qr, note: note || undefined });
  let draft: PurchaseDraft | undefined;
  if (qr && qr.docType !== 'CRN') {
    draft = draftFromQrNow(qr, { inboxId: inbox.id, file: ref }) ?? undefined;
    if (draft) inbox = inboxDb.update(inbox.id, { draft_id: draft.id }) ?? inbox;
  }
  try {
    window.dispatchEvent(new CustomEvent(INBOX_CHANGED_EVENT));
  } catch {
    /* no window (tests) */
  }
  return { inbox, draft, qr, note, route: `/expenses?tab=inbox&doc=${encodeURIComponent(inbox.id)}` };
}

const QR_WARN_KEY = { sellerGstin: 'wSeller', buyerGstin: 'wBuyer', docDate: 'wDate', irn: 'wIrn', total: 'wTotal', docType: 'wType' } as const;

/**
 * 8I (8.160): a QR read live by the camera ("Scan bill" in the Expenses header) — keep it in the inbox and draft
 * the bill, like the Inbox tab's camera / paste path. Returns the toast text and the inbox route.
 */
type CaptureToast = { message: string; tone: 'success' | 'error' | 'info'; route?: string; inboxId?: string };

export function captureFromQrText(text: string, source: InboxSource = 'camera'): CaptureToast {
  // 8.46: the full e-invoice JSON (or the IRP's signed invoice) drafts every line with its GST split.
  const json = decodeEinvoiceJson(text);
  if (json.ok === true) return captureJson(json.data, json.warnings, source);
  if (/^\s*[[{]/.test(text)) return { message: capT(json.error === 'tooLong' ? 'e_tooLong' : 'e_json'), tone: 'error' };
  const res = decodeEinvoiceQr(text);
  if (res.ok === false) return { message: capT(`e_${res.error}`), tone: 'error' };
  const preview = draftFromQr(res.data, captureContext());
  if (preview.creditNote) {
    const row = inboxDb.add({ source, qr: res.data, note: capT('creditNote') });
    notifyInbox();
    return { message: capT('creditNote'), tone: 'info', route: `/expenses?tab=inbox&doc=${encodeURIComponent(row.id)}` };
  }
  const row = inboxDb.add({ source, qr: res.data });
  const d = draftFromQrNow(res.data, { inboxId: row.id });
  if (d) inboxDb.update(row.id, { draft_id: d.id });
  notifyInbox();
  const extra = [...res.warnings.map((w) => capT(QR_WARN_KEY[w])), ...(preview.buyerMismatch ? [capT('warnBuyer', { gstin: res.data.buyerGstin })] : [])];
  return {
    message: `${capT('drafted', { no: res.data.docNo || '-' })} ${capT('sigNote')}${extra.length ? ` ${extra.join(' ')}` : ''}`,
    tone: extra.length ? 'info' : 'success',
    route: `/expenses?tab=inbox&doc=${encodeURIComponent(row.id)}`,
  };
}

function captureJson(j: EinvoiceJsonData, warnings: readonly (keyof typeof QR_WARN_KEY)[], source: InboxSource): CaptureToast {
  const row = inboxDb.add({ source, qr: j.qr });
  const res = draftFromEinvoiceJson(j, captureContext(), { inboxId: row.id });
  if (res.bill) inboxDb.update(row.id, { draft_id: draftsDb.save(res.bill).id });
  else inboxDb.update(row.id, { note: capT('creditNote') });
  notifyInbox();
  const route = `/expenses?tab=inbox&doc=${encodeURIComponent(row.id)}`;
  if (!res.bill) return { message: capT('creditNote'), tone: 'info', route, inboxId: row.id };
  const extra = [...warnings.map((w) => capT(QR_WARN_KEY[w])), ...(res.buyerMismatch ? [capT('warnBuyer', { gstin: j.qr.buyerGstin })] : [])];
  return { message: `${capT('draftedLines', { no: j.qr.docNo || '-', n: j.lines.length })}${extra.length ? ` ${extra.join(' ')}` : ''}`, tone: extra.length ? 'info' : 'success', route, inboxId: row.id };
}

function notifyInbox() {
  try {
    window.dispatchEvent(new CustomEvent(INBOX_CHANGED_EVENT));
  } catch {
    /* no window (tests) */
  }
}

/**
 * Browser half of bill capture (8.40 / 8.41): read an e-invoice QR from a photo with the browser's
 * BarcodeDetector, keep the file in the documents inbox and draft a bill from the QR.
 *
 * Entry point for other features (the PWA share target, a later pass): `openCaptureFromFile(file)`
 * stores the file in `doc_inbox`, tries the QR, drafts the bill when it can and returns the route of
 * the inbox row (`/expenses?tab=inbox&doc=<id>`) for the caller to navigate to.
 *
 * PDFs: rendering a PDF page needs a PDF engine (pdf.js) that this app does not ship, so a PDF is
 * kept in the inbox as it is and its QR is not read — scan the printed QR or a photo / screenshot of
 * it instead. Images are size-capped before decoding; nothing leaves the device.
 */

import type { InboxDoc, InboxSource } from './doc-inbox';
import { inboxDb } from './doc-inbox';
import { decodeEinvoiceQr, type EinvoiceQrData } from './einvoice-qr';
import { draftFromQr, type CaptureContext } from './bill-capture';
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
  if (file.size > Math.max(MAX_IMAGE_INPUT_BYTES, MAX_PDF_BYTES)) throw new Error(capT('tooLarge'));
  const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const mime = sniffMime(head);
  if (!mime) throw new Error(capT('badType'));
  // Decode BEFORE storing: the stored copy of a photo is downscaled, which can make a dense QR unreadable.
  let qrText: string | null = null;
  if (mime !== 'application/pdf' && opts.intent !== 'expense') qrText = await readQrFromImage(file);
  const ref = await attachFile(file);
  const decoded = qrText ? decodeEinvoiceQr(qrText) : null;
  const qr = decoded?.ok ? decoded.data : undefined;
  let note = '';
  if (mime === 'application/pdf') note = capT('notePdf');
  else if (opts.intent === 'expense') note = '';
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

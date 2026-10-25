/**
 * Browser side of attachments (6.12): read a picked file, downscale photos, store it,
 * and open / download a stored file. Kept apart from attachments.ts (which stays pure and
 * Node-tested) because it needs canvas, Blob URLs and `window.open`.
 *
 * Viewing: images are shown in an <img> from their data URL (CSP `img-src data:` already
 * allows that). PDFs open in a new tab from a `blob:` URL built from the stored bytes with the
 * SNIFFED type (never the declared one); a top-level navigation is not restricted by the
 * page CSP, so no CSP change is needed. Data URLs are never fetched (`connect-src 'self'`).
 */

import { compressPhoto } from './image';
import {
  AttachmentError,
  MAX_IMAGE_INPUT_BYTES,
  MAX_PDF_BYTES,
  attachmentBytes,
  formatBytes,
  isImageMime,
  putAttachment,
  sniffMime,
  type AttachmentRef,
} from './attachments';
import { downloadBlob } from './download';

/** Store a picked file and return the reference to put on the record. */
export async function attachFile(file: File): Promise<AttachmentRef> {
  if (file.size > Math.max(MAX_IMAGE_INPUT_BYTES, MAX_PDF_BYTES)) {
    throw new AttachmentError(`That file is ${formatBytes(file.size)} — too large to keep in the browser.`);
  }
  const original = new Uint8Array(await file.arrayBuffer());
  const mime = sniffMime(original);
  if (!mime) throw new AttachmentError('Only photos (JPG, PNG, WebP, GIF) and PDF files can be attached.');
  let bytes: Uint8Array = original;
  let name = file.name;
  if (isImageMime(mime)) {
    try {
      bytes = await compressPhoto(file, original);
    } catch {
      throw new AttachmentError('This image could not be read. Try a JPG or PNG copy of it.');
    }
    if (bytes !== original && mime !== 'image/jpeg') name = name.replace(/\.[a-z0-9]+$/i, '') + '.jpg';
  }
  return putAttachment({ bytes, name });
}

function blobOf(ref: AttachmentRef): Blob | null {
  const file = attachmentBytes(ref.id);
  return file ? new Blob([file.bytes as BlobPart], { type: file.mime }) : null;
}

/** Open a stored file in a new tab. Returns false when the file is missing. */
export function openAttachment(ref: AttachmentRef): boolean {
  const blob = blobOf(ref);
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  window.open(url, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

/** Save a stored file to disk under its original name. Returns false when the file is missing. */
export function downloadAttachment(ref: AttachmentRef): boolean {
  const blob = blobOf(ref);
  if (!blob) return false;
  downloadBlob(ref.name || 'attachment', blob);
  return true;
}

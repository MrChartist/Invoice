/**
 * Share the bill as an image (R3-A5): the rendered paper (first copy only) as JPEG (A4 / A5 / letter)
 * or PNG (thermal roll), one image per page up to {@link MAX_IMAGE_PAGES}. Shared as files where the
 * browser's share sheet takes files, else downloaded (several pages as one ZIP); "Copy image" puts the
 * first page on the clipboard where `ClipboardItem` exists. The image is never stored.
 *
 * Pure above "Browser". `html-to-image` and the ZIP writer load on demand.
 */
import { pageSlices, paperSize, type DesignPrefs } from './design-prefs';

export const MAX_IMAGE_PAGES = 5;

export type ImageKind = 'jpeg' | 'png';

/** PNG for a thermal roll (sharp text on narrow paper), JPEG for page papers. */
export function imageKind(design?: Pick<DesignPrefs, 'paper'> | null): ImageKind {
  return paperSize(design).autoHeight ? 'png' : 'jpeg';
}

/** Pages to cut a paper of `heightPx` into (one for a roll), at most 5. */
export function imageSlices(heightPx: number, design?: Pick<DesignPrefs, 'paper'> | null): { top: number; height: number }[] {
  return pageSlices(heightPx, design).slice(0, MAX_IMAGE_PAGES);
}

/** True when the paper is longer than the 5 pages an image share carries. */
export const imagePagesCapped = (heightPx: number, design?: Pick<DesignPrefs, 'paper'> | null): boolean => pageSlices(heightPx, design).length > MAX_IMAGE_PAGES;

/** "INV-FY26-27-0012.jpg" (page n of m → "INV-FY26-27-0012-p2.jpg"); slashes and unsafe characters → "-". */
export function imageFileName(invoiceNumber: string, kind: ImageKind, page = 1, pages = 1): string {
  const stem = (invoiceNumber || 'bill').replace(/[\\/:*?"<>|\s]+/g, '-').replace(/^-+|-+$/g, '') || 'bill';
  return `${stem}${pages > 1 ? `-p${page}` : ''}.${kind === 'png' ? 'png' : 'jpg'}`;
}

export const zipName = (invoiceNumber: string): string => imageFileName(invoiceNumber, 'jpeg').replace(/\.jpg$/, '-images.zip');

/* ── Browser ─────────────────────────────────────────────────── */

/** Render `node` (a TemplateEngine paper at its natural width) to image files, one per page. */
export async function renderBillImages(node: HTMLElement, invoiceNumber: string, design?: Pick<DesignPrefs, 'paper'> | null): Promise<File[]> {
  const { toCanvas } = await import('html-to-image');
  const size = paperSize(design);
  const height = Math.max(node.offsetHeight, size.autoHeight ? 1 : size.height);
  const ratio = 2;
  const canvas = await toCanvas(node, {
    pixelRatio: ratio,
    cacheBust: true,
    width: size.width,
    height,
    backgroundColor: '#ffffff',
    style: { transform: 'none', transformOrigin: 'top left' },
  });
  const kind = imageKind(design);
  const slices = imageSlices(height, design);
  const files: File[] = [];
  for (let i = 0; i < slices.length; i++) {
    const s = slices[i];
    const page = document.createElement('canvas');
    page.width = Math.round(size.width * ratio);
    page.height = Math.round(Math.min(s.height, height - s.top) * ratio) || 1;
    const ctx = page.getContext('2d');
    if (!ctx) break;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, page.width, page.height);
    ctx.drawImage(canvas, 0, Math.round(s.top * ratio), page.width, page.height, 0, 0, page.width, page.height);
    const mime = kind === 'png' ? 'image/png' : 'image/jpeg';
    const blob = await new Promise<Blob | null>((resolve) => page.toBlob(resolve, mime, 0.92));
    if (!blob) continue;
    files.push(new File([blob], imageFileName(invoiceNumber, kind, i + 1, slices.length), { type: mime }));
  }
  return files;
}

interface FileShareNav {
  canShare?: (data: { files: File[] }) => boolean;
  share?: (data: { files: File[]; title?: string; text?: string }) => Promise<void>;
}

/** Share the images (share sheet), else download them (one file, or a ZIP for several). */
export async function shareOrDownloadImages(files: File[], invoiceNumber: string, title?: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (!files.length) throw new Error('Could not draw the bill as an image.');
  const nav = navigator as unknown as FileShareNav;
  try {
    if (nav.share && nav.canShare?.({ files })) {
      await nav.share({ files, title: title ?? files[0].name });
      return 'shared';
    }
  } catch (err) {
    if ((err as Error).name === 'AbortError') return 'cancelled';
    /* fall through to a download */
  }
  const { downloadBlob } = await import('./download');
  if (files.length === 1) downloadBlob(files[0].name, files[0]);
  else {
    const { zipBlob } = await import('./zip');
    const entries = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
    downloadBlob(zipName(invoiceNumber), await zipBlob(entries, { compress: false }));
  }
  return 'downloaded';
}

/** Copy the first page to the clipboard (desktop); false where the browser cannot. */
export async function copyBillImage(file: File): Promise<boolean> {
  const CI = (globalThis as unknown as { ClipboardItem?: new (items: Record<string, Blob>) => unknown }).ClipboardItem;
  const clip = navigator.clipboard as unknown as { write?: (items: unknown[]) => Promise<void> } | undefined;
  if (!CI || !clip?.write) return false;
  try {
    // Most browsers copy PNG only.
    let blob: Blob = file;
    if (file.type !== 'image/png') {
      const bmp = await createImageBitmap(file);
      const c = document.createElement('canvas');
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext('2d')?.drawImage(bmp, 0, 0);
      blob = (await new Promise<Blob | null>((r) => c.toBlob(r, 'image/png'))) ?? file;
    }
    await clip.write([new CI({ [blob.type]: blob })]);
    return true;
  } catch {
    return false;
  }
}

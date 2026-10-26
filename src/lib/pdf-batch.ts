/**
 * PDF assembly for printing & batch output (P0-9 copies, P1-15 batch / ZIP). Critical Rule 6:
 * the stack stays `html-to-image` + `jspdf`, both loaded on demand so they never touch first
 * paint. The pure helpers (file names, page maths) are unit-tested; the capture runs in a browser.
 *
 *   const pdf = await PdfBuilder.create();
 *   for (const node of papers) await pdf.addPaper(node, design);
 *   downloadBlob('Invoices.pdf', pdf.blob());
 *
 * ZIP output reuses the dependency-free writer in `zip.ts` (STORE: PDFs are already compressed).
 */

import { activeArt, pageSlices, paperSize, type DesignPrefs, type PageBands } from './design-prefs';
import { itemImageData } from './item-images';
import { ensureDevanagariFont } from './fonts-ready';
import { writeZip } from './zip';
import { DOCUMENT_LABELS, type InvoiceRecord } from '../types/invoice';

type JsPdf = InstanceType<typeof import('jspdf').jsPDF>;

export interface PaperPlacement {
  /** Page width / height in mm (height = image height for a thermal roll). */
  pageWmm: number;
  pageHmm: number;
  imgHmm: number;
  pages: number;
}

/** How a captured paper of `heightPx` (CSS px at the paper width) is laid onto PDF pages. */
export function placePaper(heightPx: number, design?: Pick<DesignPrefs, 'paper'> | null): PaperPlacement {
  const size = paperSize(design);
  const height = Math.max(heightPx, size.height);
  const pageWmm = size.mm.width;
  const imgHmm = (height / size.width) * pageWmm;
  const pageHmm = size.autoHeight ? imgHmm : size.mm.height;
  return { pageWmm, pageHmm, imgHmm, pages: pageSlices(height, design).length };
}

/** Builds one PDF from any number of rendered papers (one paper may span several pages). */
export class PdfBuilder {
  private pdf: JsPdf | null = null;
  private toJpeg: typeof import('html-to-image').toJpeg;
  private JsPDF: typeof import('jspdf').jsPDF;
  /** Pages written so far. */
  pageCount = 0;

  private constructor(toJpeg: typeof import('html-to-image').toJpeg, JsPDF: typeof import('jspdf').jsPDF) {
    this.toJpeg = toJpeg;
    this.JsPDF = JsPDF;
  }

  static async create(): Promise<PdfBuilder> {
    const [{ toJpeg }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')]);
    return new PdfBuilder(toJpeg, jsPDF);
  }

  /** Capture `node` (a TemplateEngine paper at its natural width) and append its pages. */
  async addPaper(node: HTMLElement, design?: (Pick<DesignPrefs, 'paper'> & Partial<Pick<DesignPrefs, 'preprinted' | 'letterhead' | 'footer_image'>>) | null): Promise<number> {
    const size = paperSize(design);
    await ensureDevanagariFont(node.textContent);
    const height = Math.max(node.offsetHeight, size.height);
    // R3-C3: a footer band / every-page header band is drawn on each PDF page instead of once in the paper.
    const art = size.autoHeight ? null : await loadBands(design, size.width);
    const dataUrl = await this.toJpeg(node, {
      quality: 0.92,
      pixelRatio: 2.5,
      cacheBust: true,
      width: size.width,
      height,
      backgroundColor: '#ffffff',
      style: { transform: 'none', transformOrigin: 'top left' },
      ...(art?.footer ? { filter: (n: HTMLElement) => !(n instanceof Element && n.hasAttribute('data-page-footer')) } : {}),
    });
    const place = placePaper(height, design);
    const pxToMm = place.pageWmm / size.width;
    const slices = art ? pageSlices(height, design, art.bands) : null;
    const pages = slices ? slices.length : place.pages;
    for (let page = 0; page < pages; page++) {
      if (!this.pdf) this.pdf = new this.JsPDF({ orientation: 'portrait', unit: 'mm', format: [place.pageWmm, place.pageHmm] });
      else this.pdf.addPage([place.pageWmm, place.pageHmm], 'portrait');
      const slice = slices?.[page];
      const y = slice ? ((slice.offset ?? 0) - slice.top) * pxToMm : -page * place.pageHmm;
      this.pdf.addImage(dataUrl, 'JPEG', 0, y, place.pageWmm, place.imgHmm, undefined, 'FAST');
      if (slice && art) {
        // Cover what spills outside this page's content window, then draw the bands on top.
        this.pdf.setFillColor(255, 255, 255);
        const top = (slice.offset ?? 0) * pxToMm;
        const bottom = (top + slice.height * pxToMm);
        if (top > 0) this.pdf.rect(0, 0, place.pageWmm, top, 'F');
        if (bottom < place.pageHmm) this.pdf.rect(0, bottom, place.pageWmm, place.pageHmm - bottom, 'F');
        if (top > 0 && art.header) this.pdf.addImage(art.header.data, art.header.kind, 0, 0, place.pageWmm, art.header.h * pxToMm, undefined, 'FAST');
        if (art.footer) this.pdf.addImage(art.footer.data, art.footer.kind, 0, place.pageHmm - art.footer.h * pxToMm, place.pageWmm, art.footer.h * pxToMm, undefined, 'FAST');
      }
      this.pageCount++;
    }
    return pages;
  }

  /** The finished PDF (throws when nothing was added). */
  blob(): Blob {
    if (!this.pdf) throw new Error('Nothing to put in the PDF.');
    return this.pdf.output('blob');
  }

  async bytes(): Promise<Uint8Array> {
    return new Uint8Array(await this.blob().arrayBuffer());
  }
}

/** File-system-safe stem: no path separators or characters Windows rejects. */
export function safeStem(s: string, fallback = 'document'): string {
  const printable = Array.from(s, (ch) => ((ch.codePointAt(0) ?? 0) < 32 ? '-' : ch)).join('');
  const out = printable.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_').replace(/^[-_.]+|[-_.]+$/g, '').slice(0, 90);
  return out || fallback;
}

/** "Tax_Invoice_INV-FY25-26-0001.pdf" — the same name the preview's PDF button uses. */
export function invoicePdfName(rec: Pick<InvoiceRecord, 'doc_type' | 'invoice_number'>): string {
  const label = (DOCUMENT_LABELS[rec.doc_type] ?? 'Document').replace(/\s+/g, '_');
  return `${label}_${safeStem(rec.invoice_number || 'draft', 'draft')}.pdf`;
}

/** De-duplicate names case-insensitively: "a.pdf", "a (2).pdf", "a (3).pdf" (ZIP entries must be unique). */
export function uniqueFileNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  return names.map((name) => {
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    let candidate = name;
    for (let n = 2; seen.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`;
    seen.add(candidate.toLowerCase());
    return candidate;
  });
}

/** A ZIP of finished files (STORE mode: PDFs do not shrink further). */
export async function zipFiles(files: readonly { name: string; data: Uint8Array }[]): Promise<Blob> {
  const names = uniqueFileNames(files.map((f) => f.name));
  const bytes = await writeZip(files.map((f, i) => ({ name: names[i], data: f.data })), { compress: false });
  return new Blob([bytes.slice().buffer as ArrayBuffer], { type: 'application/zip' });
}

/** Wait for React to commit and the browser to paint (two animation frames), plus a tick for images. */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 30))));
}

interface Band { data: string; kind: 'PNG' | 'JPEG'; h: number }

/** Height in CSS px of an image drawn at the paper width (keeps its aspect). */
async function band(ref: string | undefined, width: number): Promise<Band | undefined> {
  const data = itemImageData(ref);
  if (!data) return undefined;
  const img = new Image();
  img.src = data;
  try {
    await img.decode();
  } catch {
    return undefined;
  }
  if (!img.naturalWidth) return undefined;
  // jsPDF draws PNG and JPEG; WebP / GIF artwork is re-encoded through a canvas once.
  let out = data;
  let kind: Band['kind'] = data.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG';
  if (!/^data:image\/(png|jpeg)/.test(data)) {
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext('2d')?.drawImage(img, 0, 0);
    out = c.toDataURL('image/png');
    kind = 'PNG';
  }
  return { data: out, kind, h: (img.naturalHeight / img.naturalWidth) * width };
}

/** R3-C3: the repeated artwork of a design, or null when there is none to repeat. */
async function loadBands(design: Parameters<PdfBuilder['addPaper']>[1], width: number): Promise<{ bands: PageBands; header?: Band; footer?: Band } | null> {
  const art = activeArt(design as DesignPrefs | null);
  if (!art) return null;
  const every = art.letterhead?.mode === 'header' && art.letterhead.every_page;
  const header = every ? await band(art.letterhead?.image, width) : undefined;
  const footer = await band(art.footer, width);
  if (!header && !footer) return null;
  return { bands: { header: header?.h, everyPage: !!header, footer: footer?.h }, header, footer };
}

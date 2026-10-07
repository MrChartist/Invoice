/**
 * Browser-side export helpers for the receivables module.
 * The heavy libraries (html-to-image, jspdf) are imported dynamically so they
 * only load when the user actually exports a PDF.
 */

export function downloadTextFile(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  // BOM so Excel opens UTF-8 (₹, en dashes) correctly.
  const blob = new Blob(['﻿', text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function safeFilename(name: string): string {
  return name.replace(/[^\w\-. ]+/g, '').trim().replace(/\s+/g, '_').slice(0, 80) || 'statement';
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not render the statement image.'));
    img.src = src;
  });
}

/**
 * Renders `node` (an A4-width paper) to a multi-page A4 PDF. The tall capture
 * is sliced into page-height strips so long ledgers continue onto page 2, 3…
 */
export async function exportNodeToPdf(node: HTMLElement, filename: string): Promise<void> {
  const [{ toPng }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')]);
  const dataUrl = await toPng(node, { pixelRatio: 2, cacheBust: true, backgroundColor: 'white' });
  const img = await loadImage(dataUrl);

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = pdf.internal.pageSize.getWidth();
  const pageH = pdf.internal.pageSize.getHeight();

  // Pixel height of one A4 page at the captured width.
  const slicePx = Math.floor((img.width * pageH) / pageW);
  const pages = Math.max(1, Math.ceil(img.height / slicePx));

  for (let i = 0; i < pages; i++) {
    const sy = i * slicePx;
    const h = Math.min(slicePx, img.height - sy);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = slicePx;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available in this browser.');
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, sy, img.width, h, 0, 0, img.width, h);
    if (i > 0) pdf.addPage();
    // JPEG keeps a multi-page statement to a few hundred KB; PNG made it tens of MB.
    pdf.addImage(canvas.toDataURL('image/jpeg', 0.92), 'JPEG', 0, 0, pageW, pageH, undefined, 'FAST');
  }
  pdf.save(filename);
}

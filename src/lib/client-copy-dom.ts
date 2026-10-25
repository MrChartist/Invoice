/**
 * Browser half of the "client copy" web page (8.3 generalises it from invoices to statements):
 * clone a rendered paper, freeze its QR canvases into PNG images and collect the app's CSS rules,
 * so `buildClientCopyHtml` (pure, `client-copy.ts`) can wrap it in a static, script-free page.
 */

export interface FrozenPaper {
  /** outerHTML of the clone, canvases replaced by <img>. */
  html: string;
  /** PNG data URL of the first canvas (the payment QR), if any. */
  qrDataUrl?: string;
}

export function freezePaper(node: HTMLElement): FrozenPaper {
  const clone = node.cloneNode(true) as HTMLElement;
  const live = Array.from(node.querySelectorAll('canvas'));
  let qrDataUrl: string | undefined;
  Array.from(clone.querySelectorAll('canvas')).forEach((c, i) => {
    try {
      const url = live[i]?.toDataURL('image/png');
      if (!url) return;
      qrDataUrl ??= url;
      const img = document.createElement('img');
      img.src = url;
      img.width = live[i].width;
      img.height = live[i].height;
      img.style.cssText = live[i].style.cssText;
      img.alt = 'QR code';
      c.replaceWith(img);
    } catch {
      c.remove();
    }
  });
  return { html: clone.outerHTML, qrDataUrl };
}

/** Every readable stylesheet rule of the app (cross-origin sheets are skipped). */
export function documentCss(): string {
  return Array.from(document.styleSheets)
    .map((sheet) => {
      try {
        return Array.from(sheet.cssRules).map((r) => r.cssText).join('\n');
      } catch {
        return '';
      }
    })
    .join('\n');
}

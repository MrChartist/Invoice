import { downloadText } from '../../lib/download';
import { printWhenReady } from '../../lib/print-fonts';

/**
 * Open a script-free voucher page in its own window and print it (the CSP allows it).
 * A blocked pop-up falls back to saving the page as an HTML file.
 */
export function openPrintable(html: string, fileBase: string): void {
  const w = window.open('', '_blank');
  if (w) {
    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
    printWhenReady(w);
  } else {
    downloadText(`${fileBase.replace(/[\\/]/g, '-')}.html`, html, 'text/html');
  }
}

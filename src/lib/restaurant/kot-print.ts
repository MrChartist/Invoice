/**
 * Printing kitchen tickets (R3-A2). Loaded on the first print only (dynamic import from the Tables
 * screen), together with `escpos.ts`.
 *
 * Each station has a device-local printer choice (`mrchartist_kot_printers`, outside the company prefix
 * like `mrchartist_pos_printer`: never backed up or synced), reusing `PrinterPrefs`:
 *  - `browser` / `raw`: one small script-free HTML ticket per station in one print window;
 *  - `serial` / `bluetooth`: ESC/POS bytes (`ticketBytes`) through Web Serial / Web Bluetooth.
 */
import type { Kot } from '../../types/restaurant';
import {
  DEFAULT_PRINTER, sendToBluetooth, sendToSerial, ticketBytes, type PrinterPrefs,
} from '../escpos';
import { ticketLines, type TicketContext } from './kot';

export const KOT_PRINTERS_KEY = 'mrchartist_kot_printers';

export type KotPrinters = Record<string, PrinterPrefs>;

export function loadKotPrinters(): KotPrinters {
  try {
    const raw = JSON.parse(localStorage.getItem(KOT_PRINTERS_KEY) ?? 'null') as KotPrinters | null;
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

export function saveKotPrinters(p: KotPrinters): void {
  try {
    localStorage.setItem(KOT_PRINTERS_KEY, JSON.stringify(p));
  } catch {
    /* private window: not remembered */
  }
}

export const printerFor = (printers: KotPrinters, station: string): PrinterPrefs => ({ ...DEFAULT_PRINTER, ...(printers[station] ?? {}) });

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** One print page with a ticket per station (page break between tickets). */
export function kotHtml(tickets: readonly { lines: string[]; width: 58 | 80 }[], title = 'KOT'): string {
  const body = tickets
    .map((t) => `<pre style="font-size:${t.width === 58 ? 11 : 12}px">${esc(t.lines.join('\n'))}</pre>`)
    .join('<div class="cut"></div>');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title>
<style>@page{size:80mm auto;margin:2mm}html,body{margin:0;background:#fff;color:#000}pre{font-family:monospace;line-height:1.25;margin:0 0 4mm;white-space:pre}.cut{break-after:page;page-break-after:always}</style></head>
<body>${body}</body></html>`;
}

/**
 * Print tickets on each station's printer. Browser / raw stations share one print window.
 * Returns the stations that failed (with the reason).
 */
export async function printKots(kots: readonly Kot[], ctxOf: (k: Kot) => TicketContext, opts: { duplicate?: boolean } = {}): Promise<{ station: string; error: string }[]> {
  const printers = loadKotPrinters();
  const failed: { station: string; error: string }[] = [];
  const paper: { lines: string[]; width: 58 | 80 }[] = [];
  for (const k of kots) {
    const p = printerFor(printers, k.station);
    const lines = ticketLines(k, { ...ctxOf(k), duplicate: opts.duplicate }, p.width);
    try {
      if (p.mode === 'serial') await sendToSerial(ticketBytes(lines, p.width), p.baud);
      else if (p.mode === 'bluetooth') await sendToBluetooth(ticketBytes(lines, p.width));
      else paper.push({ lines, width: p.width });
    } catch (err) {
      failed.push({ station: k.station, error: (err as Error).message });
      paper.push({ lines, width: p.width }); // fall back to the browser ticket
    }
  }
  if (paper.length) {
    const w = window.open('', '_blank', 'popup,width=420,height=600');
    if (!w) failed.push({ station: kots[0]?.station ?? '', error: 'Pop-ups are blocked: allow them to print kitchen tickets.' });
    else {
      w.document.open();
      w.document.write(kotHtml(paper, kots.map((k) => k.number).join(' ')));
      w.document.close();
      w.focus();
      w.print();
    }
  }
  return failed;
}

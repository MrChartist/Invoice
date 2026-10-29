/**
 * Cheque printing (roadmap 6.26) for issued cheques on Indian CTS-2010 leaves.
 *
 * CTS-2010 standardises the leaf (about 203 × 92 mm) and the MICR band, but not the exact spot of
 * each field — banks differ by a few millimetres. So the layout is a sensible default for the common
 * leaf (date boxes top-right, "Pay" line, two "Rupees" lines, the ₹ box on the right) plus
 * adjustable offsets in millimetres: one for the whole print (printer feed) and one per field.
 * Do a test print on plain paper held against a leaf, adjust, then print on the cheque.
 *
 * Output is a script-free HTML page (inline styles, so the CSP allows it) opened in a new window
 * and printed with the browser at 100 % scale — no PDF library needed.
 *
 * Pure except `loadChequePrefs` / `saveChequePrefs` (table `cheque_print`).
 */

import type { Cheque } from '../types/cheques';
import { amountInWords } from './amount-in-words';
import { round2 } from './invoice-calc';
import { DB_PREFIX, getJson, setJson } from './storage';
import { escHtml as esc } from './html-esc';
import { PRINT_FONT, PRINT_FONT_FACE } from './print-fonts';

export const CHEQUE_PREFS_KEY = `${DB_PREFIX}cheque_print`;

export type ChequeField = 'date' | 'payee' | 'words1' | 'words2' | 'figures' | 'crossing';

export interface FieldBox {
  /** Left / top in mm from the leaf's top-left corner. */
  x: number;
  y: number;
  /** Width in mm (text is clipped to it). */
  w: number;
}

export interface ChequeLayout {
  id: string;
  label: string;
  /** Leaf size in mm. */
  width: number;
  height: number;
  fields: Record<ChequeField, FieldBox>;
  /** Pitch of one date box in mm (8 boxes: D D M M Y Y Y Y). */
  dateBox: number;
  /** Characters that fit on the first words line before wrapping to the second. */
  words1Chars: number;
}

/** Default leaf: CTS-2010 standard size with the commonest field positions. */
export const CTS_2010: ChequeLayout = {
  id: 'cts2010',
  label: 'CTS-2010 standard leaf (203 × 92 mm)',
  width: 203,
  height: 92,
  fields: {
    date: { x: 152, y: 8, w: 44 },
    payee: { x: 20, y: 21, w: 140 },
    words1: { x: 32, y: 30, w: 125 },
    words2: { x: 10, y: 38, w: 140 },
    figures: { x: 160, y: 36, w: 38 },
    crossing: { x: 6, y: 2, w: 30 },
  },
  dateBox: 5.5,
  words1Chars: 52,
};

/** Same leaf, the variant with the date boxes and ₹ box a little lower (seen on several PSU-bank leaves). */
export const CTS_2010_LOW: ChequeLayout = {
  ...CTS_2010,
  id: 'cts2010_low',
  label: 'CTS-2010, date and amount boxes lower',
  fields: {
    ...CTS_2010.fields,
    date: { x: 150, y: 11, w: 44 },
    payee: { x: 20, y: 24, w: 140 },
    words1: { x: 32, y: 33, w: 125 },
    words2: { x: 10, y: 41, w: 140 },
    figures: { x: 158, y: 40, w: 38 },
  },
};

export const CHEQUE_LAYOUTS: readonly ChequeLayout[] = [CTS_2010, CTS_2010_LOW];

export interface ChequePrefs {
  layout: string;
  /** Whole-print nudge in mm (positive = right / down). */
  offsetX: number;
  offsetY: number;
  /** Per-field nudges in mm. */
  fields: Partial<Record<ChequeField, { dx: number; dy: number }>>;
}

export const DEFAULT_CHEQUE_PREFS: ChequePrefs = { layout: CTS_2010.id, offsetX: 0, offsetY: 0, fields: {} };

const clampMm = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(-30, Math.min(30, Math.round(n * 2) / 2)) : 0;
};

export function normalizeChequePrefs(raw: unknown): ChequePrefs {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const fields: ChequePrefs['fields'] = {};
  const f = (o.fields && typeof o.fields === 'object' ? o.fields : {}) as Record<string, { dx?: unknown; dy?: unknown }>;
  for (const k of Object.keys(CTS_2010.fields) as ChequeField[]) {
    if (f[k]) fields[k] = { dx: clampMm(f[k].dx), dy: clampMm(f[k].dy) };
  }
  return {
    layout: CHEQUE_LAYOUTS.some((l) => l.id === o.layout) ? String(o.layout) : CTS_2010.id,
    offsetX: clampMm(o.offsetX),
    offsetY: clampMm(o.offsetY),
    fields,
  };
}

export function loadChequePrefs(): ChequePrefs {
  return normalizeChequePrefs(getJson<unknown>(CHEQUE_PREFS_KEY, null));
}

export function saveChequePrefs(p: ChequePrefs): void {
  setJson(CHEQUE_PREFS_KEY, normalizeChequePrefs(p));
}

/* ── Content ────────────────────────────────────────────────── */

/** DDMMYYYY digits for the date boxes (empty for a bad date). */
export function chequeDateDigits(date: string): string[] {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date ?? '');
  return m ? `${m[3]}${m[2]}${m[1]}`.split('') : [];
}

/** Amount in words for the "Rupees" lines (Indian system; the leaf already prints "Rupees"). */
export function chequeWords(amount: number): string {
  return amountInWords(round2(Math.abs(amount)), 'INR').replace(/^Rupees\s+/, '');
}

/** Split the words over the two lines at a word boundary. */
export function splitWords(words: string, firstLineChars: number): [string, string] {
  if (words.length <= firstLineChars) return [words, ''];
  const cut = words.lastIndexOf(' ', firstLineChars);
  const at = cut > 0 ? cut : firstLineChars;
  return [words.slice(0, at).trim(), words.slice(at).trim()];
}

/** Figures for the ₹ box: Indian grouping, guarded with asterisks; "/-" when there are no paise. */
export function chequeFigures(amount: number): string {
  const a = round2(Math.abs(amount));
  const whole = Number.isInteger(a);
  const s = a.toLocaleString('en-IN', { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: 2 });
  return `**${s}${whole ? '/-' : ''}`;
}

export interface PrintItem {
  field: ChequeField;
  /** Final position in mm, offsets applied. */
  x: number;
  y: number;
  w: number;
  text: string;
  /** Date: one character per box. */
  boxes?: string[];
}

export interface ChequePrint {
  layout: ChequeLayout;
  items: PrintItem[];
  accountPayee: boolean;
}

/** Everything to print on one leaf, positioned in mm. */
export function buildChequePrint(c: Pick<Cheque, 'party_name' | 'amount' | 'cheque_date' | 'account_payee'>, prefs: ChequePrefs = DEFAULT_CHEQUE_PREFS): ChequePrint {
  const p = normalizeChequePrefs(prefs);
  const layout = CHEQUE_LAYOUTS.find((l) => l.id === p.layout) ?? CTS_2010;
  const [w1, w2] = splitWords(chequeWords(c.amount), layout.words1Chars);
  const accountPayee = c.account_payee !== false;
  const at = (field: ChequeField) => {
    const box = layout.fields[field];
    const nudge = p.fields[field] ?? { dx: 0, dy: 0 };
    return { x: round2(box.x + p.offsetX + nudge.dx), y: round2(box.y + p.offsetY + nudge.dy), w: box.w };
  };
  const items: PrintItem[] = [
    { field: 'date', ...at('date'), text: chequeDateDigits(c.cheque_date).join(''), boxes: chequeDateDigits(c.cheque_date) },
    { field: 'payee', ...at('payee'), text: String(c.party_name ?? '').trim() },
    { field: 'words1', ...at('words1'), text: w1 },
    { field: 'words2', ...at('words2'), text: w2 },
    { field: 'figures', ...at('figures'), text: chequeFigures(c.amount) },
  ];
  if (accountPayee) items.push({ field: 'crossing', ...at('crossing'), text: 'A/C PAYEE' });
  return { layout, items, accountPayee };
}


/**
 * A printable page for one leaf. `guide` draws the leaf outline and field boxes for a test print
 * on plain paper (never use it on a real cheque).
 */
export function chequeHtml(print: ChequePrint, opts: { guide?: boolean; title?: string } = {}): string {
  const { layout } = print;
  const mm = (n: number) => `${n}mm`;
  const parts = print.items.map((it) => {
    const pos = `left:${mm(it.x)};top:${mm(it.y)};width:${mm(it.w)}`;
    if (it.field === 'date') {
      const boxes = (it.boxes ?? []).map((d) => `<span class="box" style="width:${mm(layout.dateBox)}">${esc(d)}</span>`).join('');
      return `<div class="f date" style="${pos}">${boxes}</div>`;
    }
    if (it.field === 'crossing') {
      return `<div class="f crossing" style="${pos}"><span>${esc(it.text)}</span></div>`;
    }
    return `<div class="f ${it.field}" style="${pos}">${esc(it.text)}</div>`;
  });
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(opts.title ?? 'Cheque')}</title>
<style>${PRINT_FONT_FACE}
  @page { size: ${mm(layout.width)} ${mm(layout.height)}; margin: 0; }
  html, body { margin: 0; padding: 0; background: white; color: black; }
  .leaf { position: relative; width: ${mm(layout.width)}; height: ${mm(layout.height)}; overflow: hidden;
    font-family: ${PRINT_FONT}; font-size: 11pt; font-weight: 600; }
  .guide { outline: 0.3mm dashed gray; }
  .guide .f { outline: 0.2mm dotted gray; }
  .f { position: absolute; white-space: nowrap; overflow: hidden; line-height: 1.2; }
  .date { display: flex; }
  .date .box { display: inline-block; text-align: center; }
  .figures { text-align: right; }
  .crossing { height: 12mm; transform: rotate(-30deg); transform-origin: left top; border-top: 0.4mm solid black;
    border-bottom: 0.4mm solid black; text-align: center; font-size: 9pt; display: flex; align-items: center; justify-content: center; }
  .note { font: 10pt ${PRINT_FONT}; padding: 4mm; }
  @media print { .note { display: none; } }
</style></head>
<body>
<div class="leaf${opts.guide ? ' guide' : ''}">
${parts.join('\n')}
</div>
${opts.guide ? '<p class="note">Test print: hold this sheet against a blank cheque leaf and adjust the offsets until the text sits on the lines. Print at 100% / "Actual size".</p>' : ''}
</body></html>`;
}

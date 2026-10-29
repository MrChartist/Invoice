/**
 * Barcode encoders (roadmap 6.7): Code 128 (code set B, with its mod-103 checksum) and EAN-13
 * (check digit validated), rendered as SVG for label sheets. Pure, no dependencies, no DOM.
 *
 * Both encoders return the module pattern as a string of '1' (bar) and '0' (space), without the
 * quiet zone; `barcodeSvg` adds the quiet zone and draws one <rect> per run of bars.
 */

/* ── Code 128 ────────────────────────────────────────────────── */

/**
 * Bar / space widths of the 107 Code 128 symbols (value 0–102, Start A/B/C = 103/104/105,
 * Stop = 106). Each symbol is 11 modules wide (the stop is 13: it carries the final bar).
 */
const CODE128_WIDTHS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
] as const;

export const CODE128_START_B = 104;
export const CODE128_STOP = 106;

/** Widths string ("211214") → module string ("11010010000"), starting with a bar. */
export function widthsToModules(widths: string): string {
  let out = '';
  for (let i = 0; i < widths.length; i++) out += (i % 2 === 0 ? '1' : '0').repeat(Number(widths[i]));
  return out;
}

/** Module pattern of one Code 128 symbol value (0–106). */
export function code128Symbol(value: number): string {
  const w = CODE128_WIDTHS[value];
  if (w === undefined) throw new RangeError(`Code 128 has no symbol ${value}.`);
  return widthsToModules(w);
}

/** All widths (exported for the table self-checks in the tests). */
export const CODE128_TABLE: readonly string[] = CODE128_WIDTHS;

/** True when every character can be written in Code 128 set B (printable ASCII 32–126). */
export function isCode128BText(text: string): boolean {
  if (!text) return false;
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (ch.length !== 1 || c < 32 || c > 126) return false;
  }
  return true;
}

/** Symbol values for `text` in set B: start, data, checksum, stop. */
export function code128BValues(text: string): number[] {
  if (!isCode128BText(text)) throw new Error('Code 128 labels take letters, digits and plain punctuation only.');
  const data = [...text].map((ch) => ch.charCodeAt(0) - 32);
  const check = code128Checksum(CODE128_START_B, data);
  return [CODE128_START_B, ...data, check, CODE128_STOP];
}

/** Mod-103 checksum: start value + Σ (position × value), positions counted from 1. */
export function code128Checksum(start: number, data: readonly number[]): number {
  let sum = start;
  data.forEach((v, i) => {
    sum += v * (i + 1);
  });
  return sum % 103;
}

/** Module pattern of `text` in Code 128 B (no quiet zone). */
export function encodeCode128B(text: string): string {
  return code128BValues(text).map(code128Symbol).join('');
}

/* ── EAN-13 ──────────────────────────────────────────────────── */

/** Left-hand odd-parity (set A / "L") codes for digits 0–9. */
export const EAN_L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'] as const;
/** Right-hand codes ("R"): the L code inverted. */
export const EAN_R = EAN_L.map((c) => [...c].map((b) => (b === '1' ? '0' : '1')).join(''));
/** Left-hand even-parity codes ("G"): the R code reversed. */
export const EAN_G = EAN_R.map((c) => [...c].reverse().join(''));
/** Which left-hand digits use G codes, by the first (implied) digit. */
export const EAN_PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'] as const;

/** Check digit for the first 12 digits (weights 1, 3, 1, 3 … from the left). */
export function ean13CheckDigit(first12: string): number {
  if (!/^\d{12}$/.test(first12)) throw new Error('An EAN-13 check digit needs exactly 12 digits.');
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

/** True for 13 digits whose last digit is the correct check digit. */
export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

/** Module pattern of an EAN-13 (95 modules, guards included, no quiet zone). Refuses a bad check digit. */
export function encodeEan13(code: string): string {
  if (!/^\d{13}$/.test(code)) throw new Error('EAN-13 is exactly 13 digits.');
  if (!isValidEan13(code)) throw new Error(`EAN-13 ${code} has a wrong check digit (should end in ${ean13CheckDigit(code.slice(0, 12))}).`);
  const parity = EAN_PARITY[Number(code[0])];
  let out = '101';
  for (let i = 1; i <= 6; i++) {
    const d = Number(code[i]);
    out += parity[i - 1] === 'L' ? EAN_L[d] : EAN_G[d];
  }
  out += '01010';
  for (let i = 7; i <= 12; i++) out += EAN_R[Number(code[i])];
  out += '101';
  return out;
}

/**
 * A new in-store EAN-13 (prefix 2, "restricted circulation" numbers a shop may assign itself),
 * not already in `taken`. `seed` picks the starting serial so tests are deterministic.
 */
export function nextInStoreEan(taken: ReadonlySet<string>, seed = 1): string {
  for (let n = Math.max(1, Math.floor(seed)); n < 1e11; n++) {
    const first12 = '2' + String(n).padStart(11, '0');
    const code = first12 + ean13CheckDigit(first12);
    if (!taken.has(code)) return code;
  }
  throw new Error('No free in-store barcode left.');
}

/* ── Choosing + rendering ────────────────────────────────────── */

export type Symbology = 'EAN13' | 'CODE128';

/** EAN-13 for a valid 13-digit code, Code 128 B for anything else printable; null if neither. */
export function pickSymbology(code: string): Symbology | null {
  const c = code.trim();
  if (isValidEan13(c)) return 'EAN13';
  return isCode128BText(c) ? 'CODE128' : null;
}

/** Module pattern for a code with the symbology `pickSymbology` chooses (throws when it cannot be drawn). */
export function encodeBarcode(code: string): { symbology: Symbology; modules: string } {
  const c = code.trim();
  const symbology = pickSymbology(c);
  if (!symbology) throw new Error('This code cannot be printed as a barcode.');
  return { symbology, modules: symbology === 'EAN13' ? encodeEan13(c) : encodeCode128B(c) };
}

/** Runs of bars as [startModule, width] pairs. */
export function barRuns(modules: string): [number, number][] {
  const runs: [number, number][] = [];
  let i = 0;
  while (i < modules.length) {
    if (modules[i] !== '1') {
      i++;
      continue;
    }
    const start = i;
    while (modules[i] === '1') i++;
    runs.push([start, i - start]);
  }
  return runs;
}

const escapeXml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * SVG markup of a barcode in user units of one module (it scales to whatever box the label gives it). Quiet zone: 10 modules (Code 128) / 11 (EAN-13).
 * `text` adds the human-readable line under the bars.
 */
export function barcodeSvg(code: string, opts: { height?: number; text?: boolean; className?: string } = {}): string {
  const { symbology, modules } = encodeBarcode(code);
  const quiet = symbology === 'EAN13' ? 11 : 10;
  const width = modules.length + quiet * 2;
  const barH = opts.height ?? 40;
  const showText = opts.text !== false;
  const height = barH + (showText ? 10 : 0);
  const rects = barRuns(modules).map(([x, w]) => `<rect x="${x + quiet}" y="0" width="${w}" height="${barH}"/>`).join('');
  const label = showText
    ? `<text x="${width / 2}" y="${barH + 8.5}" text-anchor="middle" font-size="8" font-family="'Chartist Sans Flex', sans-serif" font-variant-numeric="tabular-nums">${escapeXml(code.trim())}</text>`
    : '';
  const cls = opts.className ? ` class="${escapeXml(opts.className)}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg"${cls} viewBox="0 0 ${width} ${height}" role="img" aria-label="Barcode ${escapeXml(code.trim())}" shape-rendering="crispEdges"><rect width="${width}" height="${height}" fill="white"/><g fill="black">${rects}</g>${label}</svg>`;
}

/**
 * SmartFind query parsing (8G, 8.103 — TallyPrime-style "find anything"). Pure, no storage:
 *
 *   amounts   "12500", "₹12,500", "12.5k", "1.2L" / "1.2 lakh", "2cr", ranges ">50k", "<=1000",
 *             "10k-20k", "10k..20k"  →  AmountQuery
 *   ids       GSTIN (15), PAN (10), IRN (64 hex), UTR / bank reference (12–22 alphanumeric with digits)
 *   typos     `typoScore` — Damerau (OSA) edit distance per word: 1 edit for 4–6 letters, 2 for longer
 *
 * `search.ts` uses these to filter its cached index; the palette stays a lazy chunk.
 */

export interface AmountQuery {
  op: 'eq' | 'gt' | 'lt' | 'range';
  min: number;
  max: number;
  /** The token as typed (shown in the palette hint). */
  raw: string;
}

const UNITS: Record<string, number> = { k: 1e3, th: 1e3, l: 1e5, lac: 1e5, lakh: 1e5, lakhs: 1e5, lacs: 1e5, cr: 1e7, crore: 1e7, crores: 1e7, m: 1e6 };

/** "12.5k" → 12500, "₹1,20,000" → 120000, "1.2L" → 120000; NaN when it is not an amount. */
export function parseMoney(text: string): number {
  const m = /^₹?\s*(\d[\d,]*(?:\.\d+)?|\.\d+)\s*([a-z]+)?$/i.exec(text.trim());
  if (!m) return NaN;
  const n = Number(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return NaN;
  if (!m[2]) return n;
  const f = UNITS[m[2].toLowerCase()];
  return f ? Math.round(n * f * 100) / 100 : NaN;
}

/**
 * One token as an amount filter, or null. Bare digits are not a filter (see below); with a unit, ₹,
 * comma, decimal, comparison or range it is.
 */
export function parseAmountQuery(token: string): AmountQuery | null {
  const t = token.trim();
  if (!t) return null;
  const cmp = /^(>=|<=|>|<)\s*(.+)$/.exec(t);
  if (cmp) {
    const v = parseMoney(cmp[2]);
    if (!Number.isFinite(v)) return null;
    return cmp[1].startsWith('>') ? { op: 'gt', min: cmp[1] === '>=' ? v : v + 0.001, max: Infinity, raw: t } : { op: 'lt', min: -Infinity, max: cmp[1] === '<=' ? v : v - 0.001, raw: t };
  }
  const range = /^(.+?)\s*(?:-|\.\.|to)\s*(.+)$/i.exec(t);
  if (range && !/^\d{4}-\d{2}/.test(t)) {
    const a = parseMoney(range[1]);
    const b = parseMoney(range[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) return { op: 'range', min: Math.min(a, b), max: Math.max(a, b), raw: t };
  }
  // Bare digits stay text: "0007" is an invoice sequence and "12500" already matches the raw
  // amount fields of every record. A unit, ₹, comma or decimal makes it an amount filter.
  if (/^\d+$/.test(t)) return null;
  const v = parseMoney(t);
  if (!Number.isFinite(v)) return null;
  return { op: 'eq', min: v, max: v, raw: t };
}

/** Exact amounts match within a rupee either way (12500 finds 12,499.60); ranges are inclusive. */
export function amountMatches(q: AmountQuery, values: readonly number[]): boolean {
  return values.some((v) => {
    if (!Number.isFinite(v)) return false;
    const a = Math.abs(v);
    if (q.op === 'eq') return Math.abs(a - q.min) <= Math.max(1, q.min * 0.0005);
    return a >= q.min && a <= q.max;
  });
}

export type IdKind = 'gstin' | 'pan' | 'irn' | 'utr';

/** Recognise identifier-shaped tokens (upper-cased). */
export function detectId(token: string): { kind: IdKind; value: string } | null {
  const v = token.trim().toUpperCase();
  if (/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(v)) return { kind: 'gstin', value: v };
  if (/^[A-Z]{5}\d{4}[A-Z]$/.test(v)) return { kind: 'pan', value: v };
  if (/^[0-9A-F]{64}$/.test(v)) return { kind: 'irn', value: v };
  if (/^[A-Z0-9]{12,22}$/.test(v) && /\d{6,}/.test(v)) return { kind: 'utr', value: v };
  return null;
}

/** Restricted Damerau–Levenshtein distance, giving up (returning max + 1) once it exceeds `max`. */
export function editDistance(a: string, b: string, max = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const n = a.length;
  const m = b.length;
  let prev2: number[] = [];
  let prev = Array.from({ length: m + 1 }, (_, j) => j);
  for (let i = 1; i <= n; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let d = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d = Math.min(d, prev2[j - 2] + 1);
      cur.push(d);
      if (d < rowMin) rowMin = d;
    }
    if (rowMin > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[m];
}

/**
 * Typo-tolerant match of one (folded, lower-case) token against the words of a (folded) text: 0 when no
 * word is close enough, else a score below any substring match (so exact hits always rank first).
 */
export function typoScore(token: string, foldedText: string): number {
  if (token.length < 4) return 0;
  const allowed = token.length <= 6 ? 1 : 2;
  let best = 0;
  for (const word of foldedText.split(/[^\p{L}\p{N}]+/u)) {
    if (word.length < 3) continue;
    // Compare against the word's prefix of similar length too ("sharmaa" vs "sharma traders").
    const cand = word.length > token.length + allowed ? word.slice(0, token.length) : word;
    const d = editDistance(token, cand, allowed);
    if (d <= allowed) best = Math.max(best, 40 - d * 12);
  }
  return best;
}

export interface ParsedQuery {
  /** Text tokens left after amounts / ids were taken out. */
  text: string;
  amount: AmountQuery | null;
  ids: { kind: IdKind; value: string }[];
}

/** Split a palette query into text, one amount filter and identifier tokens. */
export function parseQuery(query: string): ParsedQuery {
  const text: string[] = [];
  let amount: AmountQuery | null = null;
  const ids: { kind: IdKind; value: string }[] = [];
  // Keep "10k - 20k" and "> 50k" together before splitting on spaces.
  const norm = query.replace(/\s*(-|\.\.)\s*(?=₹?\d)/g, '$1').replace(/(>=|<=|>|<)\s+/g, '$1').replace(/(\d)\s+(lakh|lakhs|lac|lacs|cr|crore|crores|k)\b/gi, '$1$2');
  for (const tok of norm.trim().split(/\s+/).filter(Boolean)) {
    const id = detectId(tok);
    if (id) {
      ids.push(id);
      continue;
    }
    const a: AmountQuery | null = amount ? null : parseAmountQuery(tok);
    if (a) {
      amount = a;
      continue;
    }
    text.push(tok);
  }
  return { text: text.join(' '), amount, ids };
}

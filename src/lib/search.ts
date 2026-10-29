/**
 * Global search — fuzzy scorer + `searchAll` over invoices, clients, catalogue
 * items and static commands/pages. The scorer is pure (no browser APIs); only
 * `searchAll`'s default data source and the recents helpers touch storage, and
 * both tolerate its absence.
 */

import type { Client, InvoiceItem, InvoiceRecord, Payment } from '../types/invoice';
import { effectiveStatus } from './invoice-status';
import { DB_PREFIX, KEYS, peekTable, rawStamp, readRaw, writeRaw } from './storage';
import { amountMatches, parseQuery, typoScore, type ParsedQuery } from './smart-find';
import { isVoidStatus, readPurchase } from './purchase-normalize';

export type Range = [start: number, end: number];

/** 8.103 SmartFind adds bills, suppliers, payments (incl. advances), vouchers, cheques and other companies. */
export type SearchGroup = 'invoices' | 'clients' | 'items' | 'pages' | 'actions' | 'bills' | 'vendors' | 'payments' | 'vouchers' | 'cheques' | 'companies';

export const GROUP_LABELS: Record<SearchGroup, string> = {
  invoices: 'Invoices',
  clients: 'Clients',
  items: 'Catalogue items',
  pages: 'Pages',
  actions: 'Quick actions',
  bills: 'Purchase bills',
  vendors: 'Suppliers',
  payments: 'Payments & advances',
  vouchers: 'Vouchers',
  cheques: 'Cheques',
  companies: 'Other companies (read-only)',
};

export const GROUP_ORDER: SearchGroup[] = ['actions', 'pages', 'invoices', 'clients', 'items', 'bills', 'vendors', 'payments', 'vouchers', 'cheques', 'companies'];

/** Loosely typed rows of tables whose readers normalise them (purchases, vouchers, cheques …). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRow = Record<string, any>;

export interface SearchResult {
  id: string;
  group: SearchGroup;
  title: string;
  subtitle?: string;
  /** Key the UI maps to a lucide icon: `invoice`, `client`, `item`, `page`, `action`. */
  icon: string;
  href?: string;
  /** For actions: the id of the PaletteAction to run. */
  actionId?: string;
  score: number;
  /** Half-open [start, end) character ranges of `title` to highlight. */
  ranges: Range[];
  /** All-companies mode: the company the hit belongs to (read-only, nothing opens). */
  company?: string;
}

export interface StaticEntry {
  id: string;
  title: string;
  subtitle?: string;
  icon: string;
  href?: string;
  actionId?: string;
  keywords?: string[];
}

/** Rows are only read (the index copies strings out), so peeked, shared tables can be passed in. */
export interface SearchData {
  invoices: readonly InvoiceRecord[];
  clients: readonly Client[];
  items: readonly Partial<InvoiceItem>[];
  pages: StaticEntry[];
  actions: StaticEntry[];
  vendors?: readonly AnyRow[];
  bills?: readonly AnyRow[];
  payments?: readonly Payment[];
  vouchers?: readonly AnyRow[];
  cheques?: readonly AnyRow[];
  advances?: readonly AnyRow[];
  einvoice?: readonly AnyRow[];
}

/* ── Normalisation ──────────────────────────────────────────── */

/** Plain ASCII folds to its lower case; only other text needs the per-character pass. */
function isAscii(text: string): boolean {
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 127) return false;
  return true;
}

/** Lower-cases and strips accents per character so indices map 1:1 to the original. */
export function fold(text: string): string {
  // PERF-2: identical result for ASCII (NFD is a no-op, no marks, one char each) without the per-char regex.
  if (isAscii(text)) return text.toLowerCase();
  let out = '';
  for (const ch of text) {
    const f = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    out += f.length ? f[0] : ch;
  }
  return out;
}

const ALNUM = /[\p{L}\p{N}]/u;
/** `isAlnum(t[j])` with an ASCII fast path. */
function alnumAt(t: string, j: number): boolean {
  const c = t.charCodeAt(j);
  if (c < 128) return (c >= 48 && c <= 57) || (c >= 97 && c <= 122) || (c >= 65 && c <= 90);
  return ALNUM.test(t[j]);
}

/* ── Fuzzy scorer ───────────────────────────────────────────── */

export interface FuzzyMatch {
  score: number;
  ranges: Range[];
}

function toRanges(indices: number[]): Range[] {
  const ranges: Range[] = [];
  for (const i of indices) {
    const last = ranges[ranges.length - 1];
    if (last && last[1] === i) last[1] = i + 1;
    else ranges.push([i, i + 1]);
  }
  return ranges;
}

/**
 * Scores one query token against `text`. Subsequence match with bonuses for
 * word starts and consecutive runs; an exact substring always beats a scattered
 * subsequence. Returns null when the token is not a subsequence of the text.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  return fuzzyFolded(fold(query).replace(/\s+/g, ''), fold(text));
}

/* DP scratch buffers, grown on demand and reused (PERF-2: no m×n arrays allocated per call). */
let dpBuf = new Float64Array(256);
let fromBuf = new Int32Array(256);

/** `fuzzyMatch` on already-folded text (`q` folded with whitespace removed). Same scores and ranges. */
export function fuzzyFolded(q: string, t: string, memo?: Map<string, FuzzyMatch | null>): FuzzyMatch | null {
  if (!q) return { score: 0, ranges: [] };
  const n = t.length;
  const m = q.length;
  if (m > n) return null;

  const boundary = (j: number) => j === 0 || !alnumAt(t, j - 1);

  // Exact substring: prefer one that starts a word, then the earliest.
  let best: FuzzyMatch | null = null;
  for (let at = t.indexOf(q); at !== -1; at = t.indexOf(q, at + 1)) {
    let score = 100 + m * 10;
    if (at === 0) score += 60;
    else if (boundary(at)) score += 40;
    if (m === n) score += 80;
    score -= Math.min(at, 20);
    if (!best || score > best.score) best = { score, ranges: [[at, at + m]] };
  }
  if (best) return best;

  // Cheap reject (PERF-2): the DP below finds a match iff `q` is a subsequence of `t`.
  for (let i = 0, from = 0; i < m; i++) {
    const at = t.indexOf(q[i], from);
    if (at === -1) return null;
    from = at + 1;
  }
  if (!memo) return subsequenceDp(q, t);
  let hit = memo.get(t);
  if (hit === undefined) {
    hit = subsequenceDp(q, t);
    memo.set(t, hit);
  }
  return hit;
}

function subsequenceDp(q: string, t: string): FuzzyMatch | null {
  const n = t.length;
  const m = q.length;
  const boundary = (j: number) => j === 0 || !alnumAt(t, j - 1);
  // Subsequence DP: dp[i][j] = best score matching q[0..i] with q[i] at t[j] (flat, row-major).
  const NEG = -Infinity;
  const size = m * n;
  if (dpBuf.length < size) {
    dpBuf = new Float64Array(size);
    fromBuf = new Int32Array(size);
  }
  const dp = dpBuf;
  const from = fromBuf;
  dp.fill(NEG, 0, size);
  from.fill(-1, 0, size);
  for (let i = 0; i < m; i++) {
    const qi = q.charCodeAt(i);
    const row = i * n;
    const prevRow = row - n;
    for (let j = i; j < n; j++) {
      if (t.charCodeAt(j) !== qi) continue;
      const base = 1 + (boundary(j) ? 12 : 0) + (j === 0 ? 6 : 0);
      if (i === 0) {
        dp[row + j] = base - Math.min(j, 10) * 0.3;
        continue;
      }
      for (let k = i - 1; k < j; k++) {
        const prev = dp[prevRow + k];
        if (prev === NEG) continue;
        const gap = j - k - 1;
        const sc = prev + base + (gap === 0 ? 8 : -Math.min(gap, 6));
        if (sc > dp[row + j]) {
          dp[row + j] = sc;
          from[row + j] = k;
        }
      }
    }
  }
  let bj = -1;
  let bs = NEG;
  const last = (m - 1) * n;
  for (let j = 0; j < n; j++) {
    if (dp[last + j] > bs) {
      bs = dp[last + j];
      bj = j;
    }
  }
  if (bj < 0) return null;
  const idx: number[] = [];
  for (let i = m - 1, j = bj; i >= 0; i--) {
    idx.unshift(j);
    j = from[i * n + j];
  }
  // Subsequence matches are capped below any substring match.
  return { score: Math.min(95, Math.max(1, bs)), ranges: toRanges(idx) };
}

/* ── Invoice-number helpers ─────────────────────────────────── */

/** Trailing sequence of a document number: "INV/FY25-26/0007" → 7. */
export function numberSequence(invoiceNumber: string): number | null {
  const m = /(\d+)\s*$/.exec(invoiceNumber ?? '');
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Digits-only token vs a document number. "0007" and "7" both equal sequence 7
 * (exact); "00" / "000" match as a prefix of the zero-padded sequence.
 */
export function matchNumberToken(token: string, invoiceNumber: string): number {
  if (!/^\d+$/.test(token)) return 0;
  const seq = numberSequence(invoiceNumber);
  if (seq === null) return 0;
  if (parseInt(token, 10) === seq) return 1000;
  const tail = /(\d+)\s*$/.exec(invoiceNumber)![1];
  if (token.length >= 2 && tail.startsWith(token)) return 300;
  return 0;
}

/* ── Field scoring ──────────────────────────────────────────── */

export interface Field {
  text: string;
  weight: number;
  /** Highlight ranges are only reported for the title field. */
  isTitle?: boolean;
  isNumber?: boolean;
  /** `fold(text)`, filled on first use and kept with the cached index (PERF-2: never re-folded per key). */
  folded?: string;
  /** Which of a–z / 0–9 occur in `folded` (`charMask`), filled with it. */
  maskLo?: number;
  maskHi?: number;
}

export interface Scored {
  score: number;
  ranges: Range[];
}

/** One query token, folded once per search, with per-search memos of the costly passes (PERF-2). */
export interface QueryToken {
  raw: string;
  /** Folded, whitespace removed (what `fuzzyMatch` compares). */
  q: string;
  /** Folded as typed (what `typoScore` compares). */
  folded: string;
  /** Subsequence-DP results by folded field text (the same name / status repeats across thousands of rows). */
  dp: Map<string, FuzzyMatch | null>;
  /** Typo scores by folded field text. */
  typo: Map<string, number>;
  /** Typo scores by single word (ASCII fast path of `typoScore`). */
  words: Map<string, number>;
  /** Digits only: the token can match a document number's sequence (`matchNumberToken`). */
  digits: boolean;
  /** `charMask` of `q`. */
  maskLo: number;
  maskHi: number;
}

/*
 * Character masks (PERF-2 cheap reject): bit per a–z and 0–9 present in folded text. A token char with no
 * bit (anything else) is never counted as missing, so the reject stays exact:
 *  - fuzzy needs every token char in the field (subsequence), so any missing char rules it out;
 *  - a typo match within `allowed` edits leaves at most `allowed` distinct token chars absent from the word.
 */
function bitOf(c: number): number {
  if (c >= 97 && c <= 122) return c - 97;
  if (c >= 48 && c <= 57) return c - 22; // 26..35
  return -1;
}

function charMask(text: string, from = 0, to = text.length): [lo: number, hi: number] {
  let lo = 0;
  let hi = 0;
  for (let i = from; i < to; i++) {
    const b = bitOf(text.charCodeAt(i));
    if (b < 0) continue;
    if (b < 32) lo |= 1 << b;
    else hi |= 1 << (b - 32);
  }
  return [lo, hi];
}

function popcount(x: number): number {
  x -= (x >>> 1) & 0x55555555;
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

/** Distinct token chars (with a bit) absent from a text with masks lo/hi. */
const missingChars = (tok: QueryToken, lo: number, hi: number) => popcount(tok.maskLo & ~lo) + popcount(tok.maskHi & ~hi);

/** Split a query into prepared tokens (whitespace-separated, AND-ed by `scoreTokens`). */
export function prepareTokens(query: string): QueryToken[] {
  return query.trim().split(/\s+/).filter(Boolean).map((raw) => {
    const folded = fold(raw);
    const q = folded.replace(/\s+/g, '');
    const [maskLo, maskHi] = charMask(q);
    return { raw, q, folded, digits: /^\d+$/.test(raw), dp: new Map(), typo: new Map(), words: new Map(), maskLo, maskHi };
  });
}

function foldedOf(f: Field): string {
  let v = f.folded;
  if (v === undefined) {
    v = fold(f.text);
    f.folded = v;
    [f.maskLo, f.maskHi] = charMask(v);
  }
  return v;
}

const isWordCode = (c: number) => (c >= 48 && c <= 57) || (c >= 97 && c <= 122) || (c >= 65 && c <= 90);

/**
 * `typoScore(tok.folded, text)` with the same result: for ASCII text it walks the words in place, skips the
 * ones whose length can never come within the allowed edits, and scores each distinct word once per search.
 */
function typoFast(tok: QueryToken, text: string): number {
  const token = tok.folded;
  if (!isAscii(text) || !isAscii(token)) return typoScore(token, text);
  const allowed = token.length <= 6 ? 1 : 2;
  // A word shorter than this is compared whole and differs in length by more than `allowed`.
  const minLen = Math.max(3, token.length - allowed);
  let best = 0;
  const n = text.length;
  for (let i = 0; i < n; ) {
    while (i < n && !isWordCode(text.charCodeAt(i))) i++;
    const start = i;
    while (i < n && isWordCode(text.charCodeAt(i))) i++;
    if (i - start < minLen) continue;
    // The compared candidate is the word or its first `token.length` chars: too many absent token chars → no match.
    const candEnd = i - start > token.length + allowed ? start + token.length : i;
    const [lo, hi] = charMask(text, start, candEnd);
    if (missingChars(tok, lo, hi) > allowed) continue;
    const word = text.slice(start, i);
    let sc = tok.words.get(word);
    if (sc === undefined) {
      sc = typoScore(token, word);
      tok.words.set(word, sc);
    }
    if (sc > best) best = sc;
  }
  return best;
}

/** Every whitespace-separated token must match some field (AND). */
export function scoreFields(query: string, fields: Field[]): Scored | null {
  return scoreTokens(prepareTokens(query), fields);
}

/** `scoreFields` over prepared tokens: same scores and ranges, folding and DP work shared across entries. */
export function scoreTokens(tokens: readonly QueryToken[], fields: readonly Field[]): Scored | null {
  if (!tokens.length) return { score: 0, ranges: [] };
  let total = 0;
  const ranges: Range[] = [];
  for (const tok of tokens) {
    const token = tok.raw;
    let bestScore = 0;
    let bestRanges: Range[] = [];
    for (const f of fields) {
      if (!f.text) continue;
      let s = 0;
      let r: Range[] = [];
      if (f.isNumber && tok.digits) {
        const ns = matchNumberToken(token, f.text);
        if (ns) {
          s = ns * f.weight;
          const tail = /(\d+)\s*$/.exec(f.text);
          if (tail && f.isTitle) r = [[tail.index, tail.index + tail[1].length]];
        }
      }
      const ft = s ? '' : foldedOf(f);
      const missing = s ? 0 : missingChars(tok, f.maskLo!, f.maskHi!);
      if (!s && missing === 0) {
        const fm = fuzzyFolded(tok.q, ft, tok.dp);
        if (fm) {
          s = fm.score * f.weight;
          if (f.isTitle) r = fm.ranges;
        }
      }
      // 8.103: spelling slips ("sharmaa", "kumr") still find the word, ranked below real matches.
      if (!s && tok.folded.length >= 4 && missing <= (tok.folded.length <= 6 ? 1 : 2)) {
        let ts = tok.typo.get(ft);
        if (ts === undefined) {
          ts = typoFast(tok, ft);
          tok.typo.set(ft, ts);
        }
        s = ts * f.weight;
      }
      if (s > bestScore) {
        bestScore = s;
        bestRanges = r;
      }
    }
    if (!bestScore) return null;
    total += bestScore;
    ranges.push(...bestRanges);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: Range[] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  return { score: total / tokens.length, ranges: merged };
}

/* ── Static commands ────────────────────────────────────────── */

export const DEFAULT_PAGES: StaticEntry[] = [
  { id: 'page:dashboard', title: 'Dashboard', subtitle: 'Overview', icon: 'page', href: '/', keywords: ['home', 'overview'] },
  { id: 'page:invoice', title: 'New invoice', subtitle: 'Create a document', icon: 'page', href: '/invoice', keywords: ['create', 'bill'] },
  { id: 'page:transactions', title: 'Transactions', subtitle: 'Invoices and payments ledger', icon: 'page', href: '/transactions', keywords: ['ledger', 'payments', 'invoices'] },
  { id: 'page:clients', title: 'Clients', subtitle: 'Customers and parties', icon: 'page', href: '/clients', keywords: ['customers', 'parties'] },
  { id: 'page:settings', title: 'Settings', subtitle: 'Business profile, backup', icon: 'page', href: '/settings', keywords: ['profile', 'preferences', 'backup'] },
];

function staticFields(e: StaticEntry): Field[] {
  return [
    { text: e.title, weight: 1.2, isTitle: true },
    { text: e.subtitle ?? '', weight: 0.5 },
    ...(e.keywords ?? []).map((k) => ({ text: k, weight: 0.7 })),
  ];
}

/* ── searchAll ──────────────────────────────────────────────── */

export interface SearchOptions {
  /** Max results per group (default 6). */
  perGroup?: number;
  /** Inject data (tests / callers that already hold it). Missing keys load from storage. */
  data?: Partial<SearchData>;
  now?: Date;
}

function rawAmount(n: number | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? String(n) : '';
}

const rupees = (n: number | undefined) => (typeof n === 'number' && Number.isFinite(n) ? `₹${n.toLocaleString('en-IN')}` : '');
const s = (v: unknown) => (typeof v === 'string' ? v : v === undefined || v === null ? '' : String(v));

/** One searchable record: prebuilt fields + its amounts and identifiers (8.103). */
export interface IndexEntry {
  id: string;
  group: SearchGroup;
  title: string;
  subtitle: string;
  icon: string;
  href: string;
  fields: Field[];
  amounts: number[];
  /** Upper-cased GSTIN / PAN / IRN / UTR / reference values. */
  ids: string[];
  /** Union of the fields' char masks (PERF-2), filled on first search. */
  maskLo?: number;
  maskHi?: number;
}

/** Build the index over every searchable table (pure; cached per storage version by `searchIndex`). */
export function buildIndex(d: Omit<SearchData, 'pages' | 'actions'>, now: Date = new Date()): IndexEntry[] {
  const out: IndexEntry[] = [];
  const irnBy = new Map((d.einvoice ?? []).map((m) => [s(m.invoice_id), s(m.irn).toUpperCase()]));
  const invById = new Map(d.invoices.map((i) => [i?.id, i]));
  for (const inv of d.invoices) {
    if (!inv) continue;
    const status = effectiveStatus(inv, now);
    const number = inv.invoice_number ?? '';
    const irn = irnBy.get(inv.id) ?? '';
    out.push({
      id: `inv:${inv.id}`, group: 'invoices', title: number || 'Untitled document', icon: 'invoice', href: `/invoice/${inv.id}`,
      subtitle: [inv.client?.name, status, rawAmount(inv.total) && `₹${inv.total}`].filter(Boolean).join(' · '),
      fields: [
        { text: number, weight: 1.5, isTitle: true, isNumber: true },
        { text: inv.client?.name ?? '', weight: 1 },
        { text: inv.client?.company ?? '', weight: 0.8 },
        { text: status, weight: 0.6 },
        { text: rawAmount(inv.total), weight: 0.6 },
        { text: rawAmount(inv.balance_due), weight: 0.3 },
        { text: inv.po_number ?? '', weight: 0.5 },
      ],
      amounts: [Number(inv.total), Number(inv.balance_due)],
      ids: [s(inv.client?.gstin).toUpperCase(), s(inv.client?.pan).toUpperCase(), irn].filter(Boolean),
    });
  }
  d.clients.forEach((c, i) => {
    out.push({
      id: `client:${c.id ?? i}`, group: 'clients', title: c.name || c.company || 'Unnamed client', icon: 'client', href: '/clients',
      subtitle: [c.company, c.city, c.gstin].filter(Boolean).join(' · '),
      fields: [
        { text: c.name ?? '', weight: 1.4, isTitle: true },
        { text: c.company ?? '', weight: 1 },
        { text: c.gstin ?? '', weight: 0.9 },
        { text: c.city ?? '', weight: 0.6 },
        { text: c.phone ?? '', weight: 0.6 },
      ],
      amounts: [],
      ids: [s(c.gstin).toUpperCase(), s(c.pan).toUpperCase()].filter(Boolean),
    });
  });
  d.items.forEach((it, i) => {
    out.push({
      id: `item:${it.id ?? i}`, group: 'items', title: it.name || 'Unnamed item', icon: 'item', href: '/invoice',
      subtitle: [it.hsn && `HSN/SAC ${it.hsn}`, typeof it.rate === 'number' && `₹${it.rate}`].filter(Boolean).join(' · '),
      fields: [
        { text: it.name ?? '', weight: 1.4, isTitle: true },
        { text: it.hsn ?? '', weight: 1 },
        { text: it.description ?? '', weight: 0.4 },
      ],
      amounts: typeof it.rate === 'number' ? [it.rate] : [],
      ids: [],
    });
  });
  for (const v of d.vendors ?? []) {
    out.push({
      id: `vendor:${s(v.id)}`, group: 'vendors', title: s(v.name) || 'Unnamed supplier', icon: 'vendor', href: '/expenses?tab=vendors',
      subtitle: [s(v.gstin), s(v.phone)].filter(Boolean).join(' · '),
      fields: [{ text: s(v.name), weight: 1.4, isTitle: true }, { text: s(v.gstin), weight: 0.9 }, { text: s(v.phone), weight: 0.6 }],
      amounts: [],
      ids: [s(v.gstin).toUpperCase(), s(v.pan).toUpperCase()].filter(Boolean),
    });
  }
  // Purchases contract (Rule 9): bills are read through the shared `readPurchase`.
  for (const raw of d.bills ?? []) {
    const b = readPurchase(raw, d.vendors ?? []);
    if (!b) continue;
    const number = b.number;
    const total = b.total;
    out.push({
      id: `bill:${b.id}`, group: 'bills', title: number || 'Bill', icon: 'bill', href: `/expenses?bill=${encodeURIComponent(b.id)}`,
      subtitle: [b.partyName, b.date, rupees(total), isVoidStatus(b.status) ? 'cancelled' : ''].filter(Boolean).join(' · '),
      fields: [
        { text: number, weight: 1.4, isTitle: true, isNumber: true },
        { text: b.partyName, weight: 1 },
        { text: b.category, weight: 0.5 },
        { text: rawAmount(total), weight: 0.6 },
      ],
      amounts: [total],
      ids: [b.partyGstin].filter(Boolean),
    });
  }
  for (const p of d.payments ?? []) {
    const inv = invById.get(p.invoice_id);
    const party = inv?.client?.name ?? s((p as { client_name?: unknown }).client_name);
    const title = p.receipt_number || p.reference || `${p.method} ${rupees(p.amount)}`;
    out.push({
      id: `pay:${p.id}`, group: 'payments', title, icon: 'payment', href: inv ? `/invoice/${inv.id}` : '/receivables',
      subtitle: [party, p.method, s(p.date).slice(0, 10), rupees(p.amount), inv?.invoice_number].filter(Boolean).join(' · '),
      fields: [
        { text: title, weight: 1.3, isTitle: true },
        { text: p.reference ?? '', weight: 1.1 },
        { text: party, weight: 0.9 },
        { text: p.method ?? '', weight: 0.5 },
        { text: rawAmount(p.amount), weight: 0.7 },
      ],
      amounts: [Number(p.amount)],
      ids: [s(p.reference).toUpperCase().replace(/\s+/g, '')].filter(Boolean),
    });
  }
  for (const v of d.vouchers ?? []) {
    const lines = Array.isArray(v.lines) ? v.lines : [];
    const total = lines.reduce((t, l) => t + (Number(l?.dr) || 0), 0) / 100;
    const parties = [...new Set(lines.map((l) => s(l?.party)).filter(Boolean))].join(', ');
    out.push({
      id: `vch:${s(v.id)}`, group: 'vouchers', title: s(v.number) || 'Voucher', icon: 'voucher', href: '/books?tab=vouchers',
      subtitle: [s(v.type), s(v.date), rupees(total), parties].filter(Boolean).join(' · '),
      fields: [
        { text: s(v.number), weight: 1.4, isTitle: true, isNumber: true },
        { text: s(v.narration), weight: 0.8 },
        { text: parties, weight: 0.9 },
        { text: rawAmount(total), weight: 0.6 },
      ],
      amounts: [total],
      ids: [],
    });
  }
  for (const c of d.cheques ?? []) {
    out.push({
      id: `chq:${s(c.id)}`, group: 'cheques', title: `Cheque ${s(c.number)}`, icon: 'cheque', href: '/cheques',
      subtitle: [s(c.party_name), s(c.bank), s(c.cheque_date), rupees(Number(c.amount)), s(c.status)].filter(Boolean).join(' · '),
      fields: [
        { text: `Cheque ${s(c.number)}`, weight: 1.3, isTitle: true },
        { text: s(c.number), weight: 1.2 },
        { text: s(c.party_name), weight: 1 },
        { text: s(c.bank), weight: 0.6 },
        { text: rawAmount(Number(c.amount)), weight: 0.6 },
      ],
      amounts: [Number(c.amount)],
      ids: [s(c.number).toUpperCase()].filter(Boolean),
    });
  }
  for (const a of d.advances ?? []) {
    const client = (a.client ?? {}) as { name?: string; gstin?: string };
    out.push({
      id: `adv:${s(a.id)}`, group: 'payments', title: s(a.number) || 'Advance', icon: 'payment', href: '/receivables?tab=advances',
      subtitle: [client.name, 'Advance', s(a.date), rupees(Number(a.amount))].filter(Boolean).join(' · '),
      fields: [
        { text: s(a.number), weight: 1.4, isTitle: true, isNumber: true },
        { text: s(client.name), weight: 1 },
        { text: s(a.reference), weight: 1 },
        { text: rawAmount(Number(a.amount)), weight: 0.6 },
      ],
      amounts: [Number(a.amount)],
      ids: [s(client.gstin).toUpperCase(), s(a.reference).toUpperCase()].filter(Boolean),
    });
  }
  return out;
}

/* Index cache: rebuilt only when one of the tables' stored text changes (cheap string identity checks). */
const INDEX_TABLES = ['invoices', 'clients', 'items_catalog', 'vendors', 'purchases', 'transactions', 'vouchers', 'cheques', 'advances', 'einvoice_meta'] as const;
let indexCache: { raws: unknown[]; day: string; index: IndexEntry[] } | null = null;

/** Rows of every searchable table, read once per storage version (shared peeked rows: read-only). */
export function loadSearchData(): Omit<SearchData, 'pages' | 'actions'> {
  return {
    invoices: peekTable<InvoiceRecord>(KEYS.invoices),
    clients: peekTable<Client>(KEYS.clients),
    items: peekTable<Partial<InvoiceItem>>(KEYS.items),
    vendors: peekTable<AnyRow>('vendors'),
    bills: peekTable<AnyRow>('purchases'),
    payments: peekTable<Payment>(KEYS.transactions),
    vouchers: peekTable<AnyRow>('vouchers'),
    cheques: peekTable<AnyRow>('cheques'),
    advances: peekTable<AnyRow>('advances'),
    einvoice: peekTable<AnyRow>('einvoice_meta'),
  };
}

/** The cached index of the open company (8.103: built once per storage version and day). */
export function searchIndex(now: Date = new Date()): IndexEntry[] {
  const raws = INDEX_TABLES.map((t) => rawStamp(DB_PREFIX + t)); // PERF-3: tokens, never a chunked table's text
  const day = now.toDateString();
  if (indexCache && indexCache.day === day && indexCache.raws.every((r, i) => r === raws[i])) return indexCache.index;
  const index = buildIndex(loadSearchData(), now);
  // Fold every field and fill the char masks now (palette open), so the first keystroke does not pay for it.
  for (const e of index) entryCannotMatch(e, []);
  indexCache = { raws, day, index };
  return index;
}

/** Score one entry against a parsed query (null = no match). */
/**
 * Cheap whole-entry reject: a text token with more distinct chars absent from EVERY field than a typo could
 * forgive cannot match any field. Digit tokens are skipped ("0007" equals sequence 7 without a 0 in the text).
 */
function entryCannotMatch(e: Pick<IndexEntry, 'fields' | 'maskLo' | 'maskHi'>, tokens: readonly QueryToken[]): boolean {
  if (e.maskLo === undefined) {
    let lo = 0;
    let hi = 0;
    for (const f of e.fields) {
      if (!f.text) continue;
      foldedOf(f);
      lo |= f.maskLo!;
      hi |= f.maskHi!;
    }
    e.maskLo = lo;
    e.maskHi = hi;
  }
  for (const tok of tokens) {
    if (tok.digits) continue;
    const len = tok.folded.length;
    const forgiven = len < 4 ? 0 : len <= 6 ? 1 : 2;
    if (missingChars(tok, e.maskLo, e.maskHi!) > forgiven) return true;
  }
  return false;
}

function scoreEntry(e: Pick<IndexEntry, 'fields' | 'amounts' | 'ids' | 'maskLo' | 'maskHi'>, pq: ParsedQuery, tokens: readonly QueryToken[]): Scored | null {
  if (pq.amount && !amountMatches(pq.amount, e.amounts)) return null;
  let bonus = 0;
  for (const id of pq.ids) {
    if (!e.ids.some((x) => x === id.value || (id.value.length >= 6 && x.startsWith(id.value)))) return null;
    bonus += 400;
  }
  if (!pq.text) return pq.amount || pq.ids.length ? { score: 120 + bonus, ranges: [] } : null;
  if (entryCannotMatch(e, tokens)) return null;
  const sc = scoreTokens(tokens, e.fields);
  return sc ? { score: sc.score + bonus, ranges: sc.ranges } : null;
}

/** Same order as `String#localeCompare` with no arguments (both use the default locale's collator), built once. */
let titleCollator: Intl.Collator | null = null;
const byRank = (a: SearchResult, b: SearchResult) => b.score - a.score || (titleCollator ??= new Intl.Collator()).compare(a.title, b.title);

/**
 * The first `k` of `list` sorted by `byRank`, without sorting thousands of weak hits (PERF-2): only rows
 * scoring at least the k-th best score can make the cut, and the stable sort keeps their order.
 */
export function topRanked(list: SearchResult[], k: number): SearchResult[] {
  if (list.length > k * 4 && k > 0) {
    const scores = Float64Array.from(list, (r) => r.score).sort();
    const floor = scores[scores.length - k];
    list = list.filter((r) => r.score >= floor);
  }
  return list.sort(byRank).slice(0, k);
}

export function searchAll(query: string, opts: SearchOptions = {}): SearchResult[] {
  const q = query.trim();
  if (!q) return [];
  const perGroup = opts.perGroup ?? 6;
  const now = opts.now ?? new Date();
  const d = opts.data ?? {};
  const injected = opts.data && Object.keys(opts.data).some((k) => k !== 'pages' && k !== 'actions');
  let index: IndexEntry[];
  if (injected) {
    const base = loadSearchDataFallback(d);
    index = buildIndex(base, now);
  } else {
    index = searchIndex(now);
  }
  const pages = d.pages ?? DEFAULT_PAGES;
  const actions = d.actions ?? [];
  const pq = parseQuery(q);
  const tokens = prepareTokens(pq.text);

  const groups = Object.fromEntries(GROUP_ORDER.map((g) => [g, [] as SearchResult[]])) as Record<SearchGroup, SearchResult[]>;
  for (const e of index) {
    const sc = scoreEntry(e, pq, tokens);
    if (!sc) continue;
    groups[e.group].push({ id: e.id, group: e.group, title: e.title, subtitle: e.subtitle, icon: e.icon, href: e.href, score: sc.score, ranges: sc.ranges });
  }

  // Pages / actions match on the whole query text (amount / id tokens never name a command).
  const whole = prepareTokens(q);
  for (const [group, list] of [['pages', pages], ['actions', actions]] as const) {
    for (const e of list) {
      const sc = scoreTokens(whole, staticFields(e));
      if (!sc) continue;
      groups[group].push({ id: e.id, group, title: e.title, subtitle: e.subtitle, icon: e.icon, href: e.href, actionId: e.actionId, score: sc.score, ranges: sc.ranges });
    }
  }

  const result: SearchResult[] = [];
  for (const g of GROUP_ORDER) result.push(...topRanked(groups[g], perGroup));
  return result;
}

/** Injected data (tests / callers): missing tables are simply empty, never read from storage mid-test. */
function loadSearchDataFallback(d: Partial<SearchData>): Omit<SearchData, 'pages' | 'actions'> {
  return {
    invoices: d.invoices ?? peekTable<InvoiceRecord>(KEYS.invoices),
    clients: d.clients ?? peekTable<Client>(KEYS.clients),
    items: d.items ?? peekTable<Partial<InvoiceItem>>(KEYS.items),
    vendors: d.vendors ?? [],
    bills: d.bills ?? [],
    payments: d.payments ?? [],
    vouchers: d.vouchers ?? [],
    cheques: d.cheques ?? [],
    advances: d.advances ?? [],
    einvoice: d.einvoice ?? [],
  };
}

/* ── All companies (8.103, read-only peek) ──────────────────── */

/** Search another company's peeked tables; results are tagged with the company and open nothing. */
export function searchPeek(query: string, company: { id: string; name: string }, data: Omit<SearchData, 'pages' | 'actions'>, now: Date = new Date(), perCompany = 5): SearchResult[] {
  const pq = parseQuery(query.trim());
  if (!query.trim()) return [];
  const tokens = prepareTokens(pq.text);
  const out: SearchResult[] = [];
  for (const e of buildIndex(data, now)) {
    const sc = scoreEntry(e, pq, tokens);
    if (!sc) continue;
    out.push({ id: `co:${company.id}:${e.id}`, group: 'companies', title: e.title, subtitle: `${company.name} · ${e.subtitle}`, icon: e.icon, score: sc.score, ranges: sc.ranges, company: company.id });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, perCompany);
}

/** Groups results, ordering groups by their best hit so the most relevant leads. */
export function groupResults(
  results: SearchResult[],
): { group: SearchGroup; label: string; items: SearchResult[] }[] {
  const map = new Map<SearchGroup, SearchResult[]>();
  for (const r of results) {
    const arr = map.get(r.group) ?? [];
    arr.push(r);
    map.set(r.group, arr);
  }
  return [...map.entries()]
    .sort((a, b) => Math.max(...b[1].map((x) => x.score)) - Math.max(...a[1].map((x) => x.score)))
    .map(([group, items]) => ({ group, label: GROUP_LABELS[group], items }));
}

/* ── Recents ────────────────────────────────────────────────── */

export const RECENT_SEARCHES_KEY = 'mrchartist_inv_recent_searches';
export const MAX_RECENTS = 8;

/** Pure: puts `query` first, de-duplicating case-insensitively, capped at MAX_RECENTS. */
export function addRecent(list: string[], query: string): string[] {
  const q = query.trim();
  if (!q) return list;
  const rest = list.filter((x) => x.toLowerCase() !== q.toLowerCase());
  return [q, ...rest].slice(0, MAX_RECENTS);
}

export function getRecentSearches(): string[] {
  const raw = readRaw(RECENT_SEARCHES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string').slice(0, MAX_RECENTS)
      : [];
  } catch {
    return [];
  }
}

export function pushRecentSearch(query: string): string[] {
  const next = addRecent(getRecentSearches(), query);
  try {
    writeRaw(RECENT_SEARCHES_KEY, JSON.stringify(next));
  } catch {
    /* recents are a convenience — never fail the search over them */
  }
  return next;
}

export function clearRecentSearches(): void {
  try {
    writeRaw(RECENT_SEARCHES_KEY, '[]');
  } catch {
    /* ignore */
  }
}

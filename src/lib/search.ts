/**
 * Global search — fuzzy scorer + `searchAll` over invoices, clients, catalogue
 * items and static commands/pages. The scorer is pure (no browser APIs); only
 * `searchAll`'s default data source and the recents helpers touch storage, and
 * both tolerate its absence.
 */

import type { Client, InvoiceItem, InvoiceRecord } from '../types/invoice';
import { effectiveStatus } from './invoice-status';
import { KEYS, getTable, readRaw, writeRaw } from './storage';

export type Range = [start: number, end: number];

export type SearchGroup = 'invoices' | 'clients' | 'items' | 'pages' | 'actions';

export const GROUP_LABELS: Record<SearchGroup, string> = {
  invoices: 'Invoices',
  clients: 'Clients',
  items: 'Catalogue items',
  pages: 'Pages',
  actions: 'Quick actions',
};

export const GROUP_ORDER: SearchGroup[] = ['actions', 'pages', 'invoices', 'clients', 'items'];

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

export interface SearchData {
  invoices: InvoiceRecord[];
  clients: Client[];
  items: Partial<InvoiceItem>[];
  pages: StaticEntry[];
  actions: StaticEntry[];
}

/* ── Normalisation ──────────────────────────────────────────── */

/** Lower-cases and strips accents per character so indices map 1:1 to the original. */
export function fold(text: string): string {
  let out = '';
  for (const ch of text) {
    const f = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    out += f.length ? f[0] : ch;
  }
  return out;
}

const isAlnum = (c: string) => /[\p{L}\p{N}]/u.test(c);

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
  const q = fold(query).replace(/\s+/g, '');
  if (!q) return { score: 0, ranges: [] };
  const t = fold(text);
  const n = t.length;
  const m = q.length;
  if (m > n) return null;

  const boundary = (j: number) => j === 0 || !isAlnum(t[j - 1]);

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

  // Subsequence DP: dp[i][j] = best score matching q[0..i] with q[i] at t[j].
  const NEG = -Infinity;
  const dp: number[][] = Array.from({ length: m }, () => new Array<number>(n).fill(NEG));
  const from: number[][] = Array.from({ length: m }, () => new Array<number>(n).fill(-1));
  for (let i = 0; i < m; i++) {
    for (let j = i; j < n; j++) {
      if (t[j] !== q[i]) continue;
      const base = 1 + (boundary(j) ? 12 : 0) + (j === 0 ? 6 : 0);
      if (i === 0) {
        dp[i][j] = base - Math.min(j, 10) * 0.3;
        continue;
      }
      for (let k = i - 1; k < j; k++) {
        const prev = dp[i - 1][k];
        if (prev === NEG) continue;
        const gap = j - k - 1;
        const s = prev + base + (gap === 0 ? 8 : -Math.min(gap, 6));
        if (s > dp[i][j]) {
          dp[i][j] = s;
          from[i][j] = k;
        }
      }
    }
  }
  let bj = -1;
  let bs = NEG;
  for (let j = 0; j < n; j++) {
    if (dp[m - 1][j] > bs) {
      bs = dp[m - 1][j];
      bj = j;
    }
  }
  if (bj < 0) return null;
  const idx: number[] = [];
  for (let i = m - 1, j = bj; i >= 0; i--) {
    idx.unshift(j);
    j = from[i][j];
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

interface Field {
  text: string;
  weight: number;
  /** Highlight ranges are only reported for the title field. */
  isTitle?: boolean;
  isNumber?: boolean;
}

interface Scored {
  score: number;
  ranges: Range[];
}

/** Every whitespace-separated token must match some field (AND). */
export function scoreFields(query: string, fields: Field[]): Scored | null {
  const tokens = query.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { score: 0, ranges: [] };
  let total = 0;
  const ranges: Range[] = [];
  for (const token of tokens) {
    let bestScore = 0;
    let bestRanges: Range[] = [];
    for (const f of fields) {
      if (!f.text) continue;
      let s = 0;
      let r: Range[] = [];
      if (f.isNumber) {
        const ns = matchNumberToken(token, f.text);
        if (ns) {
          s = ns * f.weight;
          const tail = /(\d+)\s*$/.exec(f.text);
          if (tail && f.isTitle) r = [[tail.index, tail.index + tail[1].length]];
        }
      }
      if (!s) {
        const fm = fuzzyMatch(token, f.text);
        if (fm) {
          s = fm.score * f.weight;
          if (f.isTitle) r = fm.ranges;
        }
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
  /** Inject data (tests / callers that already hold it). Missing keys load from localStorage. */
  data?: Partial<SearchData>;
  now?: Date;
}

function rawAmount(n: number | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? String(n) : '';
}

export function searchAll(query: string, opts: SearchOptions = {}): SearchResult[] {
  const q = query.trim();
  if (!q) return [];
  const perGroup = opts.perGroup ?? 6;
  const now = opts.now ?? new Date();
  const d = opts.data ?? {};
  const invoices = d.invoices ?? getTable<InvoiceRecord>(KEYS.invoices);
  const clients = d.clients ?? getTable<Client>(KEYS.clients);
  const items = d.items ?? getTable<Partial<InvoiceItem>>(KEYS.items);
  const pages = d.pages ?? DEFAULT_PAGES;
  const actions = d.actions ?? [];

  const groups: Record<SearchGroup, SearchResult[]> = {
    invoices: [], clients: [], items: [], pages: [], actions: [],
  };
  const add = (group: SearchGroup, r: Omit<SearchResult, 'group'>) => {
    groups[group].push({ group, ...r });
  };

  for (const inv of invoices) {
    if (!inv) continue;
    const status = effectiveStatus(inv, now);
    const number = inv.invoice_number ?? '';
    const s = scoreFields(q, [
      { text: number, weight: 1.5, isTitle: true, isNumber: true },
      { text: inv.client?.name ?? '', weight: 1 },
      { text: inv.client?.company ?? '', weight: 0.8 },
      { text: status, weight: 0.6 },
      { text: rawAmount(inv.total), weight: 0.6 },
      { text: rawAmount(inv.balance_due), weight: 0.3 },
    ]);
    if (!s) continue;
    add('invoices', {
      id: `inv:${inv.id}`,
      title: number || 'Untitled document',
      subtitle: [inv.client?.name, status, rawAmount(inv.total) && `₹${inv.total}`].filter(Boolean).join(' · '),
      icon: 'invoice',
      href: `/invoice/${inv.id}`,
      score: s.score,
      ranges: s.ranges,
    });
  }

  clients.forEach((c, i) => {
    const s = scoreFields(q, [
      { text: c.name ?? '', weight: 1.4, isTitle: true },
      { text: c.company ?? '', weight: 1 },
      { text: c.gstin ?? '', weight: 0.9 },
      { text: c.city ?? '', weight: 0.6 },
    ]);
    if (!s) return;
    add('clients', {
      id: `client:${c.id ?? i}`,
      title: c.name || c.company || 'Unnamed client',
      subtitle: [c.company, c.city, c.gstin].filter(Boolean).join(' · '),
      icon: 'client',
      href: '/clients',
      score: s.score,
      ranges: s.ranges,
    });
  });

  items.forEach((it, i) => {
    const s = scoreFields(q, [
      { text: it.name ?? '', weight: 1.4, isTitle: true },
      { text: it.hsn ?? '', weight: 1 },
      { text: it.description ?? '', weight: 0.4 },
    ]);
    if (!s) return;
    add('items', {
      id: `item:${it.id ?? i}`,
      title: it.name || 'Unnamed item',
      subtitle: [it.hsn && `HSN/SAC ${it.hsn}`, typeof it.rate === 'number' && `₹${it.rate}`]
        .filter(Boolean)
        .join(' · '),
      icon: 'item',
      href: '/invoice',
      score: s.score,
      ranges: s.ranges,
    });
  });

  for (const [group, list] of [['pages', pages], ['actions', actions]] as const) {
    for (const e of list) {
      const s = scoreFields(q, staticFields(e));
      if (!s) continue;
      add(group, {
        id: e.id,
        title: e.title,
        subtitle: e.subtitle,
        icon: e.icon,
        href: e.href,
        actionId: e.actionId,
        score: s.score,
        ranges: s.ranges,
      });
    }
  }

  const result: SearchResult[] = [];
  for (const g of GROUP_ORDER) {
    groups[g].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
    result.push(...groups[g].slice(0, perGroup));
  }
  return result;
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

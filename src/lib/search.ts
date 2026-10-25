/**
 * Global search — fuzzy scorer + `searchAll` over invoices, clients, catalogue
 * items and static commands/pages. The scorer is pure (no browser APIs); only
 * `searchAll`'s default data source and the recents helpers touch storage, and
 * both tolerate its absence.
 */

import type { Client, InvoiceItem, InvoiceRecord, Payment } from '../types/invoice';
import { effectiveStatus } from './invoice-status';
import { DB_PREFIX, KEYS, getTable, readRaw, writeRaw } from './storage';
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

export interface SearchData {
  invoices: InvoiceRecord[];
  clients: Client[];
  items: Partial<InvoiceItem>[];
  pages: StaticEntry[];
  actions: StaticEntry[];
  vendors?: AnyRow[];
  bills?: AnyRow[];
  payments?: Payment[];
  vouchers?: AnyRow[];
  cheques?: AnyRow[];
  advances?: AnyRow[];
  einvoice?: AnyRow[];
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

export interface Field {
  text: string;
  weight: number;
  /** Highlight ranges are only reported for the title field. */
  isTitle?: boolean;
  isNumber?: boolean;
}

export interface Scored {
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
      // 8.103: spelling slips ("sharmaa", "kumr") still find the word, ranked below real matches.
      if (!s) s = typoScore(fold(token), fold(f.text)) * f.weight;
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
let indexCache: { raws: (string | null)[]; day: string; index: IndexEntry[] } | null = null;

/** Rows of every searchable table, read once per storage version. */
export function loadSearchData(): Omit<SearchData, 'pages' | 'actions'> {
  return {
    invoices: getTable<InvoiceRecord>(KEYS.invoices),
    clients: getTable<Client>(KEYS.clients),
    items: getTable<Partial<InvoiceItem>>(KEYS.items),
    vendors: getTable<AnyRow>('vendors'),
    bills: getTable<AnyRow>('purchases'),
    payments: getTable<Payment>(KEYS.transactions),
    vouchers: getTable<AnyRow>('vouchers'),
    cheques: getTable<AnyRow>('cheques'),
    advances: getTable<AnyRow>('advances'),
    einvoice: getTable<AnyRow>('einvoice_meta'),
  };
}

/** The cached index of the open company (8.103: built once per storage version and day). */
export function searchIndex(now: Date = new Date()): IndexEntry[] {
  const raws = INDEX_TABLES.map((t) => readRaw(DB_PREFIX + t));
  const day = now.toDateString();
  if (indexCache && indexCache.day === day && indexCache.raws.every((r, i) => r === raws[i])) return indexCache.index;
  const index = buildIndex(loadSearchData(), now);
  indexCache = { raws, day, index };
  return index;
}

/** Score one entry against a parsed query (null = no match). */
function scoreEntry(e: Pick<IndexEntry, 'fields' | 'amounts' | 'ids'>, pq: ParsedQuery): Scored | null {
  if (pq.amount && !amountMatches(pq.amount, e.amounts)) return null;
  let bonus = 0;
  for (const id of pq.ids) {
    if (!e.ids.some((x) => x === id.value || (id.value.length >= 6 && x.startsWith(id.value)))) return null;
    bonus += 400;
  }
  if (!pq.text) return pq.amount || pq.ids.length ? { score: 120 + bonus, ranges: [] } : null;
  const sc = scoreFields(pq.text, e.fields);
  return sc ? { score: sc.score + bonus, ranges: sc.ranges } : null;
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

  const groups = Object.fromEntries(GROUP_ORDER.map((g) => [g, [] as SearchResult[]])) as Record<SearchGroup, SearchResult[]>;
  for (const e of index) {
    const sc = scoreEntry(e, pq);
    if (!sc) continue;
    groups[e.group].push({ id: e.id, group: e.group, title: e.title, subtitle: e.subtitle, icon: e.icon, href: e.href, score: sc.score, ranges: sc.ranges });
  }

  // Pages / actions match on the whole query text (amount / id tokens never name a command).
  for (const [group, list] of [['pages', pages], ['actions', actions]] as const) {
    for (const e of list) {
      const sc = scoreFields(q, staticFields(e));
      if (!sc) continue;
      groups[group].push({ id: e.id, group, title: e.title, subtitle: e.subtitle, icon: e.icon, href: e.href, actionId: e.actionId, score: sc.score, ranges: sc.ranges });
    }
  }

  const result: SearchResult[] = [];
  for (const g of GROUP_ORDER) {
    groups[g].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
    result.push(...groups[g].slice(0, perGroup));
  }
  return result;
}

/** Injected data (tests / callers): missing tables are simply empty, never read from storage mid-test. */
function loadSearchDataFallback(d: Partial<SearchData>): Omit<SearchData, 'pages' | 'actions'> {
  return {
    invoices: d.invoices ?? getTable<InvoiceRecord>(KEYS.invoices),
    clients: d.clients ?? getTable<Client>(KEYS.clients),
    items: d.items ?? getTable<Partial<InvoiceItem>>(KEYS.items),
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
  const out: SearchResult[] = [];
  for (const e of buildIndex(data, now)) {
    const sc = scoreEntry(e, pq);
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

/**
 * PERF-2 guard rails (UI layer): the optimised SmartFind scorer, typeahead ranking, invoice-list sort, payment
 * scores and late-fee lookup return exactly what the straightforward algorithms they replaced return, and the
 * SmartFind keystroke stays within a time budget over a 15k-document company.
 *
 * The `ref*` functions below are the pre-PERF-2 implementations, kept verbatim as the oracle.
 */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage, rng } from './helpers/shim.ts';
import { KEYS, setTable } from '../src/lib/storage.ts';
import {
  DEFAULT_PAGES, GROUP_ORDER, buildIndex, fold, fuzzyMatch, matchNumberToken, scoreFields, searchAll, searchIndex, topRanked,
  type Field, type IndexEntry, type Range, type SearchData, type SearchGroup, type SearchResult,
} from '../src/lib/search.ts';
import { amountMatches, parseQuery, typoScore, type ParsedQuery } from '../src/lib/smart-find.ts';
import { makeSuggester, suggest } from '../src/lib/suggest.ts';
import { sortInvoices, type SortDir, type SortKey } from '../src/lib/invoice-list.ts';
import { paymentScores } from '../src/lib/payment-score.ts';
import { lateFeeRuleFor, sanitizeClientLateFee } from '../src/lib/late-fee.ts';
import { isRevenueDoc } from '../src/lib/stats.ts';
import { receivableBalance } from '../src/lib/rcm.ts';
import type { Client, InvoiceRecord, Payment } from '../src/types/invoice.ts';
import type { CollectionNote } from '../src/lib/collections.ts';

/* ── Reference (pre-PERF-2) SmartFind ───────────────────────── */

function refFold(text: string): string {
  let out = '';
  for (const ch of text) {
    const f = ch.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
    out += f.length ? f[0] : ch;
  }
  return out;
}
const refIsAlnum = (c: string) => /[\p{L}\p{N}]/u.test(c);
function refToRanges(indices: number[]): Range[] {
  const ranges: Range[] = [];
  for (const i of indices) {
    const last = ranges[ranges.length - 1];
    if (last && last[1] === i) last[1] = i + 1;
    else ranges.push([i, i + 1]);
  }
  return ranges;
}
function refFuzzy(query: string, text: string): { score: number; ranges: Range[] } | null {
  const q = refFold(query).replace(/\s+/g, '');
  if (!q) return { score: 0, ranges: [] };
  const t = refFold(text);
  const n = t.length;
  const m = q.length;
  if (m > n) return null;
  const boundary = (j: number) => j === 0 || !refIsAlnum(t[j - 1]);
  let best: { score: number; ranges: Range[] } | null = null;
  for (let at = t.indexOf(q); at !== -1; at = t.indexOf(q, at + 1)) {
    let score = 100 + m * 10;
    if (at === 0) score += 60;
    else if (boundary(at)) score += 40;
    if (m === n) score += 80;
    score -= Math.min(at, 20);
    if (!best || score > best.score) best = { score, ranges: [[at, at + m]] };
  }
  if (best) return best;
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
  for (let j = 0; j < n; j++) if (dp[m - 1][j] > bs) { bs = dp[m - 1][j]; bj = j; }
  if (bj < 0) return null;
  const idx: number[] = [];
  for (let i = m - 1, j = bj; i >= 0; i--) { idx.unshift(j); j = from[i][j]; }
  return { score: Math.min(95, Math.max(1, bs)), ranges: refToRanges(idx) };
}
function refScoreFields(query: string, fields: Field[]): { score: number; ranges: Range[] } | null {
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
        const fm = refFuzzy(token, f.text);
        if (fm) { s = fm.score * f.weight; if (f.isTitle) r = fm.ranges; }
      }
      if (!s) s = typoScore(refFold(token), refFold(f.text)) * f.weight;
      if (s > bestScore) { bestScore = s; bestRanges = r; }
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
function refScoreEntry(e: IndexEntry, pq: ParsedQuery) {
  if (pq.amount && !amountMatches(pq.amount, e.amounts)) return null;
  let bonus = 0;
  for (const id of pq.ids) {
    if (!e.ids.some((x) => x === id.value || (id.value.length >= 6 && x.startsWith(id.value)))) return null;
    bonus += 400;
  }
  if (!pq.text) return pq.amount || pq.ids.length ? { score: 120 + bonus, ranges: [] } : null;
  const sc = refScoreFields(pq.text, e.fields);
  return sc ? { score: sc.score + bonus, ranges: sc.ranges } : null;
}
function refSearch(query: string, index: IndexEntry[], perGroup = 6): SearchResult[] {
  const q = query.trim();
  if (!q) return [];
  const pq = parseQuery(q);
  const groups = Object.fromEntries(GROUP_ORDER.map((g) => [g, [] as SearchResult[]])) as Record<SearchGroup, SearchResult[]>;
  for (const e of index) {
    const sc = refScoreEntry(e, pq);
    if (!sc) continue;
    groups[e.group].push({ id: e.id, group: e.group, title: e.title, subtitle: e.subtitle, icon: e.icon, href: e.href, score: sc.score, ranges: sc.ranges });
  }
  for (const e of DEFAULT_PAGES) {
    const sc = refScoreFields(q, [{ text: e.title, weight: 1.2, isTitle: true }, { text: e.subtitle ?? '', weight: 0.5 }, ...(e.keywords ?? []).map((k) => ({ text: k, weight: 0.7 }))]);
    if (sc) groups.pages.push({ id: e.id, group: 'pages', title: e.title, subtitle: e.subtitle, icon: e.icon, href: e.href, actionId: e.actionId, score: sc.score, ranges: sc.ranges });
  }
  const out: SearchResult[] = [];
  for (const g of GROUP_ORDER) {
    groups[g].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
    out.push(...groups[g].slice(0, perGroup));
  }
  return out;
}

/* ── Fixture ────────────────────────────────────────────────── */

const FIRST = ['Ganesh', 'Sharma', 'Kumar', 'Iyer', 'Café', 'Zoë', 'Patel', 'Reddy', 'Mehta', 'Bose', 'Nair', 'Joshi', 'Ünal', 'Das', 'Rao'];
const LAST = ['Traders', 'Enterprises', 'Stores', 'Agencies', 'Distributors', 'Labs', 'Foods', 'Textiles', 'Steel', 'Pharma'];
const STATUSES = ['Paid', 'Sent', 'Overdue', 'Draft', 'Partially Paid', 'Cancelled'] as const;

function fixture(nInvoices: number, seed = 7): Omit<SearchData, 'pages' | 'actions'> {
  const r = rng(seed);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
  const clients: Client[] = Array.from({ length: Math.max(50, Math.round(nInvoices / 10)) }, (_, i) => ({
    id: `c${i}`, name: `${pick(FIRST)} ${pick(LAST)} ${i}`, company: r() < 0.3 ? `${pick(LAST)} Pvt Ltd` : '', email: '', address: '',
    city: pick(['Pune', 'Mumbai', 'Chennai', 'Kolkata']), zip: '', phone: r() < 0.5 ? `98${String(Math.floor(r() * 1e8)).padStart(8, '0')}` : '',
    gstin: r() < 0.4 ? `27AAACB${String(1000 + i).slice(-4)}M1Z${i % 10}` : '',
  }));
  const invoices: InvoiceRecord[] = [];
  const payments: Payment[] = [];
  for (let i = 0; i < nInvoices; i++) {
    const c = pick(clients);
    const total = Math.round(r() * 200000) / 100;
    invoices.push({
      id: `i${i}`, invoice_number: `${r() < 0.9 ? 'INV' : 'QTN'}/FY2${5 + (i % 2)}-2${6 + (i % 2)}/${String(i + 1).padStart(4, '0')}`,
      doc_type: 'TAX_INVOICE', status: pick(STATUSES), issue_date: `2026-0${1 + (i % 9)}-1${i % 10}`, due_date: `2026-0${1 + (i % 9)}-2${i % 9}`,
      total, balance_due: r() < 0.5 ? 0 : total, amount_paid: 0, client: { ...c }, po_number: r() < 0.1 ? `PO-${i}` : '',
      created_at: `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}Z`,
    } as unknown as InvoiceRecord);
    if (r() < 0.6) payments.push({ id: `p${i}`, invoice_id: `i${i}`, amount: total, method: pick(['UPI', 'Cash', 'Cheque', 'NEFT']), date: '2026-05-01', reference: r() < 0.5 ? `UTR${Math.floor(r() * 1e12)}` : '', receipt_number: `RCT/${i}` } as Payment);
  }
  const items = Array.from({ length: 300 }, (_, i) => ({ id: `it${i}`, name: `${pick(['Steel rod', 'Paracetamol', 'Rice bag', 'Cotton shirt', 'Crème'])} ${i}`, hsn: String(1000 + i), rate: i * 3 }));
  return { invoices, clients, items, payments };
}

const QUERIES = ['g', 'ga', 'gane', 'ganesh 14', 'sharmaa', 'kumr trad', 'cafe', 'Café', 'zoe', 'unal', 'paid', 'overdue', '>500', '12.5k', '0007', '7', 'inv 0012', 'upi', 'utr', 'pune', 'xyzq', 'steel', 'paracetmol', 'creme', '98', '27AAACB1001M1Z1', 'po-', 'rct/1', 'trad ent'];

test('SmartFind: optimised search returns exactly the reference results (same set, order, scores, ranges)', () => {
  const data = fixture(1500);
  const NOW = new Date(2026, 5, 15);
  const index = buildIndex(data, NOW);
  for (const q of QUERIES) {
    const got = searchAll(q, { data, now: NOW });
    const want = refSearch(q, buildIndex(data, NOW));
    assert.deepEqual(got.map((x) => [x.id, x.score, x.ranges]), want.map((x) => [x.id, x.score, x.ranges]), `query "${q}"`);
  }
  assert.ok(index.length > 1500);
});

test('SmartFind: fold / fuzzyMatch / scoreFields agree with the reference on random text', () => {
  const r = rng(99);
  const alphabet = 'abcdeAÉé ü-/0123456789xyzñ';
  const word = (n: number) => Array.from({ length: n }, () => alphabet[Math.floor(r() * alphabet.length)]).join('');
  for (let i = 0; i < 20000; i++) {
    const text = word(1 + Math.floor(r() * 24));
    const q = word(1 + Math.floor(r() * 6));
    assert.equal(fold(text), refFold(text));
    assert.deepEqual(fuzzyMatch(q, text), refFuzzy(q, text), `${q} vs ${text}`);
    const fields: Field[] = [{ text, weight: 1.3, isTitle: true, isNumber: r() < 0.3 }, { text: word(8), weight: 0.6 }];
    const query = `${q} ${word(1 + Math.floor(r() * 7))}`;
    assert.deepEqual(scoreFields(query, fields), refScoreFields(query, fields), `${query} vs ${text}`);
  }
});

test('SmartFind: topRanked equals a full sort + slice', () => {
  const r = rng(5);
  const list: SearchResult[] = Array.from({ length: 2000 }, (_, i) => ({ id: `x${i}`, group: 'invoices', title: `T${Math.floor(r() * 50)}`, icon: '', score: Math.floor(r() * 20), ranges: [] }));
  const want = [...list].sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, 6);
  assert.deepEqual(topRanked([...list], 6).map((x) => x.id), want.map((x) => x.id));
});

test('SmartFind: a keystroke over a 15k-document company stays within budget', () => {
  const data = fixture(15000);
  const NOW = new Date(2026, 5, 15);
  resetStorage();
  setTable(KEYS.invoices, data.invoices as InvoiceRecord[]);
  setTable(KEYS.clients, data.clients as Client[]);
  setTable(KEYS.items, data.items as unknown[]);
  setTable(KEYS.transactions, data.payments as Payment[]);
  try {
    const t0 = performance.now();
    const index = searchIndex(NOW); // built once per storage version, like the palette's warm-up on open
    console.log(`# perf SmartFind index build (15k invoices): ${(performance.now() - t0).toFixed(0)} ms, ${index.length} entries`);
    assert.ok(index.length > 15000);
    const opts = { now: NOW, data: { pages: [], actions: [] } };
    searchAll('warm', opts);
    const times: number[] = [];
    for (const q of ['g', 'ga', 'gan', 'gane', 'ganes', 'ganesh', 'ganesh 1', 'ganesh 14', 'ganesh 143', 'ganesh 1435', 's', 'sh', 'sharmaa', 'kumr', 'kumr trad', 'paid', '>500', 'xyzq']) {
      const t = performance.now();
      searchAll(q, opts);
      times.push(performance.now() - t);
    }
    times.sort((x, y) => x - y);
    const median = times[times.length >> 1];
    console.log(`# perf SmartFind 15k keystroke: median ${median.toFixed(0)} ms, max ${times.at(-1)!.toFixed(0)} ms`);
    // Pre-PERF-2 this was ~2–3 s per key at this scale; the target is < 100 ms on a desktop.
    assert.ok(median < 400, `median ${median.toFixed(0)} ms`);
  } finally {
    resetStorage();
  }
});

/* ── Typeahead ──────────────────────────────────────────────── */

function refSuggest<T>(query: string, rows: readonly T[], opts: { label: (r: T) => string; extra?: (r: T) => (string | undefined)[]; sub?: (r: T) => string | undefined; limit?: number }) {
  const q = query.trim();
  if (!q) return [];
  const out: { row: T; label: string; sub?: string; score: number }[] = [];
  for (const row of rows) {
    const label = opts.label(row) ?? '';
    if (!label.trim()) continue;
    let score = refFuzzy(q, label)?.score ?? -Infinity;
    for (const f of opts.extra?.(row) ?? []) {
      if (!f) continue;
      const m = refFuzzy(q, f);
      if (m) score = Math.max(score, m.score * 0.6);
    }
    if (score === -Infinity) continue;
    out.push({ row, label, sub: opts.sub?.(row), score });
  }
  return out.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label)).slice(0, opts.limit ?? 6);
}

test('typeahead: makeSuggester (pre-folded directory) equals the reference ranking', () => {
  const { clients } = fixture(3000);
  const opts = { label: (c: Client) => c.name, extra: (c: Client) => [c.company, c.gstin, c.city, c.phone], sub: (c: Client) => c.city, limit: 8 };
  const fast = makeSuggester(clients, opts);
  for (const q of ['g', 'gan', 'sharma tr', 'cafe', 'ZOE', 'pune', '98', 'pvt', 'xyz', '27aaacb', 'ünal', 'ra 1']) {
    assert.deepEqual(fast(q), refSuggest(q, clients, opts), q);
    assert.deepEqual(suggest(q, clients, opts), refSuggest(q, clients, opts), q);
  }
});

/* ── Invoice list sort ──────────────────────────────────────── */

function refSort(rows: readonly InvoiceRecord[], key: SortKey, dir: SortDir): InvoiceRecord[] {
  const sign = dir === 'asc' ? 1 : -1;
  const balanceOf = (i: InvoiceRecord) => (isRevenueDoc(i) ? Number(receivableBalance(i)) || 0 : 0);
  const val = (i: InvoiceRecord): string | number => {
    switch (key) {
      case 'date': return String(i.issue_date ?? '');
      case 'due': return String(i.due_date ?? '');
      case 'number': return String(i.invoice_number ?? '');
      case 'client': return (i.client?.name ?? '').toLowerCase();
      case 'total': return Number(i.total) || 0;
      case 'balance': return balanceOf(i);
    }
  };
  return [...rows].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    const c = typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), 'en', { numeric: true });
    return c * sign || String(b.created_at ?? '').localeCompare(String(a.created_at ?? ''));
  });
}

test('invoice list: sortInvoices order is unchanged for every key and direction', () => {
  const { invoices } = fixture(4000, 11);
  for (const key of ['date', 'due', 'number', 'client', 'total', 'balance'] as SortKey[]) {
    for (const dir of ['asc', 'desc'] as SortDir[]) {
      assert.deepEqual(sortInvoices(invoices, key, dir).map((i) => i.id), refSort(invoices, key, dir).map((i) => i.id), `${key} ${dir}`);
    }
  }
});

/* ── Receivables: payment scores and late-fee rules ─────────── */

test('receivables: grouped paymentScores equal the per-party computation', () => {
  const { invoices: raw, clients } = fixture(3000, 21);
  const invoices = raw.map((i, n) => ({ ...i, status: n % 4 === 0 ? 'Sent' : 'Paid', doc_type: 'TAX_INVOICE', due_date: `2026-0${1 + (n % 9)}-10`, issue_date: `2026-0${1 + (n % 9)}-01` }) as InvoiceRecord);
  const payments: Payment[] = invoices.filter((i) => i.status === 'Paid').map((i, n) => ({ id: `p${i.id}`, invoice_id: i.id, amount: i.total, method: 'UPI', date: `2026-0${1 + (n % 9)}-${10 + (n % 15)}` }) as Payment);
  const notes: CollectionNote[] = clients.slice(0, 40).map((c, n) => ({ id: `n${n}`, party_key: c.id!, kind: 'call', outcome: '', date: '2026-08-01', created_at: '', promise: { date: '2026-08-10', amount: 100 } }) as unknown as CollectionNote);
  const TODAY = '2026-10-25';
  const all = paymentScores({ invoices, payments, clients, notes, receipts: [] }, TODAY);
  assert.ok(all.size > 50);
  for (const [party, score] of all) {
    const mine = invoices.filter((i) => i.client?.id === party);
    const ids = new Set(mine.map((i) => i.id));
    const one = paymentScores({ invoices: mine, payments: payments.filter((p) => ids.has(p.invoice_id)), clients, notes: notes.filter((n) => n.party_key === party), receipts: [] }, TODAY).get(party);
    assert.deepEqual(score, one, party);
  }
});

test('receivables: lateFeeRuleFor (indexed) equals the linear client search', () => {
  const fee = { mode: 'percent_pa', rate: 2, graceDays: 5 };
  const clients: Client[] = [
    { id: 'a', name: 'Acme', gstin: 'G1', late_fee: fee },
    { id: 'b', name: ' acme ', gstin: 'G2', late_fee: { ...fee, rate: 3 } },
    { id: 'c', name: 'Acme', gstin: 'G1', late_fee: { ...fee, rate: 4 } }, // duplicate: the first wins
    { id: '', name: 'Bose', late_fee: { ...fee, rate: 5 } },
  ] as unknown as Client[];
  const ref = (inv: InvoiceRecord) => {
    const c = inv.client;
    return (c?.id && clients.find((x) => x.id === c.id)) || clients.find((x) => x.name && c?.name && x.name.trim().toLowerCase() === c.name.trim().toLowerCase() && (x.gstin ?? '') === (c.gstin ?? ''));
  };
  const cases = [
    { id: 'b', name: 'x' }, { id: 'zz', name: 'ACME', gstin: 'G1' }, { name: 'acme', gstin: 'G2' }, { name: 'Acme' }, { name: 'bose' }, { name: '' }, undefined,
  ];
  for (const client of cases) {
    const inv = { id: 'i', client } as unknown as InvoiceRecord;
    const master = ref(inv);
    assert.deepEqual(lateFeeRuleFor(inv, clients), sanitizeClientLateFee(master ? master.late_fee : (client as { late_fee?: unknown } | undefined)?.late_fee), JSON.stringify(client));
  }
});

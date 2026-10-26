/**
 * Batch genealogy and recall (R4-A3). Every stock movement already carries its batch (`collectEvents`); this joins them.
 *
 *  - One pass over the events builds an index: batch (item + batch number) → the events that brought it in, consumed
 *    it, produced it or sent it out, and document / voucher id → its events.
 *  - Trace BACKWARD from a finished batch, a serial or a sales line: the Manufacturing / Stock Journal or job-work
 *    receipt that produced it, the component batches it consumed (recursively through sub-assemblies) and the bill /
 *    GRN / opening stock that brought each batch in, with supplier, number and date.
 *  - Trace FORWARD from a purchase batch: every voucher that consumed it, the batches produced, and every outward
 *    document carrying those batches (invoices, challans, POS bills, transfers, job work out); credit notes and
 *    rejections in are "came back".
 *  - When a voucher consumed several batches of one component, every edge is kept (no pro-rating) and the output batch
 *    is marked "mixed". Whether that is enough for an FSSAI / CDSCO recall is a question for your QA / CA.
 *
 * Cycle-safe (visited set). Pure; the caller passes `collectEvents(liveTrackingInputs())` (tests/genealogy.test.ts).
 */
import type { StockEvent } from '../inventory';

export interface TraceRef {
  refType: string;
  refId: string;
  refNumber: string;
  party: string;
  date: string;
}

export interface SourceRow extends TraceRef {
  /** purchase (bill / GRN), opening stock, an adjustment in, or a customer return. */
  kind: 'purchase' | 'opening' | 'adjustment' | 'return';
  qty: number;
}

export interface TraceNode {
  itemId: string;
  batch: string;
  /** Item does not track batches (or the line had no batch): the chain stops here. */
  untracked?: boolean;
  /** Made from more than one batch of some component. */
  mixed?: boolean;
  /** Already shown higher up (a cycle or a shared sub-assembly). */
  repeat?: boolean;
  sources: SourceRow[];
  madeBy: { ref: TraceRef; qty: number; components: (TraceNode & { qty: number })[] }[];
}

export interface OutRow extends TraceRef {
  itemId: string;
  batch: string;
  qty: number;
  /** sale (invoice / challan / POS bill), transfer to another godown / branch, job work out, or came back. */
  kind: 'sale' | 'transfer' | 'job_work' | 'return';
}

export interface ForwardResult {
  /** Batches reached (the start batch first), with the depth they were reached at. */
  batches: { itemId: string; batch: string; depth: number; mixed: boolean }[];
  /** Vouchers that consumed a reached batch. */
  consumedBy: (TraceRef & { itemId: string; batch: string; qty: number })[];
  outward: OutRow[];
  returned: OutRow[];
}

type Ev = StockEvent & { itemId: string };

interface NodeEvents {
  in: Ev[];
  out: Ev[];
}

export interface GenealogyIndex {
  nodes: Map<string, NodeEvents>;
  byRef: Map<string, Ev[]>;
  bySerial: Map<string, Ev[]>;
}

export const nodeKey = (itemId: string, batch: string | undefined) => `${itemId}|${(batch ?? '').trim().toUpperCase()}`;
const serialKeyOf = (itemId: string, s: string) => `${itemId}|${s.trim().toUpperCase()}`;
const rq = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000 || 0;
const refOf = (e: Ev): TraceRef => ({ refType: e.refType ?? '', refId: e.refId ?? '', refNumber: e.refNumber ?? '', party: e.party ?? '', date: e.date });

/** One pass over the engine's events. */
export function buildGenealogy(events: ReadonlyMap<string, readonly StockEvent[]>): GenealogyIndex {
  const nodes = new Map<string, NodeEvents>();
  const byRef = new Map<string, Ev[]>();
  const bySerial = new Map<string, Ev[]>();
  for (const [itemId, list] of events) {
    for (const raw of list) {
      const e: Ev = { ...raw, itemId };
      const k = nodeKey(itemId, e.batch);
      let n = nodes.get(k);
      if (!n) nodes.set(k, (n = { in: [], out: [] }));
      (e.qty > 0 ? n.in : n.out).push(e);
      const ref = e.voucher || e.refId;
      if (ref) {
        const r = byRef.get(ref);
        if (r) r.push(e);
        else byRef.set(ref, [e]);
      }
      for (const s of e.serials ?? []) {
        const sk = serialKeyOf(itemId, s);
        const r = bySerial.get(sk);
        if (r) r.push(e);
        else bySerial.set(sk, [e]);
      }
    }
  }
  return { nodes, byRef, bySerial };
}

const isProduction = (e: Ev) => e.kind === 'production';
const sourceKind = (e: Ev): SourceRow['kind'] | null =>
  e.kind === 'purchase' ? 'purchase' : e.kind === 'opening' ? 'opening' : e.kind === 'adjustment' ? 'adjustment' : null;

/** Producing vouchers of a batch → their consumed component lines, recursively (cycle-safe). */
export function traceBackward(index: GenealogyIndex, itemId: string, batch: string, seen: Set<string> = new Set()): TraceNode {
  const key = nodeKey(itemId, batch);
  const node: TraceNode = { itemId, batch: batch.trim(), sources: [], madeBy: [] };
  if (!batch.trim()) return { ...node, untracked: true };
  if (seen.has(key)) return { ...node, repeat: true };
  seen.add(key);
  const ev = index.nodes.get(key);
  if (!ev) return node;
  const vouchers = new Map<string, { ref: TraceRef; qty: number }>();
  for (const e of ev.in) {
    if (e.kind === 'transfer') continue;
    if (isProduction(e)) {
      const id = e.voucher || e.refId || '';
      const v = vouchers.get(id) ?? { ref: refOf(e), qty: 0 };
      v.qty = rq(v.qty + e.qty);
      vouchers.set(id, v);
      continue;
    }
    const kind = sourceKind(e);
    if (kind) node.sources.push({ ...refOf(e), kind, qty: rq(e.qty) });
  }
  for (const [id, v] of vouchers) {
    const comps = (index.byRef.get(id) ?? []).filter((x) => x.kind === 'consumption');
    const perItem = new Map<string, Set<string>>();
    const components = comps.map((c) => {
      const s = perItem.get(c.itemId) ?? new Set<string>();
      s.add((c.batch ?? '').trim().toUpperCase());
      perItem.set(c.itemId, s);
      return { ...traceBackward(index, c.itemId, c.batch ?? '', seen), qty: rq(-c.qty) };
    });
    if ([...perItem.values()].some((s) => s.size > 1)) node.mixed = true;
    node.madeBy.push({ ref: v.ref, qty: v.qty, components });
  }
  return node;
}

/** Backward trace of one serial: the batch it was made / bought in, or its producing voucher. */
export function traceSerial(index: GenealogyIndex, itemId: string, serial: string): TraceNode {
  const list = index.bySerial.get(serialKeyOf(itemId, serial)) ?? [];
  const made = list.find((e) => isProduction(e));
  const node: TraceNode = { itemId, batch: serial.trim(), sources: [], madeBy: [] };
  if (made) {
    if (made.batch) return traceBackward(index, itemId, made.batch);
    const id = made.voucher || made.refId || '';
    const seen = new Set<string>();
    const comps = (index.byRef.get(id) ?? []).filter((x) => x.kind === 'consumption').map((c) => ({ ...traceBackward(index, c.itemId, c.batch ?? '', seen), qty: rq(-c.qty) }));
    node.madeBy.push({ ref: refOf(made), qty: 1, components: comps });
    return node;
  }
  for (const e of list) {
    const kind = e.qty > 0 ? sourceKind(e) : null;
    if (kind) node.sources.push({ ...refOf(e), kind, qty: 1 });
  }
  return node;
}

/** Batches a sales document line (invoice / challan / POS bill) carried, for "trace back from a sale". */
export function batchesOnDocument(index: GenealogyIndex, docId: string, itemId?: string): { itemId: string; batch: string; qty: number }[] {
  const out = new Map<string, { itemId: string; batch: string; qty: number }>();
  for (const e of index.byRef.get(docId) ?? []) {
    if (itemId && e.itemId !== itemId) continue;
    if (!e.batch?.trim()) continue;
    const k = nodeKey(e.itemId, e.batch);
    const r = out.get(k) ?? { itemId: e.itemId, batch: e.batch.trim(), qty: 0 };
    r.qty = rq(r.qty + Math.abs(e.qty));
    out.set(k, r);
  }
  return [...out.values()];
}

/** Every voucher that consumed the batch, the batches produced from it (recursively), and where they all went. */
export function traceForward(index: GenealogyIndex, start: { itemId: string; batch: string }[], maxDepth = 25): ForwardResult {
  const res: ForwardResult = { batches: [], consumedBy: [], outward: [], returned: [] };
  const seen = new Set<string>();
  const queue: { itemId: string; batch: string; depth: number }[] = start.filter((s) => s.batch.trim()).map((s) => ({ ...s, batch: s.batch.trim(), depth: 0 }));
  const mixedVoucher = (id: string) => {
    const per = new Map<string, Set<string>>();
    for (const c of index.byRef.get(id) ?? []) {
      if (c.kind !== 'consumption') continue;
      const s = per.get(c.itemId) ?? new Set<string>();
      s.add((c.batch ?? '').trim().toUpperCase());
      per.set(c.itemId, s);
    }
    return [...per.values()].some((s) => s.size > 1);
  };
  while (queue.length) {
    const cur = queue.shift() as { itemId: string; batch: string; depth: number };
    const key = nodeKey(cur.itemId, cur.batch);
    if (seen.has(key)) continue;
    seen.add(key);
    const ev = index.nodes.get(key);
    let mixed = false;
    for (const e of ev?.in ?? []) if (isProduction(e) && mixedVoucher(e.voucher || e.refId || '')) mixed = true;
    res.batches.push({ itemId: cur.itemId, batch: cur.batch, depth: cur.depth, mixed });
    if (!ev) continue;
    for (const e of ev.out) {
      const ref = refOf(e);
      if (e.kind === 'consumption') {
        res.consumedBy.push({ ...ref, itemId: cur.itemId, batch: cur.batch, qty: rq(-e.qty) });
        if (cur.depth >= maxDepth) continue;
        for (const p of index.byRef.get(e.voucher || e.refId || '') ?? []) {
          if (isProduction(p) && p.batch?.trim()) queue.push({ itemId: p.itemId, batch: p.batch.trim(), depth: cur.depth + 1 });
        }
      } else if (e.kind === 'sale') res.outward.push({ ...ref, itemId: cur.itemId, batch: cur.batch, qty: rq(-e.qty), kind: 'sale' });
      else if (e.kind === 'transfer') res.outward.push({ ...ref, itemId: cur.itemId, batch: cur.batch, qty: rq(-e.qty), kind: e.refType === 'job_work_out' ? 'job_work' : 'transfer' });
    }
    for (const e of ev.in) if (e.kind === 'return') res.returned.push({ ...refOf(e), itemId: cur.itemId, batch: cur.batch, qty: rq(e.qty), kind: 'return' });
  }
  return res;
}

/* ── Recall list ──────────────────────────────────────────────── */

export interface RecallRow {
  party: string;
  phone?: string;
  email?: string;
  docs: { refId: string; refNumber: string; date: string; batch: string; itemId: string; qty: number }[];
  /** Units sold per batch key (`item|BATCH`). */
  qty: number;
  returned: number;
}

/** Customers who received a reached batch, with their documents, quantities, returns and contact details. */
export function recallList(f: ForwardResult, contact: (party: string, refId: string) => { phone?: string; email?: string } | undefined): RecallRow[] {
  const rows = new Map<string, RecallRow>();
  for (const o of f.outward) {
    if (o.kind !== 'sale' || o.refType !== 'invoice') continue;
    const k = o.party.trim().toLowerCase() || '(no party)';
    const r = rows.get(k) ?? { party: o.party || '—', docs: [], qty: 0, returned: 0, ...(contact(o.party, o.refId) ?? {}) };
    r.docs.push({ refId: o.refId, refNumber: o.refNumber, date: o.date, batch: o.batch, itemId: o.itemId, qty: o.qty });
    r.qty = rq(r.qty + o.qty);
    rows.set(k, r);
  }
  for (const o of f.returned) {
    const r = rows.get(o.party.trim().toLowerCase());
    if (r) r.returned = rq(r.returned + o.qty);
  }
  return [...rows.values()].sort((a, b) => b.qty - a.qty || a.party.localeCompare(b.party));
}

/** CSV rows of a recall list. */
export function recallCsvRows(rows: readonly RecallRow[], itemName: (id: string) => string): (string | number)[][] {
  const out: (string | number)[][] = [['Customer', 'Phone', 'E-mail', 'Document', 'Date', 'Item', 'Batch', 'Quantity', 'Returned by customer']];
  for (const r of rows) for (const d of r.docs) out.push([r.party, r.phone ?? '', r.email ?? '', d.refNumber, d.date, itemName(d.itemId), d.batch, d.qty, r.returned]);
  return out;
}

/** `wa.me` / `mailto:` links for "Message all" (opened one by one by the user; nothing is sent from here). */
export function recallMessageLinks(r: Pick<RecallRow, 'phone' | 'email' | 'party' | 'docs'>, text: string): { whatsapp?: string; mail?: string } {
  const digits = (r.phone ?? '').replace(/\D/g, '');
  const phone = digits.length === 10 ? `91${digits}` : digits;
  return {
    ...(phone.length >= 10 ? { whatsapp: `https://wa.me/${phone}?text=${encodeURIComponent(text)}` } : {}),
    ...(r.email?.includes('@') ? { mail: `mailto:${r.email}?subject=${encodeURIComponent('Product recall notice')}&body=${encodeURIComponent(text)}` } : {}),
  };
}

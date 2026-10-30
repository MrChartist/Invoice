/**
 * Stock event source for job work (P1-9) and Rejections In (P1-8). Registered in `collectEvents`
 * (inventory.ts) with one call; the engine itself is unchanged apart from reading these events.
 *
 *  - Material Out (`job_work_out`): a godown move from our godown to the job worker's godown (kind `transfer`).
 *    Company-wide quantity and value are unchanged: the goods are still ours ("our stock with third party"),
 *    and they show under the job worker's godown wherever stock is shown by godown.
 *  - Material In (`job_work_in`):
 *      consumed lines → issued from the job worker's godown (kind `consumption`, part of a voucher pool);
 *      processed lines → received into our godown (kind `production`) at
 *                        pool = inputs consumed + job charges − scrap value, split by quantity;
 *      scrap lines     → received at their fixed value per unit (kind `production`);
 *      returned / supplied lines → moved back from the job worker's godown (kind `transfer`);
 *      losses          → issued from the job worker's godown (kind `adjustment`: neither a sale nor COGS).
 *  - Rejection In (`rejections_in`): goods back from a customer who rejected a delivery challan (kind `return`,
 *    so it reverses the challan's issue), only while that challan itself moves stock.
 *  - Quantities are typed in a line's unit; `unit_factor` converts to the item's base unit (units.ts).
 *
 * Pure apart from `loadJobWorkStockDocs` (storage read, used by `liveInputs`).
 */

import type { MaterialIn, MaterialOut, RejectionIn } from '../types/job-work';
import type { InvoiceLike, ItemIndex, StockEvent, StockItem } from './inventory';
import { num } from './invoice-calc';
import { getTable } from './storage';
import { lineFactor } from './units';

export const JOB_WORK_TABLES = {
  orders: 'job_work_orders', out: 'job_work_out', in: 'job_work_in', principal: 'job_work_principal', rejections: 'rejections_in',
} as const;

export interface JobWorkStockDocs {
  outs: readonly MaterialOut[];
  ins: readonly MaterialIn[];
  rejections: readonly RejectionIn[];
}

type Push = (itemId: string, ev: Omit<StockEvent, 'seq' | 'rank' | 'godown'> & { godown?: string; rank?: number }) => void;

export interface JobWorkEventContext {
  /** Tracked stock item by id. */
  byId: (id: string) => StockItem | undefined;
  index: ItemIndex;
  invoices: readonly InvoiceLike[];
  links?: readonly { from_id: string; to_id: string; relation: string }[];
  includeChallans: boolean;
  /** Godown moves are emitted only when the caller asks for godown detail (as for stock transfers). */
  includeTransfers: boolean;
}

const day = (d: unknown) => String(d ?? '').slice(0, 10);
const MAIN = 'main';
/** 7S: trimmed serials of a line (same rule as `cleanSerials` in inventory.ts; kept local to avoid an import cycle). */
const cleanSerials = (list: unknown): string[] | undefined => {
  if (!Array.isArray(list)) return undefined;
  const out = list.map((x) => String(x ?? '').trim()).filter(Boolean);
  return out.length ? out : undefined;
};

export function loadJobWorkStockDocs(): JobWorkStockDocs {
  return {
    outs: getTable<MaterialOut>(JOB_WORK_TABLES.out),
    ins: getTable<MaterialIn>(JOB_WORK_TABLES.in),
    rejections: getTable<RejectionIn>(JOB_WORK_TABLES.rejections),
  };
}

/** True when any document would move stock (lets callers skip work). */
export function hasJobWorkDocs(docs: JobWorkStockDocs | undefined): boolean {
  return !!docs && (docs.outs.length > 0 || docs.ins.length > 0 || docs.rejections.length > 0);
}

/**
 * Does a delivery challan move stock? Only a live challan while challans move stock, and not one made from a
 * live invoice (the invoice moved the goods). Same rule as `collectEvents`.
 */
export function challanMovesStock(challan: InvoiceLike | undefined, ctx: Pick<JobWorkEventContext, 'invoices' | 'links' | 'includeChallans'>): boolean {
  if (!challan || challan.doc_type !== 'DELIVERY_CHALLAN' || !ctx.includeChallans) return false;
  if (challan.status === 'Draft' || challan.status === 'Cancelled') return false;
  for (const l of ctx.links ?? []) {
    if (l.relation !== 'converted' || l.to_id !== challan.id) continue;
    const from = ctx.invoices.find((d) => d.id === l.from_id);
    const live = from && from.status !== 'Draft' && from.status !== 'Cancelled';
    if (live && (from.doc_type === 'INVOICE' || from.doc_type === 'TAX_INVOICE' || from.doc_type === 'BILL_OF_SUPPLY' || from.doc_type === undefined)) return false;
  }
  return true;
}

/** Push every job-work and rejection-in stock event. */
export function jobWorkStockEvents(docs: JobWorkStockDocs | undefined, ctx: JobWorkEventContext, push: Push): void {
  if (!docs || !hasJobWorkDocs(docs)) return;
  for (const o of docs.outs) {
    const date = day(o?.date);
    if (!date || !o.job_worker_godown || !ctx.includeTransfers) continue;
    for (const l of o.lines ?? []) {
      const q = num(l?.qty) * lineFactor(l);
      const from = l.godown_id || MAIN;
      if (!ctx.byId(l.item_id) || !(q > 0) || from === o.job_worker_godown) continue;
      const base = { date, kind: 'transfer' as const, refType: 'job_work_out', refId: o.id, refNumber: o.number, party: o.party_name, batch: l.batch_no || undefined, serials: cleanSerials(l.serials) };
      push(l.item_id, { ...base, qty: -q, godown: from, particulars: `Material out: ${o.number} · ${o.party_name}` });
      push(l.item_id, { ...base, qty: q, godown: o.job_worker_godown, particulars: `Material out: ${o.number} · at ${o.party_name}` });
    }
  }
  const sorted = [...docs.ins].filter((v) => v && day(v.date)).sort((a, b) => day(a.date).localeCompare(day(b.date)) || String(a.number).localeCompare(String(b.number), undefined, { numeric: true }));
  for (const v of sorted) {
    const date = day(v.date);
    const jw = v.job_worker_godown || MAIN;
    const label = `Material in: ${v.number}`;
    const base = { date, refType: 'job_work_in', refId: v.id, refNumber: v.number, party: v.party_name };
    for (const l of v.consumed ?? []) {
      const q = num(l?.qty) * lineFactor(l);
      if (!ctx.byId(l.item_id) || !(q > 0)) continue;
      push(l.item_id, { ...base, kind: 'consumption', qty: -q, godown: jw, batch: l.batch_no || undefined, serials: cleanSerials(l.serials), voucher: v.id, particulars: `${label} (consumed at ${v.party_name})` });
    }
    const made = (v.received ?? []).filter((l) => (l.kind === 'processed' || l.kind === 'scrap') && ctx.byId(l.item_id) && num(l.qty) * lineFactor(l) > 0);
    const processedQty = made.reduce((s, l) => s + (l.kind === 'processed' ? num(l.qty) * lineFactor(l) : 0), 0);
    const fixed = made.reduce((s, l) => s + (l.kind === 'scrap' ? num(l.qty) * Math.max(num(l.rate), 0) : 0), 0);
    const pool = { amount: Math.max(num(v.charges), 0), pct: 0, fixed };
    for (const l of made) {
      const f = lineFactor(l);
      const q = num(l.qty) * f;
      const scrap = l.kind === 'scrap';
      push(l.item_id, {
        ...base, kind: 'production', qty: q, godown: l.godown_id, batch: l.batch_no || undefined, serials: cleanSerials(l.serials), voucher: v.id, pool,
        rate: scrap ? Math.max(num(l.rate), 0) / f : undefined,
        share: scrap ? undefined : processedQty > 0 ? q / processedQty : 0,
        particulars: `${label} (${scrap ? 'scrap' : 'processed'} from ${v.party_name})`,
      });
    }
    if (ctx.includeTransfers) {
      const back = [
        ...(v.received ?? []).filter((l) => l.kind === 'returned').map((l) => ({ l, what: 'returned unprocessed' })),
        ...(v.supplied ?? []).map((l) => ({ l, what: `supplied from ${v.party_name}'s premises` })),
      ];
      for (const { l, what } of back) {
        const q = num(l?.qty) * lineFactor(l);
        const to = l.godown_id || MAIN;
        if (!ctx.byId(l.item_id) || !(q > 0) || to === jw) continue;
        const t = { ...base, kind: 'transfer' as const, batch: l.batch_no || undefined, serials: cleanSerials(l.serials), particulars: `${label} (${what})` };
        push(l.item_id, { ...t, qty: -q, godown: jw });
        push(l.item_id, { ...t, qty: q, godown: to });
      }
    }
    for (const l of v.losses ?? []) {
      const q = num(l?.qty) * lineFactor(l);
      if (!ctx.byId(l.item_id) || !(q > 0)) continue;
      push(l.item_id, { ...base, kind: 'adjustment', qty: -q, godown: jw, batch: l.batch_no || undefined, serials: cleanSerials(l.serials), particulars: `${label} (loss at ${v.party_name})` });
    }
  }
  if (!docs.rejections.length) return;
  const byInvoice = new Map(ctx.invoices.filter((d) => d?.id).map((d) => [d.id as string, d]));
  for (const r of docs.rejections) {
    const date = day(r?.date);
    const challan = byInvoice.get(r?.challan_id);
    if (!date || !challanMovesStock(challan, ctx)) continue;
    const lines = new Map((challan?.items ?? []).map((l) => [l.id, l]));
    for (const l of r.lines ?? []) {
      const src = lines.get(l.challan_line_id);
      const it = ctx.index.find(src?.name ?? l.name, src?.hsn ?? l.hsn);
      const f = lineFactor(src ?? l);
      const q = num(l.quantity) * f;
      if (!it || !(q > 0)) continue;
      push(it.id, {
        date, kind: 'return', qty: q, saleRate: src ? (num(src.rate) * (1 - Math.min(Math.max(num(src.discount_percent), 0), 100) / 100)) / f : undefined,
        particulars: `Rejection in: ${r.number} (challan ${r.challan_number ?? challan?.invoice_number ?? ''})${r.client_name ? ` · ${r.client_name}` : ''}`,
        refType: 'rejection_in', refId: r.id, refNumber: r.number, party: r.client_name,
        godown: l.godown_id ?? src?.godown_id, batch: (l.batch_no ?? src?.batch_no) || undefined,
      });
    }
  }
}

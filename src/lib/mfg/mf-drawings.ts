/**
 * MF-B1 drawing register (table `drawings`, `master.edit`, audited): the customer's drawing number with every revision
 * (one `current`; a newer revision supersedes it; `hold` stops production), the characteristics to inspect (nominal ±
 * tolerances) and the material grade. A document line naming a superseded revision warns ("PO says rev B; current is
 * rev C"); a `hold` revision blocks the release of a production order of the drawing's item unless the owner overrides
 * it for that revision (audited). Heat no. / test-certificate refs typed on bill lines (`PurchaseLine.mf_heat`) are
 * carried to the output batch through the order's batch-wise issues (R4-A genealogy) for the invoice sub-line.
 * Pure helpers above the "Storage" divider (tests/mf-drawings.test.ts). Working papers — verify with your CA.
 */
import type { Drawing, DrawingRevision, MfLineSnap, MfSnapshot } from '../../types/mfg-r13';
import type { InvoiceRecord } from '../../types/invoice';
import type { ManufacturingVoucher } from '../../types/manufacturing';
import type { StockTransfer } from '../../types/stock';
import { generateId, peekTable } from '../storage';
import { requireAccess, currentActor } from '../access';
import { audit } from '../audit';
import { isVoidStatus, readPurchase, readPurchaseLines } from '../purchase-normalize';
import { impliedPacks } from '../shop-mode';
import { localDb } from '../localDb';
import { MF_TABLES } from './mf-shared';
import { mfSnapshot } from './mf-snapshot';
import { DAY, drop, mustGet, nowIso, put, rowsOf } from './mf-b-db';

export const DRAWINGS_TABLE = MF_TABLES.drawings;
const key = (s: string | undefined) => String(s ?? '').trim().toUpperCase();

/* ── Pure ─────────────────────────────────────────────────────── */

/** The current revision (else the newest that is not superseded, else the newest). */
export function currentRev(d: Pick<Drawing, 'revisions'>): DrawingRevision | undefined {
  const r = d.revisions ?? [];
  return r.find((x) => x.status === 'current') ?? [...r].reverse().find((x) => x.status !== 'superseded') ?? r[r.length - 1];
}

/** Add a revision: it becomes `current` (or `hold`); every earlier current / hold revision is superseded. */
export function withRevision(d: Drawing, rev: Omit<DrawingRevision, 'status'> & { status?: 'current' | 'hold' }): Drawing {
  const r = key(rev.rev);
  if (!r) throw new Error('Enter the revision.');
  if (!DAY.test(rev.date)) throw new Error('Enter the revision date.');
  if (d.revisions.some((x) => key(x.rev) === r)) throw new Error(`Revision ${r} is already in the register.`);
  const older: DrawingRevision[] = d.revisions.map((x) => (x.status === 'superseded' ? x : { ...x, status: 'superseded' }));
  return { ...d, revisions: [...older, { ...rev, rev: r, status: rev.status ?? 'current', ...(rev.note?.trim() ? { note: rev.note.trim() } : { note: undefined }) }] };
}

/** Put the current revision on hold or release it back to current. */
export function withHold(d: Drawing, hold: boolean): Drawing {
  const cur = currentRev(d);
  if (!cur || cur.status === 'superseded') throw new Error('No live revision to change.');
  return { ...d, revisions: d.revisions.map((x) => (x === cur ? { ...x, status: hold ? 'hold' : 'current' } : x)) };
}

/** '' when `rev` is the live revision; else the warning for a document line naming it. */
export function revWarning(d: Pick<Drawing, 'number' | 'revisions'>, rev: string | undefined): string {
  const r = key(rev);
  const cur = currentRev(d);
  if (!r || !cur) return '';
  const named = d.revisions.find((x) => key(x.rev) === r);
  if (!named) return `Drawing ${d.number}: rev ${r} is not in the register (current is rev ${cur.rev}).`;
  if (named.status === 'superseded') return `Drawing ${d.number}: PO says rev ${r}; current is rev ${cur.rev}.`;
  if (named.status === 'hold') return `Drawing ${d.number}: rev ${r} is on hold.`;
  return '';
}

/** Warnings for the drawing / revision on each line of a document's `mf` snapshot. */
export function docRevWarnings(mf: MfSnapshot | undefined, drawings: readonly Drawing[]): string[] {
  const out: string[] = [];
  for (const l of Object.values(mf?.lines ?? {})) {
    const d = l.drawing ? drawings.find((x) => key(x.number) === key(l.drawing)) : undefined;
    const w = d ? revWarning(d, l.rev) : '';
    if (w && !out.includes(w)) out.push(w);
  }
  return out;
}

/** '' or why an order of `itemId` may not be released: a drawing of the item whose live revision is on hold. */
export function holdBlock(itemId: string, drawings: readonly Drawing[]): string {
  for (const d of drawings) {
    if (d.item_id !== itemId) continue;
    const cur = currentRev(d);
    if (cur?.status === 'hold' && key(d.release_override?.rev) !== key(cur.rev)) return `Drawing ${d.number} rev ${cur.rev} is on hold — release it in the drawing register (or the owner overrides it) first.`;
  }
  return '';
}

export interface HeatDocs {
  mfg: readonly Pick<ManufacturingVoucher, 'item_id' | 'batch_no' | 'production_order_id' | 'components'>[];
  transfers: readonly Pick<StockTransfer, 'production_order_id' | 'lines'>[];
  purchases: readonly unknown[];
}

/** Heat nos. behind an output batch: the batches its orders consumed (journal lines + issues) → bill lines' `mf_heat`. */
export function heatsForBatch(itemId: string, batch: string, docs: HeatDocs): string[] {
  const b = key(batch);
  if (!b) return [];
  const used = new Set<string>();
  const orders = new Set<string>();
  for (const v of docs.mfg) {
    if (v.item_id !== itemId || key(v.batch_no) !== b) continue;
    for (const c of v.components ?? []) if (c.batch_no) used.add(`${c.item_id}|${key(c.batch_no)}`);
    if (v.production_order_id) orders.add(v.production_order_id);
  }
  for (const t of docs.transfers) {
    if (!t.production_order_id || !orders.has(t.production_order_id)) continue;
    for (const l of t.lines ?? []) if (l.batch_no) used.add(`${l.item_id}|${key(l.batch_no)}`);
  }
  const heats = new Set<string>();
  for (const raw of docs.purchases) {
    const p = readPurchase(raw);
    if (!p || p.isExpense || isVoidStatus((raw as { status?: string }).status)) continue;
    const rawLines = ((raw as { lines?: { mf_heat?: string }[] }).lines ?? []);
    readPurchaseLines(raw).forEach((l, i) => {
      const h = rawLines[i]?.mf_heat?.trim();
      if (h && used.has(`${l.itemId}|${key(l.batchNo)}`)) heats.add(h);
    });
  }
  return [...heats].sort();
}

/* ================================================================
   Storage
   ================================================================ */

export const loadDrawings = (): Drawing[] => rowsOf<Drawing>(DRAWINGS_TABLE).filter((d) => Array.isArray(d.revisions));

/** Release guard for `production/orders.ts` (via MF-A's routing copy): reads drawings only with the fabrication pack. */
export function releaseHold(itemId: string): string {
  if (!impliedPacks(localDb.settings.get()).includes('fabrication')) return '';
  return holdBlock(itemId, peekTable<Drawing>(DRAWINGS_TABLE).filter((d) => d && Array.isArray(d.revisions)));
}

export type DrawingInput = Pick<Drawing, 'number' | 'title'> & Partial<Pick<Drawing, 'id' | 'client_id' | 'item_id' | 'characteristics' | 'material_grade'>> & { rev?: string; rev_date?: string };

/** Create (with its first revision) or edit a drawing's details and characteristics. */
export function saveDrawing(i: DrawingInput): Drawing {
  requireAccess('master.edit');
  if (!i.number?.trim()) throw new Error('Enter the drawing number.');
  if (!i.title?.trim()) throw new Error('Enter the title.');
  const all = loadDrawings();
  if (all.some((d) => d.id !== i.id && key(d.number) === key(i.number) && (d.client_id ?? '') === (i.client_id ?? ''))) throw new Error(`Drawing ${key(i.number)} is already in the register.`);
  for (const c of i.characteristics ?? []) {
    if (!c.name?.trim()) throw new Error('Name each characteristic.');
    if (!(c.tol_minus >= 0 && c.tol_plus >= 0)) throw new Error('Tolerances cannot be negative.');
  }
  const prev = i.id ? all.find((d) => d.id === i.id) : undefined;
  let row: Drawing = {
    ...prev, id: prev?.id ?? generateId(), number: i.number.trim(), title: i.title.trim(), revisions: prev?.revisions ?? [],
    ...(i.client_id ? { client_id: i.client_id } : { client_id: undefined }), ...(i.item_id ? { item_id: i.item_id } : { item_id: undefined }),
    characteristics: (i.characteristics ?? prev?.characteristics ?? []).map((c) => ({ ...c, id: c.id || generateId(), name: c.name.trim() })),
    ...(i.material_grade?.trim() ? { material_grade: i.material_grade.trim() } : {}), created_at: prev?.created_at ?? nowIso(), updated_at: nowIso(),
  };
  if (!prev) row = withRevision(row, { rev: i.rev?.trim() || 'A', date: i.rev_date || nowIso().slice(0, 10) });
  return put(DRAWINGS_TABLE, row);
}

export function addRevision(id: string, rev: Omit<DrawingRevision, 'status'> & { status?: 'current' | 'hold' }): Drawing {
  requireAccess('master.edit');
  return put(DRAWINGS_TABLE, { ...withRevision(mustGet<Drawing>(DRAWINGS_TABLE, id, 'drawing'), rev), updated_at: nowIso() });
}

export function setHold(id: string, hold: boolean): Drawing {
  requireAccess('master.edit');
  const d = withHold(mustGet<Drawing>(DRAWINGS_TABLE, id, 'drawing'), hold);
  return put(DRAWINGS_TABLE, { ...d, ...(hold ? {} : { release_override: undefined }), updated_at: nowIso() });
}

/** Owner only: let production of the item go ahead although the live revision is on hold (audited). */
export function overrideHold(id: string): Drawing {
  requireAccess('settings.manage');
  const d = mustGet<Drawing>(DRAWINGS_TABLE, id, 'drawing');
  const cur = currentRev(d);
  if (cur?.status !== 'hold') throw new Error('The live revision is not on hold.');
  const by = currentActor()?.name ?? 'Owner';
  const saved = put(DRAWINGS_TABLE, { ...d, release_override: { rev: cur.rev, by, at: nowIso() }, updated_at: nowIso() });
  try {
    audit.record({ entity: 'item', entity_id: d.id, action: 'update', summary: `Drawing ${d.number} rev ${cur.rev}: hold overridden for production by ${by}` });
  } catch {
    /* logging never blocks */
  }
  return saved;
}

/** Delete (recycle bin) — refused while an inspection report names it. */
export function removeDrawing(id: string, inspectionDrawingIds: readonly string[]): void {
  requireAccess('master.edit');
  const d = mustGet<Drawing>(DRAWINGS_TABLE, id, 'drawing');
  if (inspectionDrawingIds.includes(id)) throw new Error(`Drawing ${d.number} has inspection reports; keep it.`);
  drop(DRAWINGS_TABLE, id);
}

/** Stamp drawing / revision / PO line / heat on the lines of a DRAFT document (`mf.lines`; issued documents keep theirs). */
export function stampDocLines(invoiceId: string, lines: Record<string, MfLineSnap>): InvoiceRecord {
  requireAccess('doc.create');
  const inv = localDb.invoices.getById(invoiceId);
  if (!inv) throw new Error('Document not found.');
  if (inv.status !== 'Draft') throw new Error('Only a draft can be changed; an issued document keeps its print.');
  const keep = new Set(inv.items.map((l) => l.id));
  const merged = { ...inv.mf?.lines };
  for (const [id, l] of Object.entries(lines)) if (keep.has(id)) merged[id] = { ...merged[id], ...l };
  return localDb.invoices.save({ ...inv, mf: { ...inv.mf, ...mfSnapshot(inv.mf?.kind ?? 'drawing', { ...inv.mf, lines: merged }) } });
}

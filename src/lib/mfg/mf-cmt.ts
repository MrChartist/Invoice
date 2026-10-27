/**
 * MF-C3 cut-make-trim by bundle on the existing job-work documents (no new document):
 *  - CMT out = a Material Out (`JWC`) line of the lot's fabric from the WIP godown — metres = pieces × metres a piece —
 *    tagged `JobWorkLine.mf = { lot, bundles, pieces }`;
 *  - CMT in = a Material In by bundle: good pieces come back as the style's variant children (processed), the fabric of
 *    good pieces is consumed at the fabricator, rejected cut pieces come back unstitched (returned), the rest stays
 *    short (pending on the challan, flagged per bundle); job charges = good × piece rate.
 * Sec 143 clocks and ITC-04 keep working on the fabric metres. Pure.
 */
import type { JobWorkLine, JobWorkReceiptLine, MaterialOut } from '../../types/job-work';
import type { StockItem } from '../inventory';
import { generateId } from '../storage';
import { num, round2 } from '../invoice-calc';
import { lineFactor } from '../units';
import { bundleId, livePieces, parseBundleId } from './mf-bundles';
import { childFor } from './mf-styles';
import type { CutPlan } from './mf-c-pending';

/** The CMT tag of a job-work line (`JobWorkLine.mf`), read defensively. */
export interface CmtTag { lot?: string; bundles?: string[]; pieces?: number; scrap_at_jw?: boolean }
export const cmtTag = (l: unknown): CmtTag | undefined => (l as { mf?: CmtTag } | undefined)?.mf;

const r3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000 || 0;

/** A Material Out line sending bundles `nos` of a lot: fabric metres = live pieces × `perPieceM`. */
export function cmtOutLine(p: CutPlan, nos: readonly number[], o: { perPieceM: number; godownId: string; ratePerM?: number; hsn?: string }): JobWorkLine & { mf: CmtTag } {
  const set = new Set(nos);
  const picked = (p.bundles ?? []).filter((b) => set.has(b.no));
  if (!picked.length) throw new Error('Pick the bundles to send.');
  const bad = picked.find((b) => b.at.where !== 'floor' || !livePieces(b));
  if (bad) throw new Error(`Bundle ${bundleId(p.number, bad.no)} is ${bad.at.where === 'floor' ? 'empty' : `at ${bad.at.where}`}.`);
  if (!(num(o.perPieceM) > 0)) throw new Error('Enter the fabric metres a piece.');
  const pieces = picked.reduce((s, b) => s + livePieces(b), 0);
  return {
    id: generateId(), item_id: p.fabric_item_id, qty: r3(pieces * num(o.perPieceM)), godown_id: o.godownId, goods_kind: 'input',
    ...(p.fabric_batch ? { batch_no: p.fabric_batch } : {}), ...(o.ratePerM ? { rate: num(o.ratePerM) } : {}), ...(o.hsn ? { hsn: o.hsn } : {}),
    mf: { lot: p.number, bundles: picked.map((b) => bundleId(p.number, b.no)), pieces },
  };
}

export interface BundleReceipt { no: number; good: number; rejected: number; reason?: string }

export interface CmtInDraft {
  consumed: JobWorkLine[];
  received: JobWorkReceiptLine[];
  /** Pieces neither returned stitched nor rejected, per bundle (stay pending at the fabricator). */
  short: { bundle: string; pieces: number }[];
  good: number;
  rejected: number;
  charges: number;
}

/**
 * The Material In of a CMT challan line received by bundle. `rate` = job charges a good piece; `into` = the godown the
 * stitched pieces go to (absent = Main). Refuses more pieces than a bundle carried.
 */
export function cmtInDraft(out: MaterialOut, lineId: string, p: CutPlan, parent: StockItem, items: readonly StockItem[], receipts: readonly BundleReceipt[], o: { rate?: number; into?: string } = {}): CmtInDraft {
  const line = out.lines.find((l) => l.id === lineId);
  const tag = cmtTag(line);
  if (!line || !tag?.pieces) throw new Error(`${out.number}: not a CMT line.`);
  const perPiece = (num(line.qty) * lineFactor(line)) / num(tag.pieces);
  const sent = new Set(tag.bundles ?? []);
  const bySize = new Map<string, number>();
  const short: CmtInDraft['short'] = [];
  let good = 0;
  let rejected = 0;
  for (const r of receipts) {
    const id = bundleId(p.number, r.no);
    const b = (p.bundles ?? []).find((x) => x.no === r.no);
    if (!b || !sent.has(id)) throw new Error(`Bundle ${id} was not sent on ${out.number}.`);
    const g = Math.max(Math.floor(num(r.good)), 0);
    const j = Math.max(Math.floor(num(r.rejected)), 0);
    if (g + j > livePieces(b)) throw new Error(`Bundle ${id} carried ${livePieces(b)} pieces.`);
    if (g + j < livePieces(b)) short.push({ bundle: id, pieces: livePieces(b) - g - j });
    good += g;
    rejected += j;
    if (g) bySize.set(b.size, (bySize.get(b.size) ?? 0) + g);
  }
  const got = new Set(receipts.map((r) => bundleId(p.number, r.no)));
  for (const b of p.bundles ?? []) {
    const id = bundleId(p.number, b.no);
    if (sent.has(id) && !got.has(id) && b.at.where === 'fabricator' && livePieces(b)) short.push({ bundle: id, pieces: livePieces(b) });
  }
  const received: JobWorkReceiptLine[] = [];
  for (const [size, q] of bySize) {
    const child = childFor(parent, items, size, p.colour);
    if (!child) throw new Error(`${parent.name}: no variant for ${size} / ${p.colour}.`);
    received.push({ id: generateId(), kind: 'processed', item_id: child.id, qty: q, ...(o.into ? { godown_id: o.into } : {}), mf: { lot: p.number, pieces: q } } as JobWorkReceiptLine);
  }
  if (rejected) received.push({ id: generateId(), kind: 'returned', item_id: line.item_id, qty: r3(rejected * perPiece), out_line_id: line.id, ...(line.godown_id ? { godown_id: line.godown_id } : {}), ...(line.batch_no ? { batch_no: line.batch_no } : {}) });
  const consumed: JobWorkLine[] = good ? [{ id: generateId(), item_id: line.item_id, qty: r3(good * perPiece), out_line_id: line.id, ...(line.batch_no ? { batch_no: line.batch_no } : {}) }] : [];
  return { consumed, received, short, good, rejected, charges: round2(good * Math.max(num(o.rate), 0)) };
}

/** Bundle ids of a CMT challan (all lines), parsed. */
export function challanBundles(out: Pick<MaterialOut, 'lines'>): { lot: string; no: number }[] {
  return out.lines.flatMap((l) => cmtTag(l)?.bundles ?? []).map(parseBundleId).filter((x): x is { lot: string; no: number } => !!x);
}

/** Good pieces stitched per Material In (its processed lines tagged with a lot). */
export const cmtPieces = (lines: readonly JobWorkReceiptLine[] | undefined): number => (lines ?? []).filter((l) => l.kind === 'processed' && cmtTag(l)?.lot).reduce((s, l) => s + num(l.qty) * lineFactor(l), 0);

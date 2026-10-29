/**
 * RT-E4 karigar (goldsmith job worker) metal account by FINE weight (table `karigar_moves`, `books.edit`, numbered
 * `KAR/FY…`, dated `date`, audited "Karigar issue / receipt"; a deleted number is never reused).
 *
 *   issue          metal leaves stock into the karigar's 'wip' godown (non-saleable)            + fine issued
 *   receipt        finished pieces come in (tags optional); the metal used = fine received + wastage allowed is
 *                  consumed from the wip godown; labour makes a draft purchase bill               − fine received − wastage
 *   return_metal   unused metal comes back from the wip godown                                    − fine returned
 *
 *   balance (g fine) = issued − received − wastage allowed − returned      fine = net × touch %
 *
 * Labour: SAC 9988 job work at 5% when the karigar is registered (GSTIN), nil and no RCM when not (RT20). ITC-04 / the
 * job-work challan stay opt-in through the existing job-work model; this ledger says "ITC-04 may apply". Metal with a
 * karigar stays in stock valuation (wip godown, RT21); QA10 R2: a receipt brings the pieces (or tags) in at the consumed
 * metal's average cost, split by fine weight (tags by net weight) — labour stays an expense through its bill. Working
 * paper — verify with your CA.
 */
import './rt-registry';
import type { KarigarLine, KarigarMove } from '../../types/retail-r9';
import type { Vendor } from '../../types/purchases';
import { num, round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { generateId, getTable, setTable } from '../storage';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { loadPositions, stockDb } from '../inventory';
import { godownsDb, MAIN_GODOWN_ID } from '../godowns';
import { draftsDb } from '../purchase-drafts';
import { RT_SERIES, RT_TABLES } from './rt-shared';
import { r3 } from './rt-jewel-rates';
import { addTags, loadTags, type TagInput } from './rt-jewel-tags';
import type { JewelTag } from '../../types/retail-r9';

export const KARIGAR_TABLE = RT_TABLES.karigarMoves;
const DAY = 86400000;

/* ── Pure ── */

/** A line with its fine weight (net defaults to gross; touch % defaults to 100). */
export function karigarLine(l: Omit<KarigarLine, 'fine_wt' | 'net_wt' | 'touch_pct'> & { net_wt?: number; touch_pct?: number }): KarigarLine {
  const net = r3(num(l.net_wt) > 0 ? num(l.net_wt) : num(l.gross_wt));
  const touch = num(l.touch_pct) > 0 ? Math.min(num(l.touch_pct), 100) : 100;
  return { ...l, gross_wt: r3(num(l.gross_wt) || net), net_wt: net, touch_pct: touch, fine_wt: r3((net * touch) / 100) };
}

export const fineSum = (lines: readonly KarigarLine[]): number => r3(lines.reduce((s, l) => s + num(l.fine_wt), 0));

/** Wastage allowed on a receipt: % of the fine weight received. */
export const wastageFine = (fine: number, pct: number): number => r3((num(fine) * Math.max(num(pct), 0)) / 100);

/** Labour: per gram of net weight received, or per piece. */
export function labourAmount(basis: 'per_gram' | 'per_piece', rate: number, lines: readonly KarigarLine[]): number {
  const q = basis === 'per_gram' ? lines.reduce((s, l) => s + num(l.net_wt), 0) : lines.reduce((s, l) => s + (num(l.pieces) || 1), 0);
  return round2(q * Math.max(num(rate), 0));
}

export interface KarigarBalance { karigar_id: string; name: string; issued: number; received: number; wastage: number; returned: number; balance: number; oldest?: string; days: number }

/** Per karigar fine-weight ledger; ageing = days since the oldest issue not yet covered (first in, first out). */
export function karigarLedger(moves: readonly KarigarMove[], today: string): KarigarBalance[] {
  const by = new Map<string, KarigarMove[]>();
  for (const m of moves) by.set(m.karigar_id, [...(by.get(m.karigar_id) ?? []), m]);
  return [...by.entries()].map(([id, list]) => {
    list.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
    const f = (k: KarigarMove['kind']) => r3(list.filter((m) => m.kind === k).reduce((s, m) => s + fineSum(m.lines), 0));
    const issued = f('issue'), received = f('receipt'), returned = f('return_metal');
    const wastage = r3(list.reduce((s, m) => s + num(m.wastage_fine), 0));
    let used = received + wastage + returned;
    let oldest: string | undefined;
    for (const m of list.filter((x) => x.kind === 'issue')) {
      const q = fineSum(m.lines);
      if (used >= q - 0.0005) used -= q;
      else { oldest = m.date; break; }
    }
    const balance = r3(issued - received - wastage - returned);
    const [y, mo, d] = (oldest ?? today).split('-').map(Number);
    const [ty, tm, td] = today.split('-').map(Number);
    const days = balance > 0.0005 && oldest ? Math.round((Date.UTC(ty, tm - 1, td) - Date.UTC(y, mo - 1, d)) / DAY) : 0;
    return { karigar_id: id, name: list[list.length - 1].karigar_name, issued, received, wastage, returned, balance, oldest: balance > 0.0005 ? oldest : undefined, days };
  }).sort((a, b) => b.balance - a.balance);
}

export const nextKarigarNumber = (date: string, moves: readonly Pick<KarigarMove, 'number'>[]): string => nextSeriesNumberFor(RT_SERIES.karigar, date, moves.map((m) => m.number));

/* ── Storage ── */

export const loadKarigarMoves = (): KarigarMove[] => getTable<KarigarMove>(KARIGAR_TABLE).filter((m) => m && typeof m.id === 'string');

/** The karigar's wip godown (created once; non-saleable). */
export function karigarGodown(k: Pick<Vendor, 'id' | 'name'>): string {
  return (godownsDb.list().find((g) => g.kind === 'wip' && g.vendor_id === k.id) ?? godownsDb.save({ name: `Karigar: ${k.name}`, kind: 'wip', job_worker: true, vendor_id: k.id })).id;
}

function move(itemId: string, date: string, qty: number, godown: string, note: string, rate = 0): string {
  const id = generateId();
  stockDb.addMove({ id, item_id: itemId, date, qty: r3(qty), rate: rate > 0 ? Number(rate.toFixed(6)) : 0, kind: 'adjustment', godown_id: godown, note });
  return id;
}

/** Average cost per unit of an item now (the stock engine's position), 0 when unknown. */
function unitCost(itemId: string | undefined): number {
  if (!itemId) return 0;
  const p = loadPositions().find((x) => x.item.id === itemId);
  return p && p.qty > 0 ? p.value / p.qty : num(p?.avgCost);
}

/**
 * QA10 R2: the cost a receipt carries into the finished pieces — the consumed metal (fine received + wastage, in the
 * issued item's grams) at its average cost — split over the lines by fine weight. Labour is not added: it stays an
 * expense through its bill. Pure given the unit cost.
 */
export function receiptCost(lines: readonly KarigarLine[], consumedQty: number, metalUnitCost: number): number[] {
  const total = Math.max(num(consumedQty), 0) * Math.max(num(metalUnitCost), 0);
  const fine = fineSum(lines);
  return lines.map((l) => (fine > 0 ? round2((total * num(l.fine_wt)) / fine) : 0));
}

export interface KarigarInput {
  date: string;
  karigar: Pick<Vendor, 'id' | 'name' | 'gstin'>;
  kind: KarigarMove['kind'];
  lines: KarigarLine[];
  /** Receipt: wastage allowed % of the fine received, labour, the issued metal item consumed, and new tags. */
  wastage_pct?: number;
  labour?: { basis: 'per_gram' | 'per_piece'; rate: number };
  consume_item_id?: string;
  tags?: TagInput[];
  note?: string;
}

/** Record an issue / receipt / metal return with its stock moves (and tags, labour bill draft on a receipt). */
export function recordKarigar(input: KarigarInput): KarigarMove {
  requireAccess('books.edit');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('Choose the date.');
  const lines = input.lines.filter((l) => l.net_wt > 0 || l.gross_wt > 0);
  if (!lines.length) throw new Error('Add at least one line with a weight.');
  const all = loadKarigarMoves();
  const number = nextKarigarNumber(input.date, all);
  assertUnlocked({ issue_date: input.date, invoice_number: number }, 'create');
  const wip = karigarGodown(input.karigar);
  const ids: string[] = [];
  const tag = `${number} ${input.karigar.name}`;
  const fine = fineSum(lines);
  const wastage = input.kind === 'receipt' ? wastageFine(fine, num(input.wastage_pct)) : 0;
  let tagCost: ((t: JewelTag) => number) | undefined;
  if (input.kind === 'issue' || input.kind === 'return_metal') {
    const [from, to] = input.kind === 'issue' ? [MAIN_GODOWN_ID, wip] : [wip, MAIN_GODOWN_ID];
    for (const l of lines) if (l.item_id) ids.push(move(l.item_id, input.date, -l.net_wt, from, tag), move(l.item_id, input.date, l.net_wt, to, tag));
  } else {
    // Metal used = fine received + wastage, in the issued item's own grams (its issue touch).
    const issueLine = all.filter((m) => m.karigar_id === input.karigar.id && m.kind === 'issue').flatMap((m) => m.lines).reverse().find((l) => l.item_id === input.consume_item_id);
    const used = ((fine + wastage) * 100) / (issueLine?.touch_pct || 100);
    // QA10 R2: the pieces come in at the consumed metal's cost (closing stock keeps the metal's value).
    const cost = input.consume_item_id ? receiptCost(lines, used, unitCost(input.consume_item_id)) : lines.map(() => 0);
    if (input.consume_item_id) ids.push(move(input.consume_item_id, input.date, -used, wip, tag));
    lines.forEach((l, k) => {
      if (!l.item_id || input.tags?.length) return;
      const unit = stockDb.items().find((i) => i.id === l.item_id)?.unit.toUpperCase();
      const qty = unit === 'GMS' || unit === 'GM' || unit === 'G' ? l.net_wt : num(l.pieces) || 1;
      ids.push(move(l.item_id, input.date, qty, MAIN_GODOWN_ID, tag, qty > 0 ? cost[k] / qty : 0));
    });
    if (input.tags?.length) {
      // Tags share the receipt's metal cost by net weight.
      const total = cost.reduce((s, c) => s + c, 0);
      const net = input.tags.reduce((s, t) => s + Math.max(num(t.gross_wt) - num(t.stone_wt), 0), 0);
      tagCost = (t) => (net > 0 ? (total * num(t.net_wt)) / net : 0);
    }
  }
  const made = input.kind === 'receipt' && input.tags?.length ? addTags(input.tags, { date: input.date, toStock: true, cost: tagCost }) : [];
  const lab = input.kind === 'receipt' && input.labour && num(input.labour.rate) > 0 ? { ...input.labour, amount: labourAmount(input.labour.basis, input.labour.rate, lines) } : undefined;
  let draftId: string | undefined;
  if (lab) {
    const reg = !!input.karigar.gstin?.trim();
    const gst = reg ? round2(lab.amount * 0.05) : 0;
    const half = round2(gst / 2);
    draftId = draftsDb.save({
      kind: 'EXPENSE', vendor_id: input.karigar.id, vendor_name: input.karigar.name, bill_number: number, date: input.date, category: 'Karigar labour (job work)',
      lines: [{ id: generateId(), name: `Labour: ${number}`, quantity: 1, rate: lab.amount, tax_rate: reg ? 5 : 0, unit: 'NOS', hsn: '9988' }],
      taxable: lab.amount, cgst: half, sgst: round2(gst - half), igst: 0, total: round2(lab.amount + gst), amount_paid: 0, itc_eligible: reg,
      notes: `Karigar labour, SAC 9988 job work: ${reg ? '5% (registered karigar)' : 'no GST, no RCM (unregistered karigar)'}. Verify with your CA (RT20).`,
      draft: { source: 'manual', created_at: new Date().toISOString() },
    }).id;
  }
  const row: KarigarMove = {
    id: generateId(), number, date: input.date, karigar_id: input.karigar.id, karigar_name: input.karigar.name, kind: input.kind, lines, created_at: new Date().toISOString(),
    ...(wastage ? { wastage_pct: num(input.wastage_pct), wastage_fine: wastage } : {}), ...(lab ? { labour: lab } : {}), ...(draftId ? { bill_draft_id: draftId } : {}),
    ...(ids.length ? { move_ids: ids } : {}), ...(made.length ? { tags: made.map((t) => t.tag) } : {}), ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  };
  setTable(KARIGAR_TABLE, [...all, row]);
  recordSeries(number);
  return row;
}

/** Delete a move, its stock moves and its unposted labour draft (to the recycle bin; the number stays used). Tags made on it must go first. */
export function deleteKarigarMove(id: string): void {
  requireAccess('books.edit');
  const all = loadKarigarMoves();
  const m = all.find((x) => x.id === id);
  if (!m) return;
  if (m.tags?.length && loadTags().some((t) => m.tags!.includes(t.tag))) throw new Error(`Tags ${m.tags.join(', ')} came in on ${m.number}; delete them on the Tags view first.`);
  assertUnlocked({ id, issue_date: m.date, invoice_number: m.number }, 'delete');
  for (const mv of m.move_ids ?? []) stockDb.deleteMove(mv);
  if (m.bill_draft_id && draftsDb.all().some((d) => d.id === m.bill_draft_id)) draftsDb.remove(m.bill_draft_id); // a labour bill not yet posted goes too
  setTable(KARIGAR_TABLE, all.filter((x) => x.id !== id));
}

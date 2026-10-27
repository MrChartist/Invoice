/**
 * CN-A4: the abstract of cost inside the document. The abstract is SNAPSHOTTED on the RA bill at save
 * (`boq_terms.cn.abstract`), so a bill always prints as certified — a later bill, or a cancelled earlier one, never
 * changes it (Critical Rule 3 spirit). `ra-abstract.ts` `abstractRows` stays the live calculator of the register screen.
 *
 * Sections: A. BOQ items, B. extra items, C. substituted items, D. deviation quantities (beyond the deviation limit,
 * default 25% per item — contract term). The "this bill" column of every section sums to the bill's line value.
 * Pure. Working paper — verify with your CA.
 */
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { MeasurementLine } from '../../types/transport-works-r5';
import type { CnAbstractRow, CnLine, CnLineKind } from '../../types/construction-r11';
import { num, round2 } from '../invoice-calc';
import { lineValue, roundQty, stageInvoices } from '../progress-billing';
import { boqLines } from '../works/boq';

const EPS = 1e-6;

export const SECTION_ORDER: readonly CnLineKind[] = ['boq', 'extra', 'substituted', 'deviation'];
export const SECTION_TITLE: Readonly<Record<CnLineKind, string>> = {
  boq: 'A. BOQ items',
  extra: 'B. Extra items',
  substituted: 'C. Substituted items',
  deviation: 'D. Deviation quantities (beyond the deviation limit)',
};

/** The class of a bill line: its snapshot, else the R5 id suffix (`-x` excess = extra, `-d` = deviation), else BOQ. */
export function itemKind(it: Pick<InvoiceItem, 'id'>, cnLines?: Readonly<Record<string, CnLine>>): CnLineKind {
  const k = cnLines?.[it.id]?.kind;
  if (k) return k;
  if (it.id.endsWith('-d')) return 'deviation';
  if (it.id.endsWith('-x')) return 'extra';
  return 'boq';
}

/**
 * This bill's quantity split at the deviation limit: `deviation` = the part of this bill beyond BOQ × (1 + pct %),
 * `within` = the rest. Cumulative quantities in, so a limit crossed on an earlier bill is not counted twice.
 */
export function deviationSplit(boqQty: number, prevQty: number, cumQty: number, pct: number): { within: number; deviation: number; limit: number } {
  const limit = roundQty(num(boqQty) * (1 + Math.max(num(pct), 0) / 100));
  const thisQty = roundQty(num(cumQty) - num(prevQty));
  const deviation = roundQty(Math.max(num(cumQty) - limit, 0) - Math.max(num(prevQty) - limit, 0));
  return { within: roundQty(thisQty - deviation), deviation, limit };
}

export interface DeviationWarning {
  line_id: string;
  name: string;
  cumulative: number;
  limit: number;
  pct: number;
}

/** Lines whose cumulative quantity passes the deviation limit (a warning, never a block). */
export function deviationWarnings(boq: Pick<InvoiceRecord, 'items'>, lines: readonly Pick<MeasurementLine, 'line_id' | 'cumulative_qty'>[], pct: number): DeviationWarning[] {
  const out: DeviationWarning[] = [];
  for (const m of lines) {
    const l = boqLines(boq).find((x) => x.id === m.line_id);
    if (!l || !(num(l.quantity) > 0)) continue;
    const limit = roundQty(num(l.quantity) * (1 + pct / 100));
    if (num(m.cumulative_qty) > limit + EPS) out.push({ line_id: l.id, name: l.name, cumulative: num(m.cumulative_qty), limit, pct });
  }
  return out;
}

export const deviationWarningText = (w: DeviationWarning): string =>
  `"${w.name}": cumulative ${w.cumulative} is beyond the deviation limit ${w.limit} (BOQ + ${w.pct}%) — the excess is billed as a deviation item; keep the approval on record.`;

/**
 * Split the deviation part out of each excess ("Extra item") line of a stage bill: the quantity beyond the limit
 * becomes its own `-d` line "Deviation — …" at the same rate (rate per clause of agreement). Lines within the limit
 * are unchanged, so R5 bills keep their items exactly.
 */
export function splitDeviation(items: readonly InvoiceItem[], boq: Pick<InvoiceRecord, 'items'>, previous: ReadonlyMap<string, number>, lines: readonly MeasurementLine[], pct: number): InvoiceItem[] {
  const out: InvoiceItem[] = [];
  for (const it of items) {
    if (!it.id.endsWith('-x')) {
      out.push(it);
      continue;
    }
    const src = boqLines(boq).find((l) => l.id === it.progress_line_of);
    const m = lines.find((l) => l.line_id === it.progress_line_of);
    const dev = src && m ? deviationSplit(num(src.quantity), previous.get(src.id) ?? 0, m.cumulative_qty, pct).deviation : 0;
    const devQty = roundQty(Math.min(dev, num(it.quantity)));
    if (!(devQty > EPS)) {
      out.push(it);
      continue;
    }
    const rest = roundQty(num(it.quantity) - devQty);
    if (rest > EPS) out.push({ ...it, quantity: rest, amount: round2(rest * num(it.rate)) });
    out.push({ ...it, id: `${it.id.slice(0, -2)}-d`, name: `Deviation — ${src?.name ?? it.name}`, description: 'Quantity beyond the deviation limit — rate per clause of agreement', quantity: devQty, amount: round2(devQty * num(it.rate)) });
  }
  return out;
}

type Doc = Pick<InvoiceRecord, 'id' | 'items' | 'progress_of' | 'boq_terms' | 'doc_type' | 'status' | 'issue_date'>;

/** Earlier live stage bills of the BOQ (what "up to previous" is made of). */
export function earlierStages<T extends Doc>(boqId: string, bill: Pick<InvoiceRecord, 'id' | 'progress_of'>, invoices: readonly T[]): T[] {
  const mine = num(bill.progress_of?.stage);
  return stageInvoices(boqId, invoices as unknown as InvoiceRecord[]).filter((s) => s.id !== bill.id && num(s.progress_of?.stage) < mine) as unknown as T[];
}

/**
 * Pure: the abstract snapshot of `bill` (its own `cnLines` give the classes of its lines; earlier bills' classes come
 * from their snapshots, else the R5 id suffix). A BOQ line marked substituted on any bill moves to section C with all
 * its earlier quantities ("substituted item replaces its BOQ line in the previous maths").
 */
export function buildAbstract(boq: InvoiceRecord, bill: Pick<InvoiceRecord, 'id' | 'items' | 'progress_of'>, earlier: readonly Doc[], cnLines: Readonly<Record<string, CnLine>> = {}): CnAbstractRow[] {
  const docs: { lines: Readonly<Record<string, CnLine>> | undefined; items: readonly InvoiceItem[]; current: boolean }[] = [
    ...earlier.map((d) => ({ lines: d.boq_terms?.cn?.lines, items: d.items ?? [], current: false })),
    { lines: cnLines, items: bill.items ?? [], current: true },
  ];
  const substituted = new Set<string>();
  for (const d of docs) for (const it of d.items) if (it.progress_line_of && itemKind(it, d.lines) === 'substituted') substituted.add(it.progress_line_of);
  type Acc = { prevQty: number; prevAmount: number; thisQty: number; thisAmount: number; rate: number; name: string; mb: string[]; approval: string };
  const acc = new Map<string, Acc>();
  for (const d of docs) for (const it of d.items) {
    const lineId = it.progress_line_of;
    if (!lineId) continue;
    let k = itemKind(it, d.lines);
    if (k === 'boq' && substituted.has(lineId)) k = 'substituted';
    const key = `${k}|${lineId}`;
    const a = acc.get(key) ?? { prevQty: 0, prevAmount: 0, thisQty: 0, thisAmount: 0, rate: num(it.rate), name: it.name, mb: [], approval: '' };
    const v = lineValue(it);
    if (d.current) {
      a.thisQty = roundQty(a.thisQty + num(it.quantity));
      a.thisAmount = round2(a.thisAmount + v);
      a.rate = num(it.rate);
      a.name = it.name;
      const snap = d.lines?.[it.id];
      if (snap?.mb && !a.mb.includes(snap.mb)) a.mb.push(snap.mb);
      if (snap?.approval) a.approval = snap.approval;
    } else {
      a.prevQty = roundQty(a.prevQty + num(it.quantity));
      a.prevAmount = round2(a.prevAmount + v);
    }
    acc.set(key, a);
  }
  const rows: CnAbstractRow[] = [];
  for (const kind of SECTION_ORDER) {
    for (const l of boqLines(boq)) {
      const a = acc.get(`${kind}|${l.id}`);
      if (!a && kind !== 'boq') continue;
      if (kind === 'boq' && substituted.has(l.id) && !a) continue;
      const x = a ?? { prevQty: 0, prevAmount: 0, thisQty: 0, thisAmount: 0, rate: num(l.rate), name: l.name, mb: [], approval: '' };
      const cumQty = roundQty(x.prevQty + x.thisQty);
      const boqRow = kind === 'boq' || kind === 'substituted';
      rows.push({
        id: kind === 'boq' ? l.id : `${l.id}:${kind}`, kind, ref: l.boq_ref ?? '',
        description: boqRow ? (kind === 'substituted' ? `${l.name} (substituted)` : l.name) : x.name,
        unit: l.unit ?? '', boq_qty: kind === 'extra' ? 0 : num(l.quantity), rate: boqRow ? num(l.rate) : x.rate,
        prev_qty: x.prevQty, prev_amount: x.prevAmount, this_qty: x.thisQty, this_amount: x.thisAmount, cum_qty: cumQty, cum_amount: round2(x.prevAmount + x.thisAmount),
        pct: boqRow && num(l.quantity) > 0 ? round2((cumQty / num(l.quantity)) * 100) : 0,
        ...(x.mb.length ? { mb: x.mb.join(', ') } : {}),
        ...(x.approval ? { approval: x.approval } : {}),
      });
    }
  }
  return rows;
}

export interface AbstractSection {
  kind: CnLineKind;
  title: string;
  rows: CnAbstractRow[];
  prev: number;
  this: number;
  cum: number;
}

/** Rows grouped into sections A–D with sub-totals (empty sections dropped). */
export function abstractSections(rows: readonly CnAbstractRow[]): AbstractSection[] {
  return SECTION_ORDER.map((kind) => {
    const r = rows.filter((x) => x.kind === kind);
    return { kind, title: SECTION_TITLE[kind], rows: r, prev: round2(r.reduce((s, x) => s + x.prev_amount, 0)), this: round2(r.reduce((s, x) => s + x.this_amount, 0)), cum: round2(r.reduce((s, x) => s + x.cum_amount, 0)) };
  }).filter((s) => s.rows.length > 0);
}

/** Grand totals of the abstract. */
export function abstractGrand(rows: readonly CnAbstractRow[]): { prev: number; this: number; cum: number } {
  return rows.reduce((s, r) => ({ prev: round2(s.prev + r.prev_amount), this: round2(s.this + r.this_amount), cum: round2(s.cum + r.cum_amount) }), { prev: 0, this: 0, cum: 0 });
}

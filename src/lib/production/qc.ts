/**
 * QC hold and release (R4-A4). A godown of kind 'qc' is non-saleable (the existing sale guard refuses it, like an
 * expiry godown). Receipts default to it when the item is marked `qc_on_receipt` or "Hold every receipt for QC" is on
 * (key `qc_settings`); a production order can send its output there too.
 *
 * The QC desk lists what sits in QC godowns by item / batch / source document with its age (FIFO lots built from the
 * engine's events), and each decision is a `qc_results` row:
 *  - Release → a normal stock transfer (STR) from the QC godown to the target godown;
 *  - Reject  → from a GRN: Rejections Out pre-filled from that GRN; from a bill: a debit note; from production: a
 *              consume-only Stock Journal (scrap) or a re-work note.
 *
 * Pure above the "Storage" divider (tests/qc-hold.test.ts).
 */
import type { StockEvent, StockItem } from '../inventory';
import type { Godown } from '../../types/stock';
import type { QcResult, QcSettings, QcSourceKind } from '../../types/production-r4';
import { DB_PREFIX, generateId, getJson, peekTable, setJson, setTable } from '../storage';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { audit } from '../audit';
import { godownsDb } from '../godowns';

export const QC_RESULTS_TABLE = 'qc_results';
export const QC_SETTINGS_KEY = `${DB_PREFIX}qc_settings`;
export const QC_GODOWN_NAME = 'QC hold';
export const DEFAULT_QC_ALERT_DAYS = 3;

const EPS = 1e-6;
const rq = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000 || 0;

export const qcGodowns = (list: readonly Godown[]): Godown[] => list.filter((g) => g.kind === 'qc');

/** Does a receipt of `item` default to the QC godown? */
export function holdsForQc(item: Pick<StockItem, 'qc_on_receipt' | 'track_stock'> | undefined, settings: Pick<QcSettings, 'hold_all'>): boolean {
  return !!item?.track_stock && (!!settings.hold_all || !!item.qc_on_receipt);
}

/**
 * Receipt lines with the QC godown filled in where the line names no godown and the item is held for QC. Lines that
 * already name a godown are left alone (the user's choice wins). Pure.
 */
export function withQcGodown<L extends { godown_id?: string; item_id?: string; name?: string }>(
  lines: readonly L[], qcGodownId: string | undefined, itemOf: (l: L) => StockItem | undefined, settings: Pick<QcSettings, 'hold_all'>,
): L[] {
  if (!qcGodownId) return [...lines];
  return lines.map((l) => (!l.godown_id && holdsForQc(itemOf(l), settings) ? { ...l, godown_id: qcGodownId } : l));
}

/* ── QC desk ──────────────────────────────────────────────────── */

export interface QcRow {
  key: string;
  itemId: string;
  batch: string;
  godownId: string;
  source: { kind: QcSourceKind; id?: string; number?: string; party?: string };
  /** Day the goods came into QC. */
  since: string;
  qty: number;
  serials?: string[];
  ageDays: number;
}

const sourceKindOf = (refType: string | undefined): QcSourceKind =>
  refType === 'grn' ? 'grn' : refType === 'purchase' ? 'purchase' : refType === 'manufacturing' ? 'manufacturing' : refType === 'transfer' ? 'transfer' : 'other';

const dayNo = (d: string) => {
  const [y, m, dd] = d.split('-').map(Number);
  return Date.UTC(y, (m || 1) - 1, dd || 1) / 86_400_000;
};

/**
 * Stock sitting in QC godowns, one row per lot (item × batch × source document), oldest first. Lots are filled by
 * every movement into a QC godown and emptied first-in-first-out by every movement out of it. Pure over the engine's
 * events (`collectEvents` with transfers).
 */
export function qcStock(events: ReadonlyMap<string, readonly StockEvent[]>, qcIds: ReadonlySet<string>, today: string): QcRow[] {
  const out: QcRow[] = [];
  if (!qcIds.size) return out;
  for (const [itemId, list] of events) {
    const lots = new Map<string, QcRow[]>();
    for (const e of list) {
      if (!qcIds.has(e.godown)) continue;
      const k = `${e.godown}|${(e.batch ?? '').trim().toUpperCase()}`;
      const q = lots.get(k) ?? [];
      lots.set(k, q);
      if (e.qty > 0) {
        q.push({
          key: `${itemId}|${k}|${e.refId ?? ''}|${q.length}`, itemId, batch: (e.batch ?? '').trim(), godownId: e.godown,
          source: { kind: sourceKindOf(e.refType), ...(e.refId ? { id: e.refId } : {}), ...(e.refNumber ? { number: e.refNumber } : {}), ...(e.party ? { party: e.party } : {}) },
          since: e.date, qty: rq(e.qty), ...(e.serials?.length ? { serials: [...e.serials] } : {}), ageDays: 0,
        });
      } else {
        let rest = -e.qty;
        const gone = new Set((e.serials ?? []).map((s) => s.trim().toUpperCase()));
        for (const lot of q) {
          if (rest <= EPS) break;
          const take = Math.min(rest, lot.qty);
          lot.qty = rq(lot.qty - take);
          rest -= take;
          if (lot.serials && gone.size) lot.serials = lot.serials.filter((s) => !gone.has(s.trim().toUpperCase()));
        }
      }
    }
    for (const q of lots.values()) for (const lot of q) if (lot.qty > EPS) out.push({ ...lot, ageDays: Math.max(0, Math.round(dayNo(today) - dayNo(lot.since))) });
  }
  return out.sort((a, b) => a.since.localeCompare(b.since) || a.itemId.localeCompare(b.itemId));
}

/** Rows older than `days` (the bell). */
export const agedQc = (rows: readonly QcRow[], days: number): QcRow[] => rows.filter((r) => r.ageDays > days);

/** Transfer lines releasing `qty` of a QC row (batch and serials kept). */
export function releaseLines(row: QcRow, qty: number, newId: () => string = generateId): { id: string; item_id: string; qty: number; batch_no?: string; serials?: string[] }[] {
  const q = rq(Math.min(Math.max(qty, 0), row.qty));
  if (!(q > EPS)) return [];
  return [{ id: newId(), item_id: row.itemId, qty: q, ...(row.batch ? { batch_no: row.batch } : {}), ...(row.serials?.length ? { serials: row.serials.slice(0, Math.round(q)) } : {}) }];
}

/**
 * Rejections Out lines for a QC row from a GRN: the GRN's still-rejectable lines (`rejectionLinesFromGrn`) cut down to
 * the item, batch and quantity rejected here.
 */
export function rejectionFromQc<L extends { item_id?: string; name: string; batch_no?: string; quantity: number; unit_factor?: number; godown_id?: string }>(
  lines: readonly L[], row: QcRow, qty: number, itemName: string,
): L[] {
  let rest = rq(Math.min(Math.max(qty, 0), row.qty));
  const out: L[] = [];
  for (const l of lines) {
    if (rest <= EPS) break;
    const same = l.item_id ? l.item_id === row.itemId : l.name.trim().toLowerCase() === itemName.trim().toLowerCase();
    if (!same || (row.batch && (l.batch_no ?? '').trim().toUpperCase() !== row.batch.toUpperCase())) continue;
    const f = Number(l.unit_factor) > 0 ? Number(l.unit_factor) : 1;
    const take = rq(Math.min(rest / f, l.quantity));
    if (!(take > EPS)) continue;
    out.push({ ...l, quantity: take, godown_id: row.godownId });
    rest = rq(rest - take * f);
  }
  return out;
}

/** QC bell rows (id stable per lot while it stays). */
export function qcNotices(rows: readonly QcRow[], days: number, nameOf: (id: string) => string, at: string): { id: string; severity: 'warning'; title: string; detail: string; href: string; cta: string; at: string }[] {
  const aged = agedQc(rows, days);
  if (!aged.length) return [];
  const sample = aged.slice(0, 3).map((r) => `${nameOf(r.itemId)}${r.batch ? ` (${r.batch})` : ''} — ${r.ageDays} days`).join('; ');
  return [{ id: `qc-aged:${aged[0].key}:${aged.length}`, severity: 'warning', title: `${aged.length} lot${aged.length === 1 ? '' : 's'} waiting in QC for more than ${days} days`, detail: sample, href: '/manufacturing?tab=qc', cta: 'Open QC desk', at }];
}

/* ================================================================
   Storage
   ================================================================ */

/** The QC hold godown (kind 'qc'), created the first time it is needed. */
export function ensureQcGodown(): Godown {
  const found = qcGodowns(godownsDb.list())[0];
  if (found) return found;
  const taken = godownsDb.list().some((g) => g.name.trim().toLowerCase() === QC_GODOWN_NAME.toLowerCase());
  return godownsDb.save({ name: taken ? `${QC_GODOWN_NAME} 2` : QC_GODOWN_NAME, kind: 'qc' });
}

/** Default-godown hook for receipts (GRN); lives in receipt-notes.ts so the purchases screens do not load this module. */
export { applyQcHold } from '../receipt-notes';

export function loadQcSettings(): QcSettings {
  const s = getJson<Partial<QcSettings>>(QC_SETTINGS_KEY, {});
  const days = Number(s.alert_days);
  return { hold_all: !!s.hold_all, alert_days: Number.isFinite(days) && days > 0 ? Math.min(Math.round(days), 365) : DEFAULT_QC_ALERT_DAYS };
}

/** QC settings change how receipts are put away: a settings change (owner), audited. */
export function saveQcSettings(s: QcSettings): void {
  requireAccess('settings.manage');
  setJson(QC_SETTINGS_KEY, { hold_all: !!s.hold_all, alert_days: Math.max(1, Math.round(Number(s.alert_days) || DEFAULT_QC_ALERT_DAYS)) });
  try {
    audit.record({ entity: 'settings', entity_id: 'qc_settings', action: 'update', summary: `QC settings: ${s.hold_all ? 'every receipt held for QC' : 'only items marked for QC held'}, alert after ${s.alert_days} days` });
  } catch {
    /* logging never breaks a save */
  }
}

export const qcResultsDb = {
  all: (): QcResult[] => peekTable<QcResult>(QC_RESULTS_TABLE).filter((r) => r && typeof r.id === 'string'),
  /** Record a decision (books.edit, period lock on its date, audited). */
  save(input: Omit<QcResult, 'id' | 'created_at'> & { id?: string }): QcResult {
    requireAccess('books.edit');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new Error('Choose the date of the check.');
    if (!(Number(input.qty) > 0)) throw new Error('The quantity must be above zero.');
    const id = input.id || generateId();
    const state = assertUnlocked({ id, issue_date: input.date }, 'create');
    const row: QcResult = { ...input, id, qty: rq(Number(input.qty)), created_at: new Date().toISOString() };
    const rows = qcResultsDb.all();
    setTable(QC_RESULTS_TABLE, rows.some((r) => r.id === id) ? rows.map((r) => (r.id === id ? row : r)) : [...rows, row]);
    try {
      audit.record({ entity: 'manufacturing', entity_id: id, action: 'create', doc_number: input.source.number, summary: `QC ${input.result === 'pass' ? 'passed' : 'failed'}: ${row.qty} unit(s)${input.batch_no ? ` of batch ${input.batch_no}` : ''}${input.note ? ` — ${input.note}` : ''}${state === 'overridden' ? ' (period lock overridden)' : ''}` });
    } catch {
      /* logging never breaks a save */
    }
    return row;
  },
};

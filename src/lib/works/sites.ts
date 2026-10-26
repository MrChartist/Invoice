/**
 * R5-B6: works sites — material at site and site cost.
 *  - "Add site" on a BOQ creates a godown of kind `site` (non-saleable, `nonSaleableGodowns`) linked to the BOQ and its
 *    project cost centre. Material sent = an ordinary stock transfer to the site godown (no engine change).
 *  - "Book consumption" saves a consume-only stock journal (`SJ/FY…`) from the site godown, tagged with the project
 *    cost centre (`StockJournal.cost_centre_id`), valued by the stock engine.
 *  - Theoretical consumption: coefficients per BOQ line in their own table (`boq_coefficients`), × measured quantity
 *    of the period's RA measurements. Statement: issued, consumed, theoretical, variance %, closing at site; CSV.
 *  - Site cost: consumed stock value per cost centre (`siteCostByCentre`) — the Project P&L shows it as a memo row.
 * Alternate units: transfer / journal lines convert with `lineFactor`. Pure helpers + guarded writers.
 */
import type { Godown, StockTransfer } from '../../types/stock';
import type { StockJournal } from '../../types/manufacturing';
import type { BoqCoefficient, RaMeasurement } from '../../types/transport-works-r5';
import type { StockComputation, StockItem } from '../inventory';
import { num, round2 } from '../invoice-calc';
import { lineFactor } from '../units';
import { requireAccess } from '../access';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { withTablesRollback } from '../table-txn';
import { GODOWNS_TABLE, godownsDb } from '../godowns';
import { saveConsumeOnlyJournal } from '../manufacturing';

export const COEFF_TABLE = 'boq_coefficients';

export function siteGodowns(godowns: readonly Godown[], boqId?: string): Godown[] {
  return godowns.filter((g) => g.kind === 'site' && (!boqId || g.boq_id === boqId));
}

/** Create the site godown of a BOQ (kind `site`, linked to the BOQ and its project cost centre). */
export function addSite(boqId: string, name: string, costCentreId?: string): Godown {
  requireAccess('master.edit');
  return withTablesRollback([GODOWNS_TABLE], () => {
    const g = godownsDb.save({ name, kind: 'site' });
    const row: Godown = { ...g, boq_id: boqId, ...(costCentreId ? { cost_centre_id: costCentreId } : {}) };
    setTable(GODOWNS_TABLE, getTable<Godown>(GODOWNS_TABLE).map((x) => (x.id === g.id ? row : x)));
    return row;
  });
}

export interface ConsumptionLine {
  item_id: string;
  qty: number;
  unit?: string;
  unit_factor?: number;
}

/** Consume-only stock journal from the site godown, tagged with the project cost centre (role, lock, series, audit). */
export function bookConsumption(site: Godown, c: { date: string; lines: readonly ConsumptionLine[]; narration?: string }, items: readonly StockItem[]): StockJournal {
  if (site.kind !== 'site') throw new Error('Choose a site godown.');
  return saveConsumeOnlyJournal({
    date: c.date,
    consume: c.lines.filter((l) => l.item_id && num(l.qty) > 0).map((l) => ({ id: generateId(), item_id: l.item_id, qty: num(l.qty), godown_id: site.id, ...(l.unit && num(l.unit_factor) > 0 ? { unit: l.unit, unit_factor: num(l.unit_factor) } : {}) })),
    narration: c.narration?.trim() || `Consumption at site ${site.name}`,
    ...(site.cost_centre_id ? { cost_centre_id: site.cost_centre_id } : {}),
  }, items);
}

/* ── Coefficients ─────────────────────────────────────────────── */

export function loadCoefficients(boqId?: string): readonly BoqCoefficient[] {
  const rows = peekTable<BoqCoefficient>(COEFF_TABLE).filter((r) => r && typeof r.id === 'string');
  return boqId ? rows.filter((r) => r.boq_id === boqId) : rows;
}

/** Replace the coefficients of a BOQ (rows with no item or a zero coefficient are dropped). */
export function saveCoefficients(boqId: string, rows: readonly Omit<BoqCoefficient, 'id' | 'boq_id'>[]): BoqCoefficient[] {
  requireAccess('master.edit');
  const keep = getTable<BoqCoefficient>(COEFF_TABLE).filter((r) => r.boq_id !== boqId);
  const mine = rows.filter((r) => r.line_id && r.item_id && num(r.qty_per_unit) > 0).map((r) => ({ id: generateId(), boq_id: boqId, line_id: r.line_id, item_id: r.item_id, qty_per_unit: num(r.qty_per_unit) }));
  setTable(COEFF_TABLE, [...keep, ...mine]);
  return mine;
}

/* ── Statement ────────────────────────────────────────────────── */

export interface SiteRow {
  itemId: string;
  issued: number;
  consumed: number;
  theoretical: number;
  /** (consumed − theoretical) ÷ theoretical, % (null without a theoretical figure). */
  variancePct: number | null;
  closing: number;
}

export interface SiteInput {
  site: Godown;
  period: { start: string; end: string };
  transfers: readonly StockTransfer[];
  journals: readonly StockJournal[];
  measurements: readonly RaMeasurement[];
  coefficients: readonly BoqCoefficient[];
}

/** Pure: the site statement for a period (quantities in base units). */
export function siteStatement(i: SiteInput): SiteRow[] {
  const rows = new Map<string, SiteRow>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) rows.set(id, (r = { itemId: id, issued: 0, consumed: 0, theoretical: 0, variancePct: null, closing: 0 }));
    return r;
  };
  const inPeriod = (d: string) => d >= i.period.start && d <= i.period.end;
  const upToEnd = (d: string) => d <= i.period.end;
  for (const t of i.transfers) {
    if (!upToEnd(t.date)) continue;
    const sign = t.to_godown === i.site.id ? 1 : t.from_godown === i.site.id ? -1 : 0;
    if (!sign) continue;
    for (const l of t.lines) {
      const q = num(l.qty) * lineFactor(l);
      const r = row(l.item_id);
      r.closing = round2(r.closing + sign * q);
      if (inPeriod(t.date)) r.issued = round2(r.issued + sign * q);
    }
  }
  for (const j of i.journals) {
    if (!upToEnd(j.date)) continue;
    for (const l of j.consume) {
      if (l.godown_id !== i.site.id) continue;
      const q = num(l.qty) * lineFactor(l);
      const r = row(l.item_id);
      r.closing = round2(r.closing - q);
      if (inPeriod(j.date)) r.consumed = round2(r.consumed + q);
    }
  }
  const boqId = i.site.boq_id;
  for (const m of i.measurements) {
    if (m.boq_id !== boqId || m.status === 'cancelled' || !inPeriod(m.date)) continue;
    for (const l of m.lines) for (const c of i.coefficients) if (c.boq_id === boqId && c.line_id === l.line_id) {
      const r = row(c.item_id);
      r.theoretical = round2(r.theoretical + num(l.this_qty) * num(c.qty_per_unit));
    }
  }
  for (const r of rows.values()) r.variancePct = r.theoretical > 0 ? round2(((r.consumed - r.theoretical) / r.theoretical) * 100) : null;
  return [...rows.values()];
}

export const siteCsvRows = (rows: readonly SiteRow[], name: (id: string) => string): (string | number)[][] => [
  ['Item', 'Issued to site', 'Consumed', 'Theoretical', 'Variance %', 'Closing at site'],
  ...rows.map((r) => [name(r.itemId), r.issued, r.consumed, r.theoretical, r.variancePct ?? '', r.closing]),
];

/** Consumed stock value per cost centre (journals tagged `cost_centre_id`) in a period, from the stock engine. */
export function siteCostByCentre(journals: readonly StockJournal[], computation: Pick<StockComputation, 'positions'>, period: { start: string; end: string }): Map<string, number> {
  const centre = new Map<string, string>();
  for (const j of journals) if (j.cost_centre_id && j.date >= period.start && j.date <= period.end) centre.set(j.id, j.cost_centre_id);
  const out = new Map<string, number>();
  if (!centre.size) return out;
  for (const p of computation.positions) for (const r of p.ledger) {
    const c = r.kind === 'consumption' && r.refId ? centre.get(r.refId) : undefined;
    if (c) out.set(c, round2((out.get(c) ?? 0) + r.amount));
  }
  return out;
}

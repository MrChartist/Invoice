/**
 * R18-B1 billing run (pure; family `f-society`): per unit one document of the period (two when a non-member head
 * applies — never mixed), lines per head in the B2 regime, the `hs` snapshot (unit, period, due, heads with their
 * `line_id`, run, test, regime, declaration). Idempotent per (unit, period, document kind): billed state is derived from
 * the live documents whose `hs.unit` / `hs.period` match (no stored flag). B4: a special levy shared by a basis, tested
 * with the unit's regular bill of that month (HS3). C / D add their rows through `runExtras` (one block each). Nothing
 * is written here: `hs-issue-io.ts` issues the plan in one batch. Working papers — verify with your CA.
 */
import { round2 } from '../invoice-calc';
import { periodRange, sacFor, unitCharges } from './hs-tariff';
import { hsRegime, regimeLines, type RegimeOut } from './hs-regime';
import { unitDues, type DuesIndex, type InterestFn } from './hs-dues';
import { fundOf } from './hs-funds';
import type { Client, DocumentType, InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type {} from '../../types/services-r10';
import type { HsHead, HsHeadRow, HsSnapshot, SocietyKind, SocietyRun, SocietySettings, SocietyUnit } from '../../types/society-r18';

export interface RunCtx {
  date: string;
  due: string;
  registered: boolean;
  kind?: SocietyKind;
  settings: SocietySettings;
  clients: readonly Client[];
  /** The period's live documents (and, for a levy, the month's regular bills). */
  invoices: readonly InvoiceRecord[];
  runId: string;
  /** The pure-agent line text (`PURE_AGENT_CHARGE`, passed by the bridge). */
  passText: string;
  levy?: SocietyRun['levy'];
  /** R18-C1: the units' bills and receipts before the period (arrears, interest to `asOf` = the day before it). */
  dues?: { ix: DuesIndex; fn: InterestFn; asOf: string };
}

export interface UnitBill { unit: SocietyUnit; client: Client; regime: RegimeOut; items: InvoiceItem[]; hs: HsSnapshot }
export type SkipReason = 'billed' | 'owner' | 'empty';
export interface RunPlan {
  bills: UnitBill[];
  skipped: { code: string; reason: SkipReason }[];
  counts: SocietyRun['counts'];
  totals: Record<string, number>;
  /** Units of commercial use billed under the Sl. 77(c) test (HS8). */
  commercial: string[];
}

/** R18-C / R18-D hook: rows added to a unit's bill (C1 arrears / interest, D1 fund tags). Empty in R18-B. */
export function runExtras(unit: SocietyUnit, ctx: RunCtx): { rows: HsHeadRow[]; hs?: Partial<HsSnapshot> } {
  const rows: HsHeadRow[] = [], hs: Partial<HsSnapshot> = {};
  // R18-C: arrears brought forward (a memo — the old bills stay the receivable) and the interest line (counted, HS7)
  const d = ctx.dues && unitDues(unit.id, ctx.dues.asOf, ctx.dues.ix, ctx.settings, ctx.dues.fn, unit.owner_id);
  if (d && d.arrears > 0) hs.arrears = { amount: d.arrears, as_of: d.to };
  if (d && d.interest > 0 && d.interest >= (ctx.settings.interest?.min_amount ?? 0)) {
    rows.push({ head_id: 'interest', name: 'Interest on arrears', kind: 'other', basis: `${d.from} – ${d.to} @ ${d.pct} % on ₹${d.on.toLocaleString('en-IN')}`, amount: d.interest });
    hs.interest = { amount: d.interest, from: d.from, to: d.to, pct: d.pct, on: d.on, through: d.to };
  }
  // R18-D
  return { rows, hs };
}

/** R18-D1: the fund contributions of a bill's rows (`hs.funds`; none when no fund head). */
function fundsOf(rows: readonly HsHeadRow[]): Partial<HsSnapshot> {
  const f: NonNullable<HsSnapshot['funds']> = {};
  for (const r of rows) { const k = fundOf(r.kind); if (k) f[k] = round2((f[k] ?? 0) + r.amount); }
  return Object.keys(f).length ? { funds: f } : {};
}

/** The document kind of a society bill: `main`, `outsider` (non-member income only) or `levy:<name>`. */
export const billKind = (hs: HsSnapshot | undefined): string =>
  hs?.levy ? `levy:${hs.levy.name}` : hs?.regime === 'outsider' || (!!hs?.heads?.length && hs.heads.every((h) => h.kind === 'outsider')) ? 'outsider' : 'main';

/** Live (not cancelled) society bills of a period (a credit / debit note is no bill). */
export const periodBills = (invoices: readonly InvoiceRecord[], period: string): InvoiceRecord[] =>
  invoices.filter((i) => i.hs?.unit && i.hs.period === period && i.status !== 'Cancelled' && i.doc_type !== 'CREDIT_NOTE' && i.doc_type !== 'DEBIT_NOTE');

/** Billed state (derived): `unit|kind` of each live bill of the period. */
export const billedKeys = (invoices: readonly InvoiceRecord[], period: string): Set<string> => new Set(periodBills(invoices, period).map((i) => `${i.hs!.unit!.id}|${billKind(i.hs)}`));

const W: Partial<Record<string, (u: SocietyUnit) => number>> = { area_carpet: (u) => u.carpet_area ?? 0, area_super: (u) => u.super_area ?? 0, undivided_pct: (u) => u.undivided_pct ?? 0 };

/** B4: a levy's total shared by its basis (carpet / super area, undivided %; else equally), paise residue on the last unit. */
export function levyShares(units: readonly SocietyUnit[], levy: NonNullable<SocietyRun['levy']>): Map<string, number> {
  const w = units.map((u) => Math.max(0, (W[levy.basis] ?? (() => 1))(u)));
  const sum = w.reduce((t, x) => t + x, 0) || 1;
  const out = new Map<string, number>();
  let left = round2(levy.total);
  units.forEach((u, k) => {
    const a = k === units.length - 1 ? left : round2((levy.total * w[k]) / sum);
    left = round2(left - a);
    out.set(u.id, a);
  });
  return out;
}

const DOC_COUNT: Record<DocumentType | string, keyof SocietyRun['counts']> = { BILL_OF_SUPPLY: 'bos', TAX_INVOICE: 'tax', INVOICE: 'plain' };

/** The run of a period over the active units (pure; sorted by code). `limit` caps the bills of one run (`run_limit`). */
export function planSocietyRun(period: string, units: readonly SocietyUnit[], heads: readonly HsHead[], ctx: RunCtx): RunPlan {
  const pr = periodRange(period);
  const plan: RunPlan = { bills: [], skipped: [], counts: { bos: 0, tax: 0, plain: 0, outsider: 0 }, totals: {}, commercial: [] };
  if (!pr) return plan;
  const live = units.filter((u) => u.status === 'active').sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }));
  const billed = billedKeys(ctx.invoices, period);
  const first = new Map<string, string>(); // owner → the first unit (fixed-per-member heads once, HS29)
  for (const u of live) if (u.owner_id && !first.has(u.owner_id)) first.set(u.owner_id, u.id);
  const shares = ctx.levy ? levyShares(live, ctx.levy) : undefined;
  const byId = new Map(ctx.clients.map((c) => [c.id, c]));
  const limit = ctx.settings.run_limit && ctx.settings.run_limit > 0 ? ctx.settings.run_limit : Infinity;
  for (const unit of live) {
    const client = unit.owner_id ? byId.get(unit.owner_id) : undefined;
    if (!client) { plan.skipped.push({ code: unit.code, reason: 'owner' }); continue; }
    const levy = ctx.levy;
    const ex = levy ? { rows: [] } : runExtras(unit, ctx);
    let rows: HsHeadRow[] = levy
      ? [{ head_id: 'levy', name: levy.name, kind: levy.kind, basis: levy.basis === 'per_unit' ? 'per unit' : `share by ${levy.basis.replace('_', ' ')}`, amount: shares!.get(unit.id) ?? 0 }].filter((r) => r.amount > 0)
      : [...unitCharges(unit, heads, period, { member: first.get(unit.owner_id!) === unit.id, areaUnit: ctx.settings.area_unit }), ...ex.rows];
    const docs = levy ? [{ kind: `levy:${levy.name}`, rows }] : [{ kind: 'main', rows: rows.filter((r) => r.kind !== 'outsider') }, { kind: 'outsider', rows: rows.filter((r) => r.kind === 'outsider') }];
    let made = 0, skip: SkipReason = 'empty';
    for (const d of docs) {
      rows = d.rows;
      if (!rows.length) continue;
      if (billed.has(`${unit.id}|${d.kind}`)) { skip = 'billed'; continue; }
      if (plan.bills.length >= limit) break;
      // B4 (HS3): a levy is tested with the unit's regular contribution of that month.
      const reg = levy ? ctx.invoices.find((i) => i.hs?.unit?.id === unit.id && billKind(i.hs) === 'main' && i.status !== 'Cancelled' && (periodRange(i.hs.period ?? '')?.from ?? '9') <= ctx.date && ctx.date <= (periodRange(i.hs.period ?? '')?.to ?? '')) : undefined;
      const extra = reg?.hs?.test ? round2(reg.hs.test.counted / Math.max(1, reg.hs.test.months)) : 0;
      const r0 = hsRegime({ date: ctx.date, months: levy ? 1 : pr.months, rows: extra ? [...rows, { head_id: 'reg', name: '', kind: 'service', basis: '', amount: extra }] : rows, registered: ctx.registered, kind: ctx.kind, valuation: ctx.settings.gst?.valuation, outsider: d.kind === 'outsider' });
      // The levy document itself is taxed on its own amount (whole-amount rule); its test counted the month's bill.
      const regime: RegimeOut = extra && r0.regime === 'taxable_excess' ? { ...r0, regime: 'taxable_whole' } : r0;
      const hsRows: HsHeadRow[] = rows.map((r) => ({ ...r }));
      const items: InvoiceItem[] = regimeLines(rows, regime).map((l, n) => {
        const id = `t${n + 1}`;
        if (l.row) { const h = hsRows.find((x) => x.head_id === l.row!.head_id && !x.line_id); if (h) h.line_id = id; }
        const sac = l.pass ? undefined : heads.find((h) => h.id === l.row?.head_id)?.sac || sacFor(l.row?.kind ?? 'service', ctx.date);
        const cc = l.row && ctx.settings.funds?.[fundOf(l.row.kind)!]; // R18-D1: a fund head's line carries its fund
        return {
          id, name: l.name, type: 'Service', quantity: 1, rate: l.amount, amount: l.amount, tax_rate: l.tax, discount_percent: 0,
          ...(sac ? { hsn: sac } : {}), ...(cc ? { cost_centre_id: cc } : {}), ...(l.pass ? { description: ctx.passText, charge_head_id: 'rule33' } : {}), ...(l.exempt && regime.regime === 'taxable_excess' ? { sv: { exempt: 'EXEMPT' as const } } : {}),
        } as InvoiceItem;
      });
      const hs: HsSnapshot = {
        unit: { id: unit.id, code: unit.code, ...(unit.wing ? { wing: unit.wing } : {}), ...(unit.carpet_area ? { area: unit.carpet_area, area_unit: ctx.settings.area_unit ?? 'sqft' } : {}), members: [client.name] },
        period, due: ctx.due, heads: hsRows, ...(ctx.settings.explain !== false ? { explain: true } : {}), run_id: ctx.runId, test: { counted: regime.counted, limit: regime.limit, months: regime.months }, regime: regime.regime,
        ...(regime.decl ? { decl: regime.decl } : {}), ...(levy ? { levy } : {}), ...fundsOf(rows), ...(d.kind === 'main' ? 'hs' in ex ? ex.hs : {} : {}),
      };
      plan.bills.push({ unit, client, regime, items, hs });
      plan.counts[d.kind === 'outsider' ? 'outsider' : DOC_COUNT[regime.doc]]++;
      for (const r of rows) plan.totals[r.head_id] = round2((plan.totals[r.head_id] ?? 0) + r.amount);
      if (unit.use === 'commercial' && d.kind !== 'outsider') plan.commercial.push(unit.code);
      made++;
    }
    if (!made && plan.bills.length < limit) plan.skipped.push({ code: unit.code, reason: skip });
  }
  return plan;
}

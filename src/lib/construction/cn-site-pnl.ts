/**
 * CN-D5 site P&L per contract (a BOQ and its project cost centre) and period — a working paper next to Books →
 * Projects (which stays ledger-based). Revenue: RA bills of the BOQ and other sales documents of the cost centre
 * (taxable, gross and net payable; `isRevenueDoc`), less credit notes. Costs, each source counted ONCE: stock consumed
 * at the site (`siteCostByCentre`) less material recovered from sub-contractors, plus what the client recovers on our RA
 * bills (material issued, plant hire, water & power, LD, advance interest — QA11 C3); sub-contractor bills (D1, `cn_sub`);
 * labour-contractor bills and the muster's site wages (D2); plant hire bills (split by the month's log hours per site)
 * and the internal charge of our own plant less hire recovered (D3); other bills / expenses of the cost centre.
 * Purchases are read through `readPurchase` (cost = taxable when ITC is taken, else the total). Memo: unbilled work
 * (draft RA measurements × rate + typed "not yet measured"), cost to complete per BOQ group and expected margin
 * (CN26 — no journal), retention and held amounts (`raDueSplit`, D1 retention payable). Verify with your CA.
 */
import type { InvoiceRecord, Payment } from '../../types/invoice';
import type { RaMeasurement } from '../../types/transport-works-r5';
import type { Godown } from '../../types/stock';
import type { CnSitePnlInputs, CnSubSnapshot, LabourCompliance, PlantLog } from '../../types/construction-r11';
import type { ManualVoucher } from '../ledger/vouchers';
import { num, round2 } from '../invoice-calc';
import { isVoidStatus, readPurchase } from '../purchase-normalize';
import { isRevenueDoc } from '../stats';
import { receivableBalance } from '../rcm';
import { raDueSplit } from '../works/ra-due';
import { boqLines, contractValue, saveBoqTerms } from '../works/boq';
import { loadMeasurements } from '../works/measurements';
import { siteCostByCentre } from '../works/sites';
import { getTable } from '../storage';
import { localDb } from '../localDb';
import { purchasesDb } from '../purchases';
import { loadVouchers } from '../ledger/vouchers';
import { godownsDb } from '../godowns';
import { computeStockDetailed } from '../inventory';
import { liveTrackingInputs } from '../stock-tracking';
import { internalCharges, loadLogs, machines } from './cn-plant';
import { loadCompliance } from './cn-labour-compliance';
import { recoTables } from './cn-reco';

export interface SitePnlInput {
  boq: InvoiceRecord;
  period: { start: string; end: string };
  invoices: readonly InvoiceRecord[];
  purchases: readonly unknown[];
  vouchers: readonly Pick<ManualVoucher, 'date' | 'voucher_class' | 'lines' | 'variant'>[];
  payments: readonly Pick<Payment, 'invoice_id' | 'amount' | 'ra_kind' | 'advance_id'>[];
  measurements: readonly RaMeasurement[];
  /** `siteCostByCentre` for the period. */
  material: ReadonlyMap<string, number>;
  /** Internal plant charge per site godown (D3 `internalCharges`). */
  internal: ReadonlyMap<string, number>;
  sites: readonly Godown[];
  logs: readonly PlantLog[];
  compliance: readonly LabourCompliance[];
}

export interface SitePnl {
  revenue: { taxable: number; gross: number; net: number; credit: number };
  costs: { material: number; subcon: number; labour: number; muster: number; plant: number; other: number };
  totalCost: number;
  margin: number;
  marginPct: number | null;
  wip: { unbilled: number; unmeasured: number; total: number };
  contract: { value: number; billed: number; remaining: number; ctc: number; expected: number };
  held: { kind: string; label: string; amount: number }[];
  retentionPayable: number;
}

const inP = (d: string, p: { start: string; end: string }) => d >= p.start && d <= p.end;

export function sitePnl(i: SitePnlInput): SitePnl {
  const cc = i.boq.boq_terms?.cost_centre_id;
  const mine = (inv: Pick<InvoiceRecord, 'boq_id' | 'cost_centre_id'>) => inv.boq_id === i.boq.id || (!!cc && inv.cost_centre_id === cc);
  const rev = { taxable: 0, gross: 0, net: 0, credit: 0 };
  // QA11 C3: what the client recovers on our RA bills is our cost (booked to these heads at receipt, ra-receivable.ts).
  const clientCost: Partial<Record<string, 'material' | 'plant' | 'other'>> = { material_recovery: 'material', hire_charges: 'plant', water_power: 'other', ld: 'other', advance_interest: 'other' };
  const recovered = { material: 0, plant: 0, other: 0 };
  let billedToDate = 0;
  const held = new Map<string, { kind: string; label: string; amount: number }>();
  for (const inv of i.invoices) {
    if (inv.id === i.boq.id || !mine(inv)) continue;
    if (inv.doc_type === 'CREDIT_NOTE' && inv.status !== 'Cancelled' && inv.status !== 'Draft') {
      if (inP(inv.issue_date, i.period)) rev.credit += num(inv.taxable_value);
      billedToDate -= num(inv.taxable_value);
      continue;
    }
    if (!isRevenueDoc(inv)) continue;
    billedToDate += num(inv.taxable_value);
    if (inv.boq_id === i.boq.id) for (const h of raDueSplit(inv, i.payments, receivableBalance(inv)).held) {
      const x = held.get(h.kind) ?? { kind: h.kind, label: h.label, amount: 0 };
      held.set(h.kind, { ...x, amount: round2(x.amount + h.amount) });
    }
    if (!inP(inv.issue_date, i.period)) continue;
    if (inv.boq_id === i.boq.id) for (const d of inv.ra_deductions ?? []) {
      const head = clientCost[d.kind];
      if (head) recovered[head] += num(d.amount);
    }
    rev.taxable += num(inv.taxable_value);
    rev.gross += num(inv.total);
    rev.net += inv.ra_net_payable ?? num(inv.total);
  }
  const siteIds = new Set(i.sites.filter((g) => g.kind === 'site' && (g.boq_id === i.boq.id || (!!cc && g.cost_centre_id === cc))).map((g) => g.id));
  const labourVendors = new Set(i.compliance.map((r) => r.vendor_id));
  const c = { material: (i.material.get(cc ?? '') ?? 0) + recovered.material, subcon: 0, labour: 0, muster: 0, plant: recovered.plant, other: recovered.other };
  let retentionPayable = 0;
  for (const raw of i.purchases) {
    const p = readPurchase(raw);
    if (!p || isVoidStatus(p.status) || !inP(p.date, i.period)) continue;
    const r = raw as { cost_centre_id?: string; vendor_id?: string; category?: string; cn_sub?: CnSubSnapshot };
    const cost = p.itcEligible ? p.taxable : p.total;
    const sub = r.cn_sub;
    if (sub?.kind === 'hire') {
      const logs = i.logs.filter((l) => l.equipment_ref === `hire:${sub.equipment_id}` && l.date.slice(0, 7) === sub.month);
      const all = logs.reduce((s, l) => s + num(l.hours_worked), 0);
      const here = logs.filter((l) => siteIds.has(l.site_id)).reduce((s, l) => s + num(l.hours_worked), 0);
      c.plant += all > 0 ? (cost * here) / all : r.cost_centre_id === cc && cc ? cost : 0;
      continue;
    }
    if (!cc || r.cost_centre_id !== cc) continue;
    if (sub?.kind === 'subcon') {
      c.subcon += cost;
      for (const d of sub.deductions ?? []) {
        if (d.kind === 'material_recovery') c.material -= d.amount;
        else if (d.kind === 'hire_recovery') c.plant -= d.amount;
        else if (d.kind === 'other') c.subcon -= d.amount;
        else if (d.kind === 'retention') retentionPayable += d.amount;
      }
    } else if ((r.vendor_id && labourVendors.has(r.vendor_id)) || /labour contract/i.test(r.category ?? '')) c.labour += cost;
    else c.other += cost;
  }
  for (const v of i.vouchers) {
    if (v.variant || v.voucher_class !== 'Site wages' || !inP(v.date, i.period)) continue;
    for (const l of v.lines) if (cc && l.cost_centre_id === cc) c.muster += l.dr / 100;
  }
  for (const id of siteIds) c.plant += i.internal.get(id) ?? 0;
  for (const k of Object.keys(c) as (keyof typeof c)[]) c[k] = round2(c[k]);
  for (const k of Object.keys(rev) as (keyof typeof rev)[]) rev[k] = round2(rev[k]);
  const totalCost = round2(Object.values(c).reduce((s, x) => s + x, 0));
  const income = round2(rev.taxable - rev.credit);
  const margin = round2(income - totalCost);
  // WIP memo: draft measurements × BOQ rate + typed "not yet measured"; cost to complete; expected margin.
  const rate = new Map(boqLines(i.boq).map((l) => [l.id, num(l.rate)]));
  // QA11 C7: a measurement whose RA bill is still a draft is measured, not billed (saveRaBill stamps it 'billed').
  const draftBills = new Set(i.invoices.filter((x) => x.status === 'Draft').map((x) => x.id));
  const unbilled = round2(i.measurements.filter((m) => m.boq_id === i.boq.id && (m.status === 'draft' || (m.status === 'billed' && !!m.invoice_id && draftBills.has(m.invoice_id)))).reduce((s, m) => s + m.lines.reduce((a, l) => a + num(l.this_qty) * (rate.get(l.line_id) ?? 0), 0), 0));
  const inputs = i.boq.boq_terms?.site_pnl ?? {};
  const unmeasured = round2(num(inputs.unmeasured));
  const value = contractValue(i.boq);
  const ctc = round2((inputs.ctc ?? []).reduce((s, x) => s + num(x.amount), 0));
  const remaining = round2(value - billedToDate);
  return {
    revenue: rev, costs: c, totalCost, margin, marginPct: income ? round2((margin * 100) / income) : null,
    wip: { unbilled, unmeasured, total: round2(unbilled + unmeasured) },
    contract: { value, billed: round2(billedToDate), remaining, ctc, expected: round2(remaining - ctc) },
    held: [...held.values()], retentionPayable: round2(retentionPayable),
  };
}

export const pnlCsvRows = (p: SitePnl, L: (k: string) => string): (string | number)[][] => [
  [L('head'), L('amount')],
  [L('revenue'), p.revenue.taxable], [L('credit'), -p.revenue.credit],
  ...Object.entries(p.costs).map(([k, v]) => [L(`c.${k}`), -v]),
  [L('margin'), p.margin], [L('marginPct'), p.marginPct ?? ''],
  [L('unbilled'), p.wip.unbilled], [L('unmeasured'), p.wip.unmeasured], [L('contractValue'), p.contract.value], [L('billed'), p.contract.billed],
  [L('remaining'), p.contract.remaining], [L('ctc'), p.contract.ctc], [L('expected'), p.contract.expected],
  ...p.held.map((h) => [`${L('held')}: ${h.label}`, h.amount]), [L('retPayable'), p.retentionPayable],
];

/** Save the typed WIP memo inputs on the BOQ terms (roles and period lock through the BOQ save). */
export function saveSitePnlInputs(boq: InvoiceRecord, inputs: CnSitePnlInputs): InvoiceRecord {
  const ctc = (inputs.ctc ?? []).filter((x) => x.group.trim() && num(x.amount) > 0).map((x) => ({ group: x.group.trim(), amount: round2(num(x.amount)) }));
  return saveBoqTerms(boq.id, { ...boq.boq_terms, site_pnl: { unmeasured: round2(num(inputs.unmeasured)), ctc, updated_at: new Date().toISOString() } });
}

/** Read every source once for `sitePnl` (stock engine valuation, logs, muster vouchers, compliance rows). */
export function gatherSitePnl(boq: InvoiceRecord, period: { start: string; end: string }): SitePnlInput {
  const tables = recoTables();
  return {
    boq, period, invoices: localDb.invoices.getAll(), purchases: purchasesDb.all(), vouchers: loadVouchers(), payments: getTable<Payment>('transactions'),
    measurements: loadMeasurements(boq.id), material: siteCostByCentre(tables.journals, computeStockDetailed(liveTrackingInputs()), period),
    internal: internalCharges(loadLogs(), machines(), period.start, period.end), sites: godownsDb.stored(), logs: loadLogs(), compliance: loadCompliance(),
  };
}

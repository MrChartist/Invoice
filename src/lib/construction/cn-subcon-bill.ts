/**
 * CN-D1 measured sub-contractor bills (table `sub_measurements`, `SCB/FY…`, `doc.create`, dated `date`): cumulative /
 * this quantities and M-book refs per work-order line (the `ra_measurements` shape). Saving makes ONE purchase bill
 * (`PURCHASE`, `purchasesDb.save`: roles, period lock, approval) with this bill's quantities, 194C TDS on the value
 * before GST (CBDT Circular 23/2017; `resolveBillTds`, the BillModal path) and the snapshot `cn_sub` (abstract and
 * deductions). Deductions: retention → liability "Retention payable to sub-contractors", material / plant-hire / other
 * recoveries → their recovery ledgers (no GST by default, CN14(c)) — one journal Dr Sundry creditors (the
 * sub-contractor) whose amount is rolled into the bill's `amount_paid`, so payables show the net due; advance recovery
 * adjusts his open advances against the bill (bill-wise Agst Ref, no money moves). Working paper — verify with your CA.
 */
import './cn-registry';
import type { CnSubDeduction, CnSubSnapshot, SubMeasurement, SubWorkOrder } from '../../types/construction-r11';
import type { PurchaseLine, PurchaseRecord, Vendor } from '../../types/purchases';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { num, round2 } from '../invoice-calc';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { assertUnlocked } from '../period-lock';
import { withTablesRollback } from '../table-txn';
import { localDb } from '../localDb';
import { senderStateCode } from '../../store/invoice-defaults';
import { computePurchaseTotals, paymentsDb, purchasesDb, PURCHASES_TABLE } from '../purchases';
import { billTdsInputFor, deducteeTypeFromPan, priorCreditsFor, resolveBillTds } from '../tds-payables';
import { adjustAgainstBill, unallocatedOf, vendorPaymentsDb, VENDOR_PAYMENTS_TABLE } from '../billwise';
import { A, chartOf, loadUserAccounts, saveUserAccount, type PrimaryGroupId } from '../ledger/accounts';
import { deleteVoucher, loadVouchers, saveVoucher, VOUCHERS_TABLE } from '../ledger/vouchers';
import { DAY, SD, noItcCentre, put, rowsOf, loadWorkOrders } from './cn-subcon';
import { hireRecoveryFor, loadLogs, machines } from './cn-plant';

export const SCB = 'SCB';
export const loadSubBills = () => rowsOf<SubMeasurement>(SD.bills);
export const live = (m: Pick<SubMeasurement, 'status'>) => m.status !== 'cancelled';

/** Ledgers of the deductions (created on first use by name). */
export const SUB_LEDGERS: Record<Exclude<CnSubDeduction['kind'], 'advance_recovery'>, [string, PrimaryGroupId, number]> = {
  retention: ['Retention payable to sub-contractors', 'OTHER_CL', 2460],
  material_recovery: ['Material recovered from sub-contractors', 'DIRECT_EXPENSES', 5820],
  hire_recovery: ['Plant hire recoveries', 'OTHER_INCOME', 4820],
  other: ['Other recoveries — sub-contractors', 'DIRECT_EXPENSES', 5830],
};

/** A user ledger found (or created) by name. */
export function ledgerId(name: string, group: PrimaryGroupId, code: number): string {
  const chart = chartOf(loadUserAccounts());
  const hit = chart.find((a) => a.name.toLowerCase() === name.toLowerCase());
  if (hit) return hit.id;
  const codes = new Set(chart.map((a) => a.code));
  while (codes.has(String(code))) code++;
  return saveUserAccount({ code: String(code), name, group }).id;
}

/** Quantity billed so far per work-order line (live bills). */
export function previousQty(woId: string, bills: readonly SubMeasurement[] = loadSubBills()): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of bills) if (m.wo_id === woId && live(m)) for (const l of m.lines) out.set(l.line_id, round2((out.get(l.line_id) ?? 0) + num(l.this_qty)));
  return out;
}

export interface SubQtyInput {
  line_id: string;
  /** Cumulative to date (wins) or this bill's quantity. */
  cumulative?: number;
  this_qty?: number;
  mb_ref?: string;
}

/** Pure: measurement lines from typed cumulative / this quantities (lines with nothing this time are dropped). */
export function measureLines(prev: ReadonlyMap<string, number>, input: readonly SubQtyInput[]): SubMeasurement['lines'] {
  return input.map((q) => {
    const before = prev.get(q.line_id) ?? 0;
    const cum = q.cumulative !== undefined && q.cumulative !== null && String(q.cumulative) !== '' ? num(q.cumulative) : before + num(q.this_qty);
    return { line_id: q.line_id, cumulative_qty: round2(cum), this_qty: round2(cum - before), ...(q.mb_ref?.trim() ? { mb_ref: q.mb_ref.trim() } : {}) };
  }).filter((l) => l.this_qty !== 0);
}

export interface DeductionCtx {
  /** Materials issued to him and recovered on this bill. */
  material?: { item_id?: string; label?: string; qty: number; rate: number }[];
  /** Plant hire charged to him (D3 logs). */
  hire?: number;
  /** His open advances (₹). */
  advanceOpen?: number;
}

/** Pure: the deductions of one bill on `taxable` (value before GST) by the work-order rules and the context. */
export function subDeductions(wo: Pick<SubWorkOrder, 'deductions'>, taxable: number, ctx: DeductionCtx = {}): CnSubDeduction[] {
  const out: CnSubDeduction[] = [];
  const pct = (r: { rate?: number; amount?: number }) => round2(num(r.amount) + (taxable * num(r.rate)) / 100);
  for (const r of wo.deductions) {
    if (r.kind === 'retention') out.push({ kind: 'retention', label: r.label || `Retention ${num(r.rate) ? `${num(r.rate)}%` : ''}`.trim(), amount: pct(r) });
    else if (r.kind === 'advance_recovery') out.push({ kind: 'advance_recovery', label: r.label || 'Advance recovery', amount: round2(Math.min(pct(r), Math.max(num(ctx.advanceOpen), 0))) });
    else if (r.kind === 'other') out.push({ kind: 'other', label: r.label || 'Other recovery', amount: pct(r) });
  }
  for (const m of ctx.material ?? []) if (num(m.qty) > 0 && num(m.rate) > 0) out.push({ kind: 'material_recovery', label: `Material issued: ${m.label || 'material'} ${num(m.qty)} @ ${num(m.rate)}`, amount: round2(num(m.qty) * num(m.rate)), ...(m.item_id ? { item_id: m.item_id } : {}), qty: num(m.qty), rate: num(m.rate) });
  if (num(ctx.hire) > 0) out.push({ kind: 'hire_recovery', label: 'Plant hire (log sheets)', amount: round2(num(ctx.hire)) });
  return out.filter((d) => d.amount > 0);
}

/** 194C code by the payee's PAN (individual / HUF 1%, others 2%), unless the work order / vendor names one. */
export function subTdsCode(wo: Pick<SubWorkOrder, 'tds_section'>, v?: Pick<Vendor, 'pan' | 'tds_section'>): string {
  if (wo.tds_section) return wo.tds_section;
  if (v?.tds_section?.startsWith('194C')) return v.tds_section;
  const t = deducteeTypeFromPan(v?.pan);
  return t === 'INDIVIDUAL' || t === 'HUF' ? '194C-1' : '194C-2';
}

/** Pure: the bill lines (this-bill quantities at the work-order rates) and the abstract. */
export function billLines(wo: SubWorkOrder, lines: SubMeasurement['lines']): { lines: PurchaseLine[]; abstract: NonNullable<CnSubSnapshot['abstract']> } {
  const abstract: NonNullable<CnSubSnapshot['abstract']> = [];
  const out: PurchaseLine[] = [];
  for (const l of lines) {
    const w = wo.lines.find((x) => x.id === l.line_id);
    if (!w) continue;
    out.push({ id: generateId(), name: `${w.ref ? `${w.ref} ` : ''}${w.description}`, hsn: w.sac, unit: w.unit, quantity: l.this_qty, rate: num(w.rate), tax_rate: num(w.gst_rate) });
    abstract.push({ ref: w.ref, description: w.description, unit: w.unit, rate: num(w.rate), prev_qty: round2(l.cumulative_qty - l.this_qty), this_qty: l.this_qty, cum_qty: l.cumulative_qty, amount: round2(l.this_qty * num(w.rate)), ...(l.mb_ref ? { mb: l.mb_ref } : {}) });
  }
  return { lines: out, abstract };
}

export interface SubBillInput extends DeductionCtx {
  date: string;
  period_from?: string;
  period_to?: string;
  qty: SubQtyInput[];
  /** Recover open plant-hire logs charged to him (default true). */
  recoverHire?: boolean;
}

const openAdvances = (vendorId: string) => {
  const billIds = new Set(purchasesDb.all().map((p) => p.id));
  return vendorPaymentsDb.all().filter((v) => v.vendor_id === vendorId && v.kind !== 'NEW_REF').map((v) => ({ v, open: unallocatedOf(v, billIds) })).filter((x) => x.open > 0.004);
};

/** Save the measurement and make the purchase bill, deductions journal and advance adjustments (all or nothing). */
export function saveSubBill(woId: string, i: SubBillInput): { measurement: SubMeasurement; bill: PurchaseRecord } {
  requireAccess('doc.create');
  const wo = loadWorkOrders().find((w) => w.id === woId);
  if (!wo || wo.status === 'cancelled') throw new Error('Choose an open work order.');
  if (!DAY.test(i.date)) throw new Error('Enter the bill date.');
  const all = loadSubBills();
  const lines = measureLines(previousQty(woId, all), i.qty);
  if (!lines.length) throw new Error('Enter this bill\'s quantities.');
  const vendor = getTable<Vendor>('vendors').find((v) => v.id === wo.vendor_id);
  const { lines: pl, abstract } = billLines(wo, lines);
  const home = senderStateCode(localDb.settings.activeProfile());
  const pos = vendor?.state_code || home;
  const t = computePurchaseTotals(pl, { placeOfSupply: pos, businessState: home, gstApplies: !!vendor?.gstin });
  const number = nextSeriesNumberFor(SCB, i.date, all.map((m) => m.number));
  assertUnlocked({ issue_date: i.date, invoice_number: number }, 'create');
  const purchases = purchasesDb.all();
  const tdsIn = { ...billTdsInputFor(null, vendor), section: subTdsCode(wo, vendor) };
  const tds = resolveBillTds(tdsIn, { date: i.date, taxable: t.taxable, prior: priorCreditsFor(purchases, { id: vendor?.id, name: wo.vendor_name, pan: vendor?.pan }) }).fields;
  const advances = openAdvances(wo.vendor_id);
  const hire = i.recoverHire === false ? { logs: [], amount: 0 } : hireRecoveryFor(wo.vendor_id, i.date, loadLogs(), machines(), localDb.invoices.getAll());
  const deds = subDeductions(wo, t.taxable, { material: i.material, hire: hire.amount + num(i.hire), advanceOpen: advances.reduce((s, a) => s + a.open, 0) });
  const net = round2(t.total - num(tds.tds_amount) - deds.reduce((s, d) => s + d.amount, 0));
  if (net < 0) throw new Error('The deductions are more than the bill.');
  const jvDeds = deds.filter((d) => d.kind !== 'advance_recovery');
  const jvTotal = round2(jvDeds.reduce((s, d) => s + d.amount, 0));
  const id = generateId();
  return withTablesRollback([SD.bills, SD.logs, PURCHASES_TABLE, VOUCHERS_TABLE, VENDOR_PAYMENTS_TABLE, 'series_counters', 'accounts'], () => {
    let jvId: string | undefined;
    if (jvTotal > 0) {
      const p = (n: number) => Math.round(n * 100);
      jvId = saveVoucher({
        type: 'JOURNAL', date: i.date, voucher_class: 'Sub-contractor deductions',
        narration: `Deductions on sub-contractor bill ${number} (${wo.number}) — ${wo.vendor_name}`,
        lines: [
          { account_id: A.creditors, dr: p(jvTotal), cr: 0, party: wo.vendor_name },
          ...jvDeds.map((d) => {
            const [n, g, c] = SUB_LEDGERS[d.kind as keyof typeof SUB_LEDGERS];
            return { account_id: ledgerId(n, g, c), dr: 0, cr: p(d.amount), ...(wo.cost_centre_id && d.kind !== 'retention' ? { cost_centre_id: wo.cost_centre_id } : {}) };
          }),
        ],
      }).id;
    }
    const cn: CnSubSnapshot = { kind: 'subcon', wo_id: wo.id, wo_number: wo.number, measurement_id: id, number, ...(wo.site_id ? { site_id: wo.site_id } : {}), abstract, deductions: deds, tds: num(tds.tds_amount), net, ...(jvId ? { jv_id: jvId } : {}) };
    const bill = purchasesDb.save({
      kind: 'PURCHASE', vendor_id: wo.vendor_id, vendor_name: wo.vendor_name, ...(vendor?.gstin ? { vendor_gstin: vendor.gstin } : {}), bill_number: number, date: i.date,
      place_of_supply: pos, category: 'Sub-contract work', lines: pl, taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst, total: t.total,
      itc_eligible: !!vendor?.gstin && !noItcCentre(wo.cost_centre_id), amount_paid: jvTotal, ...tds, ...(wo.cost_centre_id ? { cost_centre_id: wo.cost_centre_id } : {}), cn_sub: cn,
      notes: `Sub-contractor bill ${number} against work order ${wo.number}${i.period_from ? `, ${i.period_from} to ${i.period_to ?? i.date}` : ''}.`,
    } as Omit<PurchaseRecord, 'id'>);
    let left = deds.find((d) => d.kind === 'advance_recovery')?.amount ?? 0;
    for (const a of advances) {
      if (!(left > 0.004)) break;
      const amt = round2(Math.min(left, a.open));
      adjustAgainstBill(a.v.id, bill.id, amt, i.date < a.v.date ? a.v.date : i.date);
      left = round2(left - amt);
    }
    if (hire.logs.length) setTable(SD.logs, loadLogs().map((l) => (hire.logs.some((h) => h.id === l.id) ? { ...l, recovered_in: number, recovered_invoice_id: undefined } : l)));
    const m: SubMeasurement = { id, number, wo_id: wo.id, date: i.date, ...(i.period_from ? { period_from: i.period_from } : {}), ...(i.period_to ? { period_to: i.period_to } : {}), lines, purchase_id: bill.id, ...(jvId ? { jv_id: jvId } : {}), status: 'billed', created_at: new Date().toISOString() };
    put(SD.bills, m);
    recordSeries(number);
    return { measurement: m, bill: purchasesDb.get(bill.id) ?? bill };
  });
}

/** Cancel a bill: the purchase bill, its deductions journal and hire recoveries go; the SCB number stays used. */
export function cancelSubBill(id: string): SubMeasurement {
  requireAccess('doc.create');
  const m = loadSubBills().find((x) => x.id === id);
  if (!m || !live(m)) throw new Error('This bill is already cancelled.');
  if (m.purchase_id && paymentsDb.forPurchase(m.purchase_id).length) throw new Error('Payments are recorded on this bill. Delete them first.');
  return withTablesRollback([SD.bills, SD.logs, PURCHASES_TABLE, 'purchase_payments', VOUCHERS_TABLE], () => {
    const { purchase_id: _p, jv_id: _j, ...rest } = m; // the bin keeps them; the row no longer names them (restore guard)
    void _p;
    void _j;
    // QA11 C4 / C5: the row lets go of the bill and journal first — both refuse to go while a live row names them.
    const out = put(SD.bills, { ...rest, status: 'cancelled' as const });
    if (m.purchase_id && purchasesDb.get(m.purchase_id)) purchasesDb.remove(m.purchase_id);
    if (m.jv_id && loadVouchers().some((v) => v.id === m.jv_id)) deleteVoucher(m.jv_id);
    setTable(SD.logs, loadLogs().map((l) => (l.recovered_in === m.number ? { ...l, recovered_in: undefined } : l)));
    return out;
  });
}

/** Retention held from each sub-contractor (live bills) less what was released. */
export function retentionPayable(purchases: readonly PurchaseRecord[] = purchasesDb.all(), vouchers = loadVouchers()): { vendor: string; held: number; released: number; due: number }[] {
  const out = new Map<string, { vendor: string; held: number; released: number; due: number }>();
  const row = (v: string) => out.get(v) ?? out.set(v, { vendor: v, held: 0, released: 0, due: 0 }).get(v)!;
  for (const p of purchases) if (p.cn_sub?.kind === 'subcon') row(p.vendor_name).held += (p.cn_sub.deductions ?? []).filter((d) => d.kind === 'retention').reduce((s, d) => s + d.amount, 0);
  for (const v of vouchers) if (v.voucher_class === 'Retention release') for (const l of v.lines) if (l.party && l.dr > 0) row(l.party).released += l.dr / 100;
  for (const r of out.values()) r.due = round2(r.held - r.released);
  return [...out.values()].filter((r) => r.held > 0);
}

/** Pay retention back: PAYMENT voucher Dr "Retention payable to sub-contractors" | Cr cash / bank. */
export function releaseRetention(vendor: string, amount: number, date: string, method: string) {
  requireAccess('books.edit');
  const due = retentionPayable().find((r) => r.vendor === vendor)?.due ?? 0;
  if (!(amount > 0) || amount > due + 0.004) throw new Error(`Retention due to ${vendor} is ₹${due.toFixed(2)}.`);
  const p = Math.round(amount * 100);
  const [n, g, c] = SUB_LEDGERS.retention;
  return saveVoucher({ type: 'PAYMENT', date, voucher_class: 'Retention release', narration: `Retention released to ${vendor}`, lines: [{ account_id: ledgerId(n, g, c), dr: p, cr: 0, party: vendor }, { account_id: method.toLowerCase() === 'cash' ? A.cash : A.bank, dr: 0, cr: p }] });
}

/** Printable abstract of a sub-contractor bill ("Sub-contractor bill"). */
export function subBillHtml(b: PurchaseRecord, company: string): string {
  const e = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const cn = b.cn_sub;
  const rows = (cn?.abstract ?? []).map((r) => `<tr><td>${e(r.ref)}</td><td>${e(r.description)}${r.mb ? ` <small>(MB ${e(r.mb)})</small>` : ''}</td><td>${e(r.unit)}</td><td>${r.rate}</td><td>${r.prev_qty}</td><td>${r.this_qty}</td><td>${r.cum_qty}</td><td>${r.amount.toFixed(2)}</td></tr>`).join('');
  const deds = (cn?.deductions ?? []).map((d) => `<tr><td colspan="7">Less: ${e(d.label)}</td><td>${d.amount.toFixed(2)}</td></tr>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>${e(cn?.number)}</title><style>body{font:12px sans-serif;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px;text-align:left}</style>
<h2>Sub-contractor bill ${e(cn?.number)} — abstract</h2><p>${e(company)} · Work order ${e(cn?.wo_number)} · ${e(b.vendor_name)} · ${e(b.date)}</p>
<table><tr><th>Item</th><th>Description</th><th>Unit</th><th>Rate</th><th>Previous</th><th>This bill</th><th>Up to date</th><th>Amount</th></tr>${rows}
<tr><td colspan="7">Value before GST</td><td>${b.taxable.toFixed(2)}</td></tr><tr><td colspan="7">GST</td><td>${(b.total - b.taxable).toFixed(2)}</td></tr>
<tr><td colspan="7">Less: TDS ${e(b.tds_section)}</td><td>${num(cn?.tds).toFixed(2)}</td></tr>${deds}<tr><th colspan="7">Net payable</th><th>${num(cn?.net).toFixed(2)}</th></tr></table>
<p><small>Working paper — TDS u/s 194C on the value before GST (CBDT Circular 23/2017); verify with your CA.</small></p>`;
}

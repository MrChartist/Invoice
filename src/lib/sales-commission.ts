/**
 * Sales commission per agent (7U, roadmap 7.43 — Marg / Busy "salesman commission").
 *
 *  - Agent master (table `sales_agents`, `master.edit`): name, phone, PAN, a flat % of taxable value,
 *    optional % per stock group (a group's rate also covers its sub-groups; the nearest group wins),
 *    and the basis: earned **on invoice** (bill date) or **on receipt** (pro rata to the money received).
 *  - A sales document names its agent in `agent_id` (editor summary panel, additive).
 *  - Base = the line's taxable value in rupees (foreign documents at their invoice rate), so GST, cess,
 *    TCS and freight never earn commission. Credit notes that name the agent take it back (invoice basis).
 *  - Statement per agent and period (`commissionStatement`) + CSV; **payable journal** per agent and
 *    period (`postCommission`, table `commission_postings`): Dr Sales commission (a user ledger created
 *    on first use, Indirect expenses) | Cr Sundry creditors with the agent as the party — through
 *    `saveVoucher` (period lock, audit, roles). Periods of one agent cannot overlap.
 *
 * TDS u/s 194H: opt-in on the posting (R8-B, §8 Q18; brokers default to it, `trade/tr-brokers.ts`) — verify with your CA.
 * Pure above "Storage".
 */

import type { InvoiceRecord, Payment } from '../types/invoice';
import { calcInputFromRecord, calculateInvoice, num, round2 } from './invoice-calc';
import { fxRate } from './fx';
import { isRevenueDoc } from './stats';
import { toCsv } from './csv';
import { isoDay } from './dates';
import { A, chartOf, loadUserAccounts, saveUserAccount } from './ledger/accounts';
import { deleteVoucher, saveVoucher } from './ledger/vouchers';
import { withTablesRollback } from './table-txn';
import { generateId, getTable, setTable } from './storage';
import { requireAccess } from './access';
import { deleteManualDeduction, saveManualDeduction, suggestTds, type PriorCredit } from './tds-payables';

export const SALES_AGENTS_TABLE = 'sales_agents';
export const COMMISSION_POSTINGS_TABLE = 'commission_postings';
export const COMMISSION_ACCOUNT_NAME = 'Sales commission';

export type CommissionBasis = 'invoice' | 'receipt';

export interface SalesAgent {
  id: string;
  name: string;
  phone?: string;
  pan?: string;
  /** Flat % of taxable value (items without a group rate). */
  rate: number;
  /** % per stock group id (covers sub-groups). */
  group_rates?: { group_id: string; rate: number }[];
  basis: CommissionBasis;
  active?: boolean;
  created_at?: string;
  /* ── R8-B (TR-B3) brokers, additive; absent kind = salesman ── */
  kind?: 'agent' | 'broker';
  brokerage_basis?: 'percent' | 'per_package' | 'per_qtl' | 'per_unit';
  brokerage_rate?: number;
  /** `other_party`: memo only (the other side pays the broker, §8 Q17). */
  paid_by?: 'us' | 'other_party';
  /** The broker as a payee (`vendors` row). */
  vendor_id?: string;
}

export interface CommissionPosting {
  id: string;
  agent_id: string;
  agent_name: string;
  from: string;
  to: string;
  /** Journal date. */
  date: string;
  amount: number;
  voucher_id: string;
  voucher_number: string;
  created_at: string;
  /** R8-B: TDS u/s 194H deducted on this posting (opt-in, §8 Q18) and its TDS-register row. */
  tds?: number;
  tds_row_id?: string;
}

export interface CommissionLine {
  invoice_id: string;
  number: string;
  /** Bill date (invoice basis) or receipt date (receipt basis). */
  date: string;
  party: string;
  /** Taxable value of the document in rupees (negative on a credit note). */
  base: number;
  /** Commission on the whole document. */
  commission: number;
  /** Commission earned in the period by this row. */
  earned: number;
  kind: 'invoice' | 'credit' | 'receipt';
}

interface GroupNode {
  id: string;
  parent_id?: string;
}
interface StockRef {
  name: string;
  hsn?: string;
  group_id?: string;
}

export interface CommissionData {
  invoices: readonly InvoiceRecord[];
  payments: readonly Payment[];
  stockItems: readonly StockRef[];
  groups: readonly GroupNode[];
}

const norm = (s: string | undefined) => String(s ?? '').trim().toLowerCase();

/** The commission % for an item in a stock group: the nearest group (walking up) with a rate, else the flat rate. */
export function rateForGroup(agent: Pick<SalesAgent, 'rate' | 'group_rates'>, groupId: string | undefined, groups: readonly GroupNode[]): number {
  const rates = new Map((agent.group_rates ?? []).map((g) => [g.group_id, num(g.rate)]));
  const parent = new Map(groups.map((g) => [g.id, g.parent_id]));
  const seen = new Set<string>();
  let id = groupId;
  while (id && !seen.has(id)) {
    if (rates.has(id)) return rates.get(id)!;
    seen.add(id);
    id = parent.get(id);
  }
  return num(agent.rate);
}

/** Commission on one document (rupees, positive; base = taxable value of each line in INR). */
export function documentCommission(inv: InvoiceRecord, agent: SalesAgent, data: Pick<CommissionData, 'stockItems' | 'groups'>): { base: number; commission: number } {
  const calc = calculateInvoice(calcInputFromRecord(inv));
  const fx = fxRate(inv) ?? 1;
  const byName = new Map<string, StockRef>();
  for (const s of data.stockItems) if (s?.name && !byName.has(norm(s.name))) byName.set(norm(s.name), s);
  let base = 0;
  let commission = 0;
  for (const l of calc.lines) {
    const taxable = round2(num(l.taxable) * fx);
    if (!taxable) continue;
    const item = byName.get(norm(l.name));
    base += taxable;
    commission += (taxable * rateForGroup(agent, item?.group_id, data.groups)) / 100;
  }
  return { base: round2(base), commission: round2(commission) };
}

const inPeriod = (d: string, p: { from: string; to: string }) => d >= p.from && d <= p.to;

/** Commission statement of an agent for a period. */
export function commissionStatement(agent: SalesAgent, period: { from: string; to: string }, data: CommissionData): { lines: CommissionLine[]; total: number; base: number } {
  const lines: CommissionLine[] = [];
  const mine = data.invoices.filter((i) => i && i.agent_id === agent.id);
  if (agent.basis === 'receipt') {
    const byInv = new Map(mine.filter(isRevenueDoc).map((i) => [i.id, i]));
    const paid = new Map<string, number>();
    const rows = data.payments.filter((p) => p && byInv.has(p.invoice_id)).slice().sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
    for (const p of rows) {
      const inv = byInv.get(p.invoice_id)!;
      const total = num(inv.total);
      if (!(total > 0)) continue;
      const doc = documentCommission(inv, agent, data);
      const before = paid.get(inv.id) ?? 0;
      const upto = Math.min(before + num(p.amount), total);
      paid.set(inv.id, upto);
      const earned = round2((doc.commission * upto) / total) - round2((doc.commission * before) / total);
      const day = isoDay(p.date);
      if (!day || !inPeriod(day, period) || !earned) continue;
      lines.push({ invoice_id: inv.id, number: inv.invoice_number, date: day, party: inv.client?.name ?? '', base: doc.base, commission: doc.commission, earned: round2(earned), kind: 'receipt' });
    }
  } else {
    for (const inv of mine) {
      const credit = inv.doc_type === 'CREDIT_NOTE' && inv.status !== 'Draft' && inv.status !== 'Cancelled';
      if (!credit && !isRevenueDoc(inv)) continue;
      const day = isoDay(inv.issue_date);
      if (!day || !inPeriod(day, period)) continue;
      const doc = documentCommission(inv, agent, data);
      const sign = credit ? -1 : 1;
      lines.push({ invoice_id: inv.id, number: inv.invoice_number, date: day, party: inv.client?.name ?? '', base: sign * doc.base, commission: sign * doc.commission, earned: sign * doc.commission, kind: credit ? 'credit' : 'invoice' });
    }
  }
  lines.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number));
  return { lines, total: round2(lines.reduce((s, l) => s + l.earned, 0)), base: round2(lines.reduce((s, l) => s + (l.kind === 'receipt' ? 0 : l.base), 0)) };
}

export function commissionCsv(agent: SalesAgent, period: { from: string; to: string }, st: { lines: CommissionLine[]; total: number }): string {
  return toCsv([
    [`Commission statement: ${agent.name} (${agent.basis === 'receipt' ? 'on receipt' : 'on invoice'}) ${period.from} to ${period.to}`],
    ['Date', 'Document', 'Party', 'Taxable value', 'Commission on document', 'Earned in period'],
    ...st.lines.map((l) => [l.date, l.number, l.party, l.base.toFixed(2), l.commission.toFixed(2), l.earned.toFixed(2)]),
    ['', '', 'Total', '', '', st.total.toFixed(2)],
    ['TDS u/s 194H is not deducted here: verify with your CA.'],
  ]);
}

/** Validation for the agent form ('' = fine). */
export function validateAgent(a: Pick<SalesAgent, 'id' | 'name' | 'rate' | 'group_rates'>, existing: readonly SalesAgent[]): string {
  if (!a.name.trim()) return 'Give the agent a name.';
  if (existing.some((x) => x.id !== a.id && norm(x.name) === norm(a.name))) return `An agent called “${a.name.trim()}” already exists.`;
  const bad = (r: number) => !(num(r) >= 0 && num(r) <= 100);
  if (bad(a.rate) || (a.group_rates ?? []).some((g) => bad(g.rate))) return 'Commission rates must be between 0 and 100%.';
  const b = a as Pick<SalesAgent, 'brokerage_basis' | 'brokerage_rate'>; // R8-B
  if (num(b.brokerage_rate) < 0 || (b.brokerage_basis === 'percent' && num(b.brokerage_rate) > 100)) return 'Check the brokerage rate.';
  return '';
}

/** Does a new posting period overlap an earlier one of the same agent? */
export function overlapsPosting(postings: readonly Pick<CommissionPosting, 'agent_id' | 'from' | 'to'>[], agentId: string, period: { from: string; to: string }): boolean {
  return postings.some((p) => p.agent_id === agentId && p.from <= period.to && p.to >= period.from);
}

/* ── Storage ──────────────────────────────────────────────────── */

export const agentsDb = {
  all: (): SalesAgent[] => getTable<SalesAgent>(SALES_AGENTS_TABLE).filter((a) => a && typeof a.id === 'string'),
  active: (): SalesAgent[] => agentsDb.all().filter((a) => a.active !== false),
  save(a: SalesAgent): SalesAgent {
    requireAccess('master.edit');
    const all = agentsDb.all();
    const err = validateAgent(a, all);
    if (err) throw new Error(err);
    const row: SalesAgent = {
      id: a.id || generateId(),
      name: a.name.trim(),
      ...(a.phone?.trim() ? { phone: a.phone.trim() } : {}),
      ...(a.pan?.trim() ? { pan: a.pan.trim().toUpperCase() } : {}),
      rate: round2(num(a.rate)),
      ...((a.group_rates ?? []).filter((g) => g.group_id).length ? { group_rates: (a.group_rates ?? []).filter((g) => g.group_id).map((g) => ({ group_id: g.group_id, rate: round2(num(g.rate)) })) } : {}),
      basis: a.basis === 'receipt' ? 'receipt' : 'invoice',
      ...(a.active === false ? { active: false } : {}),
      // R8-B (TR-B3): broker fields, kept only on brokers
      ...(a.kind === 'broker' ? { kind: 'broker' as const, brokerage_basis: a.brokerage_basis ?? 'percent', brokerage_rate: num(a.brokerage_rate), ...(a.paid_by === 'other_party' ? { paid_by: 'other_party' as const } : {}), ...(a.vendor_id ? { vendor_id: a.vendor_id } : {}) } : {}),
      created_at: a.created_at || new Date().toISOString(),
    };
    setTable(SALES_AGENTS_TABLE, all.some((x) => x.id === row.id) ? all.map((x) => (x.id === row.id ? row : x)) : [...all, row]);
    return row;
  },
  remove(id: string): void {
    requireAccess('master.edit');
    if (getTable<InvoiceRecord>('invoices').some((i) => i?.agent_id === id)) throw new Error('Documents name this agent: mark the agent inactive instead.');
    setTable(SALES_AGENTS_TABLE, agentsDb.all().filter((a) => a.id !== id));
  },
};

export const loadCommissionPostings = (): CommissionPosting[] => getTable<CommissionPosting>(COMMISSION_POSTINGS_TABLE).filter((p) => p && typeof p.id === 'string');

export function liveCommissionData(): CommissionData {
  return {
    invoices: getTable<InvoiceRecord>('invoices'),
    payments: getTable<Payment>('transactions'),
    stockItems: getTable<StockRef>('stock_items'),
    groups: getTable<GroupNode>('stock_groups'),
  };
}

/** The "Sales commission" ledger (Indirect expenses), created on first use. */
export function ensureCommissionAccount(): string {
  const chart = chartOf(loadUserAccounts());
  const found = chart.find((a) => norm(a.name) === norm(COMMISSION_ACCOUNT_NAME));
  if (found) return found.id;
  const codes = new Set(chart.map((a) => a.code));
  let n = 6195;
  while (codes.has(String(n))) n++;
  return saveUserAccount({ code: String(n), name: COMMISSION_ACCOUNT_NAME, group: 'INDIRECT_EXPENSES' }).id;
}

/** Post the commission payable for an agent and period: Dr Sales commission | Cr Sundry creditors (agent). */
/** R8-B: 194H on `base` for a payee with earlier credits `prior` (FY threshold, catch-up, rate by date). Pure. */
export function tds194h(date: string, base: number, pan: string | undefined, prior: readonly PriorCredit[]) {
  const s = suggestTds('194H', date, base, { pan }, prior);
  return { amount: s?.amount ?? 0, rate: s?.rate ?? 0, base: s?.threshold.taxableBase ?? 0 };
}

/** R8-B: works out 194H for an agent / broker and records it in the TDS register (26Q); the caller posts the journal. */
export function deduct194h(a: Pick<SalesAgent, 'name' | 'pan' | 'vendor_id'>, date: string, base: number, prior: readonly PriorCredit[]): { amount: number; rate: number; rowId?: string } {
  const pan = a.pan || getTable<{ id: string; pan?: string }>('vendors').find((v) => v.id === a.vendor_id)?.pan;
  const t = tds194h(date, base, pan, prior);
  if (!(t.amount > 0)) return { amount: 0, rate: t.rate };
  return { amount: t.amount, rate: t.rate, rowId: saveManualDeduction({ vendor_id: a.vendor_id, vendor_name: a.name, pan, section: '194H', date, base: t.base, rate: t.rate, amount: t.amount, notes: 'Commission / brokerage journal (R8-B)' }).id };
}

export function postCommission(agentId: string, period: { from: string; to: string }, date: string, opts: { tds194h?: boolean } = {}): CommissionPosting {
  requireAccess('books.edit');
  const agent = agentsDb.all().find((a) => a.id === agentId);
  if (!agent) throw new Error('Agent not found.');
  if (!isoDay(period.from) || !isoDay(period.to) || period.to < period.from) throw new Error('Choose a valid period.');
  if (!isoDay(date)) throw new Error('Choose the journal date.');
  const postings = loadCommissionPostings();
  if (overlapsPosting(postings, agentId, period)) throw new Error(`Commission for ${agent.name} is already posted for part of this period.`);
  const st = commissionStatement(agent, period, liveCommissionData());
  if (!(st.total > 0)) throw new Error('No commission earned in this period.');
  return withTablesRollback([COMMISSION_POSTINGS_TABLE, 'vouchers', 'accounts', 'tds_deductions'], () => {
    const expense = ensureCommissionAccount();
    const paise = Math.round(st.total * 100);
    // R8-B (§8 Q18): opt-in 194H over the agent's earlier postings of the FY; Cr TDS payable, row in the TDS register.
    const tds: { amount: number; rowId?: string } = opts.tds194h ? deduct194h(agent, date, st.total, postings.filter((p) => p.agent_id === agent.id).map((p) => ({ id: p.id, date: p.to, base: p.amount, tds: num(p.tds), code: '194H' }))) : { amount: 0 };
    const tdsPaise = Math.round(tds.amount * 100);
    const v = saveVoucher({
      type: 'JOURNAL',
      date,
      narration: `Sales commission payable to ${agent.name} for ${period.from} to ${period.to} (${agent.basis === 'receipt' ? 'on receipt' : 'on invoice'}, ${st.lines.length} document(s)), TDS u/s 194H: verify with your CA`,
      lines: [
        { account_id: expense, dr: paise, cr: 0 },
        { account_id: A.creditors, dr: 0, cr: paise - tdsPaise, party: agent.name },
        ...(tdsPaise > 0 ? [{ account_id: A.tds194h, dr: 0, cr: tdsPaise }] : []),
      ],
      voucher_class: 'Sales commission',
    });
    const row: CommissionPosting = { id: generateId(), agent_id: agent.id, agent_name: agent.name, from: period.from, to: period.to, date, amount: st.total, voucher_id: v.id, voucher_number: v.number, created_at: new Date().toISOString(), ...(tdsPaise > 0 ? { tds: tds.amount, tds_row_id: tds.rowId } : {}) };
    setTable(COMMISSION_POSTINGS_TABLE, [...loadCommissionPostings(), row]);
    return row;
  });
}

/** Undo a posting (its journal is deleted; period lock applies). */
export function deleteCommissionPosting(id: string): void {
  requireAccess('books.edit');
  const row = loadCommissionPostings().find((p) => p.id === id);
  if (!row) return;
  withTablesRollback([COMMISSION_POSTINGS_TABLE, 'vouchers', 'tds_deductions'], () => {
    deleteVoucher(row.voucher_id);
    if (row.tds_row_id) deleteManualDeduction(row.tds_row_id); // R8-B: the 194H row of the TDS register
    setTable(COMMISSION_POSTINGS_TABLE, loadCommissionPostings().filter((p) => p.id !== id));
  });
}

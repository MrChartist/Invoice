/**
 * CN-B3: price variation / escalation (table `price_variations`, `PVB/FY…`). Default formula (CPWD clause 10CC-type,
 * "verify — the contract clause governs"): PV = M × W × Σ (share_i / 100 × (I_i − I0_i) / I0_i), rounded to the rupee,
 * where W is the work done in the period (Σ value before GST of the RA bills dated in it, less extra items when the
 * clause excludes them) and M = 0.85. Indices are typed by the user (no network) or read from a CSV / XLSX sheet the
 * user keeps. Billing: PV > 0 → a supplementary works invoice "Price variation under clause … for …" at the rate of the
 * period's RA bills; PV < 0 → a credit note linked to the period's last RA bill (`doc_links`), with the Sec 34 time
 * limit warning (CN6). The working prints as the following page from the snapshot `boq_terms.cn.pv`.
 * Working paper — verify with your CA.
 */
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { CnPvRow, CnPvSnapshot, PriceVariation, WorksContract } from '../../types/construction-r11';
import { calcInputFromRecord, calculateInvoice, num, round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { withTablesRollback } from '../table-txn';
import { localDb } from '../localDb';
import { makeDraft } from '../../store/invoice-defaults';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { getIndianFY } from '../invoice-number';
import { scoreHeader } from '../import-mapping';
import { parseNumber } from '../importers';
import { ruleAt } from '../tax-rules';
import { ESCALATION_DEFAULTS } from '../construction-rules';
import { contractBills } from './cn-contracts';
import './cn-registry';

export const PV_TABLE = 'price_variations';
export const PV_PREFIX = 'PVB';

export const loadPvs = (): PriceVariation[] => peekTable<PriceVariation>(PV_TABLE).filter((p) => p && typeof p.id === 'string');

/** Pure: the PV working. Throws when the shares do not add up to 100 or a base index is not above zero. */
export function pvFormula(m: number, w: number, comps: readonly { key: string; share_pct: number; base_index: number; current_index: number }[]): { rows: CnPvRow[]; sum: number; amount: number } {
  const share = round2(comps.reduce((s, c) => s + num(c.share_pct), 0));
  if (Math.abs(share - 100) > 0.01) throw new Error(`Component shares add up to ${share}%, not 100%.`);
  if (comps.some((c) => !(num(c.base_index) > 0) || !(num(c.current_index) > 0))) throw new Error('Every component needs a base and a current index above zero.');
  const rows = comps.map((c) => ({ key: c.key, share_pct: num(c.share_pct), base_index: num(c.base_index), current_index: num(c.current_index), weighted: ((num(c.share_pct) / 100) * (num(c.current_index) - num(c.base_index))) / num(c.base_index) }));
  const sum = rows.reduce((s, r) => s + r.weighted, 0);
  return { rows, sum: Math.round(sum * 1e6) / 1e6, amount: Math.round(m * w * sum) };
}

/** Work done in the period: Σ value before GST of the live RA bills dated in it, less extra / deviation lines when excluded. */
export function pvWorkValue(c: WorksContract, invoices: readonly InvoiceRecord[], from: string, to: string): number {
  const noExtras = c.escalation?.exclusions?.includes('extra_items');
  return round2(contractBills(c, invoices).filter((b) => b.issue_date >= from && b.issue_date <= to).reduce((s, b) => {
    const extra = noExtras ? b.items.filter((it) => ['extra', 'deviation'].includes(b.boq_terms?.cn?.lines?.[it.id]?.kind ?? '')).reduce((t, it) => t + num(it.amount), 0) : 0;
    return s + num(b.taxable_value) - extra;
  }, 0));
}

/** Sec 34: a credit note for a supply of FY Y-(Y+1) by 30 November of Y+1 (CN6 — verify). */
export const sec34Deadline = (supplyDay: string): string => `${getIndianFY(supplyDay).endYear}-11-30`;

export interface PvInput {
  contract: WorksContract;
  date: string;
  period_from: string;
  period_to: string;
  indices: { key: string; current_index: number }[];
  /** Typed work value (else from the RA bills of the period). */
  work_value?: number;
}

/** Pure: the statement's snapshot (the printed working). */
export function pvWorking(i: PvInput, invoices: readonly InvoiceRecord[]): CnPvSnapshot {
  const esc = i.contract.escalation;
  if (!esc?.components?.length) throw new Error('The contract has no price-variation clause.');
  const m = num(esc.m_factor) > 0 ? num(esc.m_factor) : ruleAt(ESCALATION_DEFAULTS, i.date).m_factor;
  const w = num(i.work_value) > 0 ? round2(num(i.work_value)) : pvWorkValue(i.contract, invoices, i.period_from, i.period_to);
  const f = pvFormula(m, w, esc.components.map((c) => ({ ...c, current_index: num(i.indices.find((x) => x.key === c.key)?.current_index) })));
  return { clause: esc.clause || '10CC', period_from: i.period_from, period_to: i.period_to, base_month: esc.base_month, m_factor: m, work_value: w, rows: f.rows, sum: f.sum, amount: f.amount };
}

/** Save a PV statement (draft, numbered PVB/FY…). */
export function savePv(i: PvInput): PriceVariation {
  requireAccess('doc.create');
  if (!(i.period_from <= i.period_to)) throw new Error('The period is not valid.');
  const all = getTable<PriceVariation>(PV_TABLE);
  if (all.some((p) => p.contract_id === i.contract.id && p.status !== 'cancelled' && p.period_from <= i.period_to && p.period_to >= i.period_from)) throw new Error('A price variation statement already covers part of this period.');
  const working = pvWorking(i, localDb.invoices.getAll());
  const number = nextSeriesNumberFor(PV_PREFIX, i.date, all.map((p) => p.number));
  const row: PriceVariation = { id: generateId(), number, contract_id: i.contract.id, date: i.date, period_from: i.period_from, period_to: i.period_to, work_value: working.work_value!, indices: i.indices, amount: working.amount!, working: { ...working, number }, status: 'draft', created_at: new Date().toISOString() };
  return withTablesRollback([PV_TABLE, 'series_counters'], () => {
    setTable(PV_TABLE, [...all, { ...row, working: { ...row.working, statement_id: row.id } }]);
    recordSeries(number);
    return row;
  });
}

/**
 * Bill a PV statement: PV > 0 → supplementary works invoice; PV < 0 → credit note against the period's last RA bill.
 * Returns the document and, for a credit note issued after the Sec 34 time limit, that deadline.
 */
export function billPv(id: string, date: string): { doc: InvoiceRecord; late?: string } {
  requireAccess('doc.create');
  const pv = loadPvs().find((p) => p.id === id);
  if (!pv || pv.status !== 'draft') throw new Error('Only a draft statement can be billed.');
  if (!pv.amount) throw new Error('The price variation is nil.');
  const contract = peekTable<WorksContract>('works_contracts').find((c) => c.id === pv.contract_id);
  const bills = contract ? contractBills(contract, localDb.invoices.getAll()).filter((b) => b.issue_date <= pv.period_to) : [];
  const last = bills[bills.length - 1];
  if (!last) throw new Error('No RA bill of this contract is dated up to the end of the period.');
  const credit = pv.amount < 0;
  const draft = makeDraft({ settings: localDb.settings.get(), sender: last.sender ?? localDb.settings.activeProfile(), docType: credit ? 'CREDIT_NOTE' : 'INVOICE', templateId: last.template_id });
  const src = last.items[0];
  const item: InvoiceItem = { id: generateId(), name: `Price variation under clause ${pv.working.clause} for ${pv.period_from} to ${pv.period_to} (${pv.number})`, description: '', type: 'Service', hsn: src?.hsn || '9954', unit: '', quantity: 1, rate: Math.abs(pv.amount), tax_rate: num(src?.tax_rate), discount_percent: 0, amount: Math.abs(pv.amount) };
  const rec: InvoiceRecord = {
    ...draft, issue_date: date, due_date: date, status: 'Sent', client: { ...last.client }, items: [item], place_of_supply: last.place_of_supply, gst_mode: last.gst_mode, currency: last.currency,
    ...(credit ? { po_number: last.invoice_number } : {}),
    notes: `${credit ? 'Credit note' : 'Supplementary bill'}: price variation statement ${pv.number}${contract?.agreement_no ? ` · agreement ${contract.agreement_no}` : ''}.`,
    boq_terms: { cn: { v: 1, works: true, ...(last.boq_terms?.cn?.header ? { header: { ...last.boq_terms.cn.header, ra_label: undefined, period_from: pv.period_from, period_to: pv.period_to } } : {}), pv: { ...pv.working, statement_id: pv.id, number: pv.number } } },
  };
  const t = calculateInvoice(calcInputFromRecord(rec, { amount_paid: 0 }));
  return withTablesRollback(['invoices', 'doc_links', PV_TABLE, 'clients', 'items_catalog', 'series_counters'], () => {
    const doc = localDb.invoices.save({ ...rec, subtotal: t.subtotal, taxable_value: t.taxable_value, cgst_amount: t.cgst_amount, sgst_amount: t.sgst_amount, igst_amount: t.igst_amount, tax_amount: t.tax_amount, round_off: t.round_off, total: t.total, balance_due: credit ? 0 : t.balance_due, discount_amount: t.discount_amount });
    if (credit) setTable('doc_links', [...getTable('doc_links'), { id: generateId(), from_id: last.id, to_id: doc.id, relation: 'credit_note', reason: `Price variation ${pv.number}`, created_at: new Date().toISOString() }]);
    setTable(PV_TABLE, getTable<PriceVariation>(PV_TABLE).map((p) => (p.id === id ? { ...p, invoice_id: doc.id, status: 'billed' as const } : p)));
    const deadline = sec34Deadline(last.issue_date);
    return { doc, ...(credit && date > deadline ? { late: deadline } : {}) };
  });
}

/** Cancel a statement (its document, if any, must be cancelled first). */
export function cancelPv(id: string): void {
  requireAccess('doc.create');
  const pv = loadPvs().find((p) => p.id === id);
  const doc = pv?.invoice_id ? localDb.invoices.getById(pv.invoice_id) : undefined;
  if (doc && doc.status !== 'Cancelled') throw new Error(`Cancel ${doc.invoice_number} first.`);
  setTable(PV_TABLE, getTable<PriceVariation>(PV_TABLE).map((p) => (p.id === id ? { ...p, status: 'cancelled' as const } : p)));
}

/** A user-kept index sheet (component / index columns) → current indices by component key. */
export function readIndexSheet(t: { headers: string[]; rows: string[][] }): Record<string, number> {
  const col = (syn: string[]): number => {
    let best = -1;
    let score = 0;
    t.headers.forEach((h, i) => {
      const s = scoreHeader(h, syn);
      if (s > score) [best, score] = [i, s];
    });
    return best;
  };
  const k = col(['component', 'key', 'material', 'item']);
  const v = col(['current index', 'index', 'value']);
  const out: Record<string, number> = {};
  if (k < 0 || v < 0) return out;
  for (const r of t.rows) {
    const key = String(r[k] ?? '').trim().toLowerCase();
    const n = parseNumber(String(r[v] ?? '')).value;
    if (key && n !== undefined && n !== null && n > 0) out[key] = n;
  }
  return out;
}

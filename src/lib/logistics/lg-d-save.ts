/**
 * R19-D writes: courier manifests (`lg_manifests` — `doc.create`, dated by the month end and period-locked by it,
 * audited row by row, deletes to the recycle bin), the month run (every bill of a run in ONE
 * `localDb.invoices.saveMany`; billed state is derived from the live bills, so undo = cancel the bills, numbers stay
 * used), and the overseas-agent pair, notes, bills and netting. Netting writes the R15-A markers (`method: 'netting'`,
 * `exchange_purchase_id`, `netting_id`) on receipts in the note's currency with the bill's rate as the realised rate, so
 * the ledger clears the creditor at the bill's ₹ and books the exchange difference; the bill side is re-derived by the
 * shared roll-up (`sync`, passed in: `syncNettedPaid`). The document base (`makeDraft`) is passed in by the desk (the
 * B seam `lg-issue-io.ts` takes it over at merge). Working papers — verify with your CA.
 */
import './lg-registry';
import { generateId, getTable, setTable } from '../storage';
import { can, requireAccess } from '../access';
import { audit } from '../audit';
import { assertUnlocked } from '../period-lock';
import { localDb } from '../localDb';
import { round2 } from '../invoice-calc';
import { withTablesRollback } from '../table-txn';
import { lgdT } from '../../i18n/areas/logistics-r19d';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import type { PurchaseRecord, Vendor } from '../../types/purchases';
import type { LgDocket, LgManifest } from '../../types/logistics-r19';
import { LG_TABLES } from './lg-shared';
import { homeOf, liveBills, monthEnd, type DocCtx } from './lg-doc';
import { billedManifests, courierBill, mergeDockets, planCourierRun } from './lg-courier';
import { agentBill, agentNote, agentStatement, pairAgent, type Agent, type AgentKind, type BillInput, type NoteInput } from './lg-agents';

export const loadManifests = (): LgManifest[] => getTable<LgManifest>(LG_TABLES.manifests).filter((m) => m?.id && Array.isArray(m.dockets));
const lock = (id: string, date: string, a: 'create' | 'edit' | 'delete') => assertUnlocked({ id, issue_date: date, invoice_number: '' }, a);

/** The run's document context: the draft base, the sender's State and registration. */
export function docCtx(base: InvoiceRecord, date: string): DocCtx {
  const s = localDb.settings.activeProfile();
  return { base, date, home: homeOf(s), registered: !!s?.companyGstin?.trim() };
}

/* ── D2 courier ── */

/** Add dockets for one account customer (into its manifests by month); all or nothing. */
export function importDockets(clientId: string, dockets: readonly LgDocket[]): LgManifest[] {
  requireAccess('doc.create');
  if (!localDb.clients.getById(clientId)) throw new Error(lgdT('eClient'));
  const all = loadManifests(), r = mergeDockets(all, clientId, dockets, billedManifests(localDb.invoices.getAll()), generateId, monthEnd, new Date().toISOString());
  if (r.dup.length) throw new Error(lgdT('eDup', { d: r.dup.slice(0, 5).join(', ') }));
  if (r.billed.length) throw new Error(lgdT('eBilled', { p: r.billed.join(', ') }));
  const touched = r.rows.filter((m) => !all.includes(m));
  for (const m of touched) lock(m.id, m.date, all.some((x) => x.id === m.id) ? 'edit' : 'create');
  setTable(LG_TABLES.manifests, r.rows);
  return touched;
}

/** Remove a manifest that no live bill names (to the recycle bin). */
export function deleteManifest(id: string): void {
  requireAccess('doc.create');
  const all = loadManifests(), m = all.find((x) => x.id === id);
  if (!m) return;
  if (billedManifests(localDb.invoices.getAll()).has(id)) throw new Error(lgdT('eBilled', { p: m.period }));
  lock(m.id, m.date, 'delete');
  setTable(LG_TABLES.manifests, all.filter((x) => x.id !== id));
}

/** "Bill month": one bill per customer (international dockets on their own) in ONE `saveMany`. */
export function billCourierMonth(period: string, date: string, base: InvoiceRecord): InvoiceRecord[] {
  requireAccess('doc.create');
  const groups = planCourierRun(period, loadManifests(), localDb.invoices.getAll(), localDb.clients.getAll());
  const ctx = docCtx(base, date);
  return groups.length ? localDb.invoices.saveMany(groups.map((g) => courierBill(g, ctx))) : [];
}

/** "Undo month": the run's live bills cancelled (never deleted; numbers stay used); a bill with a receipt stops it. */
export function undoCourierMonth(period: string): number {
  requireAccess('doc.create');
  const bills = liveBills(localDb.invoices.getAll()).filter((i) => i.lg?.period === period && i.lg.manifest_id);
  // QA22 W5: a bill with a receipt or a live credit note stops it (the note would stay a credit on a cancelled bill).
  const live = new Set(localDb.invoices.getAll().filter((x) => x.status !== 'Cancelled').map((x) => x.id));
  const paid = new Set([...getTable<Payment>('transactions').map((p) => p.invoice_id), ...getTable<{ from_id: string; to_id: string; relation: string }>('doc_links').filter((l) => l.relation === 'credit_note' && live.has(l.to_id)).map((l) => l.from_id)]);
  const held = bills.filter((b) => paid.has(b.id));
  if (held.length) throw new Error(lgdT('eUndoPaid', { n: held.map((b) => b.invoice_number).join(', ') }));
  return withTablesRollback(['invoices'], () => { for (const b of bills) localDb.invoices.setStatus(b.id, 'Cancelled'); return bills.length; });
}

/* ── D1 agents ── */

/** A new agent: the client (to bill) and the vendor (their bills) linked as one party (`Vendor.client_id`). */
export function saveAgent(i: { name: string; kind: AgentKind; foreign: boolean; country?: string }): Vendor {
  requireAccess('master.edit');
  const name = i.name.trim();
  if (!name) throw new Error(lgdT('eName'));
  const vendors = getTable<Vendor>('vendors');
  if (vendors.some((v) => v.name.trim().toLowerCase() === name.toLowerCase())) throw new Error(lgdT('eAgentDup'));
  const country = (i.country ?? '').trim().toUpperCase();
  const client_id = localDb.clients.upsert({ name, email: '', address: country, city: '', zip: '', ...(i.foreign ? { state_code: '96' } : {}) });
  const v: Vendor = { id: generateId(), name, client_id, lg: { kind: i.kind, foreign: i.foreign }, ...(i.foreign ? { non_resident: true, ...(country ? { nr_country: country } : {}) } : {}), created_at: new Date().toISOString() };
  setTable('vendors', [...vendors, v]);
  return v;
}

const pos = (x: number) => Number.isFinite(x) && x > 0;
/** "Debit agent": the note in the agent's currency. */
export function issueAgentNote(i: NoteInput, date: string, base: InvoiceRecord): InvoiceRecord {
  if (!pos(i.amount) || !pos(i.rate)) throw new Error(lgdT('eAmount'));
  return localDb.invoices.save(agentNote(i, docCtx(base, date)));
}

/** "Agent's bill": booked in ₹ under reverse charge (import of services); one bill number once per agent. */
export function saveAgentBill(i: Omit<BillInput, 'home'>): PurchaseRecord {
  requireAccess('books.edit');
  if (!pos(i.amount) || !pos(i.rate)) throw new Error(lgdT('eAmount'));
  if (!i.bill_no.trim()) throw new Error(lgdT('eBillNo'));
  // QA22 W4: reverse charge on an import of services needs a supplier outside India; an Indian agent bills its own GST.
  if (!i.agent.vendor.lg?.foreign) throw new Error(lgdT('eDomBill'));
  const all = getTable<PurchaseRecord>('purchases');
  if (all.some((b) => b.vendor_id === i.agent.vendor.id && b.bill_number.trim().toLowerCase() === i.bill_no.trim().toLowerCase())) throw new Error(lgdT('eBillDup'));
  const b = agentBill({ ...i, home: homeOf(localDb.settings.activeProfile()) }, generateId());
  assertUnlocked({ id: b.id, issue_date: b.date }, 'create');
  setTable('purchases', [...all, b]);
  return b;
}

/** "Settle by netting": `amount` (the currency) of our notes against their bills, oldest first, one receipt per pair. */
export function settleAgent(a: Agent, i: { amount: number; date: string; rcmPaid?: boolean }, sync: (billIds: string[]) => void): { nettingId: string; rows: Payment[] } {
  requireAccess('books.edit');
  if (!a.client) throw new Error(lgdT('eAgentClient'));
  const st = agentStatement(a, localDb.invoices.getAll(), getTable<PurchaseRecord>('purchases'));
  const amount = round2(i.amount), cap = Math.min(st.ours, st.theirs);
  if (!pos(amount) || amount > cap + 0.004) throw new Error(lgdT('eSettle', { a: cap.toFixed(2) }));
  if (!i.rcmPaid) throw new Error(lgdT('eRcm'));
  if (!can('doc.approve')) throw new Error(lgdT('eOwner')); // QA22 W6: as R15-A `postNetting` (a clerk's netting needs the owner)
  const pairs = pairAgent(st.notes, st.bills, amount);
  if (pairs.some((p) => p.note.cur !== p.bill.cur)) throw new Error(lgdT('eCur'));
  assertUnlocked({ id: 'netting', issue_date: i.date }, 'create');
  const nettingId = generateId();
  const rows = withTablesRollback(['transactions', 'invoices', 'purchases', 'series_counters'], () => {
    const ids = pairs.map((p) => localDb.payments.record({ invoiceId: p.note.id, amount: p.amount, method: 'netting', date: i.date, reference: p.bill.number, realisedRate: p.bill.rate }).id);
    const bill = new Map(ids.map((id, k) => [id, pairs[k].bill.id]));
    const all = getTable<Payment>('transactions').map((t) => (bill.has(t.id) ? { ...t, exchange_purchase_id: bill.get(t.id), netting_id: nettingId } : t));
    setTable('transactions', all);
    sync([...new Set(pairs.map((p) => p.bill.id))]);
    return all.filter((t) => bill.has(t.id));
  });
  audit.record({ entity: 'vendor_payment', entity_id: nettingId, action: 'create', summary: `Agent netting ${amount.toFixed(2)}: ${a.vendor.name} on ${i.date}` });
  return { nettingId, rows };
}

/**
 * R18-B1 bridge: a society run issued through the shared batch path (`buildBatchDrafts` → `issueBatch`, the R5-C
 * `fee-billing.ts` pattern): one batch, numbered in each document's own FY series (tax invoices, `BOS`), period lock,
 * approvals and the sender snapshot intact; a `society_runs` row records it, all or nothing. Undo → `undoBatch` with a
 * reason (issued documents cancelled, never deleted; numbers stay reserved). Reads the units, the period's bills and the
 * society settings only. Working papers — verify with your CA.
 */
import './hs-registry';
import type { InvoiceRecord } from '../../types/invoice';
import type { SocietyRun } from '../../types/society-r18';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { localDb } from '../localDb';
import { withTablesRollback } from '../table-txn';
import { buildBatchDrafts, issueBatch, partyKey, undoBatch } from '../batch-invoices';
import type { RecurringTemplate } from '../recurring';
import { PURE_AGENT_CHARGE } from '../trade/pure-agent';
import { senderStateCode } from '../../store/invoice-defaults';
import { hsbT } from '../../i18n/areas/society-r18b';
import { HS_TABLES } from './hs-shared';
import { periodBills, planSocietyRun, type RunPlan, type UnitBill } from './hs-run';
import { periodText } from './hs-print';
import { periodRange } from './hs-tariff';
import { duesIndex, type InterestFn } from './hs-dues';
import { computeInterest } from '../interest';
import { shiftDay } from '../dates';
import { readSocietySettings, societyDefaultsFor } from './hs-settings';
import { loadUnits } from './hs-units-save';

export const loadRuns = (): SocietyRun[] => getTable<SocietyRun>(HS_TABLES.runs).filter((r) => r?.id && r.period);

export interface RunInput { period: string; date: string; due: string; levy?: SocietyRun['levy'] }

const sender = () => localDb.settings.activeProfile() ?? null;
/** The society settings with the profile's defaults (the sender's State). */
export const societySettings = () => { const p = sender(); return societyDefaultsFor(p?.companyGstin?.slice(0, 2) || p?.stateCode, readSocietySettings()); };

/** The run's plan (nothing written): the period's live bills are read to skip units already billed. */
export function planRun(i: RunInput, runId = generateId()): RunPlan & { runId: string } {
  const s = societySettings(), inv = localDb.invoices.getAll();
  return {
    runId,
    ...planSocietyRun(i.period, loadUnits(), s.heads ?? [], {
      date: i.date, due: i.due, registered: !!sender()?.companyGstin?.trim(), kind: localDb.settings.get().society_kind, settings: s, clients: localDb.clients.getAll(),
      invoices: i.levy ? inv.filter((x) => x.hs?.unit && x.status !== 'Cancelled') : periodBills(inv, i.period), runId, passText: PURE_AGENT_CHARGE, levy: i.levy,
      // R18-C1: the bills and receipts before the period carry arrears and interest onto this bill.
      ...(i.levy || !periodRange(i.period) ? {} : { dues: { ix: duesIndex(inv, getTable('transactions'), getTable('doc_links')), fn: computeInterest as InterestFn, asOf: shiftDay(periodRange(i.period)!.from, -1) } }),
    }),
  };
}

const days = (a: string, b: string) => Math.max(0, Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 864e5) || 0);

function template(b: UnitBill): RecurringTemplate {
  const doc = b.regime.doc;
  return {
    doc_type: doc, currency: 'INR', template_id: localDb.template.get(), client: b.client, sender: sender(), items: b.items, gst_mode: doc === 'TAX_INVOICE' ? 'CGST_SGST' : 'NONE',
    place_of_supply: '', reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0, shipping: 0, other_charges: 0, round_off_enabled: false,
    notes: `${b.hs.levy ? b.hs.levy.name : 'Maintenance bill'} — ${b.unit.code} — ${periodText(b.hs.period)}`, terms: '', ...(doc === 'BILL_OF_SUPPLY' ? { exempt_kind: 'EXEMPT' } : {}),
  } as RecurringTemplate;
}

/** "Run period" (`doc.create`): issue the plan in one batch and record the run. No bill to make → no run (`run` absent). */
export function issueRun(i: RunInput): { run?: SocietyRun; invoices: InvoiceRecord[]; plan: RunPlan; held: number } {
  requireAccess('doc.create');
  const plan = planRun(i);
  if (!plan.bills.length) return { invoices: [], plan, held: 0 };
  // QA21 W2 (HS65): the building is the place of supply (IGST Act Sec 12(3)) — never a member's out-of-State address or
  // GSTIN; an agency (facility manager) keeps the client's place.
  const pos = localDb.settings.get().society_kind === 'agency' ? undefined : senderStateCode(sender()) || undefined;
  const drafts = plan.bills.flatMap((b) => buildBatchDrafts(template(b), [{ key: partyKey(b.client), client: b.client }], { date: i.date, dueDays: days(i.date, i.due), sender: sender(), pos }).map((d) => ({
    ...d,
    // The batch builder renumbers the lines: each head row follows its line (`t<n>` → the n-th line's id).
    record: { ...d.record, hs: { ...b.hs, heads: b.hs.heads?.map((h) => ({ ...h, line_id: h.line_id ? d.record.items[Number(h.line_id.slice(1)) - 1]?.id : undefined })) } },
  })));
  return withTablesRollback(['invoices', 'series_counters', 'batch_runs', HS_TABLES.runs], () => {
    const res = issueBatch(drafts, { sourceId: i.levy ? `hs:levy:${plan.runId}` : `hs:${i.period}`, sourceKind: 'recurring', sourceLabel: `Society ${i.levy?.name ?? periodText(i.period)}`, date: i.date, mode: 'issue', force: true });
    const run: SocietyRun = { id: plan.runId, period: i.period, date: i.date, due: i.due, batch_run_id: res.run.id, unit_ids: [...new Set(plan.bills.map((b) => b.unit.id))], counts: plan.counts, totals: plan.totals, ...(i.levy ? { levy: i.levy } : {}), updated_at: new Date().toISOString() };
    setTable(HS_TABLES.runs, [...loadRuns(), run]);
    return { run, invoices: res.invoices, plan, held: res.held.length };
  });
}

/** "Undo run" (`doc.create`): its documents cancelled with the reason (never deleted); the run marked undone. */
export function undoRun(id: string, reason: string): { cancelled: number } {
  requireAccess('doc.create');
  const run = loadRuns().find((r) => r.id === id);
  if (!run?.batch_run_id || run.undone) throw new Error(hsbT('noRun'));
  if (!reason.trim()) throw new Error(hsbT('noReason'));
  // QA21 W5: a bill with a receipt or a live credit note (an interest waiver) is never cancelled under it — the note
  // would stay a credit on a cancelled bill. Named by unit, before anything is written.
  const ids = new Set(getTable<{ id: string; invoice_ids?: string[] }>('batch_runs').find((b) => b.id === run.batch_run_id)?.invoice_ids ?? []);
  const all = localDb.invoices.getAll(), live = new Set(all.filter((x) => x.status !== 'Cancelled').map((x) => x.id));
  const busy = new Set([...getTable<{ invoice_id?: string }>('transactions').map((p) => p.invoice_id), ...getTable<{ from_id: string; to_id: string; relation: string }>('doc_links').filter((l) => l.relation === 'credit_note' && live.has(l.to_id)).map((l) => l.from_id)]);
  const held = all.filter((x) => ids.has(x.id) && x.status !== 'Cancelled' && busy.has(x.id)).map((x) => x.hs?.unit?.code ?? x.invoice_number);
  if (held.length) throw new Error(hsbT('undoHeld', { u: [...new Set(held)].join(', ') }));
  return withTablesRollback([HS_TABLES.runs], () => {
    const r = undoBatch(run.batch_run_id!, { cancelReason: reason.trim() });
    const at = new Date().toISOString();
    setTable(HS_TABLES.runs, loadRuns().map((x) => (x.id === id ? { ...x, undone: { at, reason: reason.trim() }, updated_at: at } : x)));
    return { cancelled: r.cancelled };
  });
}

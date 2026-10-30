/**
 * PS-D5 "Bill from the board": a draft fee note in the open (firm) company for one client and month — one line per
 * selected event at the client's agreed fee (`Client.ps.fees`, else the catalogue item flagged `ps.fee_event`), events
 * covered by an active retainer engagement at 0, typed events (ROC filings, cost-audit work …) and the client's
 * unbilled pure-agent disbursements (government / late fees paid on behalf) — through the timesheet draft builder
 * (`buildBillDraft`, the path `billUnbilled` uses), so `bill_refs` and derived billing work unchanged. Also the
 * fee-schedule writes (catalogue `ps.fee_event`, `Client.ps.fees` / `tds`) and the read-only peek of linked companies.
 * Working paper — verify with your CA (PS36).
 */
import type { Client, InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { CaFeeEvent, ClientTdsDefault, ProfCaSettings } from '../../types/prof-r14';
import type { PracticeTables } from '../practice';
import { generateId, getTable, setTable } from '../storage';
import { requireAccess } from '../access';
import { num, round2 } from '../invoice-calc';
import { localDb } from '../localDb';
import { purchasesDb } from '../purchases';
import { blankClient, makeDraft } from '../../store/invoice-defaults';
import { activeCompanyId, companyDbName } from '../company-registry';
import { buildBillDraft, expenseLine, readTimePrefs, unbilledFor } from '../timesheets';
import type { CaEvent } from './ps-ca-events';
import { caKey } from './ps-ca-events';

export const CA_FEE_EVENTS: readonly CaFeeEvent[] = ['gstr1', 'gstr3b', 'gstr9', 'tds_return', 'itr', 'tax_audit', 'stat_audit', 'roc_annual', 'certificate', 'dsc_renewal', 'checklist', 'retainer'];

type PsHolder = { ps?: Record<string, unknown> };
const psOf = (x: unknown): Record<string, unknown> => ((x as PsHolder | null)?.ps && typeof (x as PsHolder).ps === 'object' ? (x as PsHolder).ps! : {});

/** `Client.ps.fees` (agreed fee per event, ₹). */
export const clientFees = (c: unknown): Partial<Record<CaFeeEvent, number>> => (psOf(c).fees as Partial<Record<CaFeeEvent, number>>) ?? {};

/** Catalogue items flagged with a fee event (first item per event). */
export function feeItems(catalog: readonly InvoiceItem[]): Map<CaFeeEvent, InvoiceItem> {
  const out = new Map<CaFeeEvent, InvoiceItem>();
  for (const it of catalog) {
    const k = psOf(it).fee_event as CaFeeEvent | undefined;
    if (k && CA_FEE_EVENTS.includes(k) && !out.has(k)) out.set(k, it);
  }
  return out;
}

/** Flag a catalogue item with a fee event ('' clears it). Another item holding the event loses it. */
export function setFeeEvent(itemId: string, kind: CaFeeEvent | ''): void {
  requireAccess('master.edit');
  setTable('items_catalog', getTable<InvoiceItem & PsHolder>('items_catalog').map((it) => {
    const ps = psOf(it);
    if (it.id === itemId) return { ...it, ps: { ...ps, fee_event: kind || undefined } };
    return kind && ps.fee_event === kind ? { ...it, ps: { ...ps, fee_event: undefined } } : it;
  }));
}

/** Merge `patch` into a client's `ps` object (other packages' sub-fields kept). */
export function patchClientPs(clientId: string, patch: { fees?: Partial<Record<CaFeeEvent, number>>; tds?: ClientTdsDefault | undefined }): void {
  requireAccess('master.edit');
  const all = getTable<Client & PsHolder>('clients');
  if (!all.some((c) => c.id === clientId)) throw new Error('Client not found.');
  setTable('clients', all.map((c) => (c.id === clientId ? { ...c, ps: { ...psOf(c), ...patch } } : c)));
}

/** Clients with an active retainer engagement (PS-A `engagements`, model `retainer`) — their events bill at 0. */
export function retainerClients(engagements: readonly unknown[] = getTable<unknown>('engagements')): Set<string> {
  const out = new Set<string>();
  for (const e of engagements as { client_id?: string; model?: string; status?: string }[]) if (e?.client_id && e.model === 'retainer' && (e.status === 'active' || e.status === 'accepted')) out.add(e.client_id);
  return out;
}

/** A typed event (ROC annual filing, cost-audit work …) for the bill. */
export const typedEvent = (clientId: string, kind: CaFeeEvent, period: string, label: string): CaEvent => ({ key: caKey(clientId, kind, period), client_id: clientId, kind, period, date: `${period.slice(0, 7)}-01`, label });

/** Pure: the fee lines of the selected events (covered events at 0 with a note). */
export function draftLines(events: readonly CaEvent[], client: unknown, catalog: readonly InvoiceItem[], covered: boolean): InvoiceItem[] {
  const fees = clientFees(client);
  const items = feeItems(catalog);
  return events.map((e) => {
    const it = items.get(e.kind);
    const fee = covered && e.kind !== 'retainer' ? 0 : round2(num(fees[e.kind] ?? it?.rate ?? 0));
    const note = [e.udin ? `UDIN ${e.udin}` : '', covered && e.kind !== 'retainer' ? 'Covered by the monthly retainer' : ''].filter(Boolean).join(' · ');
    return {
      id: generateId(), type: 'Service', name: `${it?.name || 'Professional fees'}: ${e.label}`, description: note, hsn: it?.hsn || '9982',
      unit: 'NOS', quantity: 1, rate: fee, amount: fee, tax_rate: it ? num(it.tax_rate) : 18, discount_percent: 0, bill_refs: [e.key],
    } as InvoiceItem;
  });
}

/** Create and save the draft fee note; stamps the client's billed disbursements. */
export function billFromBoard(clientId: string, events: readonly CaEvent[], opts: { disbursements?: boolean } = {}): InvoiceRecord {
  requireAccess('doc.create');
  const master = localDb.clients.getById(clientId);
  if (!master) throw new Error('This client is no longer in your client list.');
  if (!events.length && !opts.disbursements) throw new Error('Select the work to bill.');
  const covered = retainerClients().has(clientId);
  const prefs = readTimePrefs();
  const disb = opts.disbursements ? unbilledFor(clientId).expenses.filter((p) => p.pure_agent) : [];
  const items = [...draftLines(events, master, localDb.items.getAll(), covered), ...disb.map((p) => expenseLine(p, prefs))];
  if (!items.length) throw new Error('Nothing to bill.');
  const settings = localDb.settings.get();
  const sender = localDb.settings.activeProfile() ?? null;
  const base = makeDraft({ settings, sender, docType: 'INVOICE', templateId: localDb.template.get() });
  const udins = events.filter((e) => e.udin);
  const draft = buildBillDraft({ ...base, id: generateId() }, { ...blankClient(), ...master }, items, sender);
  if (udins.length) Object.assign(draft, { ps: { udin: udins.map((e) => e.udin!), lines: Object.fromEntries(items.filter((i) => udins.some((u) => i.bill_refs?.includes(u.key))).map((i) => [i.id, { udin: udins.find((u) => i.bill_refs?.includes(u.key))!.udin }])) } });
  draft.invoice_number = localDb.invoices.nextNumber(draft.issue_date, draft.doc_type, sender?.invoicePrefix || undefined);
  const saved = localDb.invoices.save(draft);
  if (disb.length) purchasesDb.setRebilled(disb.map((p) => p.id), saved.id);
  return saved;
}

/** The open company's practice tables (same shape as a peek). */
function currentTables(): PracticeTables {
  return { compliance: getTable('compliance'), tds_returns: getTable('tds_returns'), dsc_register: getTable('dsc_register'), client_checklist: getTable('client_checklist') };
}

/** Peek every linked company read-only (`peekCompliance`, never created or upgraded). */
export async function loadLinkedPeeks(s: ProfCaSettings): Promise<Map<string, PracticeTables | undefined>> {
  const { peekCompliance } = await import('../company-peek');
  const here = activeCompanyId();
  const out = new Map<string, PracticeTables | undefined>();
  for (const l of s.company_clients ?? []) {
    if (l.company_id === here) {
      out.set(l.company_id, currentTables());
      continue;
    }
    const p = await peekCompliance(companyDbName(l.company_id)).catch(() => null);
    out.set(l.company_id, p && !p.locked ? (p.tables as PracticeTables) : undefined);
  }
  return out;
}


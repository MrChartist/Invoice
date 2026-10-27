/**
 * PS-A3 pre-bill: per matter (or client), the unbilled time at standard value, the re-billable costs and mileage, the
 * engagement's model and what it allows now. "Create draft" goes through the existing `billUnbilled` path with the
 * edited selection (so `bill_refs`, the annexure and derived billing are unchanged), then adds the engagement's fee
 * lines, marks covered lines, fills the annexure's `standard` / `billed` row fields and writes the `ps` snapshot
 * (matter, engagement, billing basis, write-up / write-down with its reason).
 */
import './ps-registry';
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { Engagement, PsLine } from '../../types/prof-r14';
import type { TimeEntry, TimePrefs } from '../../types/time';
import { billUnbilled, buildBillDraft, currentLiveInvoiceIds, readTimePrefs, unbilledFor, type BillSelection } from '../timesheets';
import { generateId } from '../storage';
import { localDb } from '../localDb';
import { num, round2 } from '../invoice-calc';
import { formatCurrency } from '../utils';
import { loadCostCentres } from '../cost-centres';
import { blankClient, makeDraft } from '../../store/invoice-defaults';
import { engagementOf, loadEngagements } from './ps-engagements';
import { planBill, type RowEdit } from './ps-models';
import { docBilling, lineTaxable } from './ps-writedown';
import { entryStandard, staffMap } from './ps-staff';
import { psSnapshot } from './ps-snapshot';
import { withStandard } from '../annexure';

export interface EngagementUse { used: number; fees: number; milestones: string[] }

/** Pure: what live fee notes of an engagement billed so far (time + fee lines; fee lines; milestones). */
export function engagementUse(engId: string, invoices: readonly InvoiceRecord[], live: ReadonlySet<string>): EngagementUse {
  const out: EngagementUse = { used: 0, fees: 0, milestones: [] };
  for (const inv of invoices) {
    if (inv.ps?.engagement?.id !== engId || !live.has(inv.id)) continue;
    for (const it of inv.items ?? []) {
      const l = inv.ps.lines?.[it.id];
      const amt = lineTaxable(it);
      if (l?.fee) { out.fees += amt; out.used += amt; if (l.milestone) out.milestones.push(l.milestone); } else if (it.bill_refs?.length && !l?.covered && it.unit === 'HRS') out.used += amt;
    }
  }
  out.used = round2(out.used);
  out.fees = round2(out.fees);
  return out;
}

export interface PrebillView {
  sel: BillSelection;
  engagement?: Engagement;
  use: EngagementUse;
  standard: number;
}

/** The pre-bill of one client (`clientKey`), optionally one matter (cost centre). */
export function prebillFor(key: string, projectId?: string, prefs: TimePrefs = readTimePrefs()): PrebillView {
  const live = currentLiveInvoiceIds();
  const sel = unbilledFor(key, live, { projectId, prefs });
  const engagement = engagementOf(projectId, loadEngagements());
  const use = engagement ? engagementUse(engagement.id, localDb.invoices.getAll(), live) : { used: 0, fees: 0, milestones: [] };
  const standard = round2(sel.time.reduce((s, e) => s + entryStandard(e, prefs), 0));
  return { sel, ...(engagement ? { engagement } : {}), use, standard };
}

export interface PrebillInput {
  key: string;
  projectId?: string;
  edits?: Readonly<Record<string, RowEdit>>;
  /** Re-billable costs / trips left for a later bill. */
  deferRows?: readonly string[];
  milestoneIds?: readonly string[];
  target?: number;
  reason?: string;
  annexure?: boolean;
}

const feeItem = (name: string, amount: number, prefs: TimePrefs): InvoiceItem => ({
  id: generateId(), type: 'Service', name, hsn: prefs.sac, unit: 'NOS', quantity: 1, rate: round2(amount), tax_rate: num(prefs.gst_rate), discount_percent: 0, amount: round2(amount),
});

/** Create the draft fee note from a reviewed pre-bill (see the header). */
export function createPrebillDraft(i: PrebillInput, prefs: TimePrefs = readTimePrefs()): InvoiceRecord {
  const view = prebillFor(i.key, i.projectId, prefs);
  const eng = view.engagement;
  const plan = planBill(view.sel.time, i.edits ?? {}, eng, { prefs, used: view.use.used, feesBefore: view.use.fees, milestonesBilled: view.use.milestones, milestoneIds: i.milestoneIds, target: i.target, money: (n) => formatCurrency(n, eng?.currency) });
  const defer = new Set(i.deferRows ?? []);
  const sel: BillSelection = { time: plan.time, expenses: view.sel.expenses.filter((p) => !defer.has(p.id)), mileage: view.sel.mileage.filter((t) => !defer.has(t.id)) };
  const fees = plan.fees.map((f) => ({ f, item: feeItem(f.name, f.amount, prefs) }));
  if (!sel.time.length && !sel.expenses.length && !sel.mileage.length && !fees.length) throw new Error('Nothing to bill for this matter yet.');
  const centre = i.projectId ? loadCostCentres().find((c) => c.id === i.projectId) : undefined;
  let saved: InvoiceRecord;
  if (sel.time.length || sel.expenses.length || sel.mileage.length) saved = billUnbilled(i.key, sel, prefs, { annexure: i.annexure });
  else {
    const settings = localDb.settings.get();
    const sender = localDb.settings.activeProfile() ?? null;
    const client = localDb.clients.getById(i.key) ?? { ...blankClient(), name: i.key.startsWith('name:') ? i.key.slice(5) : '' };
    const base = makeDraft({ settings, sender, docType: 'INVOICE', templateId: localDb.template.get() });
    saved = buildBillDraft({ ...base, id: generateId(), ...(centre ? { cost_centre_id: centre.id } : {}) }, client, [], sender);
    saved.invoice_number = localDb.invoices.nextNumber(saved.issue_date, saved.doc_type, sender?.invoicePrefix || undefined);
  }
  const cov = new Set(plan.covered);
  const lines: Record<string, PsLine> = {};
  const code = centre?.ps?.code;
  for (const it of saved.items) {
    const refs = it.bill_refs ?? [];
    const isCovered = refs.length > 0 && refs.every((r) => cov.has(r));
    if (isCovered || code) lines[it.id] = { ...(code ? { matter: code } : {}), ...(isCovered ? { covered: true } : {}) };
  }
  for (const { f, item } of fees) lines[item.id] = { fee: true, ...(code ? { matter: code } : {}), ...(f.milestone ? { milestone: f.milestone } : {}) };
  const items = [...saved.items, ...fees.map((x) => x.item)];
  const stored = new Map(view.sel.time.map((e) => [e.id, e] as [string, TimeEntry]));
  const b = docBilling({ items, ps: { lines } }, stored, prefs);
  const standard = round2(view.sel.time.filter((e) => sel.time.some((x) => x.id === e.id)).reduce((s, e) => s + entryStandard(e, prefs), 0));
  const billed = b?.billed ?? 0;
  const diff = round2(billed - standard);
  const wd = standard > 0 && Math.abs(diff) >= 0.01 ? { standard, billed, reasons: [{ reason: i.reason || plan.reason || 'Rate override', amount: diff }] } : undefined;
  const staff = staffMap();
  const who = (ref?: string) => { const e = ref ? stored.get(ref) : undefined; return e?.staff_id ? staff.get(e.staff_id)?.name : undefined; };
  const annexure = saved.annexure && {
    ...saved.annexure,
    rows: withStandard(saved.annexure.rows, (ref) => (stored.has(ref) ? entryStandard(stored.get(ref)!, prefs) : undefined)).map((r) => (!r.who && who(r.ref) ? { ...r, who: who(r.ref) } : r)),
  };
  const ps = psSnapshot('fee', {
    ...(centre?.ps ? { matter: { id: centre.id, code: centre.ps.code, name: centre.name, ...(centre.ps.court ? { court: centre.ps.court } : {}), ...(centre.ps.case_no ? { case_no: centre.ps.case_no } : {}) } } : {}),
    ...(eng ? { engagement: { id: eng.id, number: eng.number, model: eng.model } } : {}),
    basis: plan.basis,
    wd,
    lines,
  });
  const next = buildBillDraft({ ...saved, ps }, saved.client, items, saved.sender ?? localDb.settings.activeProfile() ?? null, annexure || undefined);
  return localDb.invoices.save(next);
}

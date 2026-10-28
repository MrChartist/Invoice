/**
 * R17-B3 bridge: the month's bills as DRAFT tax invoices through the shared draft builder (`buildBillDraft`, the R3-B /
 * R15-B path: place of supply and GST mode from the client), with the A3 regime patch (`mpRegimePatch`: reverse-charge
 * flag and tax kept out of the total, or exempt lines with `sv.exempt`), the `mp` snapshot (site, month, basis, posts,
 * muster ids, annexure) and B4's expected client TDS. A muster already billed is skipped unless asked again (the view
 * warns and links the first bill). All or nothing. Working papers — verify with your CA (MP6, MP10, MP11, MP14).
 */
import type { Client, InvoiceRecord } from '../../types/invoice';
import { generateId } from '../storage';
import { requireAccess } from '../access';
import { localDb } from '../localDb';
import { withTablesRollback } from '../table-txn';
import { blankClient, makeDraft } from '../../store/invoice-defaults';
import { buildBillDraft } from '../timesheets';
import { loadSites } from './mp-sites';
import { firmForm, mpRegimePatch } from './mp-regime';
import { loadMusters, loadStaff } from './mp-muster';
import { billPlans, billsOf, type BillPlan } from './mp-bill';
import { readManpowerSettings } from './mp-settings';
import { clientTds, gstTdsHint } from './mp-tds-io';

/** The month's bill plans (nothing written). */
export function planMonth(month: string): BillPlan[] {
  return billPlans({ month, sites: loadSites(), musters: loadMusters(month), settings: readManpowerSettings(), clients: localDb.clients.getAll(), entityType: firmForm(), staff: loadStaff(), newId: generateId });
}

export interface BillResult { invoices: InvoiceRecord[]; skipped: string[]; hints: string[] }

/**
 * Make the drafts of a month (`doc.create`): every plan, or those of `siteIds`. A plan whose musters are all billed
 * already is skipped (`again` bills it once more).
 */
export function billMonth(month: string, siteIds?: readonly string[], again = false): BillResult {
  requireAccess('doc.create');
  const settings = readManpowerSettings();
  const all = localDb.invoices.getAll();
  const ours = firmForm();
  const out: BillResult = { invoices: [], skipped: [], hints: [] };
  const plans = planMonth(month).filter((p) => !siteIds || p.sites.some((s) => siteIds.includes(s.id)));
  if (!plans.length) throw new Error('Nothing to bill: lock the month\'s muster first.');
  return withTablesRollback(['invoices', 'series_counters'], () => {
    for (const p of plans) {
      const label = p.sites.map((s) => s.mp.code).join(', ');
      if (!again && p.musters.every((m) => billsOf(all, m.id).length)) {
        out.skipped.push(label);
        continue;
      }
      const client: Client = { ...blankClient(), ...localDb.clients.getById(p.client_id) };
      const sender = localDb.settings.activeProfile() ?? null;
      const base = makeDraft({ settings: localDb.settings.get(), sender, docType: 'INVOICE', templateId: localDb.template.get() });
      const patch = mpRegimePatch({ items: p.items, mp: p.mp }, p.regime);
      const draft = buildBillDraft({ ...base, ...patch, id: generateId(), issue_date: p.date, ...(p.sites.length === 1 ? { cost_centre_id: p.sites[0].id } : {}) }, client, patch.items ?? p.items, sender);
      const tds = clientTds(client, p.date, draft.taxable_value ?? p.taxable, all, ours);
      const saved = localDb.invoices.save({ ...draft, mp: { ...draft.mp, ...(tds ? { tds } : {}), ...(settings.print_tds && tds ? { tds_print: true } : {}) } });
      out.invoices.push(saved);
      const h = gstTdsHint(client, p.regime.regime, p.taxable, p.date);
      if (h) out.hints.push(`${label}: ${h}`);
    }
    return out;
  });
}

/**
 * R17-B3 bridge: the month's bills as DRAFT tax invoices through the shared draft builder (`buildBillDraft`, the R3-B /
 * R15-B path: place of supply and GST mode from the client), with the A3 regime patch (`mpRegimePatch`: reverse-charge
 * flag and tax kept out of the total, or exempt lines with `sv.exempt`), the `mp` snapshot (site, month, basis, posts,
 * muster ids, annexure) and B4's expected client TDS. A muster already billed is skipped unless asked again (the view
 * warns and links the first bill). All or nothing. R17-D1: arrears notes of a wage revision (`makeArrears`). Working papers — verify with your CA (MP6, MP10, MP11, MP14).
 */
import type { Client, InvoiceRecord } from '../../types/invoice';
import type { MpSnapshot, SiteMuster, WageRevision } from '../../types/manpower-r17';
import { generateId } from '../storage';
import { requireAccess } from '../access';
import { localDb } from '../localDb';
import { withTablesRollback } from '../table-txn';
import { blankClient, makeDraft } from '../../store/invoice-defaults';
import { buildBillDraft } from '../timesheets';
import { loadSites } from './mp-sites';
import { firmForm, forcedRegime, mpRegimePatch } from './mp-regime';
import { loadMusters, loadStaff, monthEnd } from './mp-muster';
import { mpArrears, type ArrearNote } from './mp-arrears';
import { createDebitNote } from '../documents';
import { todayInput } from '../utils';
import { round2 } from '../invoice-calc';
import { billPlans, billsOf, type BillPlan } from './mp-bill';
import { readManpowerSettings } from './mp-settings';
import { clientTds, gstTdsHint } from './mp-tds-io';

/**
 * The month's bill plans (nothing written). `keep` picks the musters to plan from (QA20 V1: billing leaves out a
 * muster a live bill already covers, so a group bill made after one of its sites was billed never bills it twice).
 */
export function planMonth(month: string, keep?: (m: SiteMuster) => boolean): BillPlan[] {
  const musters = loadMusters(month);
  return billPlans({ month, sites: loadSites(), musters: keep ? musters.filter(keep) : musters, settings: readManpowerSettings(), clients: localDb.clients.getAll(), entityType: firmForm(), staff: loadStaff(), newId: generateId });
}

/** QA20 V1: the plans of the musters no live bill covers yet (the view's "Unbilled" column). */
export const planUnbilled = (month: string): BillPlan[] => {
  const all = localDb.invoices.getAll();
  return planMonth(month, (m) => !billsOf(all, m.id).length);
};

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
  const mine = (p: BillPlan) => !siteIds || p.sites.some((s) => siteIds.includes(s.id));
  if (!planMonth(month).some(mine)) throw new Error('Nothing to bill: lock the month\'s muster first.');
  // QA20 V1: a muster a live bill covers is planned again only when asked ("Bill again") for its own site; a group
  // bill made later from the other sites of the group leaves it out (it used to bill the billed site twice).
  const billed = (m: SiteMuster) => billsOf(all, m.id).length > 0;
  const keep = (m: SiteMuster) => !billed(m) || (again && (!siteIds || siteIds.includes(m.site_id)));
  const sites = loadSites();
  out.skipped.push(...loadMusters(month).filter((m) => billed(m) && !keep(m) && (!siteIds || siteIds.includes(m.site_id))).map((m) => sites.find((s) => s.id === m.site_id)?.mp.code ?? m.site_id));
  const plans = planMonth(month, keep).filter(mine);
  return withTablesRollback(['invoices', 'series_counters'], () => {
    for (const p of plans) {
      const label = p.sites.map((s) => s.mp.code).join(', ');
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

/** R17-D1: the arrears of a typed revision against every billed month it reaches (nothing written). */
export function planArrears(revId: string): { rev: WageRevision | undefined; notes: ArrearNote[] } {
  const s = readManpowerSettings();
  const rev = s.wage_revisions?.find((r) => r.id === revId);
  return { rev, notes: rev ? mpArrears({ rev, revs: s.wage_revisions ?? [], sites: loadSites(), musters: loadMusters(), invoices: localDb.invoices.getAll(), settings: s }) : [] };
}

/**
 * R17-D1 "Make debit notes" (`doc.create`): one note per original invoice not yet raised for the revision (or of
 * `ofIds`), through the existing debit-note path (`createDebitNote`: DBN series, dated today, `doc_links`), in the
 * original's regime (reverse charge carried; Sl. 66 lines keep `sv.exempt`) and SAC; `mp.arrear` names the revision and
 * the original; the client's expected TDS on the note. `arrears_doc: 'invoice'` makes a draft supplementary invoice
 * instead (MP12). All or nothing.
 */
export function makeArrears(revId: string, ofIds?: readonly string[]): InvoiceRecord[] {
  requireAccess('doc.create');
  const s = readManpowerSettings();
  const { rev, notes } = planArrears(revId);
  const todo = notes.filter((n) => !n.raised.length && (!ofIds || ofIds.includes(n.of.id)));
  if (!rev || !todo.length) throw new Error('No arrears left to raise for this revision.');
  const all = localDb.invoices.getAll();
  const now = todayInput();
  return withTablesRollback(['invoices', 'series_counters', 'doc_links'], () => todo.map((n) => {
    const o = n.of;
    // QA20 V6: a note never predates its bill (a bill dated the month's end or the 1st of the next month may still be
    // ahead of today): dated the later of the two, so the client's FY total on that day includes the bill.
    const today = String(o.issue_date ?? '') > now ? String(o.issue_date) : now;
    const sites = [...new Set(n.lines.map((l) => l.site))];
    const cc = (k: number) => (sites.length > 1 && n.lines[k] ? { cost_centre_id: n.lines[k].site.id } : {});
    const grouped = !o.mp?.site;
    const mp: MpSnapshot = {
      ...(o.mp?.site ? { site: o.mp.site } : {}), month: o.mp?.month, ...(o.mp?.basis ? { basis: o.mp.basis } : {}), regime: o.mp?.regime, ...(o.mp?.decl ? { decl: o.mp.decl } : {}), ...(o.mp?.regime_note ? { regime_note: o.mp.regime_note } : {}),
      posts: n.lines.filter((l) => l.duties).map((l) => ({ post: l.post.name, sac: l.hsn, heads: l.post.heads, duties: l.duties, rate: l.delta, amount: l.amount, basis: l.post.basis, ...(grouped ? { site: l.site.mp.code } : {}) })),
      arrear: { rev_id: rev.id, from: rev.from > `${o.mp?.month}-01` ? rev.from : `${o.mp?.month}-01`, to: monthEnd(o.mp!.month!), of: o.id },
      arrear_rows: n.lines.filter((l) => l.duties).map((l) => ({ post: `${grouped ? `${l.site.mp.code} ` : ''}${l.post.name}`, month: l.month, duties: l.duties, delta: l.delta, amount: l.amount })),
    };
    const rate = (sac: string) => o.items?.find((x) => x.hsn === sac)?.tax_rate ?? o.items?.[0]?.tax_rate ?? 0;
    const client: Client = { ...blankClient(), ...o.client, ...(o.client?.id ? localDb.clients.getById(o.client.id) : {}) };
    // QA20 V6: the bill's own expected TDS (its rate) when the threshold test on the note's day does not see it
    // (the bill still a draft): the arrears are more consideration under the same contract.
    const tds = clientTds(client, today, n.amount, all, firmForm()) ?? (o.mp?.tds ? { ...o.mp.tds, expected: round2((n.amount * o.mp.tds.rate) / 100) } : null);
    const exempt = o.mp?.regime === 'exempt66' || o.mp?.regime === 'manual_exempt';
    let saved: InvoiceRecord;
    if (s.arrears_doc === 'invoice') {
      const sender = localDb.settings.activeProfile() ?? null;
      const base = makeDraft({ settings: localDb.settings.get(), sender, docType: 'INVOICE', templateId: localDb.template.get() });
      const items = n.lines.map((l, k) => ({ id: generateId(), name: l.name, hsn: l.hsn, unit: l.quantity === 1 && !l.duties ? 'NOS' : 'DUTY', quantity: l.quantity, rate: l.rate, amount: l.amount, type: 'Service', discount_percent: 0, tax_rate: rate(l.hsn), ...cc(k) }));
      const patch = mpRegimePatch({ items, mp }, forcedRegime(o.mp?.regime ?? 'fwd', today, o.mp?.regime_note));
      saved = localDb.invoices.save(buildBillDraft({ ...base, ...patch, id: generateId(), issue_date: today, ...(sites.length === 1 ? { cost_centre_id: sites[0].id } : {}) }, client, patch.items ?? items, sender));
    } else {
      saved = createDebitNote({ ...o, mp, tds_amount: undefined, tds_section: undefined }, { date: today, reason: `Wage revision ${rev.ref} from ${rev.from}`, lines: n.lines.map((l) => ({ name: l.name, quantity: l.quantity, rate: l.rate, hsn: l.hsn, unit: l.duties && l.post.basis === 'duty' ? 'DUTY' : 'NOS', tax_rate: rate(l.hsn) })) });
      if (exempt || sites.length > 1) saved = localDb.invoices.save({ ...saved, items: saved.items.map((l, k) => ({ ...l, ...(exempt ? { tax_rate: 0, sv: { ...l.sv, exempt: 'EXEMPT' } } : {}), ...cc(k) })) });
    }
    return tds ? localDb.invoices.save({ ...saved, mp: { ...saved.mp, tds } }) : saved;
  }));
}

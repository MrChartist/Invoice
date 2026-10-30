/**
 * PS-D5 billable compliance events of a CA / CS / CMA firm (derived, never stored):
 *  - returns filed per linked company and period, from the practice desk's read-only peek (`peekCompliance`, unchanged)
 *    — GSTR-1 / IFF → `gstr1`, GSTR-3B / CMP-08 → `gstr3b`, GSTR-9 / GSTR-4 → `gstr9`; TDS / TCS returns → `tds_return`;
 *  - DSC renewals (a DSC row whose validity starts in the month) and the monthly client checklist (items ticked);
 *  - UDINs of the month from the firm's own register; a monthly `retainer` when the client has a retainer fee.
 * Event key `ca:<client>:<kind>:<period>` (UDIN events `udin:<id>`); billed state comes from live invoice lines'
 * `bill_refs`, exactly like time entries (cancel the invoice → the events are unbilled again).
 */
import type { CaFeeEvent, ProfCaSettings, UdinRow } from '../../types/prof-r14';
import type { InvoiceRecord } from '../../types/invoice';
import type { PracticeTables } from '../practice';
import { liveInvoiceIds } from '../timesheets';
import { udinRef } from './ps-udin';

export interface CaEvent {
  key: string;
  client_id: string;
  company_id?: string;
  kind: CaFeeEvent;
  period: string;
  /** Day the work was done (filed / renewed / ticked / UDIN date). */
  date: string;
  label: string;
  udin?: string;
  billedBy?: string;
}

const FORM_KIND: Readonly<Record<string, CaFeeEvent>> = { GSTR1: 'gstr1', IFF: 'gstr1', GSTR3B: 'gstr3b', CMP08: 'gstr3b', GSTR9: 'gstr9', GSTR4: 'gstr9' };
const UDIN_KIND: Readonly<Record<UdinRow['kind'], CaFeeEvent>> = { certificate: 'certificate', tax_audit: 'tax_audit', gst_audit: 'tax_audit', stat_audit: 'stat_audit', other: 'certificate' };
export const caKey = (client: string, kind: string, period: string) => `ca:${client}:${kind}:${period}`;
const inMonth = (d: unknown, month: string) => String(d ?? '').slice(0, 7) === month;

/** Events of one linked company (its peeked tables) for `month` (`YYYY-MM`). */
export function companyEvents(clientId: string, companyId: string, t: PracticeTables | undefined, month: string): CaEvent[] {
  if (!t) return [];
  const out: CaEvent[] = [];
  for (const r of t.compliance ?? []) {
    const kind = r && FORM_KIND[r.form];
    if (!kind || !r.filed_on || !inMonth(r.filed_on, month)) continue;
    out.push({ key: caKey(clientId, kind, `${r.period_key}${r.gstin ? `:${r.gstin}` : ''}`), client_id: clientId, company_id: companyId, kind, period: r.period_key, date: r.filed_on, label: `${r.form} ${r.period_key}${r.gstin ? ` (${r.gstin})` : ''}` });
  }
  for (const m of t.tds_returns ?? []) {
    if (!m?.filed_on || !inMonth(m.filed_on, month)) continue;
    const period = `${m.fy}-Q${m.quarter}-${m.form}`;
    out.push({ key: caKey(clientId, 'tds_return', period), client_id: clientId, company_id: companyId, kind: 'tds_return', period, date: m.filed_on, label: `${m.form} FY${String(m.fy).slice(2)} Q${m.quarter}` });
  }
  for (const d of t.dsc_register ?? []) {
    if (!d?.valid_from || !inMonth(d.valid_from, month)) continue;
    out.push({ key: caKey(clientId, 'dsc_renewal', `${d.id}:${d.valid_from}`), client_id: clientId, company_id: companyId, kind: 'dsc_renewal', period: d.valid_from, date: d.valid_from, label: `DSC ${d.holder}` });
  }
  const ticked = (t.client_checklist ?? []).find((c) => c?.id === month)?.items.filter((i) => i.done_at) ?? [];
  if (ticked.length) {
    const last = ticked.map((i) => String(i.done_at).slice(0, 10)).sort().pop()!;
    out.push({ key: caKey(clientId, 'checklist', month), client_id: clientId, company_id: companyId, kind: 'checklist', period: month, date: last, label: `Monthly checklist ${month} (${ticked.length})` });
  }
  return out;
}

/** UDIN events of the month for a client (revoked ones out). */
export const udinEvents = (rows: readonly UdinRow[], clientId: string, month: string): CaEvent[] =>
  rows.filter((u) => u.client_id === clientId && !u.revoked && inMonth(u.date, month)).map((u) => ({ key: udinRef(u.id), client_id: clientId, kind: UDIN_KIND[u.kind], period: u.date, date: u.date, label: `${u.description || u.kind} (UDIN ${u.udin})`, udin: u.udin }));

/** Every event of `month` for the linked clients, with its billed state. `peeks` maps company id → peeked tables. */
export function caEvents(input: { settings: ProfCaSettings; peeks: ReadonlyMap<string, PracticeTables | undefined>; udins: readonly UdinRow[]; month: string; invoices: readonly InvoiceRecord[]; retainerClients?: ReadonlySet<string> }): CaEvent[] {
  const live = liveInvoiceIds(input.invoices);
  const out: CaEvent[] = [];
  const clients = new Set<string>();
  for (const l of input.settings.company_clients ?? []) {
    clients.add(l.client_id);
    out.push(...companyEvents(l.client_id, l.company_id, input.peeks.get(l.company_id), input.month));
  }
  for (const c of new Set([...clients, ...input.udins.map((u) => u.client_id)])) out.push(...udinEvents(input.udins, c, input.month));
  for (const c of input.retainerClients ?? []) out.push({ key: caKey(c, 'retainer', input.month), client_id: c, kind: 'retainer', period: input.month, date: `${input.month}-01`, label: `Retainer ${input.month}` });
  return out.map((e) => {
    const by = live.byRow.get(e.key)?.[0];
    return by ? { ...e, billedBy: by } : e;
  }).sort((a, b) => a.client_id.localeCompare(b.client_id) || a.date.localeCompare(b.date));
}

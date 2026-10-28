/**
 * R19 bridge to the shared document path (outside `f-logistics`). A: "Quote from sheet" — a draft QUOTATION built
 * through `buildBillDraft` (place of supply and GST mode from the client, the sender snapshot) with one line per sheet
 * row and `lg = { quote: true, lane }`, saved by `localDb.invoices.save`. B appends job billing here
 * (`localDb.invoices.saveMany`, `series-counters`, `trade/pure-agent.ts`, `fx.ts`, `currency-rates.ts`).
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { LgHead, LgRateSheet } from '../../types/logistics-r19';
import { generateId } from '../storage';
import { requireAccess } from '../access';
import { localDb } from '../localDb';
import { blankClient, blankItem, makeDraft } from '../../store/invoice-defaults';
import { buildBillDraft } from '../timesheets';
import { lgT } from '../../i18n/areas/logistics-r19a';
import { lgRateFor } from './lg-heads';

/** A draft quotation from a rate sheet for its client (or `clientId`); one currency per quotation. */
export function saveQuote(sheet: LgRateSheet, heads: readonly LgHead[], clientId: string, date: string): InvoiceRecord {
  requireAccess('doc.create');
  const cur = [...new Set(sheet.rows.map((r) => r.currency))];
  if (cur.length !== 1) throw new Error(lgT('eCurrency'));
  const client = localDb.clients.getById(clientId);
  if (!client) throw new Error(lgT('eClient'));
  const sender = localDb.settings.activeProfile() ?? null;
  const base = makeDraft({ settings: localDb.settings.get(), sender, docType: 'QUOTATION', templateId: localDb.template.get() });
  const items = sheet.rows.flatMap((r) => {
    const h = heads.find((x) => x.id === r.head_id);
    return h ? [{ ...blankItem(h.role === 'own' ? lgRateFor(h.kind, date)?.rate ?? 18 : 0), name: h.name, hsn: h.sac ?? '', unit: r.unit.replace('per_', '').toUpperCase(), rate: r.rate, ...(r.min ? { description: lgT('min', { v: r.min }) } : {}) }] : [];
  });
  const draft = buildBillDraft({ ...base, id: generateId(), issue_date: date, currency: cur[0], lg: { quote: true, lane: sheet.lane } }, { ...blankClient(), ...client }, items, sender);
  return localDb.invoices.save(draft);
}

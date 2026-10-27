/**
 * MF-B: a draft sales document (quotation from a job quote / print estimate, scrap invoice) built like the editor's own
 * draft — the active sender, the client snapshot, place of supply and totals — carrying the `mf` snapshot. Saved as a
 * Draft (numbered on save like any editor draft); the user opens it in the editor (`/invoice/<id>`) to review and issue.
 */
import type { Client, DocumentType, InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { MfSnapshot } from '../../types/mfg-r13';
import { localDb } from '../localDb';
import { blankClient, blankItem, makeDraft } from '../../store/invoice-defaults';
import { buildBillDraft } from '../timesheets';
import { num } from '../invoice-calc';
import { r2 } from './mf-b-db';

/** One sales line (quantity × rate) on the editor's blank line. */
export const mfLine = (p: Partial<InvoiceItem>): InvoiceItem => {
  const l = { ...blankItem(num(p.tax_rate)), type: 'Product' as const, ...p };
  return { ...l, amount: r2(num(l.quantity) * num(l.rate)) };
};

/** The client snapshot of a saved client (else a blank one with the typed name). */
export const clientOf = (id?: string, name = ''): Client => (id ? localDb.clients.getById(id) : undefined) ?? { ...blankClient(), name };

/** Build (not save) a draft document of `docType` on `date` with the lines and the `mf` snapshot. */
export function mfDraft(docType: DocumentType, date: string, client: Client, items: InvoiceItem[], mf: MfSnapshot, extra: Partial<InvoiceRecord> = {}): InvoiceRecord {
  const settings = localDb.settings.get();
  const sender = localDb.settings.activeProfile() ?? null;
  const base = { ...makeDraft({ settings, sender, docType, templateId: localDb.template.get() }), issue_date: date, ...extra };
  return { ...buildBillDraft(base, client, items, sender), mf };
}

/** Save the draft (the invoice table's own guards: role, period lock, numbering, audit). */
export const saveDraft = (rec: InvoiceRecord): InvoiceRecord => localDb.invoices.save(rec);

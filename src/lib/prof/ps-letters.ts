/**
 * PS-A2 engagement letters: the letter IS a quotation with proposal sections (R2-B3) and the client's offline / remote
 * acceptance (8G). "Make letter" drafts a quotation for the engagement's client with its fee lines, the profession's
 * starter sections (CA: SA 210 headings; legal; design; consulting / agency) and the `ps` engagement snapshot; when the
 * quote is accepted the engagement becomes active (`syncAcceptances`). Starter text is editable and never legal advice
 * (PS31).
 */
import './ps-registry';
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { Engagement, ProfKind } from '../../types/prof-r14';
import type { ProposalSection } from '../../types/sales-r2';
import { generateId, getTable, setTable } from '../storage';
import { localDb } from '../localDb';
import { num, round2 } from '../invoice-calc';
import { buildBillDraft, readTimePrefs } from '../timesheets';
import { blankClient, makeDraft } from '../../store/invoice-defaults';
import { requireAccess } from '../access';
import { milestoneAmount } from './ps-engagements';
import { psSnapshot } from './ps-snapshot';
import { PS_TABLES } from './ps-shared';

type Group = 'ca' | 'legal' | 'design' | 'consulting';
const groupOf = (k?: ProfKind): Group => (k === 'ca' || k === 'legal' || k === 'design' ? k : 'consulting');

/** Starter sections per profession: [title, body] (`{client}`, `{title}` filled in). */
export const LETTER_SECTIONS: Readonly<Record<Group, readonly [string, string][]>> = {
  ca: [
    ['Objective and scope', 'You have asked us to carry out {title}. This letter sets out the objective and scope of our work, our responsibilities and yours.'],
    ['Responsibilities of management', 'Management is responsible for the books of account, the information given to us and the internal controls over them.'],
    ['Inherent limitations', 'Our work is not designed to detect every error or fraud; we rely on the explanations and records you provide.'],
    ['Fees', 'Our fees are set out below. Government and portal fees paid on your behalf are recovered at actual as a pure agent.'],
    ['UDIN', 'Certificates and reports we sign carry a UDIN generated on the ICAI portal.'],
  ],
  legal: [
    ['Scope of work', 'We will act for {client} in {title}, as set out below. Any other work needs a fresh instruction.'],
    ['Fees', 'Our professional fees are set out below.'],
    ['Court fees and expenses', 'Court fees, stamp duty, process fees and other disbursements are paid on your behalf and recovered at actual.'],
    ['Client money', 'Money you deposit for expenses is held in our client account and accounted to you on request.'],
    ['No guarantee of outcome', 'We will act with due care; no outcome of any proceeding is or can be guaranteed.'],
  ],
  design: [
    ['Services by stage', 'Our services for {title} are delivered in the stages listed below.'],
    ['Fee on project cost', 'Our fee is a percentage of the approved project cost, revised when the cost is revised.'],
    ['Revisions', 'Design revisions after a stage is approved are charged separately.'],
    ['Site visits', 'Site visits beyond those agreed are charged per visit, with travel at actual.'],
  ],
  consulting: [
    ['Deliverables', 'For {client} we will deliver {title} as described below.'],
    ['Change requests', 'Work outside this scope is quoted and agreed in writing before it starts.'],
    ['Intellectual property', 'Deliverables pass to you on full payment; our tools and know-how remain ours.'],
    ['Payment terms', 'Invoices are payable within the agreed days; TDS, where deducted, must be certified to us.'],
  ],
};

/** Pure: the letter's fee lines from the engagement's model. */
export function letterLines(e: Engagement, sac: string, gst: number): InvoiceItem[] {
  const line = (name: string, rate: number, unit = 'NOS', quantity = 1): InvoiceItem => ({ id: generateId(), type: 'Service', name, hsn: sac, unit, quantity, rate: round2(rate), tax_rate: gst, discount_percent: 0, amount: round2(rate * quantity) });
  switch (e.model) {
    case 'fixed': return [line(`Professional fees — ${e.title} (fixed fee)`, num(e.fee))];
    case 'milestone': return (e.milestones ?? []).map((m, i, all) => line(`${m.label} (stage ${i + 1} of ${all.length})`, milestoneAmount(e, m)));
    case 'capped': return [line(`Professional fees — ${e.title}: time at agreed rates, capped at`, num(e.cap))];
    case 'blended': return [line(`Professional fees — ${e.title}: per hour (blended rate)`, num(e.blended_rate), 'HRS')];
    case 'retainer': return [line(`Retainer — ${e.title} (per month)`, num(e.fee))];
    case 'success': return [line(`Success fee — ${e.success?.event ?? e.title}`, num(e.success?.amount))];
    default: return [line(`Professional fees — ${e.title}: time at agreed hourly rates`, num(e.fee))];
  }
}

export const letterSections = (kind: ProfKind | undefined, vars: { client: string; title: string }): ProposalSection[] =>
  LETTER_SECTIONS[groupOf(kind)].map(([title, body]) => ({ id: generateId(), place: 'before', title, body: body.replace('{client}', vars.client).replace('{title}', vars.title) }));

/** Draft the engagement letter as a quotation and link it (`doc.create`); the engagement becomes "sent". */
export function makeLetter(engId: string): InvoiceRecord {
  requireAccess('doc.create');
  const all = getTable<Engagement>(PS_TABLES.engagements);
  const e = all.find((x) => x.id === engId);
  if (!e) throw new Error('This engagement is no longer on the list.');
  const settings = localDb.settings.get();
  const sender = localDb.settings.activeProfile() ?? null;
  const client = localDb.clients.getById(e.client_id) ?? { ...blankClient(), name: '' };
  const prefs = readTimePrefs();
  const base = makeDraft({ settings, sender, docType: 'QUOTATION', templateId: localDb.template.get() });
  const draft = buildBillDraft({ ...base, id: generateId(), doc_type: 'QUOTATION', currency: e.currency || base.currency }, client, letterLines(e, prefs.sac, num(prefs.gst_rate)), sender);
  draft.invoice_number = localDb.invoices.nextNumber(draft.issue_date, 'QUOTATION', sender?.invoicePrefix || undefined);
  draft.proposal_sections = letterSections(settings.prof_kind, { client: client.name, title: e.title });
  draft.ps = psSnapshot('fee', { engagement: { id: e.id, number: e.number, model: e.model } });
  const saved = localDb.invoices.save(draft);
  setTable(PS_TABLES.engagements, all.map((x) => (x.id === engId ? { ...x, letter_quote_id: saved.id, status: x.status === 'draft' ? 'sent' as const : x.status, updated_at: new Date().toISOString() } : x)));
  return saved;
}

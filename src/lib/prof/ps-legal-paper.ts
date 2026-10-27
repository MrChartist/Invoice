/**
 * R14 PS-B2 the advocate's paper: which document, the legal-services sentence and the editor patch that applies the
 * regime with existing mechanisms only — RCM → the outward reverse-charge flag (`rcm.ts`, tax shown, not collected);
 * exempt → the line's R10 exempt marker (`item.sv.exempt = 'EXEMPT'`, Table 8 exempt column); all-exempt from a registered
 * advocate → Bill of Supply; an unregistered advocate → "Fee memo", no tax, outside GST returns (as today). The snapshot
 * `ps.legal = { regime, entry }` prints the sentence (PS-A5 paper). Working paper — verify with your CA (PS1, PS2, PS40).
 */
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { PsSnapshot } from '../../types/prof-r14';
import { legalRegime, type LegalRegime, type LegalResult } from './ps-legal';

export type LegalDoc = 'fee_memo' | 'bill_of_supply' | 'tax_invoice';

/** The document a fee note becomes: unregistered → fee memo; registered with only exempt lines → Bill of Supply. */
export function legalDocKind(registered: boolean, regimes: readonly LegalRegime[]): LegalDoc {
  if (!registered) return 'fee_memo';
  return regimes.length > 0 && regimes.every((r) => r === 'exempt') ? 'bill_of_supply' : 'tax_invoice';
}

/** The document-level regime: any RCM line → rcm; all exempt → exempt; else taxable. */
export const docRegime = (regimes: readonly LegalRegime[]): LegalRegime =>
  regimes.includes('rcm') ? 'rcm' : regimes.length && regimes.every((r) => r === 'exempt') ? 'exempt' : 'taxable';

/** The sentence printed on the paper (English; the paper is the record — Hindi labels stay on screen). */
export function legalSentence(legal: { regime: LegalRegime; entry?: string } | null | undefined, registered: boolean): string {
  if (!legal || legal.regime === 'taxable') return registered ? '' : 'Not registered under GST.';
  const s = legal.regime === 'rcm'
    ? `Legal services — GST payable by the recipient under reverse charge (${legal.entry || 'N 13/2017-CT(R), entry 2'}).`
    : `Exempt — ${legal.entry || 'N 12/2017-CT(R), entry 45'}.`;
  return registered ? s : `Not registered under GST — legal services under reverse charge / exempt as stated. ${s}`;
}

export interface LegalApplyInput {
  record: Pick<InvoiceRecord, 'client' | 'items' | 'issue_date' | 'doc_type'> & { ps?: unknown };
  /** Sender has a GSTIN. */
  registered: boolean;
  senior?: boolean;
  /** The user's choice from the chip: every legal-services line takes this regime. */
  force?: LegalRegime;
  /** `prof_settings.legal`: enrolment no. and State Bar Council, printed under the name (snapshotted). */
  paper?: { enrolment?: string; bar_council?: string };
}

/**
 * The patch the editor applies once on a new fee note (the user may change it after): per-line regimes, the document
 * regime, the reverse-charge flag, exempt markers, Bill of Supply and the `ps.legal` snapshot.
 */
export function legalPatch(i: LegalApplyInput): { regime: LegalResult; doc: LegalDoc; patch: Partial<InvoiceRecord> & { ps: PsSnapshot } } {
  const date = String(i.record.issue_date ?? '').slice(0, 10);
  const per = (i.record.items ?? []).map((l) => {
    const r = legalRegime({ client: i.record.client, line: l, supplier: { senior: i.senior }, date });
    if (!i.force || r.reason === 'non_legal' || i.force === r.regime) return r;
    const rule = legalRegime({ client: i.force === 'rcm' ? { ps: { entity: 'business' } } : {}, line: l, date });
    return { ...rule, regime: i.force, entry: i.force === 'taxable' ? '' : rule.entry };
  });
  const regimes = per.map((r) => r.regime);
  const regime = docRegime(regimes);
  const first = per.find((r) => r.regime === regime) ?? legalRegime({ client: i.record.client, supplier: { senior: i.senior }, date });
  const doc = legalDocKind(i.registered, regimes);
  const items = (i.record.items ?? []).map((l, k): InvoiceItem => {
    if (!i.registered) return { ...l, tax_rate: 0 };
    if (per[k].regime !== 'exempt') {
      if (l.sv?.exempt !== 'EXEMPT') return l;
      const { exempt: _e, ...sv } = l.sv;
      return { ...l, tax_rate: 18, sv } as InvoiceItem; // was marked exempt by an earlier choice: legal services at 18 %
    }
    return { ...l, tax_rate: 0, sv: { ...(l.sv ?? {}), exempt: 'EXEMPT' } } as InvoiceItem;
  });
  const ps: PsSnapshot = { ...((i.record.ps as PsSnapshot | undefined) ?? {}), legal: { regime, entry: first.entry, ...(i.paper?.enrolment ? { enrolment: i.paper.enrolment } : {}), ...(i.paper?.bar_council ? { bar_council: i.paper.bar_council } : {}) }, ...(doc === 'fee_memo' ? { kind: 'memo' as const, unregistered: true } : {}) };
  const patch: Partial<InvoiceRecord> & { ps: PsSnapshot } = { items, ps };
  if (doc === 'bill_of_supply') Object.assign(patch, { doc_type: 'BILL_OF_SUPPLY', reverse_charge: false, rcm_tax_excluded: undefined });
  else if (i.registered) Object.assign(patch, regime === 'rcm' ? { reverse_charge: true, rcm_tax_excluded: true } : { reverse_charge: false, rcm_tax_excluded: undefined }, i.record.doc_type === 'BILL_OF_SUPPLY' ? { doc_type: 'TAX_INVOICE' } : {});
  else Object.assign(patch, { gst_mode: 'NONE', reverse_charge: false, rcm_tax_excluded: undefined });
  return { regime: first, doc, patch };
}

/**
 * R14 PS-B2 legal services: reverse charge or exemption by client type (pure).
 *  - N 13/2017-CT(R) entry 2: legal services by an individual advocate (incl. a senior advocate) or a firm of advocates
 *    to a business entity → the recipient pays (RCM);
 *  - N 12/2017-CT(R) entry 45: to another advocate / firm of advocates, to a person other than a business entity, or to a
 *    business entity with turnover up to the threshold in the preceding FY → exempt (a senior advocate's supply to an
 *    advocate is not exempted, as reported);
 *  - a line outside SAC 9982 (a law firm's tax filing service …) → forward charge.
 * Inputs are snapshots (`Client.ps`, `Vendor.ps`, `prof_settings.legal`), the rule rows dated (`LEGAL_SERVICES_RULES`).
 * The app suggests; the user can change it per document. Working paper — verify with your CA (PS1, PS2).
 */
import { ruleAt } from '../tax-rules';
import { LEGAL_SERVICES_RULES } from './ps-b-rules';

export type LegalRegime = 'rcm' | 'exempt' | 'taxable';
export type LegalReason = 'non_legal' | 'advocate' | 'senior_to_advocate' | 'gstin' | 'business' | 'small_business' | 'person';

/** The PS-B part of `Client.ps` / `Vendor.ps` (declared in `types/prof-r14.ts`). */
export interface PsPartyB {
  entity?: 'business' | 'individual' | 'government' | 'advocate';
  small_business?: boolean;
  advocate?: boolean;
}
export const psOfParty = (p: unknown): PsPartyB => ((p as { ps?: PsPartyB } | null)?.ps ?? {});

export interface LegalInput {
  client: { gstin?: string; ps?: unknown } | null | undefined;
  line?: { hsn?: string } | null;
  /** The supplier: a senior advocate (`prof_settings.legal.senior`). */
  supplier?: { senior?: boolean } | null;
  date?: string;
}

export interface LegalResult {
  regime: LegalRegime;
  reason: LegalReason;
  /** Notification entry printed with the sentence ('' for forward charge). */
  entry: string;
  verified: boolean;
}

const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');

/** Is this a legal-services line? An empty SAC counts as legal on an advocate's fee note. */
export const isLegalLine = (line: { hsn?: string } | null | undefined, date?: string): boolean => {
  const sac = digits(line?.hsn);
  return !sac || sac.startsWith(ruleAt(LEGAL_SERVICES_RULES, date).sac);
};

export function legalRegime(i: LegalInput): LegalResult {
  const row = LEGAL_SERVICES_RULES.reduce((hit, r) => (r.from <= (i.date ?? '9999') ? r : hit), LEGAL_SERVICES_RULES[0]);
  const r = row.value;
  const out = (regime: LegalRegime, reason: LegalReason, verified = row.verified): LegalResult => ({ regime, reason, entry: regime === 'rcm' ? r.rcm : regime === 'exempt' ? r.exempt : '', verified });
  if (!isLegalLine(i.line, i.date)) return out('taxable', 'non_legal', true);
  const ps = psOfParty(i.client);
  if (ps.advocate || ps.entity === 'advocate') return i.supplier?.senior ? out('rcm', 'senior_to_advocate', false) : out('exempt', 'advocate');
  const business = !!String(i.client?.gstin ?? '').trim() || ps.entity === 'business';
  if (!business) return out('exempt', 'person');
  if (ps.small_business) return out('exempt', 'small_business');
  return out('rcm', String(i.client?.gstin ?? '').trim() ? 'gstin' : 'business', true);
}

/** Inward side: a bill from an advocate (`Vendor.ps.advocate`) with a legal SAC → the RCM reference, unless we are small. */
export function advocateInward(lines: readonly { hsn?: string }[], vendor: unknown, date: string, weAreSmall = false): string | null {
  if (!psOfParty(vendor).advocate || weAreSmall) return null;
  const sac = ruleAt(LEGAL_SERVICES_RULES, date).sac;
  return lines.some((l) => digits(l.hsn).startsWith(sac)) ? ruleAt(LEGAL_SERVICES_RULES, date).rcm : null;
}

/** Billing unit of a work type (`WorkType.ps.unit`): an appearance bills per entry, not per minute. */
export type WorkUnit = 'hour' | 'appearance' | 'item';
export const workUnitOf = (w: unknown): WorkUnit => {
  const u = (w as { ps?: { unit?: unknown } } | null)?.ps?.unit;
  return u === 'appearance' || u === 'item' ? u : 'hour';
};

/**
 * Per-appearance billing: entries of an appearance / item work type become one line of `count` × the fee (the work
 * type's rate, else the entry's rate); time still counts for realisation.
 */
export function appearanceLines(entries: readonly { work_type_id?: string; hourly_rate?: number; date: string }[], workTypes: readonly { id: string; name: string; rate?: number; ps?: unknown }[]): { name: string; quantity: number; rate: number; unit: string; work_type_id: string }[] {
  const out = new Map<string, { name: string; quantity: number; rate: number; unit: string; work_type_id: string }>();
  for (const e of entries) {
    const w = workTypes.find((x) => x.id === e.work_type_id);
    if (!w || workUnitOf(w) === 'hour') continue;
    const rate = Number(w.rate) > 0 ? Number(w.rate) : Number(e.hourly_rate) || 0;
    const k = `${w.id}|${rate}`;
    const row = out.get(k) ?? { name: w.name, quantity: 0, rate, unit: workUnitOf(w) === 'appearance' ? 'NOS' : 'OTH', work_type_id: w.id };
    row.quantity++;
    out.set(k, row);
  }
  return [...out.values()];
}

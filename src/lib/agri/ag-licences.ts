/**
 * AG-D4 dealer licences and principal certificates (`agri_settings.licences` / `.principals`, owner only):
 *  - expiry notices with R9's `licenceNotices` maths (60-day window; 45 days and less is "due soon"; expired);
 *  - a sale of an item whose `ag_class` needs a licence kind with none valid on the bill date → warning (never a
 *    block — the law punishes, the app reminds);
 *  - a purchase of a licensed class from a manufacturer with no valid principal certificate / O-form → warning;
 *  - expiry policy by class (`DEALER_CLASS_RULES`): pesticides and seeds block the sale of an expired batch,
 *    fertilisers warn (`ag-expiry.ts` applies it in the stock checks). Working paper — verify AG21.
 * Purchases are read through `readPurchase` / `readPurchaseLines` (purchase contract). Pure.
 */
import type { AgriLicence, AgriLicenceKind, AgriPrincipal } from '../../types/agri-r12d';
import type { DrugLicence } from '../../types/retail-r9';
import { ruleAt } from '../tax-rules';
import { isVoidStatus, readPurchase, readPurchaseLines } from '../purchase-normalize';
import { licenceNotices } from '../retail/rt-pharmacy-registers';
import { DEALER_CLASS_RULES } from '../agri-rules';
export { classIndex } from './ag-expiry';

export const LICENCE_KINDS: readonly AgriLicenceKind[] = ['fertiliser_retail', 'fertiliser_wholesale', 'seed', 'insecticide', 'fssai', 'apmc', 'other'];
export const SOON_DAYS = 45;

/** Licences expiring within 60 days or expired, with days left (R9 maths, read only). */
export function agriLicenceNotices(licences: readonly AgriLicence[] | undefined, today: string): { licence: AgriLicence; expired: boolean; soon: boolean }[] {
  const soonBy = licenceNotices((licences ?? []) as unknown as DrugLicence[], today, SOON_DAYS).map((n) => n.licence as unknown as AgriLicence);
  return licenceNotices((licences ?? []) as unknown as DrugLicence[], today).map((n) => ({ licence: n.licence as unknown as AgriLicence, expired: n.expired, soon: soonBy.includes(n.licence as unknown as AgriLicence) }));
}

const validOn = (l: { valid_from?: string; valid_to?: string }, day: string) => (!l.valid_from || l.valid_from <= day) && (!l.valid_to || l.valid_to >= day);

/** The class rule (licence kinds needed, expiry policy) by date. */
export const classRules = (date?: string) => ruleAt(DEALER_CLASS_RULES, date);


/** Warnings for sale lines of a class that needs a licence with none valid on `date`. */
export function unlicensedWarnings(lines: readonly { name: string; ag_class?: string }[], licences: readonly AgriLicence[] | undefined, date: string, classOf: (name: string) => string | undefined): string[] {
  const rules = classRules(date);
  const out: string[] = [];
  for (const l of lines) {
    const cls = l.ag_class ?? classOf(l.name.trim().toLowerCase());
    const need = cls ? rules[cls]?.licence : undefined;
    if (!need || (licences ?? []).some((x) => need.includes(x.kind) && validOn(x, date))) continue;
    out.push(`${l.name}: no valid ${need.join(' / ').replace(/_/g, ' ')} licence on ${date} — renew or add it (verify AG21).`);
  }
  return [...new Set(out)];
}

const PRINCIPAL_KIND: Readonly<Record<string, AgriPrincipal['kind']>> = { fertiliser: 'fertiliser', fert_input: 'fertiliser', micronutrient: 'fertiliser', pesticide_chem: 'insecticide', biopesticide: 'insecticide', seed_sowing: 'seed' };

/** Purchases of licensed classes from a supplier with no valid principal certificate of that kind on the bill date. */
export function principalWarnings(purchases: readonly unknown[], principals: readonly AgriPrincipal[] | undefined, classOf: (name: string) => string | undefined): { bill: string; date: string; vendor: string; kind: AgriPrincipal['kind'] }[] {
  const out: { bill: string; date: string; vendor: string; kind: AgriPrincipal['kind'] }[] = [];
  for (const raw of purchases) {
    const p = readPurchase(raw);
    if (!p || p.isExpense || isVoidStatus(p.status)) continue;
    const vendorId = String((raw as { vendor_id?: string }).vendor_id ?? '');
    const kinds = new Set(readPurchaseLines(raw).map((l) => PRINCIPAL_KIND[classOf(l.name.trim().toLowerCase()) ?? '']).filter(Boolean));
    for (const kind of kinds) {
      if ((principals ?? []).some((c) => c.kind === kind && (c.vendor_id === vendorId || (!!c.vendor_name && c.vendor_name.trim().toLowerCase() === p.partyName.trim().toLowerCase())) && validOn(c, p.date))) continue;
      out.push({ bill: p.number, date: p.date, vendor: p.partyName, kind });
    }
  }
  return out;
}

/** The licence lines printed in the dealer block (valid on the bill date). */
export const licenceLines = (licences: readonly AgriLicence[] | undefined, date: string) => (licences ?? []).filter((l) => l.number.trim() && validOn(l, date)).map((l) => ({ kind: l.kind, number: l.number, ...(l.valid_to ? { valid_to: l.valid_to } : {}) }));

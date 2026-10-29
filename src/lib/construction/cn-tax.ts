/**
 * CN-A2: works-contract tax classes, place of supply = site State (Sec 12(3)) and the declarations printed on a works
 * bill. A class only SUGGESTS a rate / SAC by document date (`WORKS_CLASS_RULES`); a typed rate always wins and a
 * different typed rate is a soft notice. Pure. Working paper — verify with your CA (CN1–CN4).
 */
import type { CnClass, CnLine, CnSite } from '../../types/construction-r11';
import { ruleAt } from '../tax-rules';
import { CONFLICTING_CLASSES, WORKS_CLASS_RULES, type WorksClassRate } from '../construction-rules';
import { deriveGstMode, num } from '../invoice-calc';
import { resolveStateCode, stateByCode } from '../india-states';
import type { GstMode } from '../../types/invoice';

export const CN_CLASSES: readonly CnClass[] = ['wc_general', 'wc_govt', 'wc_govt_earthwork', 'wc_subcon_govt', 'pure_labour_exempt', 'supply_goods', 'install_service', 'manpower'];

export const isCnClass = (v: unknown): v is CnClass => typeof v === 'string' && ((CN_CLASSES as readonly string[]).includes(v) || /^realty_(affordable|residential|commercial|old_option)$/.test(v));

/** What the class suggests on `date` (undefined for a class this file does not price, e.g. CN-C's realty classes). */
export function classRate(cls: CnClass | undefined, date?: string): WorksClassRate | undefined {
  if (!cls) return undefined;
  return ruleAt(WORKS_CLASS_RULES, date)[cls];
}

/** "Sources conflict — verify (CN1)" classes. */
export const classConflicts = (cls: CnClass | undefined): boolean => !!cls && CONFLICTING_CLASSES.includes(cls);

/** Soft notice: the typed rate differs from the class (supply of goods = the line's own HSN rate, never a notice). */
export function rateDiffers(typedRate: number, cls: CnClass | undefined, date?: string): boolean {
  const r = classRate(cls, date);
  return !!r && r.rate !== null && Math.abs(num(typedRate) - r.rate) > 1e-9;
}

/** The rate a line gets: a typed rate wins; else the class suggestion; else `fallback`. */
export function suggestedRate(cls: CnClass | undefined, date: string | undefined, typed?: number | null, fallback = 18): number {
  if (typed !== undefined && typed !== null && String(typed) !== '') return num(typed);
  const r = classRate(cls, date);
  return r && r.rate !== null ? r.rate : fallback;
}

/* ── Place of supply = site (Sec 12(3)) ── */

/** The site's State code ('' when unknown). */
export const siteState = (site: CnSite | undefined): string => (site?.state_code ? resolveStateCode({ code: site.state_code }) : '');

/**
 * Place of supply and GST mode for a works bill: the site State when known (Sec 12(3)), else `fallback` (the BOQ's).
 * IGST / CGST + SGST then follow the existing rule (`deriveGstMode`).
 */
export function worksPlaceOfSupply(site: CnSite | undefined, fallback: string | undefined, sender: { state: string; hasGstin: boolean; taxEnabled?: boolean }): { place_of_supply: string; gst_mode: GstMode; fromSite: boolean } {
  const s = siteState(site);
  const pos = s || fallback || '';
  return { place_of_supply: pos, gst_mode: deriveGstMode({ senderStateCode: sender.state, placeOfSupply: pos, senderHasGstin: sender.hasGstin, taxEnabled: sender.taxEnabled ?? true }), fromSite: !!s };
}

/**
 * One-time notice when the site State is not the State of any sender profile's GSTIN (CN4). '' when registered there
 * or the site State is unknown.
 */
export function otherStateNotice(site: CnSite | undefined, senderStates: readonly string[]): string {
  const s = siteState(site);
  if (!s || senderStates.filter(Boolean).includes(s)) return '';
  const name = stateByCode(s)?.name ?? s;
  return `Services for immovable property are supplied where the property is (Sec 12(3)); you may need registration in ${name}: verify with your CA (CN4).`;
}

/* ── Declarations (CN-A2 AC4): in `cn-print.ts` (the paper chunk prints them) ── */
export { DECLARATION_TEXT, PURE_LABOUR_TEXT, declarationKind, worksDeclarations, type WorksDeclarationKind } from './cn-print';

/* ── Supply + installation split (MEP / interiors, CN3) ── */

/** The editor caution: one document mixes supply-of-goods and installation lines. */
export const mixedSupplyInstall = (classes: readonly (CnClass | undefined)[]): boolean => classes.includes('supply_goods') && classes.includes('install_service');

export const SPLIT_CAUTION = 'If the installation makes the goods part of the building, the whole contract is a works contract at the works rate: check with your CA (CN3).';

/** "Treat as works contract": supply / installation lines become `wc_general` (other classes unchanged). */
export function reclassAsWorks(lines: Readonly<Record<string, CnLine>>): Record<string, CnLine> {
  return Object.fromEntries(Object.entries(lines).map(([id, l]) => [id, l.cls === 'supply_goods' || l.cls === 'install_service' ? { ...l, cls: 'wc_general' as const } : { ...l }]));
}

/**
 * CN-A5: what the deductions block of a works bill prints — the `ra_deductions` snapshot grouped Statutory / Recoveries
 * / Held / Other, net payable in figures and words, the notes and the certificate. Every amount comes from the
 * snapshot (`ra_deductions`, `ra_net_payable`); nothing is recomputed at print. Pure. Working paper — verify with your CA.
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { RaDeduction, RaDeductionKind } from '../../types/transport-works-r5';
import type { CnClass, CnHeader, CnLine, CnSnapshot } from '../../types/construction-r11';
import { num, round2 } from '../invoice-calc';

export type DeductionGroup = 'statutory' | 'recoveries' | 'held' | 'other';

/** Every deduction kind's group (the six CN-B kinds included, so B only fills the maths). */
export const DEDUCTION_GROUP: Readonly<Record<RaDeductionKind, DeductionGroup>> = {
  it_tds: 'statutory', gst_tds: 'statutory', labour_cess: 'statutory',
  advance_recovery: 'recoveries', secured_advance: 'recoveries', material_recovery: 'recoveries', water_power: 'recoveries', hire_charges: 'recoveries', advance_interest: 'recoveries',
  retention: 'held', security_deposit: 'held', withheld: 'held',
  ld: 'other', other: 'other',
};

export const GROUP_ORDER: readonly DeductionGroup[] = ['statutory', 'recoveries', 'held', 'other'];
export const GROUP_TITLE: Readonly<Record<DeductionGroup, string>> = { statutory: 'Statutory', recoveries: 'Recoveries', held: 'Held', other: 'Other' };

export interface DeductionGroupRows {
  group: DeductionGroup;
  rows: RaDeduction[];
  total: number;
}

/** Pure: the deductions grouped in print order (empty groups dropped; an unknown kind prints under Other). */
export function groupDeductions(deds: readonly RaDeduction[] | undefined): DeductionGroupRows[] {
  const list = (deds ?? []).filter((d) => d && num(d.amount) !== 0);
  return GROUP_ORDER.map((group) => {
    const rows = list.filter((d) => (DEDUCTION_GROUP[d.kind] ?? 'other') === group);
    return { group, rows, total: round2(rows.reduce((s, d) => s + num(d.amount), 0)) };
  }).filter((g) => g.rows.length > 0);
}

export const deductionsTotal = (deds: readonly RaDeduction[] | undefined): number => round2((deds ?? []).reduce((s, d) => s + num(d.amount), 0));

/** Net payable as stored on the bill (`ra_net_payable`); a bill without it: total − Σ deductions. */
export function netPayableOf(inv: Pick<InvoiceRecord, 'total' | 'ra_net_payable' | 'ra_deductions'>): number {
  return inv.ra_net_payable !== undefined && Number.isFinite(Number(inv.ra_net_payable)) ? round2(num(inv.ra_net_payable)) : round2(num(inv.total) - deductionsTotal(inv.ra_deductions));
}


/** Notes printed under the deductions (only for the rows that exist). `money` formats an amount. */
export function deductionNotes(deds: readonly RaDeduction[] | undefined, money: (n: number) => string): string[] {
  const list = deds ?? [];
  if (!list.length) return [];
  const sum = (k: RaDeductionKind) => round2(list.filter((d) => d.kind === k).reduce((s, d) => s + num(d.amount), 0));
  const out = ['GST is charged on the full bill value; deductions do not reduce it.'];
  if (sum('gst_tds') > 0) out.push(`GST TDS u/s 51 (${money(sum('gst_tds'))}) to be deducted by the recipient — credit after GSTR-7.`);
  if (sum('labour_cess') > 0) out.push(`Labour cess deducted at source (${money(sum('labour_cess'))}).`);
  return out;
}

/** The declaration lines of a works document (composite supply / supply + installation / pure labour). */
export const cnDeclarations = (cn: CnSnapshot | undefined, isRaBill: boolean): string[] => (cn || isRaBill ? worksDeclarations(cn?.lines, !!cn?.works || isRaBill) : []);

/** One row of the "Contract particulars" box: `key` names its paper label (`p.<key>`); empty values are dropped. */
export interface HeaderRow {
  key: 'nameOfWork' | 'agreement' | 'workOrder' | 'tender' | 'clientOffice' | 'engineer' | 'site' | 'contractValue' | 'stipulated' | 'extended' | 'bill' | 'period' | 'measuredOn' | 'mbNos' | 'jv';
  value: string;
  wide?: boolean;
}

/** Pure: the contract-particulars rows of a header snapshot, in print order (empty fields skipped). */
export function headerRows(h: CnHeader | undefined, fmt: { date: (d: string) => string; money: (n: number) => string; state: (code: string) => string }): HeaderRow[] {
  if (!h) return [];
  const d = (v?: string) => (v ? fmt.date(v) : '');
  const pair = (a?: string, b?: string) => [a, d(b)].filter(Boolean).join(' · ');
  const rows: HeaderRow[] = [
    { key: 'nameOfWork', value: h.name_of_work ?? '', wide: true },
    { key: 'agreement', value: pair(h.agreement_no, h.agreement_date) },
    { key: 'workOrder', value: pair(h.work_order_no, h.work_order_date) },
    { key: 'tender', value: h.tender_ref ?? '' },
    { key: 'clientOffice', value: h.client_office ?? '' },
    { key: 'engineer', value: h.engineer ?? '' },
    { key: 'site', value: h.site ? [h.site.address, h.site.state_code ? fmt.state(h.site.state_code) : ''].filter(Boolean).join(', ') : '', wide: true },
    { key: 'contractValue', value: num(h.contract_value) > 0 ? fmt.money(num(h.contract_value)) : '' },
    { key: 'stipulated', value: [d(h.stipulated_start), d(h.stipulated_completion)].filter(Boolean).join(' – ') },
    { key: 'extended', value: d(h.extended_completion) },
    { key: 'bill', value: h.ra_label ?? '' },
    { key: 'period', value: [d(h.period_from), d(h.period_to)].filter(Boolean).join(' – ') },
    { key: 'measuredOn', value: d(h.measured_on) },
    { key: 'mbNos', value: (h.mb_nos ?? []).join(', ') },
    { key: 'jv', value: h.jv_note ?? '' },
  ];
  return rows.filter((r) => r.value);
}

/* ── Declarations (CN-A2 AC4) ── */

export type WorksDeclarationKind = 'works' | 'supply_install' | 'none';

/** Which declaration a works document prints, from its line classes. */
export function declarationKind(classes: readonly (CnClass | undefined)[], works: boolean): WorksDeclarationKind {
  if (classes.includes('supply_goods')) return 'supply_install';
  if (works || classes.some((c) => c && c.startsWith('wc_'))) return 'works';
  return 'none';
}

export const DECLARATION_TEXT: Readonly<Record<Exclude<WorksDeclarationKind, 'none'>, string>> = {
  works: 'Composite supply of works contract as defined in Sec 2(119) of the CGST Act, 2017.',
  supply_install: 'Supply of goods with installation (the supply part at the goods rate; installation as a service).',
};

export const PURE_LABOUR_TEXT = 'Exempt — pure labour (verify with your CA, CN2).';

/** The declaration lines of a works document ('' entries dropped). */
export function worksDeclarations(lines: Readonly<Record<string, CnLine>> | undefined, works: boolean): string[] {
  const classes = Object.values(lines ?? {}).map((l) => l.cls);
  const k = declarationKind(classes, works);
  return [k === 'none' ? '' : DECLARATION_TEXT[k], classes.includes('pure_labour_exempt') ? PURE_LABOUR_TEXT : ''].filter(Boolean);
}


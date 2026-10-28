/**
 * Security, facility-management and manpower-supply statutory values (Round 17), keyed by the date they take effect —
 * the `Versioned` / `ruleAt` shape of `tax-rules.ts`: add a new dated row, never edit an old one. Imported only by lazy
 * Round 17 modules (`src/lib/manpower/*`) — never by `tax-rules.ts`, `tds-rules.ts`, `shop-mode.ts` or the shell
 * (`tests/mp-rules.test.ts` checks the import graph). Values that already live elsewhere stay there and are read through
 * bridges: contractor TDS / "manpower is work" (`tds-rules.ts`, `ita2025.ts`), GST TDS u/s 51
 * (`transport-works-rules.ts`), PF / ESI / PT / bonus / gratuity (`payroll-rules.ts`). No minimum-wage or VDA amounts:
 * the user types the revision that applies to each post (PRD §1.6).
 *
 * A row is `verified: true` only when its value was read in a primary text in Round 17 (PRD §2.4; the source then
 * says "Read (R17)"). One section per package. Working papers — verify with your CA (docs/CA_REVIEW.md §17).
 */
import type { Versioned } from './tax-rules';

/** A dated manpower rule row: `source` plus whether the value was read in a primary text this round. */
export type MpRule<T> = Versioned<T> & { verified: boolean };

/* ── R17-A: GST on manpower / security / cleaning, SAC, RCM entry 14, Sl. 66 (MP1, MP2, MP4, MP5, MP7, MP9) ───── */

/** Heading 9985 "support services other than tour operators": the GST rate (MP4). */
export const MP_GST_RATE_RULES: readonly MpRule<number>[] = [
  { from: '2017-07-01', value: 18, source: 'N 11/2017-CT(R) Sl. 23(ii) (9 % CGST + 9 % SGST). Read (R17): 2017 text, gstcouncil.gov.in (MP4)', verified: true },
  { from: '2025-09-22', value: 18, source: 'GST 2.0 rate changes: support services under 9985 not found among the changes (as reported; MP4)', verified: false },
];

/** SAC per kind of post (Annexure to N 11/2017-CT(R), MP5). */
export interface MpSacTable { guard: string; security: string; cleaning: string; cleaning_other: string; contract: string; temp: string; payroll: string; labour: string }

export const MP_SAC_RULES: readonly MpRule<MpSacTable>[] = [
  { from: '2017-07-01', value: { guard: '998525', security: '998529', cleaning: '998533', cleaning_other: '998539', contract: '998513', temp: '998514', payroll: '998515', labour: '998519' }, source: 'Scheme of classification of services, Annexure to N 11/2017-CT(R), groups 99851 / 99852 / 99853. Read (R17): annexure PDF, gstcouncil.gov.in (MP5)', verified: true },
];

/** Entry 14 of N 13/2017-CT(R): the SAC prefix it covers, the recipient exclusions and the printed sentence (MP1, MP10). */
export interface SecurityRcm { sac: string; exclude: readonly ('gst_tds_only' | 'composition')[]; decl: string }

export const SECURITY_RCM_RULES: readonly MpRule<SecurityRcm | null>[] = [
  { from: '2017-07-01', value: null, source: 'No reverse charge on security services before 1 Jan 2019 (N 29/2018-CT(R) para 2)', verified: false },
  {
    from: '2019-01-01',
    value: { sac: '99852', exclude: ['gst_tds_only', 'composition'], decl: 'Tax payable on reverse charge by the recipient — security services supplied by a person other than a body corporate (N 13/2017-CT(R) entry 14, inserted by N 29/2018-CT(R)). Verify with your CA.' },
    source: 'N 29/2018-CT(R) dated 31 Dec 2018, entry 14, provisos (i)(a)–(c) and (ii), para 2. Read (R17): gstcouncil.gov.in PDF (MP1)',
    verified: true,
  },
];

/** Our firm forms that are a body corporate for entry 14 (forward charge); every other form → RCM (MP2). */
export const BODY_CORPORATE_RULES: readonly MpRule<readonly string[]>[] = [
  { from: '2019-01-01', value: ['company', 'llp'], source: 'Companies Act 2013 Sec 2(11); LLP as body corporate per AAR Haryana (as reported: livelaw, taxtmi; MP2)', verified: false },
];

/** Sl. 66(b)(iii) of N 12/2017-CT(R): security / cleaning / housekeeping in a school (MP7). */
export interface EduExempt { sacs: readonly string[]; decl: string }

export const EDU_EXEMPT_RULES: readonly MpRule<EduExempt>[] = [
  { from: '2017-07-01', value: { sacs: ['99852', '99853'], decl: 'Exempt — security / cleaning / house-keeping services performed in an educational institution up to higher secondary (N 12/2017-CT(R) Sl. 66(b)(iii)). Verify with your CA.' }, source: 'N 12/2017-CT(R) Sl. 66(b)(iii) and proviso. Read (R17): 2017 text, gstcouncil.gov.in; amendments after 2017 not read (MP7)', verified: true },
];

/** N 5/2017-CT: a supplier of only reverse-charge supplies need not register (note only, MP9). */
export const RCM_ONLY_REG_RULES: readonly MpRule<string>[] = [
  { from: '2017-06-22', value: 'Only reverse-charge supplies: registration may not be required (N 5/2017-CT). Verify with your CA (MP9).', source: 'N 5/2017-Central Tax dated 19 Jun 2017. Read (R17): gstcouncil.gov.in PDF (MP9)', verified: true },
];

/* ── R17-C: LABOUR_CODE_RULES, CONTRACT_LABOUR_THRESHOLD_RULES (C3) ──────────────────────────────────────────── */

/**
 * Labour Codes hints (C3; never a block, the payroll engine is unchanged): OT at least `ot_multiple` × the ordinary rate,
 * fixed-term gratuity after `fte_years`, "wages" at least `wage_share` of all remuneration (excluded allowances above it
 * added back). `null` before the codes took effect (MP16, MP19, MP20).
 */
export interface LabourCode { ot_multiple: number; fte_years: number; wage_share: number }

export const LABOUR_CODE_RULES: readonly MpRule<LabourCode | null>[] = [
  { from: '2019-08-08', value: null, source: 'Before the four Labour Codes took effect (Code on Wages assented 8 Aug 2019, not in force)', verified: false },
  { from: '2025-11-21', value: { ot_multiple: 2, fte_years: 1, wage_share: 0.5 }, source: 'Labour Codes in force 21 Nov 2025 (PIB release, as read by the PRD author: OT at twice the wage rate, FTE gratuity after one year); 50 % wage rule from Code on Wages Sec 2(y) as reported (taxmann, KSandK). Not re-read in R17-C (MP16, MP19, MP20)', verified: false },
];

/** Contract workers at a site from which a contract-labour / OSH licence is expected (hint only, MP17). */
export const CONTRACT_LABOUR_THRESHOLD_RULES: readonly MpRule<number>[] = [
  { from: '1971-02-10', value: 20, source: 'Contract Labour (Regulation and Abolition) Act 1970 Sec 1(4): 20 or more workmen (as recalled)', verified: false },
  { from: '2025-11-21', value: 50, source: 'OSH Code: contract-labour threshold 50 (EY alert, greytHR, as reported; MP17)', verified: false },
];

/* ── R17-D: VDA_REVISION_RULES (D1) ──────────────────────────────────────────────────────────────────────────── */

/**
 * Months in which the central-sphere VDA is revised (reminder only: the amounts are typed by the user, never stored
 * here) and the days before a licence / contract end at which the bell warns (D3).
 */
export interface VdaRevision { months: readonly number[]; alert_days: readonly number[] }

export const VDA_REVISION_RULES: readonly MpRule<VdaRevision>[] = [
  { from: '2017-01-19', value: { months: [4, 10], alert_days: [60, 30, 7] }, source: 'Central-sphere minimum wages: VDA revised every 1 Apr and 1 Oct (CLC orders as reproduced by gconnect; Gulf News Oct 2024). Secondary only (MP22, MP43)', verified: false },
];

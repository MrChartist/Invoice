/**
 * Logistics statutory values (Round 19), keyed by the date they take effect — the `Versioned` / `ruleAt` shape of
 * `tax-rules.ts`: add a new dated row, never edit an old one. Imported only by lazy Round 19 modules
 * (`src/lib/logistics/*`) — never by `tax-rules.ts`, `tds-rules.ts`, `shop-mode.ts` or the shell
 * (`tests/lg-rules.test.ts` checks the import graph). Values that already live elsewhere stay there and are read
 * through the B bridge `lg-tax-io.ts`: GTA rates (`transport-works-rules.ts`), the intermediary rule (`prof-rules.ts`),
 * TDS sections and 194C(6) (`tds-rules.ts`), Act labels (`ita2025.ts`), GST slabs (`tax-rules.ts`).
 *
 * A row is `verified: true` only when its value was read in a primary text in Round 19 (PRD §2.4; the source then says
 * "Read (R19)"). A recommendation (57th GST Council) is a `pending-changes.ts` note, never a row here. Rows keyed by
 * `key` are in date order within their key. Sources are short citations; the full list is PRD §2.8 and
 * docs/CA_REVIEW.md §19 (the full citation of each row). One section per package. Working papers — verify with your CA.
 */
import type { Versioned } from './tax-rules';
import type { LgHeadKind } from '../types/logistics-r19';

/** A dated logistics rule row: `source` plus whether the value was read in a primary text this round. */
export type LgRule<T> = Versioned<T> & { verified: boolean };
/** A row of a keyed table (rate by head family, exemption by produce, place-of-supply case). */
export type LgKeyedRule<T> = LgRule<T> & { key: string };

/** The latest row of `key` from on or before `date` (null before the first row of that key). */
export function keyedAt<T>(rows: readonly LgKeyedRule<T>[], key: string, date: string): LgKeyedRule<T> | null {
  let hit: LgKeyedRule<T> | null = null;
  for (const r of rows) if (r.key === key && r.from <= date) hit = r;
  return hit;
}

/* ── R19-A: SACs (LG5), rates by mode (LG6, LG7, LG18, LG21), exemptions (LG21) ─────────────────────────────── */

/** Default SAC of each head kind (pure-agent kinds carry none: they are recoveries outside the value, LG10). */
export const LG_SAC_RULES: readonly LgRule<Partial<Record<LgHeadKind, string>>>[] = [
  {
    from: '2017-07-01',
    value: {
      freight_sea: '996521', freight_air: '996531', freight_road: '996511', freight_rail: '996512', freight_multimodal: '996799', courier: '996812',
      clearance: '996712', forwarding: '996713', origin: '996713', destination: '996713', documentation: '996713', handling: '996713',
      storage: '996729', gta: '996791', commission: '996713', demurrage: '996799', other: '996799',
    },
    source: 'N 11/2017-CT(R) annexure. Read (R19) (LG5)',
    verified: true,
  },
];

/** A mode's GST rate: `itc_note` is shown in the editor only (never printed); `air_rate` applies with an air leg. */
export interface LgRate { rate: number; itc_note?: string; air_rate?: number; domestic_only?: boolean; alt_rate?: number }

/**
 * Rates by head family (`key`): `freight_sea` (Sl. 9(ii)), `freight_air` (Sl. 9(vii)), `freight_multimodal` (Sl. 9(vi)),
 * `freight_rail` (containers by rail by others than Indian Railways, Sl. 9(iv)), `courier` (Sl. 12) and `support`
 * (Sl. 11(ii): cargo handling, CHA, C&F, storage and warehousing). GTA rows stay in `transport-works-rules.ts` (LG8).
 */
export const LG_RATE_RULES: readonly LgKeyedRule<LgRate>[] = [
  { key: 'freight_sea', from: '2017-07-01', value: { rate: 5, itc_note: 'ITC on goods other than ships not taken' }, source: 'N 11/2017-CT(R) Sl. 9(ii). Read (R19) (LG6)', verified: true },
  { key: 'freight_air', from: '2018-07-26', value: { rate: 18 }, source: 'N 11/2017-CT(R) Sl. 9(vii). Read (R19) (LG6)', verified: true },
  { key: 'freight_multimodal', from: '2018-07-26', value: { rate: 12 }, source: 'N 11/2017-CT(R) Sl. 9(vi). Read (R19) (LG6)', verified: true },
  { key: 'freight_multimodal', from: '2025-09-22', value: { rate: 5, air_rate: 18, domestic_only: true, itc_note: 'ITC on transport inputs only, capped at 5 %' }, source: 'N 15/2025-CT(R) ¶(1)(a)(iv)(D). Read (R19) (LG6, LG7)', verified: true },
  { key: 'freight_rail', from: '2025-09-22', value: { rate: 5, alt_rate: 18, itc_note: '5 % without ITC, or 18 %' }, source: 'N 15/2025-CT(R) ¶(1)(a)(iv)(B). Read (R19) (LG6)', verified: true },
  { key: 'courier', from: '2017-07-01', value: { rate: 18 }, source: 'N 11/2017-CT(R) Sl. 12. Read (R19) (LG18)', verified: true },
  { key: 'courier', from: '2025-09-22', value: { rate: 18 }, source: 'N 15/2025-CT(R) ¶(1)(a)(vi). Read (R19) (LG18)', verified: true },
  { key: 'support', from: '2017-07-01', value: { rate: 18 }, source: 'N 11/2017-CT(R) Sl. 11(ii). Read (R19) (LG5, LG21)', verified: true },
];

/** Exempt storage / handling (`exempt_if` of a head): Sl. 54(e) agricultural produce, Sl. 24 rice (LG21). */
export const LG_EXEMPT_RULES: readonly LgKeyedRule<{ serial: string }>[] = [
  { key: 'agri_produce', from: '2017-07-01', value: { serial: 'N 12/2017-CT(R) Sl. 54(e)' }, source: 'N 12/2017-CT(R) Sl. 54(e), 2017 text. Read (R19); later amendments not read (LG21)', verified: true },
  { key: 'rice', from: '2017-07-01', value: { serial: 'N 12/2017-CT(R) Sl. 24' }, source: 'N 12/2017-CT(R) Sl. 24, 2017 text. Read (R19); later amendments not read (LG21)', verified: true },
];

/* ── R19-B: place of supply per head (LG1–LG3, LG15), ocean-freight RCM (LG16), e-Invoice exemption (LG14) ───── */

/**
 * Place-of-supply cases (`key`): `domestic` (Sec 12(8): registered recipient's location, else where the goods are
 * handed over), `export` (12(8) proviso from 1 Feb 2019: the foreign destination, POS 96, IGST), `cross_border`
 * (supplier or recipient outside India: 13(9) destination of goods to 30 Sep 2023, then 13(2) recipient's location;
 * mail / courier always 13(2)). The intermediary rule stays in `prof-rules.ts` (LG4).
 */
export const LG_POS_RULES: readonly LgKeyedRule<{ section: string; pos: 'recipient_or_handover' | 'destination' | 'recipient' }>[] = [
  { key: 'domestic', from: '2017-07-01', value: { section: 'Sec 12(8) IGST Act', pos: 'recipient_or_handover' }, source: 'IGST Sec 12(8) as quoted in Circular 184/16/2022-GST. Read (R19) (LG1)', verified: true },
  { key: 'export', from: '2019-02-01', value: { section: 'Sec 12(8) proviso IGST Act', pos: 'destination' }, source: 'Circular 184/16/2022-GST Sl. 1–4. Read (R19) (LG2, LG15)', verified: true },
  { key: 'cross_border', from: '2017-07-01', value: { section: 'Sec 13(9) IGST Act', pos: 'destination' }, source: 'IGST Sec 13(9) (omitted from 1 Oct 2023), Circular 203/15/2023-GST Sl. A.1. Read (R19) (LG3)', verified: true },
  { key: 'cross_border', from: '2023-10-01', value: { section: 'Sec 13(2) IGST Act', pos: 'recipient' }, source: 'Finance Act 2023 s.162; Circular 203/15/2023-GST Sl. A.1. Read (R19) (LG3)', verified: true },
];

/** Ocean freight on imports by a foreign shipper to a foreign line: RCM on the importer (entry 10), omitted from 1 Oct 2023 (hint). */
export const OCEAN_RCM_RULES: readonly LgRule<boolean>[] = [
  { from: '2017-07-01', value: true, source: 'N 10/2017-IGST(R) entry 10 (S, LG16)', verified: false },
  { from: '2023-10-01', value: false, source: 'N 11–13/2023 as reported after Mohit Minerals (S, LG16)', verified: false },
];

/** Suppliers exempt from e-invoicing among this round's businesses: a GTA's own invoice (N 13/2020-CT via Rule 54(3)). */
export const EINV_EXEMPT_RULES: readonly LgRule<readonly string[]>[] = [
  { from: '2020-10-01', value: ['gta'], source: 'N 13/2020-CT as amended (S taxheal; Rule 54(3) read) (LG14)', verified: false },
];

/* ── R19-C: Customs Brokers Licensing Regulations 2018 (LG26, LG27) ──────────────────────────────────────────── */

/** CBLR 2018 obligations the register and KYC hints cite. */
export const CBLR_RULES: readonly LgKeyedRule<{ reg: string; text: string; years?: number }>[] = [
  { key: 'records', from: '2018-05-14', value: { reg: 'Reg 10(k)', text: 'Maintain up-to-date records and accounts in an orderly and itemised manner' }, source: 'CBLR 2018 Reg 10(k) as quoted in CESTAT Mumbai C/86165/2024. Read (R19) (LG26)', verified: true },
  { key: 'retention', from: '2018-05-14', value: { reg: 'Reg 10', text: 'Retention of records', years: 5 }, source: 'Secondary summaries; clause letter disputed (S, LG26)', verified: false },
  { key: 'kyc', from: '2018-05-14', value: { reg: 'Reg 10(n)', text: "Verify the client's IEC, GSTIN, identity and functioning at the declared address" }, source: 'taxscan report of a CESTAT order (S, LG27)', verified: false },
];

/* ── R19-D: none expected (volumetric divisors and zone cards are settings, LG33) ─────────────────────────────── */

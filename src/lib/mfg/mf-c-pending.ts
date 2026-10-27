/**
 * MF-C (textiles and garments) — TEMPORARY home of the names, rules and row shapes that move into MF-A's shared files
 * when MF-A lands (`mf-shared.ts`, `mfg-rules.ts` `// MF-C`, `types/mfg-r13.ts` `// MF-C`). Data and types only.
 */
import type { Versioned } from '../tax-rules';

/* ── names (→ mf-shared.ts) ── */
export const MF_C_TABLES = { cutPlans: 'cut_plans' } as const;
export const MF_C_SERIES = { cutPlans: 'CUT', pieceBills: 'KPB' } as const;

/* ── rules (→ mfg-rules.ts // MF-C) ── */
export type MfRule<T> = Versioned<T> & { verified: boolean };

/** A textile tax class: a flat rate, or the R9 price band (`band`) decided per piece on sale lines. */
export interface TextileClass {
  rate?: number;
  band?: 'apparel' | 'made_ups';
  hsn: string;
  ca: string;
}
export type TextileClassId = 'mmf_fibre' | 'mmf_yarn' | 'cotton_yarn' | 'fabric' | 'garment' | 'made_up' | 'textile_waste' | 'jw_textile' | 'jw_print_ch48_49' | 'jw_other';
const AS_REPORTED = 'N 9/2025-CT(R) (22 Sep 2025) as reported (PIB 17 Sep 2025, MATEXIL) — notification not re-read';
export const TEXTILE_CLASS_RULES: Readonly<Record<TextileClassId, readonly MfRule<TextileClass>[]>> = {
  mmf_fibre: [
    { from: '2017-07-01', value: { rate: 18, hsn: '5501-5507', ca: 'MF1' }, source: 'Before 22 Sep 2025 (PRD §2.3a)', verified: false },
    { from: '2025-09-22', value: { rate: 5, hsn: '5501-5507', ca: 'MF1' }, source: AS_REPORTED, verified: false },
  ],
  mmf_yarn: [
    { from: '2017-07-01', value: { rate: 12, hsn: '5401-5406, 5508-5511', ca: 'MF1' }, source: 'Before 22 Sep 2025 (PRD §2.3a); earlier history not modelled', verified: false },
    { from: '2025-09-22', value: { rate: 5, hsn: '5401-5406, 5508-5511', ca: 'MF1' }, source: AS_REPORTED, verified: false },
  ],
  cotton_yarn: [{ from: '2017-07-01', value: { rate: 5, hsn: '5205-5207', ca: 'MF1' }, source: 'No change reported on 22 Sep 2025 (recalled)', verified: false }],
  fabric: [{ from: '2017-07-01', value: { rate: 5, hsn: '50-60 (fabric)', ca: 'MF1' }, source: 'Cotton / MMF fabric 5%, no change reported (recalled)', verified: false }],
  garment: [{ from: '2017-07-01', value: { band: 'apparel', hsn: '61, 62', ca: 'MF1' }, source: 'R9 PRICE_BAND_RULES (retail-rules.ts): ≤ ₹2,500 a piece 5%, above 18% from 22 Sep 2025', verified: false }],
  made_up: [{ from: '2017-07-01', value: { band: 'made_ups', hsn: '63', ca: 'MF1' }, source: 'R9 PRICE_BAND_RULES made-ups (as apparel, assumed)', verified: false }],
  textile_waste: [{ from: '2017-07-01', value: { rate: 5, hsn: '5202, 5505', ca: 'MF8' }, source: 'Textile waste 5% as reported (unverified)', verified: false }],
  jw_textile: [{ from: '2017-10-13', value: { rate: 5, hsn: '9988', ca: 'MF2' }, source: 'N 11/2017-CT(R) entry 26 as amended Oct 2017 (ch 50-63) — as reported (fibre2fashion, CITI 2017)', verified: false }],
  jw_print_ch48_49: [
    { from: '2017-07-01', value: { rate: 12, hsn: '9988', ca: 'MF3' }, source: 'Printing job work on ch 48 / 49 goods before 22 Sep 2025 (as reported)', verified: false },
    { from: '2025-09-22', value: { rate: 5, hsn: '9988', ca: 'MF3' }, source: 'N 15/2025-CT(R) entry 26 as cited by a Gujarat AAR; not where the paper is 18% (AAR) — verify', verified: false },
  ],
  jw_other: [{ from: '2017-07-01', value: { rate: 18, hsn: '9988', ca: 'MF5' }, source: 'Residual job work: 12% / 18% before 22 Sep 2025 (sources conflict), 18% after (busy.in SAC, Maharashtra AAR)', verified: false }],
};

/** Rule 89(5) inverted-duty refund. `ratioOnTax`: the tax payable on the inverted supply is scaled by net ITC ÷ ITC availed. */
export interface Rule895 {
  ratioOnTax: boolean;
  /** ITC on input services counted in "net ITC". */
  inputServices: boolean;
  ca: string;
}
export const RULE_89_5_RULES: readonly MfRule<Rule895>[] = [
  { from: '2017-07-01', value: { ratioOnTax: false, inputServices: false, ca: 'MF26' }, source: 'Rule 89(5) as notified (N 26/2018-CT amended "net ITC" to inputs only) — recalled; VKC Footsteps (SC, 2021) upheld excluding input services', verified: false },
  { from: '2022-07-05', value: { ratioOnTax: true, inputServices: false, ca: 'MF26' }, source: 'N 14/2022-CT (5 Jul 2022): tax payable on inverted supply × (net ITC ÷ ITC availed on inputs and input services) — recalled', verified: false },
];

/* ── row shapes (→ types/mfg-r13.ts // MF-C) ── */

/** C1: a style's fabric (per colour, optional) and trims; on `StockItem.mf.style` of the style (a variant parent). */
export interface MfStyle {
  fabric_items: { item_id: string; per_piece_m: number; colour_map?: Record<string, string> }[];
  trims?: { item_id: string; per_piece: number }[];
  size_ratio_default?: Record<string, number>;
  routing_id?: string;
}

/** C1: one lay of a cut plan. */
export interface MfLay {
  plies: number;
  marker_ratio: Record<string, number>;
  marker_length_m: number;
  width_cm?: number;
}

/** C2: one operation a bundle went through (or a reject). */
export interface MfBundleStep {
  date: string;
  op_id?: string;
  op?: string;
  good: number;
  rejected: number;
  reason?: string;
  /** Who (karigar vendor id / employee id) and the job-card entry it was recorded against. */
  by?: string;
  jc_entry_id?: string;
}

export type MfBundleWhere = 'floor' | 'fabricator' | 'finished' | 'rejected';

/** C2: a bundle inside its lot (`<lot>/<no>`). `pieces` as cut; rejected pieces leave it (`rejected`). */
export interface MfBundle {
  no: number;
  size: string;
  colour: string;
  shade?: string;
  pieces: number;
  rejected?: number;
  at: { op_id?: string; op?: string; where: MfBundleWhere; party_id?: string; challan_id?: string };
  history: MfBundleStep[];
  /** The output journal (R4-A manufacturing voucher) that reported its finished pieces. */
  reported?: string;
}

/** C1: cut plan / lot `CUT/FY…` (table `cut_plans`, `doc.create`); bundles inside. */
export interface CutPlan {
  id: string;
  number: string;
  date: string;
  order_id?: string;
  style_id: string;
  colour: string;
  fabric_item_id: string;
  fabric_batch?: string;
  lays: MfLay[];
  /** Pieces cut by size (Σ plies × ratio unless typed). */
  cut: Record<string, number>;
  fabric_issued_m: number;
  end_bits_m?: number;
  cut_waste_kg?: number;
  waste_item_id?: string;
  bundle_size?: number;
  bundles?: MfBundle[];
  /** Stock documents written for the cut (R4-A issue / return, the waste journal). */
  docs?: { issue_id?: string; return_id?: string; waste_id?: string };
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

/** C4: a karigar's rate (operation id or name; a style-specific row wins). */
export interface MfKarigarRate {
  op: string;
  style_id?: string;
  rate: number;
  from: string;
}

/** C4: `Vendor.mf.karigar` — a piece-rate worker who is not on payroll. PAN / bank come from the vendor master. */
export interface MfKarigar {
  kind: 'home' | 'floor' | 'fabricator';
  rates: MfKarigarRate[];
  upi?: string;
  /** Deduct pieces rejected for his fault from the bill (default on). */
  deduct_rejects?: boolean;
}

export interface MfPieceLine {
  op: string;
  style?: string;
  pieces: number;
  rate: number;
  amount: number;
  source: 'jobcard' | 'bundle' | 'cmt' | 'typed';
  refs?: string[];
}

/** C4: `PurchaseRecord.mf.piece` of a karigar piece bill `KPB/FY…`. */
export interface MfPieceBill {
  period: { from: string; to: string };
  lines: MfPieceLine[];
  rejected_deducted?: number;
  advance_recovered?: number;
  advance_jv_id?: string;
}

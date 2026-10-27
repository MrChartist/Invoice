/**
 * PS-B rule rows (Round 14: disbursements, legal services, design stages, media) — dated, append-only, the `Versioned` /
 * `ruleAt` shape of `tax-rules.ts`. Lazy: imported only by `src/lib/prof/ps-*` engines and Round 14 screens.
 * This is the `// PS-B` section of `src/lib/prof-rules.ts`; it moves there when PS-A's scaffold lands.
 * Working papers — verify with your CA (docs/CA_REVIEW.md §14, PS1–PS3, PS6, PS11, PS12, PS18, PS30).
 */
import type { Versioned } from '../tax-rules';

export type PsRule<T> = Versioned<T> & { verified: boolean };

/* ── B1 disbursements ─────────────────────────────────────────── */

export type DisbKind = 'court_fee' | 'stamp' | 'govt_fee' | 'filing' | 'notary' | 'travel' | 'courier' | 'other';
export const DISB_KINDS: readonly DisbKind[] = ['court_fee', 'stamp', 'govt_fee', 'filing', 'notary', 'travel', 'courier', 'other'];

/** Kinds paid on the client's behalf by default (pure agent, no GST, no ITC); the rest are part of the fee (PS3). */
export const DISB_DEFAULTS: readonly PsRule<{ on_behalf: readonly DisbKind[] }>[] = [
  { from: '2017-07-01', value: { on_behalf: ['court_fee', 'stamp', 'govt_fee', 'filing'] }, source: 'Rule 33 CGST Rules (pure agent) — practice default', verified: false },
];

/* ── B2 legal services ────────────────────────────────────────── */

export interface LegalServicesRule {
  /** SAC prefix of legal services. */
  sac: string;
  rcm: string;
  exempt: string;
  /** Wording of the small-business limb of entry 45. */
  small: string;
}
export const LEGAL_SERVICES_RULES: readonly PsRule<LegalServicesRule>[] = [
  { from: '2017-07-01', value: { sac: '9982', rcm: 'N 13/2017-CT(R) entry 2', exempt: 'N 12/2017-CT(R) entry 45', small: 'turnover up to ₹20 lakh (₹10 lakh special-category States) in the preceding FY' }, source: 'N 13/2017-CT(R), N 12/2017-CT(R) (PS1)', verified: true },
  { from: '2019-10-01', value: { sac: '9982', rcm: 'N 13/2017-CT(R) entry 2', exempt: 'N 12/2017-CT(R) entry 45', small: 'aggregate turnover up to the registration threshold in the preceding FY' }, source: 'N 21/2019-CT(R) wording (PS1)', verified: false },
];

/* ── B4 design stages ─────────────────────────────────────────── */

/** An editable EXAMPLE — the Council of Architecture scale is recommendatory; agree the stages with the client (PS30). */
export const DESIGN_STAGE_EXAMPLE: readonly PsRule<readonly { id: string; label: string; cum_pct: number }[]>[] = [
  {
    from: '2017-07-01',
    value: [
      { id: 's1', label: 'Concept design', cum_pct: 10 },
      { id: 's2', label: 'Preliminary drawings and estimate', cum_pct: 30 },
      { id: 's3', label: 'Working drawings and tender', cum_pct: 50 },
      { id: 's4', label: 'Construction stage', cum_pct: 75 },
      { id: 's5', label: 'Completion', cum_pct: 100 },
    ],
    source: 'Example only — not a rule (PS30)',
    verified: false,
  },
];

/* ── B5 media ─────────────────────────────────────────────────── */

export interface MediaRule {
  /** TDS by the client on an advertising agency's bill. */
  client_tds: string;
  /** Equalisation levy on online advertising in force. */
  levy: boolean;
}
export const MEDIA_RULES: readonly PsRule<MediaRule>[] = [
  { from: '2016-06-01', value: { client_tds: '194C', levy: true }, source: 'Circular 715 (1995), Circular 5/2016; 6% levy from 1 Jun 2016 (PS18, PS38)', verified: false },
  { from: '2025-04-01', value: { client_tds: '194C', levy: false }, source: '6% equalisation levy abolished, Finance Act 2025 (PS38)', verified: true },
];

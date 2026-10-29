/**
 * Income-tax Act 2025 references (R5 §7 Q1). From 1 Apr 2026 the Income-tax Act 2025 replaces the 1961 Act:
 * salary TDS is Sec 392, non-salary TDS is consolidated in the Tables of Sec 393 and TCS in the Table of Sec 394,
 * and the Income-tax Rules 2026 renumber the forms (26Q → Form 140 …). The Act that governs a deduction is
 * decided by the earlier of credit or payment (CBDT FAQ on TDS compliance), so a label follows the document /
 * transaction date: before 1 Apr 2026 the 1961 section / form, from that day the 2025-Act reference with the old
 * code in brackets ("Sec 393(1) [Table: Sl. No. 6(i)] [old 194C]") while the transition rule says so.
 *
 * DISPLAY ONLY. Stored codes ('194C-1', '194I-A', '195-R', return marks '26Q:2026-Q1' …) are never renamed;
 * this module only turns them into labels for screens and working papers. The rates and thresholds are
 * unchanged by the 2025 Act (CBDT FAQ, TDS compliance Q3) and stay in `tax-rules.ts` / `tds-rules.ts`.
 *
 * Same `Versioned` / `ruleAt` shape as `tax-rules.ts`: add a new dated entry, never edit an old one. Kept out
 * of the shell (only the TDS, receivables, payroll, editor and export chunks import it). `verified: false`
 * means the reference was not confirmed from an official source — the label then says "verify with your CA".
 * Sources: docs/features/income-tax-act-2025.md.
 */

import { ruleAt, type Versioned } from './tax-rules';

/** First day of the Income-tax Act 2025 (tax year 2026-27). */
export const ITA2025_FROM = '2026-04-01';

/** One statutory reference: what to print, the 1961 code it replaces, and whether an official source confirms it. */
export interface ActRef {
  act: 1961 | 2025;
  /** "194C" (1961) or "Sec 393(1) [Table: Sl. No. 6(i)]" (2025). */
  ref: string;
  /** The 1961 code, shown in brackets beside a 2025-Act reference. */
  old: string;
  verified: boolean;
}

const OFFICIAL_FAQ = 'CBDT FAQ, TDS compliance (incometax.gov.in)';
const BILL_TABLE = 'Income-tax Bill 2025 Sec 393 / 394 Table (Act numbering per CBDT FAQ): verify';

/** 1961 → 2025 for one code. `ref2025` null: the provision has no 2025-Act counterpart (keeps the old label). */
function refRules(old: string, ref2025: string | null, verified: boolean, source: string): readonly Versioned<ActRef>[] {
  const v1961: Versioned<ActRef> = { from: '1961-04-01', value: { act: 1961, ref: old, old, verified: true }, source: 'Income-tax Act 1961' };
  return ref2025 ? [v1961, { from: ITA2025_FROM, value: { act: 2025, ref: ref2025, old, verified }, source }] : [v1961];
}

const T393 = (item: string) => `Sec 393(1) [Table: Sl. No. ${item}]`;

/**
 * Section references by internal code family. Append-only per code. 194C and 192 are stated in the CBDT FAQ;
 * the table items of the other sections come from the Bill's Sec 393 / 394 Tables and secondary sources, and
 * the Rules-2026 form list (Form 141 covers 393(1) Sl. No. 2(i), 3(i), 6(ii) and 8(vi), i.e. 194-IB, 194-IA,
 * 194M and 194S) — verify with your CA.
 */
export const ACT_REF_RULES: Readonly<Record<string, readonly Versioned<ActRef>[]>> = {
  '192': refRules('192', 'Sec 392(1)', true, `${OFFICIAL_FAQ}, Q20`),
  '194C': refRules('194C', T393('6(i)'), true, `${OFFICIAL_FAQ}, Q2`),
  '194J': refRules('194J', T393('6(iii)'), false, BILL_TABLE),
  '194I': refRules('194-I', T393('2(ii)'), false, BILL_TABLE),
  '194H': refRules('194H', T393('1(ii)'), false, BILL_TABLE),
  '194D': refRules('194D', T393('1(i)'), false, BILL_TABLE),
  '194Q': refRules('194Q', T393('8(ii)'), false, BILL_TABLE),
  '194A': refRules('194A', T393('5(iii)'), false, BILL_TABLE),
  '194O': refRules('194-O', T393('8(v)'), false, BILL_TABLE),
  '194R': refRules('194R', T393('8(iv)'), false, BILL_TABLE),
  '194S': refRules('194S', T393('8(vi)'), false, `${BILL_TABLE}; Form 141 list`),
  '194IA': refRules('194-IA', T393('3(i)'), false, `${BILL_TABLE}; Form 141 list`),
  '194IB': refRules('194-IB', T393('2(i)'), false, `${BILL_TABLE}; Form 141 list`),
  '194M': refRules('194M', T393('6(ii)'), false, `${BILL_TABLE}; Form 141 list`),
  '195': refRules('195', 'Sec 393(2) [Table: Sl. No. 17]', false, BILL_TABLE),
  // PENDING 40: grossing-up when the payer bears the tax — the 2025-Act provision was not found in the sources read.
  '195A': refRules('195A', 'Sec 393 [grossing-up: provision to confirm]', false, 'Not found in the sources read (P40): verify'),
  // TCS: Sec 394 is stated in the CBDT FAQ (Q18); the table item is the Bill's — verify.
  '206C1G': refRules('206C(1G)', 'Sec 394(1) [Table: Sl. No. 7]', false, `${OFFICIAL_FAQ}, Q18 (Sec 394); ${BILL_TABLE}`),
  // 206C(1H) was omitted from 1 Apr 2025 (Finance Act 2025): no 2025-Act counterpart.
  '206C1H': refRules('206C(1H)', null, true, 'Finance Act 2025'),
  // R8-C (TR-C2): TCS on specified goods (Sl. 1–5) and on motor vehicles / notified luxury goods (Sl. 6; sources
  // differ between Sl. 6 and 6.D — TR15). Both unverified.
  '206C1': refRules('206C(1)', 'Sec 394(1) [Table: Sl. No. 1–5]', false, `${BILL_TABLE}; Finance Act 2026 as reported (TR14)`),
  '206C1F': refRules('206C(1F)', 'Sec 394(1) [Table: Sl. No. 6]', false, `${BILL_TABLE}; Sl. 6 vs 6.D disputed (TR15)`),
  // R5-C: donee approval for donations (80G → Sec 133(1)(b)(ii)); the donee statement (10BD) is Sec 354(1) / Form 113 — verify.
  '80G': refRules('80G', 'Sec 133(1)(b)(ii)', false, 'Section mapping guide ITA 1961 → 2025 as understood: verify'),
  // R14 (PS-D2): 194T (payments to partners) — the Sec 393 table entry is not confirmed (PS19): the label names the
  // section only and stays "verify with your CA" until a CA answers.
  '194T': refRules('194T', 'Sec 393(1) [Table: entry to confirm]', false, 'Not found in the sources read (PS19): verify'),
  // R14 (PS-D1 / D4): partners' remuneration and interest limits, and presumptive income of professionals (as reported).
  '40B': refRules('40(b)', 'Sec 35(e)', false, 'Income-tax Act 2025 Sec 35 as reported (PS20): verify'),
  '44ADA': refRules('44ADA', 'Sec 58', false, 'Income-tax Act 2025 Sec 58(2) Table Sl. 3 as reported (PS22): verify'),
  // R15-A4 (TV3): TCS on an overseas tour programme package is Sl. No. 8 of the Sec 394(1) Table; LRS stays Sl. No. 7
  // (the '206C1G' row above). Read in the Bill as introduced. Stored codes are never renamed: labels / codes naming
  // a tour map here through `actKey`.
  '206C1G-tour': refRules('206C(1G)', 'Sec 394(1) [Table: Sl. No. 8]', true, 'Finance Bill 2026 cl. 73(f); Memorandum ¶8'),
};

/** Stored internal codes that are not themselves a section family. */
const ALIASES: Readonly<Record<string, string>> = {
  '194C-1': '194C', '194C-2': '194C',
  '194I-A': '194I', '194I-B': '194I',
  '194J-T': '194J',
  '195-R': '195', '195-F': '195', '195-I': '195', '195-O': '195',
};

/** The mapping key of a stored or typed code ("194C-1", "194-I", "Sec 194J", "206C(1G)" …), or '' when unknown. */
export function actKey(code: string | undefined): string {
  const raw = String(code ?? '').trim();
  if (ALIASES[raw]) return ALIASES[raw];
  // R15-A4: a 206C(1G) code / label (or a TCS / overseas label) that names a tour package → Sl. No. 8.
  if (/tour/i.test(raw) && /206\s*-?\s*C\s*\(?\s*1\s*G|tcs|overseas/i.test(raw)) return '206C1G-tour';
  // TCS preset labels: "206C(1G) overseas remittance 20%".
  const tcs = /206\s*-?\s*C\s*\(\s*(1[GHF]?)\s*\)/i.exec(raw); // R8-C: 206C(1) and 206C(1F) too
  if (tcs) return `206C${tcs[1].toUpperCase()}`;
  const n =raw.toUpperCase().replace(/^(U\/S|SEC(TION)?\.?)\s*/, '').replace(/[^0-9A-Z]/g, '');
  if (ACT_REF_RULES[n]) return n;
  // "194JB" / "194C1" style RPU-ish suffixes fall back to their family.
  const fam = /^(19[2-6][A-Z]?)/.exec(n)?.[1] ?? '';
  return ACT_REF_RULES[fam] ? fam : '';
}

/** The reference for `code` on `date` (`YYYY-MM-DD`; empty = today). Unknown codes come back as themselves. */
export function actRef(code: string | undefined, date?: string): ActRef {
  const key = actKey(code);
  if (!key) return { act: (date || '') >= ITA2025_FROM ? 2025 : 1961, ref: String(code ?? ''), old: String(code ?? ''), verified: false };
  return ruleAt(ACT_REF_RULES[key], date);
}

/**
 * Whether a 2025-Act label also shows the 1961 code in brackets. On during the transition; append an entry
 * `{ from: '<day>', value: false }` when the old codes should be dropped.
 */
export const OLD_CODE_SHOWN_RULES: readonly Versioned<boolean>[] = [
  { from: '1961-04-01', value: false },
  { from: ITA2025_FROM, value: true, source: 'Transition: show the 1961 code beside the 2025-Act reference' },
];

/** Words used in labels; screens pass the translated ones (`ita25Words()` in `src/i18n/areas/ita2025.ts`). */
export interface ActWords {
  /** Template with `{code}`. */
  old: string;
  /** Appended to an unverified reference. */
  verify: string;
  /** Template with `{n}`. */
  form: string;
}

export const ACT_WORDS_EN: ActWords = { old: '[old {code}]', verify: '(verify with your CA)', form: 'Form {n}' };

/**
 * Printed documents (invoice footer "Less: TDS (…)"): the customer-facing copy carries the reference and the old
 * code, not the working-paper caveat. Screens and exports keep "(verify with your CA)".
 */
export const ACT_WORDS_PRINT: ActWords = { ...ACT_WORDS_EN, verify: '' };

function decorate(r: { ref: string; old: string; act: 1961 | 2025; verified: boolean }, date: string | undefined, w: ActWords): string {
  if (r.act === 1961) return r.ref;
  const parts = [r.ref];
  if (r.old && r.old !== r.ref && ruleAt(OLD_CODE_SHOWN_RULES, date)) parts.push(w.old.replace('{code}', r.old));
  if (!r.verified && w.verify) parts.push(w.verify);
  return parts.join(' ');
}

/**
 * Display label of a section code on `date`: "194C" before 1 Apr 2026, "Sec 393(1) [Table: Sl. No. 6(i)] [old 194C]"
 * from then (plus "(verify with your CA)" when unconfirmed). Unknown / custom codes are returned unchanged.
 */
export function sectionText(code: string | undefined, date?: string, words: ActWords = ACT_WORDS_EN): string {
  const key = actKey(code);
  if (!key) return String(code ?? '');
  const r = actRef(code, date);
  // Before the 2025 Act keep the stored code as it was always shown ("194C-1", "194J-T").
  return r.act === 1961 ? String(code ?? '') : decorate(r, date, words);
}

/**
 * A pick-list label ("194C Contractor — others") for `date`: unchanged before 1 Apr 2026, prefixed with the
 * 2025-Act reference from then ("Sec 393(1) [Table: Sl. No. 6(i)] [old 194C] · 194C Contractor — others").
 */
export function withActRef(label: string, code: string | undefined, date?: string, words: ActWords = ACT_WORDS_EN): string {
  const r = actRef(code, date);
  return r.act === 2025 && actKey(code) ? `${decorate(r, date, words)} · ${label}` : label;
}

/* ── Forms ─────────────────────────────────────────────────────── */

/** Form keys the app names (stored return-mark ids keep '26Q' / '27EQ' / '27Q'). */
export type ActForm = '24Q' | '26Q' | '27Q' | '27EQ' | '16' | '12BA' | '16A' | '27D' | '26AS' | '10BD' | '10BE' | '15G/15H' | '26QB-QE' | '15CA' | '15CB';

export interface FormRef {
  act: 1961 | 2025;
  /** Number without "Form": "26Q" / "140". */
  ref: string;
  old: string;
  verified: boolean;
}

function formRules(old: string, n2025: string, verified: boolean, source: string): readonly Versioned<FormRef>[] {
  return [
    { from: '1961-04-01', value: { act: 1961, ref: old, old, verified: true }, source: 'Income-tax Rules 1962' },
    { from: ITA2025_FROM, value: { act: 2025, ref: n2025, old, verified }, source },
  ];
}

const UM = 'e-Filing user manual (incometax.gov.in)';
const INDEX = 'incometaxindia.gov.in form page (seen in search index, not opened): verify';

/**
 * Form numbers under the Income-tax Rules 2026, by the first day of the period the form covers. A return or
 * correction for a period up to Mar 2026 stays on the old form (CBDT FAQ Q12), which the period date gives.
 */
export const FORM_REF_RULES: Readonly<Record<ActForm, readonly Versioned<FormRef>[]>> = {
  '24Q': formRules('24Q', '138', true, `${UM}: Form 138 (earlier Form 24Q)`),
  '26Q': formRules('26Q', '140', true, `${UM}: Form 140 (earlier Form 26Q)`),
  '27Q': formRules('27Q', '144', true, `${UM}: Form 144 (TDS on non-residents)`),
  '27EQ': formRules('27EQ', '143', false, `${INDEX}: Form 143 (earlier Form 27EQ)`),
  '16': formRules('16', '130', false, `${INDEX}: Form 130_131_132_133 (earlier 16 / 16A / 16B–16E / 27D)`),
  '12BA': formRules('12BA', '123', false, 'Secondary sources (2026): Form 123 (earlier 12BA), Rule 204(2), verify'),
  '16A': formRules('16A', '131', false, `${INDEX}: Form 131 (earlier 16A)`),
  '27D': formRules('27D', '133', false, `${INDEX}: Form 133 (earlier 27D)`),
  '26AS': formRules('26AS', '168', true, `${OFFICIAL_FAQ}, Q24–25: AIS for TY 2026-27 in Form No. 168`),
  '10BD': formRules('10BD', '113', true, 'Form mapping guide, ITA 1961 → 2025 (incometax.gov.in)'),
  '10BE': formRules('10BE', '114', true, 'Form mapping guide, ITA 1961 → 2025 (incometax.gov.in)'),
  '15G/15H': formRules('15G/15H', '121', true, 'Form mapping guide, ITA 1961 → 2025 (incometax.gov.in)'),
  '26QB-QE': formRules('26QB-QE', '141', true, `${OFFICIAL_FAQ}, Q9; form mapping guide`),
  // PENDING 40: remittances to non-residents (Rule 37BB) — Rules-2026 numbers as reported in secondary sources.
  '15CA': formRules('15CA', '145', false, 'Income-tax Rules 2026 form list as reported (secondary): verify'),
  '15CB': formRules('15CB', '146', false, 'Income-tax Rules 2026 form list as reported (secondary): verify'),
};

export function formRef(form: ActForm, date?: string): FormRef {
  return ruleAt(FORM_REF_RULES[form], date);
}

/** "Form 26Q" before 1 Apr 2026; "Form 140 [old 26Q]" for a period from that day (plus "(verify with your CA)"). */
export function formText(form: ActForm, date?: string, words: ActWords = ACT_WORDS_EN): string {
  const r = formRef(form, date);
  const name = words.form.replace('{n}', r.ref);
  return r.act === 1961 ? name : decorate({ ...r, ref: name }, date, words);
}

/** First day of an Indian-FY quarter (FY start year, 1..4) — the date a quarterly form is chosen by. */
export function quarterStart(fy: number, quarter: number): string {
  const m = 4 + (quarter - 1) * 3;
  return m > 12 ? `${fy + 1}-${String(m - 12).padStart(2, '0')}-01` : `${fy}-${String(m).padStart(2, '0')}-01`;
}

/** First day of a due-calendar period: "2026-Q1" → 2026-04-01, "2026-05" → 2026-05-01 ('' when unknown). */
export function periodStart(period: string): string {
  const q = /^(\d{4})-Q([1-4])$/.exec(period);
  if (q) return quarterStart(Number(q[1]), Number(q[2]));
  return /^\d{4}-\d{2}$/.test(period) ? `${period}-01` : '';
}

/** First day of an Indian FY (FY start year). */
export function fyStart(fy: number): string {
  return `${fy}-04-01`;
}

/**
 * 1961 family key ('194J', '194I', '192' …) of a 2025-Act reference as it may appear in an AIS / Form 168 export
 * ("393(1) Table Sl. No. 6(iii)", "Sec 392") — for matching against stored codes. '' when not recognised.
 */
export function oldCodeOf(text: string): string {
  const s = String(text ?? '').replace(/\s+/g, ' ');
  if (/\b392\b/.test(s)) return '192';
  const m = /\b39([34])\s*\(\s*([12])\s*\).*?(?:Sl\.?\s*No\.?|item|S\.?\s*No\.?)?\s*(\d{1,2})\s*(?:\(\s*([ivx]+)\s*\))?/i.exec(s);
  if (!m) return '';
  const target = `Sec 39${m[1]}(${m[2]}) [Table: Sl. No. ${m[3]}${m[4] ? `(${m[4].toLowerCase()})` : ''}]`;
  for (const [key, versions] of Object.entries(ACT_REF_RULES)) {
    const v = versions[versions.length - 1].value;
    if (v.act === 2025 && v.ref === target) return key;
  }
  return '';
}

/**
 * R4-C1 exporter profile and export document fields (pure): IEC / AD code validation, Incoterms and countries,
 * which documents are exports, and the rows the lazy `ExportBlock` prints. Working paper — verify with your CA.
 */
import type {} from '../../types/trade-r4';
import type { InvoiceRecord, SenderProfile } from '../../types/invoice';

/** Incoterms 2020. */
export const INCOTERMS = ['EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP'] as const;
export type Incoterm = (typeof INCOTERMS)[number];
export const isIncoterm = (v: unknown): v is Incoterm => typeof v === 'string' && (INCOTERMS as readonly string[]).includes(v);

/** ISO 3166-1 alpha-2 → name, for the countries Indian exporters ship to most (any other two-letter code is accepted). */
const COUNTRY_TEXT =
  'AE:United Arab Emirates|AF:Afghanistan|AO:Angola|AR:Argentina|AT:Austria|AU:Australia|BD:Bangladesh|BE:Belgium|BH:Bahrain|BR:Brazil|' +
  'BT:Bhutan|CA:Canada|CH:Switzerland|CL:Chile|CN:China|CO:Colombia|CZ:Czechia|DE:Germany|DK:Denmark|DZ:Algeria|EG:Egypt|ES:Spain|' +
  'ET:Ethiopia|FI:Finland|FR:France|GB:United Kingdom|GH:Ghana|GR:Greece|HK:Hong Kong|HU:Hungary|ID:Indonesia|IE:Ireland|IL:Israel|' +
  'IN:India|IQ:Iraq|IR:Iran|IT:Italy|JO:Jordan|JP:Japan|KE:Kenya|KR:South Korea|KW:Kuwait|LK:Sri Lanka|MA:Morocco|MM:Myanmar|' +
  'MU:Mauritius|MV:Maldives|MX:Mexico|MY:Malaysia|MZ:Mozambique|NG:Nigeria|NL:Netherlands|NO:Norway|NP:Nepal|NZ:New Zealand|' +
  'OM:Oman|PE:Peru|PH:Philippines|PK:Pakistan|PL:Poland|PT:Portugal|QA:Qatar|RO:Romania|RU:Russia|SA:Saudi Arabia|SE:Sweden|' +
  'SG:Singapore|SN:Senegal|TG:Togo|TH:Thailand|TN:Tunisia|TR:Turkey|TW:Taiwan|TZ:Tanzania|UA:Ukraine|UG:Uganda|US:United States|' +
  'UY:Uruguay|UZ:Uzbekistan|VN:Vietnam|YE:Yemen|ZA:South Africa|ZM:Zambia|ZW:Zimbabwe';
export const COUNTRIES: readonly { code: string; name: string }[] = COUNTRY_TEXT.split('|').map((p) => ({ code: p.slice(0, 2), name: p.slice(3) }));
const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c.name]));

/** Two-letter ISO code of a stored country value ("US", "us", "US — United States"), or ''. */
export function countryCode(v: unknown): string {
  const s = String(v ?? '').trim().toUpperCase();
  return /^[A-Z]{2}(\b|$)/.test(s) ? s.slice(0, 2) : '';
}
export const countryName = (v: unknown): string => {
  const c = countryCode(v);
  return c ? (BY_CODE.get(c) ?? c) : String(v ?? '').trim();
};
/** "US — United States" for print (the code alone when unknown). */
export const countryLabel = (v: unknown): string => {
  const c = countryCode(v);
  if (!c) return String(v ?? '').trim();
  const name = BY_CODE.get(c);
  return name ? `${c} — ${name}` : c;
};

/* ── IEC / AD code ───────────────────────────────────────────── */

/** IEC: 10 characters, letters and digits (DGFT issues the PAN as the IEC). '' when valid or empty. */
export function iecProblem(v: unknown): '' | 'iecBad' {
  const s = String(v ?? '').trim();
  return !s || /^[A-Z0-9]{10}$/i.test(s) ? '' : 'iecBad';
}
/** AD code: 14 digits. '' when valid or empty. */
export function adCodeProblem(v: unknown): '' | 'adBad' {
  const s = String(v ?? '').replace(/\s+/g, '');
  return !s || /^\d{14}$/.test(s) ? '' : 'adBad';
}
export const cleanIec = (v: unknown) => String(v ?? '').trim().toUpperCase() || undefined;
export const cleanAdCode = (v: unknown) => String(v ?? '').replace(/\s+/g, '') || undefined;

/* ── Which documents are exports ─────────────────────────────── */

type DocLike = Pick<InvoiceRecord, 'supply_type' | 'place_of_supply'>;

/** EXPORT_* supply, or place of supply 96 (other country) / 97 (other territory). */
export function isExportDoc(inv: DocLike | null | undefined): boolean {
  if (!inv) return false;
  const pos = String(inv.place_of_supply ?? '');
  return inv.supply_type === 'EXPORT_LUT' || inv.supply_type === 'EXPORT_WITH_PAYMENT' || pos === '96' || pos === '97';
}
/**
 * QA6 F6: an outward-supply document. Exports are found by supply type / place of supply (`isExportDoc`), whatever
 * type they were saved as (Invoice, Tax Invoice, Bill of Supply…) — only quotations, proformas, challans and orders
 * are not supplies.
 */
export const isSupplyDocType = (t: string | undefined): boolean => t !== 'QUOTATION' && t !== 'PROFORMA' && t !== 'DELIVERY_CHALLAN' && t !== 'SALES_ORDER';
/** Zero-rated without payment of IGST: needs a live LUT (Rule 96A). */
export const isLutSupply = (inv: Pick<InvoiceRecord, 'supply_type'> | null | undefined): boolean =>
  inv?.supply_type === 'EXPORT_LUT' || inv?.supply_type === 'SEZ_WITHOUT_PAYMENT';

/* ── Export document fields ──────────────────────────────────── */

export const EXPORT_FIELD_KEYS = [
  'incoterm', 'port_of_loading', 'port_of_discharge', 'country_of_origin', 'country_of_destination',
  'pre_carriage', 'vessel_flight', 'marks_numbers', 'export_payment_terms',
] as const;
export type ExportFieldKey = (typeof EXPORT_FIELD_KEYS)[number];

export const hasExportFields = (inv: Partial<InvoiceRecord> | null | undefined): boolean =>
  !!inv && EXPORT_FIELD_KEYS.some((k) => typeof inv[k] === 'string' && (inv[k] as string).trim() !== '');

/** Cleaned patch of the export fields (trimmed; blank → undefined; codes upper-cased). */
export function cleanExportFields(input: Partial<Record<ExportFieldKey, unknown>>): Partial<Record<ExportFieldKey, string | undefined>> {
  const out: Partial<Record<ExportFieldKey, string | undefined>> = {};
  for (const k of EXPORT_FIELD_KEYS) {
    if (!(k in input)) continue;
    let v = String(input[k] ?? '').trim();
    if (k === 'incoterm' || k === 'country_of_origin' || k === 'country_of_destination') v = v.toUpperCase();
    if (k === 'incoterm' && v && !isIncoterm(v)) v = '';
    out[k] = v || undefined;
  }
  return out;
}

/** Print labels (English: the document paper is English; the Design Studio has no overridable keys for these). */
export const EXPORT_LABELS: Record<ExportFieldKey | 'iec' | 'ad_code', string> = {
  iec: 'IEC',
  ad_code: 'AD code',
  incoterm: 'Incoterms',
  pre_carriage: 'Pre-carriage by',
  vessel_flight: 'Vessel / flight no.',
  port_of_loading: 'Port of loading',
  port_of_discharge: 'Port of discharge',
  country_of_origin: 'Country of origin',
  country_of_destination: 'Final destination',
  marks_numbers: 'Marks & nos.',
  export_payment_terms: 'Payment terms',
};

export interface ExportPrintRow {
  key: ExportFieldKey | 'iec' | 'ad_code';
  label: string;
  value: string;
}

/**
 * Rows of the printed export block, in print order. IEC / AD code (from the document's sender snapshot) print only
 * on export documents; the other rows whenever the document carries them. Empty when there is nothing to print.
 */
export function exportPrintRows(inv: Partial<InvoiceRecord>, sender?: Partial<SenderProfile> | null): ExportPrintRow[] {
  const rows: ExportPrintRow[] = [];
  const add = (key: ExportPrintRow['key'], value: unknown) => {
    const v = String(value ?? '').trim();
    if (v) rows.push({ key, label: EXPORT_LABELS[key], value: v });
  };
  const exportDoc = isExportDoc(inv as DocLike);
  const fields = hasExportFields(inv);
  if (!exportDoc && !fields) return rows;
  if (exportDoc) {
    add('iec', sender?.iec);
    add('ad_code', sender?.ad_code ? `${sender.ad_code}${sender.ad_bank ? ` (${sender.ad_bank})` : ''}` : '');
  }
  if (!fields) return rows;
  add('incoterm', inv.incoterm);
  add('pre_carriage', inv.pre_carriage);
  add('vessel_flight', inv.vessel_flight);
  add('port_of_loading', inv.port_of_loading);
  add('port_of_discharge', inv.port_of_discharge);
  add('country_of_origin', countryLabel(inv.country_of_origin || 'IN'));
  add('country_of_destination', countryLabel(inv.country_of_destination));
  add('marks_numbers', inv.marks_numbers);
  add('export_payment_terms', inv.export_payment_terms);
  return rows;
}

/** e-Invoice `ExpDtls.CntCode` pre-fill: the destination's ISO code ('' when none). */
export const cntCodeOf = (inv: Partial<InvoiceRecord> | null | undefined): string => countryCode(inv?.country_of_destination);

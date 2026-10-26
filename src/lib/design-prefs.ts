/**
 * Invoice design preferences — pure logic, no React.
 *
 * One row per sender profile plus a global default row, persisted in the
 * `design_prefs` table. `resolveDesignFrom` layers   built-in defaults ←
 * global ← profile   so a profile only has to store what it overrides.
 *
 * Semantics of the "show" flags: `true` means "print it when the document has
 * the data" (a column with no HSN codes is still hidden); `false` always hides.
 * That is what lets DEFAULT_DESIGN render identically to a template with no
 * design at all.
 */

import { DB_PREFIX, getTable, readRaw, setTable, writeRaw } from './storage';
import { ASSET_TABLE, internImage, parseAssets, serializeAssets } from './assets';
import { formatMoney } from './utils';
import { sanitizeCopies, type CopySetting } from './print-copies';
import type { DocumentType } from '../types/invoice';

export const DESIGN_TABLE = 'design_prefs';
/** `profile_id` of the row that applies to every profile without its own row. */
export const GLOBAL_PROFILE_ID = '__global__';

export const MR_CHARTIST_ORANGE = '#ee6125';

export type LogoPosition = 'auto' | 'left' | 'right' | 'center';
export type LogoSize = 's' | 'm' | 'l';
export type PaperKind = 'A4' | 'A5' | 'thermal80';
export type Density = 'compact' | 'comfortable' | 'spacious';
export type NumberFormat = 'indian' | 'international';
export type DateFormat = 'dd MMM yyyy' | 'dd/MM/yyyy' | 'MM/dd/yyyy' | 'yyyy-MM-dd' | 'dd-MM-yyyy';

export const WATERMARK_NONE = 'none';
export const WATERMARK_AUTO = 'auto-status';

export interface ShowColumns {
  hsn: boolean;
  unit: boolean;
  discount: boolean;
  tax_rate: boolean;
  taxable: boolean;
}

export interface DesignPrefs {
  profile_id: string;
  /** Hex colour overriding the template accent. */
  accent?: string;
  /** Key from FONT_OPTIONS overriding the template font. */
  font?: string;
  /** 'auto' keeps the template's native logo placement. */
  logo_position: LogoPosition;
  logo_size: LogoSize;
  show_columns: ShowColumns;
  show_qr: boolean;
  show_signature: boolean;
  show_bank: boolean;
  show_terms: boolean;
  show_amount_in_words: boolean;
  show_place_of_supply: boolean;
  /** Batch / expiry / serial / warranty sub-line under tracked stock lines (6.6 / 6.11). */
  show_tracking: boolean;
  /** 'none' | 'auto-status' | any other text = custom watermark. */
  watermark: string;
  paper: PaperKind;
  density: Density;
  footer_text: string;
  header_note: string;
  number_format: NumberFormat;
  date_format: DateFormat;
  /**
   * Additive (P0-9): copies per print job / PDF — 'single' (default, one paper, no banner), 'auto'
   * (Rule 48: goods 3, services 2) or an explicit list. Absent = 'single'. See `print-copies.ts`.
   */
  copies?: CopySetting;
  /** Additive (P2): print on pre-printed stationery — no letterhead / backgrounds, content offset. */
  preprinted?: PreprintedPrefs;
  /**
   * Additive (8.5): print "Previous balance + This bill = Total due" from the bill's own
   * `party_balance_snapshot`. Absent / false = off (legacy look).
   */
  show_party_balance?: boolean;
  /**
   * Additive (R2-C5): printed label overrides keyed by `LabelKey` (`src/components/templates/labels.ts`).
   * Blank / absent = the default label. Layered key by key: global ← profile.
   */
  labels?: LabelOverrides;
  /** Additive (R2-C5): label overrides for one document type only (win over `labels`). */
  labels_by_type?: Partial<Record<DocumentType, LabelOverrides>>;
  /**
   * Additive (R2-C5): text appended to the printed document title per type ("Tax Invoice — Professional
   * Services"). The statutory title itself always prints and cannot be replaced.
   */
  title_suffix?: Partial<Record<DocumentType, string>>;
  /**
   * Additive (R3-C2): print the catalogue photo (16 mm) beside lines that snapshotted one. Off by default;
   * the GST grid and thermal paper never print them.
   */
  show_item_images?: boolean;
  /** Additive (R3-C3): page margins in mm (0–30). Absent = the template's own padding. */
  margins_mm?: MarginsMm;
  /** Additive (R3-C3): letterhead artwork (header band or full-page background). Off while pre-printed is on. */
  letterhead?: LetterheadPrefs;
  /** Additive (R3-C3): footer band artwork (`asset:<id>`), printed at the foot of the page. */
  footer_image?: string;
  updated_at?: string;
}

/* ── Page margins and letterhead artwork (R3-C3) ──────────────── */

export interface MarginsMm {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type LetterheadMode = 'header' | 'background';

export interface LetterheadPrefs {
  /** `asset:<id>` reference (or a raster data URL before it is interned). */
  image: string;
  mode: LetterheadMode;
  /** Header band on every PDF page (true) or on page 1 only (false). */
  every_page: boolean;
}

export const MARGIN_MAX_MM = 30;
/** Today's template padding in mm (44 px top, 48 px sides, 36 px bottom at 96 dpi), the panel's starting values. */
export const TEMPLATE_MARGINS_MM: MarginsMm = { top: 11.6, right: 12.7, bottom: 9.5, left: 12.7 };
/** Largest letterhead / footer image accepted (bytes of the decoded image, ~400 kB). */
export const MAX_LETTERHEAD_BYTES = 400 * 1024;
/** Raster images only — an SVG may carry script (same rule as catalogue photos). */
const SAFE_ART = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

/** A stored artwork value: an asset reference or a safe raster data URL; anything else is dropped. */
export function sanitizeArt(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  if (/^asset:[A-Za-z0-9~_-]+$/.test(v)) return v;
  return SAFE_ART.test(v) && v.length <= Math.ceil((MAX_LETTERHEAD_BYTES * 4) / 3) + 32 ? v : undefined;
}

/** Approximate decoded size of a base64 data URL, in bytes. */
export function dataUrlBytes(dataUrl: string): number {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
}

/**
 * Store letterhead / footer artwork once in the `assets` table and return its `asset:<id>` reference.
 * Throws a readable Error for a non-raster image or one over 400 kB.
 */
export function storeArtwork(dataUrl: string): string {
  if (!SAFE_ART.test(dataUrl)) throw new Error('Choose a PNG or JPEG image.');
  if (dataUrlBytes(dataUrl) > MAX_LETTERHEAD_BYTES) throw new Error('That image is over 400 kB. Pick a smaller one.');
  const key = DB_PREFIX + ASSET_TABLE;
  const idx = parseAssets(readRaw(key));
  const before = idx.byId.size;
  const ref = internImage(idx, dataUrl);
  if (idx.byId.size !== before) writeRaw(key, serializeAssets(idx));
  return ref;
}

/** Clamp margins to 0–30 mm (half-mm steps); undefined when absent or malformed. */
export function sanitizeMargins(v: unknown): MarginsMm | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const c = (n: unknown, d: number) => {
    const x = typeof n === 'number' && Number.isFinite(n) ? n : d;
    return Math.min(MARGIN_MAX_MM, Math.max(0, Math.round(x * 2) / 2));
  };
  return { top: c(o.top, TEMPLATE_MARGINS_MM.top), right: c(o.right, TEMPLATE_MARGINS_MM.right), bottom: c(o.bottom, TEMPLATE_MARGINS_MM.bottom), left: c(o.left, TEMPLATE_MARGINS_MM.left) };
}

export function sanitizeLetterhead(v: unknown): LetterheadPrefs | undefined {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
  const o = v as Record<string, unknown>;
  const image = sanitizeArt(o.image);
  if (!image) return undefined;
  return { image, mode: o.mode === 'background' ? 'background' : 'header', every_page: o.every_page === true };
}

/** Letterhead and footer artwork to print, or null: pre-printed stationery excludes them. */
export function activeArt(d: Pick<DesignPrefs, 'preprinted' | 'letterhead' | 'footer_image' | 'paper'> | null | undefined): { letterhead?: LetterheadPrefs; footer?: string } | null {
  if (!d || d.preprinted?.on || d.paper === 'thermal80') return null;
  const letterhead = sanitizeLetterhead(d.letterhead);
  const footer = sanitizeArt(d.footer_image);
  return letterhead || footer ? { ...(letterhead ? { letterhead } : {}), ...(footer ? { footer } : {}) } : null;
}

/**
 * CSS variables for the paper (the template padding in mm) and the right-hand padding of the content.
 * Empty without margins, so a design without them renders exactly as before.
 */
export function marginVars(d: Pick<DesignPrefs, 'margins_mm'> | null | undefined): Record<string, string> {
  const m = sanitizeMargins(d?.margins_mm);
  if (!m) return {};
  return { '--tpl-pt': `${m.top}mm`, '--tpl-px': `${m.left}mm`, '--tpl-pr': `${m.right}mm`, '--tpl-pb': `${m.bottom}mm` };
}

/* ── Label overrides (R2-C5) ──────────────────────────────────── */

/** Every printed label a user may rename — the keys of `labels.ts` (checked there at compile time). */
export const LABEL_KEYS = [
  'billTo', 'shipTo', 'preparedFor', 'issueDate', 'quoteDate', 'dueDate', 'validUntil', 'deliveryBy', 'poRef',
  'placeOfSupply', 'currency', 'reverseCharge', 'document', 'invoiceNo', 'desc', 'hsn', 'qty', 'rate', 'disc',
  'taxable', 'gst', 'gstRate', 'amount', 'subtotal', 'discount', 'cgst', 'sgst', 'igst', 'tax', 'shipping', 'other',
  'roundOff', 'total', 'balanceDue', 'words', 'payDetails', 'notes', 'terms', 'notesTerms', 'signatory', 'scanToPay',
  'account', 'acNo', 'ifsc', 'bank', 'upi',
] as const;
export type OverridableLabel = (typeof LABEL_KEYS)[number];
export type LabelOverrides = Partial<Record<OverridableLabel, string>>;

export const LABEL_DOC_TYPES: readonly DocumentType[] = [
  'TAX_INVOICE', 'INVOICE', 'BILL_OF_SUPPLY', 'QUOTATION', 'PROFORMA', 'SALES_ORDER', 'DELIVERY_CHALLAN', 'CREDIT_NOTE', 'DEBIT_NOTE',
];
const LABEL_MAX = 40;
const SUFFIX_MAX = 60;

/** Clean one override map: known keys only, trimmed text, blanks dropped. Undefined when empty. */
export function sanitizeLabels(value: unknown, base?: LabelOverrides): LabelOverrides | undefined {
  const out: LabelOverrides = { ...(base ?? {}) };
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    for (const k of LABEL_KEYS) {
      if (!(k in v)) continue;
      const t = typeof v[k] === 'string' ? text(v[k], LABEL_MAX).trim() : '';
      if (t) out[k] = t;
      else delete out[k];
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function sanitizeByType<T>(value: unknown, base: Partial<Record<DocumentType, T>> | undefined, clean: (v: unknown, b?: T) => T | undefined): Partial<Record<DocumentType, T>> | undefined {
  const out: Partial<Record<DocumentType, T>> = { ...(base ?? {}) };
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const v = value as Record<string, unknown>;
    for (const dt of LABEL_DOC_TYPES) {
      if (!(dt in v)) continue;
      const c = clean(v[dt], out[dt]);
      if (c === undefined) delete out[dt];
      else out[dt] = c;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

const cleanSuffix = (v: unknown): string | undefined => {
  const t = typeof v === 'string' ? text(v, SUFFIX_MAX).trim() : '';
  return t || undefined;
};

/**
 * The label to print for `key` on a `docType` document, or undefined for the default. Resolution:
 * document type → profile → global → default (profile and global are already layered in `design`).
 */
export function labelOverride(design: Pick<DesignPrefs, 'labels' | 'labels_by_type'> | null | undefined, key: string, docType?: DocumentType): string | undefined {
  if (!design) return undefined;
  const k = key as OverridableLabel;
  return (docType ? design.labels_by_type?.[docType]?.[k] : undefined) || design.labels?.[k] || undefined;
}

/**
 * The design to hand to the template engine for one document: the type's own label overrides are
 * flattened into `labels`, so every part reads one map. Unchanged object when there is nothing to flatten.
 */
export function designForDoc<T extends Pick<DesignPrefs, 'labels' | 'labels_by_type'>>(design: T, docType: DocumentType | undefined): T {
  const own = docType ? design.labels_by_type?.[docType] : undefined;
  if (!own || !Object.keys(own).length) return design;
  return { ...design, labels: { ...(design.labels ?? {}), ...own } };
}

/** "TAX INVOICE — PROFESSIONAL SERVICES": the statutory title always leads; the suffix is appended. */
export function docTitleText(baseTitle: string, design: Pick<DesignPrefs, 'title_suffix'> | null | undefined, docType: DocumentType | undefined): string {
  const suffix = docType ? design?.title_suffix?.[docType]?.trim() : '';
  return suffix ? `${baseTitle} — ${suffix}` : baseTitle;
}

export interface PreprintedPrefs {
  on: boolean;
  /** Blank space left at the top for the printed letterhead, mm (0–120). */
  top_mm: number;
  /** Extra left margin, mm (-20–40). */
  left_mm: number;
}

/** Clamp a stored pre-printed setting; undefined when absent or malformed. */
export function sanitizePreprinted(value: unknown): PreprintedPrefs | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  const clamp = (n: unknown, lo: number, hi: number, d: number) => {
    const x = typeof n === 'number' && Number.isFinite(n) ? n : d;
    return Math.min(hi, Math.max(lo, Math.round(x * 10) / 10));
  };
  return { on: v.on === true, top_mm: clamp(v.top_mm, 0, 120, 40), left_mm: clamp(v.left_mm, -20, 40, 0) };
}

export const LOGO_POSITIONS: LogoPosition[] = ['auto', 'left', 'right', 'center'];
export const LOGO_SIZES: LogoSize[] = ['s', 'm', 'l'];
export const PAPER_KINDS: PaperKind[] = ['A4', 'A5', 'thermal80'];
export const DENSITIES: Density[] = ['compact', 'comfortable', 'spacious'];
export const NUMBER_FORMATS: NumberFormat[] = ['indian', 'international'];
export const DATE_FORMATS: DateFormat[] = [
  'dd MMM yyyy',
  'dd/MM/yyyy',
  'MM/dd/yyyy',
  'yyyy-MM-dd',
  'dd-MM-yyyy',
];

export interface FontOption {
  id: string;
  label: string;
  css: string;
}

/** Offline-safe stacks: every one degrades to a system font. */
export const FONT_OPTIONS: FontOption[] = [
  { id: 'inter', label: 'Inter', css: "'Inter', system-ui, sans-serif" },
  { id: 'outfit', label: 'Outfit', css: "'Outfit', 'Inter', system-ui, sans-serif" },
  { id: 'serif', label: 'Playfair', css: "'Playfair Display', Georgia, 'Times New Roman', serif" },
  { id: 'dm-serif', label: 'DM Serif', css: "'DM Serif Display', 'Playfair Display', Georgia, serif" },
  { id: 'mono', label: 'Mono', css: "'JetBrains Mono', 'SF Mono', Menlo, ui-monospace, monospace" },
  { id: 'system', label: 'System', css: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif" },
];

export function fontCss(id?: string): string | undefined {
  return FONT_OPTIONS.find((f) => f.id === id)?.css;
}

/** Brand swatches for the panel; the first is the Mr. Chartist orange. */
export const BRAND_SWATCHES: { name: string; hex: string }[] = [
  { name: 'Mr. Chartist orange', hex: MR_CHARTIST_ORANGE },
  { name: 'Void', hex: '#14100c' },
  { name: 'Navy', hex: '#1a365d' },
  { name: 'Indigo', hex: '#4f46e5' },
  { name: 'Teal', hex: '#0f766e' },
  { name: 'Emerald', hex: '#15803d' },
  { name: 'Crimson', hex: '#be123c' },
  { name: 'Slate', hex: '#475569' },
];

export const DEFAULT_DESIGN: DesignPrefs = {
  profile_id: GLOBAL_PROFILE_ID,
  logo_position: 'auto',
  logo_size: 'm',
  show_columns: { hsn: true, unit: true, discount: true, tax_rate: true, taxable: true },
  show_qr: true,
  show_signature: true,
  show_bank: true,
  show_terms: true,
  show_amount_in_words: true,
  show_place_of_supply: true,
  show_tracking: true,
  watermark: WATERMARK_NONE,
  paper: 'A4',
  density: 'comfortable',
  footer_text: '',
  header_note: '',
  number_format: 'indian',
  date_format: 'dd MMM yyyy',
};

/* ── Sanitising ───────────────────────────────────────────────── */

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Normalises "#F60" / "#FF6600" to "#ff6600"; anything else is rejected. */
export function sanitizeHex(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  if (!HEX_RE.test(v)) return undefined;
  const h = v.slice(1).toLowerCase();
  return `#${h.length === 3 ? h.split('').map((c) => c + c).join('') : h}`;
}

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    // Drop control characters except tab/newline.
    if (code < 32 && code !== 9 && code !== 10) continue;
    out += ch;
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Coerce anything (corrupt storage, an older/newer app version, a partial
 * object) into a complete, valid DesignPrefs. Missing keys come from `base`.
 */
export function sanitizeDesign(input: unknown, base: DesignPrefs = DEFAULT_DESIGN): DesignPrefs {
  const src = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const cols = (src.show_columns && typeof src.show_columns === 'object' ? src.show_columns : {}) as Record<string, unknown>;
  const font = typeof src.font === 'string' && FONT_OPTIONS.some((f) => f.id === src.font) ? src.font : undefined;
  const watermarkRaw = 'watermark' in src ? text(src.watermark, 40).trim() : base.watermark;
  return {
    profile_id: typeof src.profile_id === 'string' && src.profile_id ? src.profile_id : base.profile_id,
    accent: 'accent' in src ? sanitizeHex(src.accent) : base.accent,
    font: 'font' in src ? font : base.font,
    logo_position: pick(src.logo_position, LOGO_POSITIONS, base.logo_position),
    logo_size: pick(src.logo_size, LOGO_SIZES, base.logo_size),
    show_columns: {
      hsn: bool(cols.hsn, base.show_columns.hsn),
      unit: bool(cols.unit, base.show_columns.unit),
      discount: bool(cols.discount, base.show_columns.discount),
      tax_rate: bool(cols.tax_rate, base.show_columns.tax_rate),
      taxable: bool(cols.taxable, base.show_columns.taxable),
    },
    show_qr: bool(src.show_qr, base.show_qr),
    show_signature: bool(src.show_signature, base.show_signature),
    show_bank: bool(src.show_bank, base.show_bank),
    show_terms: bool(src.show_terms, base.show_terms),
    show_amount_in_words: bool(src.show_amount_in_words, base.show_amount_in_words),
    show_place_of_supply: bool(src.show_place_of_supply, base.show_place_of_supply),
    show_tracking: bool(src.show_tracking, base.show_tracking),
    watermark: watermarkRaw === '' ? WATERMARK_NONE : watermarkRaw,
    paper: pick(src.paper, PAPER_KINDS, base.paper),
    density: pick(src.density, DENSITIES, base.density),
    footer_text: 'footer_text' in src ? text(src.footer_text, 200) : base.footer_text,
    header_note: 'header_note' in src ? text(src.header_note, 160) : base.header_note,
    number_format: pick(src.number_format, NUMBER_FORMATS, base.number_format),
    date_format: pick(src.date_format, DATE_FORMATS, base.date_format),
    // Additive keys stay absent unless set, so a legacy design object round-trips unchanged.
    ...(() => {
      const copies = 'copies' in src ? sanitizeCopies(src.copies) : base.copies;
      return copies !== undefined ? { copies } : {};
    })(),
    ...(() => {
      const pp = 'preprinted' in src ? sanitizePreprinted(src.preprinted) : base.preprinted;
      return pp ? { preprinted: pp } : {};
    })(),
    ...(() => {
      const on = 'show_party_balance' in src ? src.show_party_balance === true : base.show_party_balance === true;
      return on ? { show_party_balance: true } : {};
    })(),
    // R2-C5 labels / title suffix: merged key by key over the base (global ← profile).
    ...(() => {
      const labels = sanitizeLabels(src.labels, base.labels);
      const byType = sanitizeByType<LabelOverrides>(src.labels_by_type, base.labels_by_type, (v, b) => sanitizeLabels(v, b));
      const suffix = sanitizeByType<string>(src.title_suffix, base.title_suffix, (v) => cleanSuffix(v));
      return { ...(labels ? { labels } : {}), ...(byType ? { labels_by_type: byType } : {}), ...(suffix ? { title_suffix: suffix } : {}) };
    })(),
    // R3-C2 / C3 (additive): item photos, page margins, letterhead / footer artwork.
    ...(() => {
      const photos = 'show_item_images' in src ? src.show_item_images === true : base.show_item_images === true;
      const margins = 'margins_mm' in src ? sanitizeMargins(src.margins_mm) : base.margins_mm;
      const letterhead = 'letterhead' in src ? sanitizeLetterhead(src.letterhead) : base.letterhead;
      const footer = 'footer_image' in src ? sanitizeArt(src.footer_image) : base.footer_image;
      return { ...(photos ? { show_item_images: true } : {}), ...(margins ? { margins_mm: margins } : {}), ...(letterhead ? { letterhead } : {}), ...(footer ? { footer_image: footer } : {}) };
    })(),
    updated_at: typeof src.updated_at === 'string' ? src.updated_at : base.updated_at,
  };
}

/* ── Resolution ───────────────────────────────────────────────── */

/**
 * Pure merge: defaults ← global row ← profile row. Only keys actually present
 * on a row override, so a profile row can be a sparse patch.
 */
export function resolveDesignFrom(rows: Partial<DesignPrefs>[], profileId?: string | null): DesignPrefs {
  const global = rows.find((r) => r?.profile_id === GLOBAL_PROFILE_ID);
  const own =
    profileId && profileId !== GLOBAL_PROFILE_ID ? rows.find((r) => r?.profile_id === profileId) : undefined;
  let merged = DEFAULT_DESIGN;
  if (global) merged = sanitizeDesign(global, merged);
  if (own) merged = sanitizeDesign(own, merged);
  return { ...merged, profile_id: profileId || GLOBAL_PROFILE_ID };
}

/** The effective design for a profile (global default applied underneath). */
export function resolve(profileId?: string | null): DesignPrefs {
  return resolveDesignFrom(getTable<Partial<DesignPrefs>>(DESIGN_TABLE), profileId);
}

/** The raw stored row for exactly this profile id (no merging), or null. */
export function loadDesign(profileId: string): DesignPrefs | null {
  const row = getTable<Partial<DesignPrefs>>(DESIGN_TABLE).find((r) => r?.profile_id === profileId);
  return row ? sanitizeDesign(row) : null;
}

/** Replace (or insert) the row for `prefs.profile_id`. Throws StorageWriteError on quota. */
export function saveDesign(prefs: DesignPrefs): DesignPrefs {
  const clean = { ...sanitizeDesign(prefs), updated_at: new Date().toISOString() };
  const rows = getTable<DesignPrefs>(DESIGN_TABLE).filter((r) => r?.profile_id !== clean.profile_id);
  setTable(DESIGN_TABLE, [...rows, clean]);
  return clean;
}

/** Drop a profile's overrides so it falls back to the global default. */
export function resetDesign(profileId: string): void {
  setTable(
    DESIGN_TABLE,
    getTable<DesignPrefs>(DESIGN_TABLE).filter((r) => r?.profile_id !== profileId),
  );
}

/* ── Presets ──────────────────────────────────────────────────── */

type PresetPatch = Partial<Omit<DesignPrefs, 'profile_id' | 'accent' | 'font' | 'updated_at'>>;

export interface DesignPreset {
  id: string;
  name: string;
  description: string;
  /** Applied over the DEFAULT design; accent, font and profile are always kept. */
  patch: PresetPatch;
}

export const presets: DesignPreset[] = [
  { id: 'classic', name: 'Classic', description: 'Everything on, A4, comfortable spacing', patch: {} },
  {
    id: 'compact',
    name: 'Compact',
    description: 'Tighter rows to keep long lists on fewer pages',
    patch: {
      density: 'compact',
      logo_size: 's',
      show_columns: { hsn: true, unit: true, discount: false, tax_rate: true, taxable: true },
      show_qr: false,
    },
  },
  {
    id: 'minimal',
    name: 'Minimal',
    description: 'Only the essentials, generous whitespace',
    patch: {
      density: 'spacious',
      show_columns: { hsn: false, unit: false, discount: false, tax_rate: false, taxable: false },
      show_qr: false,
      show_terms: false,
      show_place_of_supply: false,
      show_amount_in_words: false,
    },
  },
  {
    id: 'receipt',
    name: 'Receipt',
    description: '80 mm thermal printer roll',
    patch: {
      paper: 'thermal80',
      density: 'compact',
      logo_size: 's',
      show_columns: { hsn: false, unit: true, discount: false, tax_rate: false, taxable: false },
      show_signature: false,
      show_terms: false,
    },
  },
];

/** Reset every option to the preset, but keep the profile id, accent, font and texts. */
export function applyPreset(current: DesignPrefs, presetId: string): DesignPrefs {
  const preset = presets.find((p) => p.id === presetId);
  if (!preset) return current;
  const base: DesignPrefs = {
    ...DEFAULT_DESIGN,
    profile_id: current.profile_id,
    accent: current.accent,
    font: current.font,
    footer_text: current.footer_text,
    header_note: current.header_note,
    // Print-job settings are not part of the look: a preset keeps them.
    ...(current.copies !== undefined ? { copies: current.copies } : {}),
    ...(current.preprinted ? { preprinted: current.preprinted } : {}),
    // R2-C5: labels and title suffixes are wording, not look — a preset keeps them.
    ...(current.labels ? { labels: current.labels } : {}),
    ...(current.labels_by_type ? { labels_by_type: current.labels_by_type } : {}),
    ...(current.title_suffix ? { title_suffix: current.title_suffix } : {}),
    // R3-C3: page setup and artwork are stationery, not look — a preset keeps them.
    ...(current.margins_mm ? { margins_mm: current.margins_mm } : {}),
    ...(current.letterhead ? { letterhead: current.letterhead } : {}),
    ...(current.footer_image ? { footer_image: current.footer_image } : {}),
    updated_at: current.updated_at,
  };
  return sanitizeDesign(preset.patch, base);
}

/* ── Paper ────────────────────────────────────────────────────── */

export interface PaperSize {
  /** CSS px @96dpi. */
  width: number;
  /** Page height; for thermal rolls this is only a minimum. */
  height: number;
  /** True when the sheet grows with content (thermal roll): measure the element instead. */
  autoHeight: boolean;
  /** Physical size in millimetres, for jsPDF `format`. */
  mm: { width: number; height: number };
  label: string;
}

const PAPERS: Record<PaperKind, PaperSize> = {
  A4: { width: 794, height: 1123, autoHeight: false, mm: { width: 210, height: 297 }, label: 'A4' },
  A5: { width: 559, height: 794, autoHeight: false, mm: { width: 148, height: 210 }, label: 'A5' },
  thermal80: { width: 302, height: 480, autoHeight: true, mm: { width: 80, height: 127 }, label: '80 mm thermal' },
};

/** Paper dimensions for a design (A4 when omitted). */
export function paperSize(design?: Pick<DesignPrefs, 'paper'> | null): PaperSize {
  return PAPERS[design?.paper ?? 'A4'] ?? PAPERS.A4;
}

/** R3-C3: artwork bands repeated on PDF pages, heights in CSS px at the paper width. */
export interface PageBands {
  /** Header band height; repeated on pages 2+ only when `everyPage`. Page 1 carries it in the paper itself. */
  header?: number;
  everyPage?: boolean;
  /** Footer band height, reserved at the foot of every page. */
  footer?: number;
}

/**
 * Where to slice a tall rendered paper into pages (canvas → jsPDF export).
 * Returns [top, height] of each page in CSS px. A thermal roll is one page.
 * With artwork bands (R3-C3) each page's content slice is shortened by the bands drawn on it, and
 * `offset` is where the slice sits on the page (below a repeated header band).
 */
export function pageSlices(
  contentHeight: number,
  design?: Pick<DesignPrefs, 'paper'> | null,
  bands?: PageBands | null,
): { top: number; height: number; offset?: number }[] {
  const size = paperSize(design);
  const total = Math.max(1, Math.ceil(contentHeight));
  if (size.autoHeight) return [{ top: 0, height: total }];
  const slices: { top: number; height: number; offset?: number }[] = [];
  const footer = Math.max(0, bands?.footer ?? 0);
  const header = bands?.everyPage ? Math.max(0, bands?.header ?? 0) : 0;
  if (!footer && !header) {
    for (let top = 0; top < total; top += size.height) slices.push({ top, height: size.height });
    return slices;
  }
  for (let top = 0, page = 0; top < total; page++) {
    const offset = page === 0 ? 0 : header;
    const height = Math.max(40, size.height - offset - footer);
    slices.push({ top, height, offset });
    top += height;
  }
  return slices;
}

/** `@page` rule matching the paper. Inject into a <style> while printing. */
export function printPageCss(design?: Pick<DesignPrefs, 'paper'> | null): string {
  const s = paperSize(design);
  return `@page { size: ${s.mm.width}mm ${s.autoHeight ? 'auto' : `${s.mm.height}mm`}; margin: 0; }`;
}

/* ── Formatting ───────────────────────────────────────────────── */

/** Plain grouped number (no symbol) honouring the chosen digit grouping. */
export function formatNumberPref(amount: number, currency: string, fmt: NumberFormat): string {
  if (fmt === 'international') {
    return new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
      Number.isFinite(amount) ? amount : 0,
    );
  }
  return formatMoney(amount, currency);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Date in one of the supported layouts; '' for empty/invalid input. */
export function formatDatePref(date: string | Date | undefined, fmt: DateFormat): string {
  if (!date) return '';
  const d =
    typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00`) : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = String(d.getFullYear());
  switch (fmt) {
    case 'dd/MM/yyyy': return `${dd}/${mm}/${yyyy}`;
    case 'MM/dd/yyyy': return `${mm}/${dd}/${yyyy}`;
    case 'yyyy-MM-dd': return `${yyyy}-${mm}-${dd}`;
    case 'dd-MM-yyyy': return `${dd}-${mm}-${yyyy}`;
    default: return `${d.getDate()} ${MONTHS[d.getMonth()]} ${yyyy}`;
  }
}

/** Readable text colour (white or near-black) for a hex background. */
export function contrastText(hex: string): string {
  const h = sanitizeHex(hex);
  if (!h) return '#ffffff';
  const lin = (i: number) => {
    const s = parseInt(h.slice(i, i + 2), 16) / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const lum = 0.2126 * lin(1) + 0.7152 * lin(3) + 0.0722 * lin(5);
  return lum > 0.45 ? '#14100c' : '#ffffff';
}

export type StampTone = 'paid' | 'overdue' | 'cancelled' | 'draft' | 'custom';
export interface Stamp {
  label: string;
  tone: StampTone;
}

/**
 * The watermark/stamp to print, or null. `status` is the already-derived
 * effective status (invoice-status.ts); quotations and challans never read
 * "PAID" / "OVERDUE".
 */
export function stampFor(watermark: string, status: string, docType: string): Stamp | null {
  if (!watermark || watermark === WATERMARK_NONE) return null;
  if (watermark !== WATERMARK_AUTO) return { label: watermark.toUpperCase(), tone: 'custom' };
  const billable = docType !== 'QUOTATION' && docType !== 'DELIVERY_CHALLAN' && docType !== 'SALES_ORDER';
  if (status === 'Cancelled') return { label: 'CANCELLED', tone: 'cancelled' };
  if (status === 'Draft') return { label: 'DRAFT', tone: 'draft' };
  if (status === 'Paid' && billable) return { label: 'PAID', tone: 'paid' };
  if (status === 'Overdue' && billable) return { label: 'OVERDUE', tone: 'overdue' };
  return null;
}

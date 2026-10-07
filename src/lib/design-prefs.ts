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

import { getTable, setTable } from './storage';
import { formatMoney } from './utils';

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
  /** 'none' | 'auto-status' | any other text = custom watermark. */
  watermark: string;
  paper: PaperKind;
  density: Density;
  footer_text: string;
  header_note: string;
  number_format: NumberFormat;
  date_format: DateFormat;
  updated_at?: string;
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
    watermark: watermarkRaw === '' ? WATERMARK_NONE : watermarkRaw,
    paper: pick(src.paper, PAPER_KINDS, base.paper),
    density: pick(src.density, DENSITIES, base.density),
    footer_text: 'footer_text' in src ? text(src.footer_text, 200) : base.footer_text,
    header_note: 'header_note' in src ? text(src.header_note, 160) : base.header_note,
    number_format: pick(src.number_format, NUMBER_FORMATS, base.number_format),
    date_format: pick(src.date_format, DATE_FORMATS, base.date_format),
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

/**
 * Where to slice a tall rendered paper into pages (canvas → jsPDF export).
 * Returns [top, height] of each page in CSS px. A thermal roll is one page.
 */
export function pageSlices(
  contentHeight: number,
  design?: Pick<DesignPrefs, 'paper'> | null,
): { top: number; height: number }[] {
  const size = paperSize(design);
  const total = Math.max(1, Math.ceil(contentHeight));
  if (size.autoHeight) return [{ top: 0, height: total }];
  const slices: { top: number; height: number }[] = [];
  for (let top = 0; top < total; top += size.height) slices.push({ top, height: size.height });
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
  const billable = docType !== 'QUOTATION' && docType !== 'DELIVERY_CHALLAN';
  if (status === 'Cancelled') return { label: 'CANCELLED', tone: 'cancelled' };
  if (status === 'Draft') return { label: 'DRAFT', tone: 'draft' };
  if (status === 'Paid' && billable) return { label: 'PAID', tone: 'paid' };
  if (status === 'Overdue' && billable) return { label: 'OVERDUE', tone: 'overdue' };
  return null;
}

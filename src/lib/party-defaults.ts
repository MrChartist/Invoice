/**
 * Party document defaults (R3-B5). A client may carry `doc_defaults` (template, currency, default line
 * discount, notes, terms, hourly rate, "attach timesheet annexure", Bilingual print language). Picking
 * the party on a NEW document applies them once:
 *  - template (or the Bilingual (Hindi) template when the print language is Hindi and no template is set);
 *  - currency, with the 8H currency master's reference rate on the document date;
 *  - notes / terms, only while the field is empty or still equal to the profile default (a typed value wins);
 *  - the discount on lines added afterwards.
 * The result carries an undo patch for the "Defaults from <party> applied · Undo" chip. An existing
 * document never re-applies them (Critical Rule 3); recurring, batch and converted documents keep their
 * source document's values.
 *
 * Pure (tests/party-defaults.test.ts).
 */
import type { Client, InvoiceRecord } from '../types/invoice';
import type { DocDefaults } from '../types/service-r3';
import { num, round2 } from './invoice-calc';

export const BILINGUAL_TEMPLATE_ID = 'bilingual_hindi';

/** The document fields party defaults may change. */
export type DefaultsDraft = Pick<InvoiceRecord, 'template_id' | 'currency' | 'notes' | 'terms' | 'issue_date'> &
  Partial<Pick<InvoiceRecord, 'id' | 'exchange_rate'>>;

/** Profile / company defaults the draft was made with. */
export interface ProfileDefaults {
  notes?: string;
  terms?: string;
}

export type DefaultsPatch = Partial<Pick<InvoiceRecord, 'template_id' | 'currency' | 'notes' | 'terms' | 'exchange_rate'>>;

export interface AppliedDefaults {
  patch: DefaultsPatch;
  /** Restores every changed field to what it was. */
  undo: DefaultsPatch;
  /** Line discount % for lines added from now on (0 = none). */
  line_discount: number;
  /** Which defaults changed something (for the chip). */
  applied: (keyof DocDefaults)[];
}

type RateRow = { currency: string; date: string; rate: number };

/** ₹ per unit of `currency` on or before `date` from the currency master (latest wins). */
export function referenceRate(rows: readonly RateRow[], currency: string, date: string): number | undefined {
  const cur = currency.toUpperCase();
  const hit = rows.filter((r) => r.currency?.toUpperCase() === cur && r.date <= date && num(r.rate) > 0).sort((a, b) => a.date.localeCompare(b.date)).pop();
  return hit ? num(hit.rate) : undefined;
}

const same = (a: string | undefined, b: string | undefined) => (a ?? '').trim() === (b ?? '').trim();

/**
 * Party defaults for a draft, or null when nothing applies (an existing document, or a party without
 * defaults). `rates` is the currency master (`currency_rates`).
 */
export function applyPartyDefaults(draft: DefaultsDraft, client: Pick<Client, 'doc_defaults'> | null | undefined, profile: ProfileDefaults, rates: readonly RateRow[] = []): AppliedDefaults | null {
  if (draft.id) return null;
  const d = normalizeDocDefaults(client?.doc_defaults);
  if (!d) return null;
  const patch: DefaultsPatch = {};
  const undo: DefaultsPatch = {};
  const applied: (keyof DocDefaults)[] = [];
  const set = <K extends keyof DefaultsPatch>(k: K, v: DefaultsPatch[K], tag: keyof DocDefaults) => {
    if (draft[k] === v) return;
    patch[k] = v;
    undo[k] = draft[k] as DefaultsPatch[K];
    if (!applied.includes(tag)) applied.push(tag);
  };
  const template = d.template_id || (d.print_lang === 'hi' ? BILINGUAL_TEMPLATE_ID : '');
  if (template) set('template_id', template, d.template_id ? 'template_id' : 'print_lang');
  if (d.currency && d.currency.toUpperCase() !== (draft.currency || 'INR').toUpperCase()) {
    set('currency', d.currency.toUpperCase(), 'currency');
    if (d.currency.toUpperCase() !== 'INR') {
      const rate = referenceRate(rates, d.currency, draft.issue_date);
      if (rate !== undefined) set('exchange_rate', rate, 'currency');
    } else if (draft.exchange_rate !== undefined) {
      set('exchange_rate', undefined, 'currency');
    }
  }
  // A typed value beats both defaults: only an empty field or the untouched profile default is replaced.
  if (d.notes && (!draft.notes?.trim() || same(draft.notes, profile.notes))) set('notes', d.notes, 'notes');
  if (d.terms && (!draft.terms?.trim() || same(draft.terms, profile.terms))) set('terms', d.terms, 'terms');
  const lineDiscount = num(d.discount_percent);
  if (lineDiscount > 0) applied.push('discount_percent');
  if (!applied.length) return null;
  return { patch, undo, line_discount: lineDiscount, applied };
}

/** Tolerant read: null when nothing is set. */
export function normalizeDocDefaults(raw: unknown): DocDefaults | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const s = (k: string) => (typeof o[k] === 'string' ? (o[k] as string).trim() : '');
  const out: DocDefaults = {};
  if (s('template_id')) out.template_id = s('template_id');
  if (/^[A-Za-z]{3}$/.test(s('currency'))) out.currency = s('currency').toUpperCase();
  const disc = num(o.discount_percent);
  if (disc > 0 && disc <= 100) out.discount_percent = round2(disc);
  if (s('notes')) out.notes = s('notes');
  if (s('terms')) out.terms = s('terms');
  const rate = num(o.hourly_rate);
  if (rate > 0) out.hourly_rate = round2(rate);
  if (o.annexure === true) out.annexure = true;
  if (o.print_lang === 'hi' || o.print_lang === 'en') out.print_lang = o.print_lang;
  return Object.keys(out).length ? out : null;
}

/* ── Client CSV / XLSX columns (optional) ───────────────────────── */

export const DOC_DEFAULT_COLUMNS = [
  'default_template', 'default_currency', 'default_discount_percent', 'default_notes', 'default_terms',
  'hourly_rate', 'attach_annexure', 'print_lang',
] as const;

export function docDefaultsToCells(d: DocDefaults | undefined): string[] {
  return [
    d?.template_id ?? '', d?.currency ?? '', d?.discount_percent ? String(d.discount_percent) : '', d?.notes ?? '', d?.terms ?? '',
    d?.hourly_rate ? String(d.hourly_rate) : '', d?.annexure ? 'yes' : '', d?.print_lang ?? '',
  ];
}

const yes = (v: string) => /^(y|yes|true|1|on)$/i.test(v.trim());

/** Read the optional columns of an import row (cell getter by field key). */
export function docDefaultsFromCells(cell: (key: string) => string): DocDefaults | null {
  const lang = cell('print_lang').trim().toLowerCase();
  return normalizeDocDefaults({
    template_id: cell('default_template'),
    currency: cell('default_currency'),
    discount_percent: Number(cell('default_discount_percent').replace(/[%\s]/g, '')) || 0,
    notes: cell('default_notes'),
    terms: cell('default_terms'),
    hourly_rate: Number(cell('hourly_rate').replace(/[₹,\s]/g, '')) || 0,
    annexure: yes(cell('attach_annexure')),
    print_lang: lang === 'hi' || lang === 'hindi' ? 'hi' : lang === 'en' || lang === 'english' ? 'en' : undefined,
  });
}

/**
 * R2-B3: proposal sections on a quotation — ordered blocks (title + plain text, optional image from the
 * document's own attachments) placed as a Cover, Before the items or After the items — and a small
 * library of reusable snippets (table `proposal_snippets`).
 *
 * Optional / alternative lines: helpers for the editor (`toggleOptional`, `selectLine`) and the printed
 * "Optional items" block (`optionalBlock`). Totals skip unselected lines in `invoice-calc`
 * (`isExcludedLine`).
 */

import type { InvoiceItem, InvoiceRecord } from '../types/invoice';
import type { ProposalSection, SectionPlace } from '../types/sales-r2';
import { isExcludedLine, mulRound2, num, pctOf, round2 } from './invoice-calc';
import { generateId, getTable, setTable } from './storage';
import { requireAccess } from './access';

export const PROPOSAL_SNIPPETS_TABLE = 'proposal_snippets';
export const SECTION_PLACES: SectionPlace[] = ['cover', 'before', 'after'];
export const MAX_SECTIONS = 20;
const MAX_BODY = 8000;

const clean = (s: unknown) => String(s ?? '').trim();

/** Trimmed sections: a title or a body is needed, place defaults to "after", at most `MAX_SECTIONS`. */
export function cleanSections(list: readonly Partial<ProposalSection>[] | undefined): ProposalSection[] {
  const out: ProposalSection[] = [];
  for (const s of list ?? []) {
    const title = clean(s?.title).slice(0, 200);
    const body = String(s?.body ?? '').replace(/\r\n/g, '\n').trim().slice(0, MAX_BODY);
    if (!title && !body) continue;
    const place: SectionPlace = SECTION_PLACES.includes(s.place as SectionPlace) ? (s.place as SectionPlace) : 'after';
    out.push({ id: clean(s.id) || generateId(), place, title, body, ...(clean(s.attachment_id) ? { attachment_id: clean(s.attachment_id) } : {}) });
    if (out.length >= MAX_SECTIONS) break;
  }
  return out;
}

/** Sections of one place, in their order. Only quotations print sections. */
export function sectionsAt(rec: Pick<InvoiceRecord, 'doc_type' | 'proposal_sections'>, place: SectionPlace): ProposalSection[] {
  if (rec.doc_type !== 'QUOTATION') return [];
  return (rec.proposal_sections ?? []).filter((s) => (s.place ?? 'after') === place && (clean(s.title) || clean(s.body)));
}

/** Move a section up / down within the list. */
export function moveSection(list: readonly ProposalSection[], id: string, dir: -1 | 1): ProposalSection[] {
  const out = [...list];
  const i = out.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= out.length) return out;
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/* ── Optional / alternative lines ───────────────────────────────── */

/** Alternative-group letters: the n-th line of a group is "Option A", "Option B" … */
export const optionLetter = (n: number) => String.fromCharCode(65 + (Math.max(0, n) % 26));

/** Flip a line's optional flag (an optional line starts unselected; clearing it clears `selected`). */
export function toggleOptional(items: readonly InvoiceItem[], id: string): InvoiceItem[] {
  return items.map((i) => {
    if (i.id !== id) return i;
    if (i.optional) {
      const { optional: _o, selected: _s, ...rest } = i;
      void [_o, _s];
      return rest.alt_group ? { ...rest, selected: i.selected } : rest;
    }
    return { ...i, optional: true, selected: false };
  });
}

/**
 * Select / unselect a line. In an alternative group exactly one line is selected: selecting one
 * unselects the others, and the selected one cannot be unselected (pick another instead).
 */
export function selectLine(items: readonly InvoiceItem[], id: string, on: boolean): InvoiceItem[] {
  const target = items.find((i) => i.id === id);
  if (!target) return [...items];
  const group = clean(target.alt_group);
  if (group) {
    if (!on) return [...items];
    return items.map((i) => (clean(i.alt_group) === group ? { ...i, selected: i.id === id } : i));
  }
  return items.map((i) => (i.id === id ? { ...i, selected: on } : i));
}

/** Put a line in an alternative group (or take it out with ''). Each group keeps exactly one selected line. */
export function setAltGroup(items: readonly InvoiceItem[], id: string, group: string): InvoiceItem[] {
  const g = clean(group).toUpperCase().slice(0, 12);
  const next = items.map((i) => {
    if (i.id !== id) return i;
    if (!g) {
      const { alt_group: _g, ...rest } = i;
      void _g;
      if (!rest.optional) delete rest.selected;
      return rest;
    }
    return { ...i, alt_group: g };
  });
  return normalizeAltGroups(next);
}

/** Each alternative group has exactly one selected line (the first selected, else the first line). */
export function normalizeAltGroups(items: readonly InvoiceItem[]): InvoiceItem[] {
  const chosen = new Map<string, string>();
  for (const i of items) {
    const g = clean(i.alt_group);
    if (g && i.selected && !chosen.has(g)) chosen.set(g, i.id);
  }
  for (const i of items) {
    const g = clean(i.alt_group);
    if (g && !chosen.has(g)) chosen.set(g, i.id);
  }
  return items.map((i) => {
    const g = clean(i.alt_group);
    return g ? { ...i, selected: chosen.get(g) === i.id } : i;
  });
}

export interface OptionalRow {
  item: InvoiceItem;
  /** "Option B" for an alternative, '' for a plain optional add-on. */
  option: string;
  /** Alternative group name ('' for add-ons). */
  group: string;
  /** Line value before GST (quantity × rate less the line discount). */
  amount: number;
}

/** Line value before GST: quantity × rate less the line discount (no invoice-level discount, no tax). */
export function lineValue(i: Pick<InvoiceItem, 'quantity' | 'rate' | 'discount_percent'>): number {
  const gross = mulRound2(num(i.quantity), num(i.rate));
  return round2(gross - pctOf(gross, Math.min(Math.max(num(i.discount_percent), 0), 100)));
}

/**
 * The printed "Optional items" block: the optional add-ons and the alternatives NOT selected (the
 * selected ones are already in the main table and the total). `subtotal` is their value before GST.
 */
export function optionalBlock(rec: Pick<InvoiceRecord, 'doc_type' | 'items'>): { rows: OptionalRow[]; subtotal: number } {
  if (rec.doc_type !== 'QUOTATION') return { rows: [], subtotal: 0 };
  const groupIndex = new Map<string, number>();
  const rows: OptionalRow[] = [];
  for (const item of rec.items ?? []) {
    const group = clean(item.alt_group);
    let option = '';
    if (group) {
      const n = groupIndex.get(group) ?? 0;
      groupIndex.set(group, n + 1);
      option = `Option ${optionLetter(n)}`;
    }
    if (!isExcludedLine(item)) continue;
    if (!clean(item.name) && !num(item.rate)) continue;
    rows.push({ item, option, group, amount: lineValue(item) });
  }
  return { rows, subtotal: round2(rows.reduce((s, r) => s + r.amount, 0)) };
}

/* ── Snippet library ────────────────────────────────────────────── */

export interface ProposalSnippet {
  id: string;
  title: string;
  body: string;
  place: SectionPlace;
  created_at: string;
  updated_at?: string;
}

export const snippetsDb = {
  all: (): ProposalSnippet[] => getTable<ProposalSnippet>(PROPOSAL_SNIPPETS_TABLE),
  /** Save a section as a reusable snippet (same title replaces the old one). */
  save(section: Pick<ProposalSection, 'title' | 'body' | 'place'>): ProposalSnippet {
    const [clean1] = cleanSections([section]);
    if (!clean1) throw new Error('Give the section a title or some text first.');
    const rows = snippetsDb.all();
    const now = new Date().toISOString();
    const same = rows.find((r) => r.title.trim().toLowerCase() === clean1.title.toLowerCase() && clean1.title);
    const row: ProposalSnippet = { id: same?.id ?? generateId(), title: clean1.title, body: clean1.body, place: clean1.place, created_at: same?.created_at ?? now, ...(same ? { updated_at: now } : {}) };
    setTable(PROPOSAL_SNIPPETS_TABLE, same ? rows.map((r) => (r.id === row.id ? row : r)) : [...rows, row]);
    return row;
  },
  remove(id: string): void {
    requireAccess('master.edit');
    setTable(PROPOSAL_SNIPPETS_TABLE, snippetsDb.all().filter((r) => r.id !== id));
  },
};

/** A new section on the document from a snippet (fresh id). */
export const sectionFromSnippet = (s: Pick<ProposalSnippet, 'title' | 'body' | 'place'>): ProposalSection => ({ id: generateId(), title: s.title, body: s.body, place: s.place });

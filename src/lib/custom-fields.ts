/**
 * Custom fields (roadmap 6.23): user-defined fields on documents, items and parties.
 *
 * Definitions: table `mrchartist_inv_custom_fields` (`CustomFieldDef`, src/types/custom-fields.ts).
 * Values (additive fields on the records):
 *  - clients / vendors / catalogue items: `custom_fields: Record<fieldId, string>`;
 *  - invoices and their lines: `custom_values: CustomFieldValue[]`, a snapshot of label + value +
 *    print flag. The snapshot is refreshed from the current definitions only while a document has
 *    never been saved; once saved it keeps the labels it was saved with (Critical Rule 3), so
 *    renaming or deleting a field never changes a historical invoice.
 *
 * Pure apart from the table read/write; tested in tests/custom-fields.test.ts.
 */

import { generateId, getTable, setTable } from './storage';
import type { CustomFieldDef, CustomFieldScope, CustomFieldType, CustomFieldValue } from '../types/custom-fields';

export type { CustomFieldDef, CustomFieldScope, CustomFieldType, CustomFieldValue } from '../types/custom-fields';

export const CUSTOM_FIELDS_TABLE = 'custom_fields';
export const MAX_CUSTOM_FIELDS = 30;
export const MAX_LABEL_LENGTH = 40;
export const MAX_VALUE_LENGTH = 200;

const TYPES: readonly CustomFieldType[] = ['text', 'number', 'date'];
const SCOPES: readonly CustomFieldScope[] = ['document', 'item', 'party'];

/* ── Values ─────────────────────────────────────────────────────── */

/**
 * Normalise a typed value for its field type. Text is trimmed and capped; numbers keep what the
 * user typed if it parses (so "1,250.50" → "1250.50", grouping removed); dates must be a real
 * `YYYY-MM-DD` local day. Returns '' for an empty or unusable value.
 */
export function cleanValue(type: CustomFieldType, raw: unknown): string {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (type === 'number') {
    const n = s.replace(/[,\s₹]/g, '');
    return /^-?\d+(\.\d+)?$/.test(n) ? n : '';
  }
  if (type === 'date') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.slice(0, 10));
    if (!m) return '';
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const dt = new Date(y, mo - 1, d); // local day, never UTC (Critical Rule 8)
    return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d ? m[0] : '';
  }
  return s.slice(0, MAX_VALUE_LENGTH);
}

/** Display text for a value; dates go through the caller's formatter (the template's date style). */
export function formatCustomValue(v: Pick<CustomFieldValue, 'type' | 'value'>, formatDate: (day: string) => string): string {
  if (!v.value) return '';
  return v.type === 'date' ? formatDate(v.value) || v.value : v.value;
}

/* ── Definitions ────────────────────────────────────────────────── */

/** Tolerant read of one definition (bad rows → null). */
export function normalizeDef(raw: unknown): CustomFieldDef | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<CustomFieldDef>;
  const label = typeof r.label === 'string' ? r.label.trim().slice(0, MAX_LABEL_LENGTH) : '';
  if (typeof r.id !== 'string' || !r.id || !label) return null;
  return {
    id: r.id,
    label,
    type: TYPES.includes(r.type as CustomFieldType) ? (r.type as CustomFieldType) : 'text',
    applies_to: SCOPES.includes(r.applies_to as CustomFieldScope) ? (r.applies_to as CustomFieldScope) : 'document',
    print: r.print === true,
    ...(r.created_at ? { created_at: r.created_at } : {}),
    ...(r.updated_at ? { updated_at: r.updated_at } : {}),
  };
}

export function fieldsFor(defs: readonly CustomFieldDef[], scope: CustomFieldScope): CustomFieldDef[] {
  return defs.filter((d) => d.applies_to === scope);
}

/** Checks a definition before it is saved; returns an error message or ''. */
export function defProblem(def: Pick<CustomFieldDef, 'id' | 'label' | 'applies_to'>, all: readonly CustomFieldDef[]): string {
  const label = def.label.trim();
  if (!label) return 'Give the field a label.';
  if (label.length > MAX_LABEL_LENGTH) return `Keep the label under ${MAX_LABEL_LENGTH} characters.`;
  const clash = all.find((d) => d.id !== def.id && d.applies_to === def.applies_to && d.label.trim().toLowerCase() === label.toLowerCase());
  if (clash) return `There is already a "${clash.label}" field for the same records.`;
  if (!all.some((d) => d.id === def.id) && all.length >= MAX_CUSTOM_FIELDS) return `Up to ${MAX_CUSTOM_FIELDS} custom fields.`;
  return '';
}

export const customFieldsDb = {
  all(): CustomFieldDef[] {
    return getTable<unknown>(CUSTOM_FIELDS_TABLE).map(normalizeDef).filter((d): d is CustomFieldDef => d !== null);
  },
  /** Insert or update by id. Throws a readable Error on an invalid definition. */
  save(input: Omit<CustomFieldDef, 'id'> & { id?: string }, now: Date = new Date()): CustomFieldDef {
    const all = customFieldsDb.all();
    const existing = input.id ? all.find((d) => d.id === input.id) : undefined;
    const def: CustomFieldDef = {
      id: existing?.id ?? input.id ?? generateId(),
      label: input.label.trim(),
      type: TYPES.includes(input.type) ? input.type : 'text',
      applies_to: SCOPES.includes(input.applies_to) ? input.applies_to : 'document',
      print: !!input.print,
      created_at: existing?.created_at ?? now.toISOString(),
      updated_at: now.toISOString(),
    };
    const problem = defProblem(def, all);
    if (problem) throw new Error(problem);
    setTable(CUSTOM_FIELDS_TABLE, existing ? all.map((d) => (d.id === def.id ? def : d)) : [...all, def]);
    return def;
  },
  /**
   * Remove a definition. Saved invoices keep their snapshot (and still print it); values on
   * clients / vendors / items stay in the record but are no longer shown.
   */
  remove(id: string): void {
    setTable(CUSTOM_FIELDS_TABLE, customFieldsDb.all().filter((d) => d.id !== id));
  },
  move(id: string, direction: -1 | 1): void {
    const all = customFieldsDb.all();
    const i = all.findIndex((d) => d.id === id);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= all.length) return;
    [all[i], all[j]] = [all[j], all[i]];
    setTable(CUSTOM_FIELDS_TABLE, all);
  },
};

/* ── Master records (clients, vendors, catalogue items) ─────────── */

/** Tolerant read of a record's `custom_fields` map. */
export function readValueMap(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string' && val) out[k] = val;
    else if (typeof val === 'number' && Number.isFinite(val)) out[k] = String(val);
  }
  return out;
}

/**
 * Clean a value map against the definitions for its scope before saving: values are normalised
 * per type and empties dropped. Values for fields that no longer exist are kept (additive: a
 * re-created field or an older backup must not lose data). Returns undefined when empty.
 */
export function cleanValueMap(
  map: Record<string, string> | undefined,
  defs: readonly CustomFieldDef[],
): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [id, raw] of Object.entries(readValueMap(map))) {
    const def = defs.find((d) => d.id === id);
    const v = def ? cleanValue(def.type, raw) : String(raw);
    if (v) out[id] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/* ── Snapshots (documents and their lines) ──────────────────────── */

/** Tolerant read of a snapshot list (bad entries dropped, one entry per id). */
export function readValues(v: unknown): CustomFieldValue[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: CustomFieldValue[] = [];
  for (const raw of v as Partial<CustomFieldValue>[]) {
    if (!raw || typeof raw.id !== 'string' || !raw.id || seen.has(raw.id)) continue;
    const type = TYPES.includes(raw.type as CustomFieldType) ? (raw.type as CustomFieldType) : 'text';
    const value = typeof raw.value === 'string' ? raw.value : raw.value == null ? '' : String(raw.value);
    if (!value) continue;
    seen.add(raw.id);
    out.push({
      id: raw.id,
      label: typeof raw.label === 'string' ? raw.label : '',
      type,
      value,
      print: raw.print === true,
      ...(raw.scope === 'party' ? { scope: 'party' as const } : {}),
    });
  }
  return out;
}

/** Snapshot entries for master-record values (catalogue item → line, client → invoice). */
export function snapshotFromMap(
  map: Record<string, string> | undefined,
  defs: readonly CustomFieldDef[],
  scope: CustomFieldScope,
): CustomFieldValue[] {
  const values = readValueMap(map);
  const out: CustomFieldValue[] = [];
  for (const def of fieldsFor(defs, scope)) {
    const value = cleanValue(def.type, values[def.id]);
    if (!value) continue;
    out.push({ id: def.id, label: def.label, type: def.type, value, print: def.print, ...(scope === 'party' ? { scope: 'party' as const } : {}) });
  }
  return out;
}

/**
 * Set (or clear, with '') one value in a snapshot list. An entry that already exists keeps its
 * stored label / print flag; a new one takes the definition's.
 */
export function setSnapshotValue(
  list: readonly CustomFieldValue[] | undefined,
  field: Pick<CustomFieldDef, 'id' | 'label' | 'type' | 'print'> & { scope?: 'party' },
  raw: string,
): CustomFieldValue[] {
  const current = readValues(list);
  const existing = current.find((v) => v.id === field.id);
  // Keep the raw text while typing (a half-typed number / date); cleanValue runs on save.
  const value = String(raw ?? '').slice(0, MAX_VALUE_LENGTH);
  if (!value.trim()) return current.filter((v) => v.id !== field.id);
  const entry: CustomFieldValue = existing
    ? { ...existing, value }
    : { id: field.id, label: field.label, type: field.type, value, print: field.print, ...(field.scope ? { scope: field.scope } : {}) };
  return existing ? current.map((v) => (v.id === field.id ? entry : v)) : [...current, entry];
}

/**
 * Merge party values from a picked client into a document's snapshot: existing entries win
 * (the user may have edited them), missing ones are added with the current label.
 */
export function mergePartyValues(
  list: readonly CustomFieldValue[] | undefined,
  clientMap: Record<string, string> | undefined,
  defs: readonly CustomFieldDef[],
): CustomFieldValue[] {
  const current = readValues(list);
  const add = snapshotFromMap(clientMap, defs, 'party').filter((p) => !current.some((v) => v.id === p.id));
  return add.length ? [...current, ...add] : current;
}

/**
 * The snapshot to persist on save. Values are normalised per type and empties dropped. For a
 * document that has never been saved (`isNew`) labels / types / print flags are refreshed from
 * the current definitions, so the first save records today's labels; a saved document keeps the
 * labels it already carries. Returns undefined when nothing is left (keeps legacy rows clean).
 */
export function finalizeValues(
  list: readonly CustomFieldValue[] | undefined,
  defs: readonly CustomFieldDef[],
  isNew: boolean,
): CustomFieldValue[] | undefined {
  const out: CustomFieldValue[] = [];
  for (const v of readValues(list)) {
    const def = isNew ? defs.find((d) => d.id === v.id) : undefined;
    const type = def?.type ?? v.type;
    const value = cleanValue(type, v.value);
    if (!value) continue;
    out.push(def ? { ...v, label: def.label, type, print: def.print, value } : { ...v, type, value });
  }
  return out.length ? out : undefined;
}

/** Entries that print, in a stable order: document fields first, then party fields. */
export function printableValues(list: readonly CustomFieldValue[] | undefined): CustomFieldValue[] {
  const vals = readValues(list).filter((v) => v.print && v.label.trim());
  return [...vals.filter((v) => v.scope !== 'party'), ...vals.filter((v) => v.scope === 'party')];
}

/* ── Exports ────────────────────────────────────────────────────── */

/**
 * Column labels for a register: every distinct document-field label used by `docs`, in the order
 * first seen (party values are included too — they are part of the document's snapshot).
 */
export function registerColumns(docs: readonly { custom_values?: CustomFieldValue[] }[]): string[] {
  const labels: string[] = [];
  for (const d of docs) {
    for (const v of readValues(d.custom_values)) {
      const label = v.label.trim();
      if (label && !labels.includes(label)) labels.push(label);
    }
  }
  return labels;
}

/** One document's values for `registerColumns` (by label, '' when absent). */
export function registerCells(doc: { custom_values?: CustomFieldValue[] }, columns: readonly string[]): string[] {
  const vals = readValues(doc.custom_values);
  return columns.map((label) => vals.find((v) => v.label.trim() === label)?.value ?? '');
}

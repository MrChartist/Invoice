/**
 * R3-C6 monthly client checklist (per company, company data): template items ("Bank statement
 * received", "GSTR-2B downloaded" …) ticked per month. A month starts from the company's template (or
 * the device default, then the built-in list) and carries over the previous saved month's unticked
 * items with a flag — across months and across the financial year. Rows: `client_checklist`
 * `{ id: 'YYYY-MM', items }`; the company template is the object key `checklist_template`; the device
 * default lives outside the data prefix (`mrchartist_checklist_default`, never backed up).
 */

import { requireAccess } from './access';
import { DB_PREFIX, getJson, getTable, setJson, setTable } from './storage';
import { withTablesRollback } from './table-txn';

export const CHECKLIST_TABLE = 'client_checklist';
export const TEMPLATE_KEY = `${DB_PREFIX}checklist_template`;
export const DEVICE_DEFAULT_KEY = 'mrchartist_checklist_default';

export const BUILTIN_TEMPLATE: readonly string[] = [
  'Bank statement received',
  'Sales register shared',
  'Purchase bills received',
  'GSTR-2B downloaded',
  'GSTR-1 filed',
  'GSTR-3B filed',
  'TDS challan paid',
  'Books updated',
];

export interface ChecklistItem {
  id: string;
  label: string;
  /** ISO time it was ticked. */
  done_at?: string;
  by?: string;
  /** Month (YYYY-MM) an unticked item was carried over from. */
  carried?: string;
}

export interface ChecklistMonth {
  id: string;
  items: ChecklistItem[];
}

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const slug = (label: string) => label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'item';

/** Clean a template: trimmed, non-empty, unique, at most 30 items. */
export function cleanTemplate(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of v) {
    const t = typeof x === 'string' ? x.trim().slice(0, 80) : '';
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length >= 30) break;
  }
  return out;
}

/** The previous month key ('2026-04' → '2026-03', '2026-01' → '2025-12'). */
export function prevMonth(month: string): string {
  const y = +month.slice(0, 4);
  const m = +month.slice(5, 7);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

/**
 * The month's checklist: the saved one, or a new one from `template` plus the unticked items of the
 * latest saved month before it (flagged `carried`; an item already in the template is flagged instead
 * of repeated). Pure — the inputs are never changed.
 */
export function monthChecklist(rows: readonly ChecklistMonth[], month: string, template: readonly string[]): ChecklistMonth {
  const saved = rows.find((r) => r?.id === month);
  if (saved) return { id: saved.id, items: saved.items.map((i) => ({ ...i })) };
  const prev = [...rows].filter((r) => r && MONTH.test(r.id) && r.id < month).sort((a, b) => b.id.localeCompare(a.id))[0];
  const open = (prev?.items ?? []).filter((i) => !i.done_at);
  const items: ChecklistItem[] = template.map((label) => {
    const carriedFrom = open.find((i) => i.label.toLowerCase() === label.toLowerCase());
    return { id: slug(label), label, ...(carriedFrom ? { carried: carriedFrom.carried ?? prev!.id } : {}) };
  });
  const used = new Set(items.map((i) => i.label.toLowerCase()));
  for (const i of open) {
    if (used.has(i.label.toLowerCase())) continue;
    used.add(i.label.toLowerCase());
    items.push({ id: `${i.id}-c`, label: i.label, carried: i.carried ?? prev!.id });
  }
  const ids = new Set<string>();
  for (const it of items) {
    let id = it.id;
    for (let n = 2; ids.has(id); n++) id = `${it.id}-${n}`;
    it.id = id;
    ids.add(id);
  }
  return { id: month, items };
}

export function progress(m: Pick<ChecklistMonth, 'items'> | undefined): { done: number; total: number } {
  const items = m?.items ?? [];
  return { done: items.filter((i) => i.done_at).length, total: items.length };
}

/** Pure: tick / untick one item of a month (the month is created from the template when new). */
export function toggleItem(rows: readonly ChecklistMonth[], month: string, template: readonly string[], itemId: string, by: string, now: Date): ChecklistMonth[] {
  const m = monthChecklist(rows, month, template);
  m.items = m.items.map((i) => {
    if (i.id !== itemId) return i;
    if (i.done_at) {
      const { done_at: _d, by: _b, ...rest } = i;
      return rest;
    }
    return { ...i, done_at: now.toISOString(), ...(by ? { by } : {}) };
  });
  return [...rows.filter((r) => r?.id !== month), m];
}

function readDeviceDefault(): string[] {
  try {
    return cleanTemplate(JSON.parse(globalThis.localStorage?.getItem(DEVICE_DEFAULT_KEY) ?? 'null'));
  } catch {
    return [];
  }
}

export const checklistDb = {
  months: (): ChecklistMonth[] => getTable<ChecklistMonth>(CHECKLIST_TABLE).filter((r) => r && MONTH.test(r.id) && Array.isArray(r.items)),
  /** Company template, else the device default, else the built-in list. */
  template(): string[] {
    const own = cleanTemplate(getJson<unknown>(TEMPLATE_KEY, null));
    if (own.length) return own;
    const dev = readDeviceDefault();
    return dev.length ? dev : [...BUILTIN_TEMPLATE];
  },
  setTemplate(list: readonly string[], asDeviceDefault = false): string[] {
    requireAccess('books.edit');
    const clean = cleanTemplate(list);
    setJson(TEMPLATE_KEY, clean);
    if (asDeviceDefault) {
      try {
        globalThis.localStorage?.setItem(DEVICE_DEFAULT_KEY, JSON.stringify(clean));
      } catch {
        /* device default not remembered */
      }
    }
    return clean;
  },
  toggle(month: string, itemId: string, by: string, now = new Date()): ChecklistMonth {
    requireAccess('books.edit');
    if (!MONTH.test(month)) throw new Error('Pick a month.');
    const next = toggleItem(checklistDb.months(), month, checklistDb.template(), itemId, by, now);
    withTablesRollback([CHECKLIST_TABLE], () => setTable(CHECKLIST_TABLE, next));
    return next.find((r) => r.id === month)!;
  },
};

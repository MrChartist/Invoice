/**
 * R2-B3: quotation revisions.
 *
 * "Revise" on a sent quotation creates a NEW quotation with the same base number and an `-R<n>` suffix
 * (`QTN/FY26-27/0012-R2`), `revision_of` = the quote it replaces and `revision_no` = n (the original is
 * revision 1). The old record is never edited: a `revised` link in `doc_links` makes it "Superseded"
 * (derived in `quoteState`), so an accepted revision keeps its acceptance snapshot untouched and the
 * revised copy starts without one (8G acceptance is per revision).
 *
 * The revision number is outside the QTN series (the suffix keeps it from counting as a new serial).
 * Pure builders first; `reviseQuotation` saves through `localDb` (period lock, roles, audit).
 */

import type { InvoiceItem, InvoiceRecord } from '../types/invoice';
import type {} from '../types/sales-r2';
import { calcInputFromRecord, calculateInvoice, isExcludedLine, num, round2 } from './invoice-calc';
import { generateId, getTable, KEYS, setTable } from './storage';
import { localDb } from './localDb';
import { withTablesRollback } from './table-txn';
import { localDayOf } from './dates';

const DOC_LINKS = 'doc_links';

export interface LinkLike {
  from_id: string;
  to_id: string;
  relation: string;
}

const REV_RE = /-R(\d+)$/i;

/** The quotation number without its revision suffix. */
export function revisionBase(number: string): string {
  return String(number ?? '').trim().replace(REV_RE, '');
}

/** `QTN/FY26-27/0012` + 3 → `QTN/FY26-27/0012-R3`. */
export function revisionNumber(base: string, n: number): string {
  return `${revisionBase(base)}-R${Math.max(2, Math.floor(n))}`;
}

/** Revision number of a quote (1 for the original). */
export const revisionOf = (q: Pick<InvoiceRecord, 'revision_no' | 'invoice_number'>): number => {
  if (num(q.revision_no) > 0) return Math.floor(num(q.revision_no));
  const m = REV_RE.exec(String(q.invoice_number ?? ''));
  return m ? Number(m[1]) : 1;
};

/** Every revision of the quote's family (same base number, quotations only), oldest first. */
export function quoteFamily<T extends Pick<InvoiceRecord, 'id' | 'doc_type' | 'invoice_number' | 'revision_no'>>(quote: T, all: readonly T[]): T[] {
  const base = revisionBase(quote.invoice_number).toUpperCase();
  return all
    .filter((q) => q.doc_type === 'QUOTATION' && revisionBase(q.invoice_number).toUpperCase() === base)
    .sort((a, b) => revisionOf(a) - revisionOf(b));
}

/** Ids of quotes that a later revision replaced. */
export function supersededIds(links: readonly LinkLike[]): Set<string> {
  return new Set(links.filter((l) => l.relation === 'revised').map((l) => l.from_id));
}

/** Why a quote cannot be revised ('' = it can). */
export function reviseBlocked(quote: Pick<InvoiceRecord, 'id' | 'doc_type' | 'status'>, links: readonly LinkLike[]): string {
  if (quote.doc_type !== 'QUOTATION') return 'Only quotations can be revised.';
  if (quote.status === 'Draft') return 'This quotation is still a draft: edit it instead of revising it.';
  if (quote.status === 'Cancelled') return 'This quotation is cancelled.';
  if (supersededIds(links).has(quote.id)) return 'A later revision already replaced this quotation: revise the latest one.';
  if (links.some((l) => l.from_id === quote.id && (l.relation === 'converted' || l.relation === 'progress'))) {
    return 'This quotation was already converted or billed.';
  }
  return '';
}

export interface RevisionContext {
  id: string;
  today: string;
  /** Highest revision number already used in the family. */
  highest: number;
}

const dayNum = (d: string): number => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d ?? '');
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5 : NaN;
};
const shift = (d: string, days: number): string => {
  const base = dayNum(d);
  if (!Number.isFinite(base)) return d;
  const t = new Date((base + days) * 864e5);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
};

/** Pure: the revision draft (Draft status, new number, today's date, same validity length, no acceptance). */
export function buildRevision(source: InvoiceRecord, ctx: RevisionContext): InvoiceRecord {
  const n = Math.max(ctx.highest, revisionOf(source)) + 1;
  const validity = Number.isFinite(dayNum(source.due_date) - dayNum(source.issue_date)) ? Math.max(dayNum(source.due_date) - dayNum(source.issue_date), 0) : 0;
  const rec: InvoiceRecord = {
    ...source,
    id: ctx.id,
    invoice_number: revisionNumber(source.invoice_number, n),
    revision_of: source.id,
    revision_no: n,
    issue_date: ctx.today,
    due_date: shift(ctx.today, validity),
    status: 'Draft',
    quote_status: undefined,
    acceptance: undefined, // 8G: acceptance belongs to the revision the client signed
    approval: undefined,
    amends: undefined,
    party_balance_snapshot: undefined,
    created_at: undefined,
    updated_at: undefined,
    items: (source.items ?? []).map((i, k) => ({ ...i, id: `${ctx.id}-l${k + 1}` })),
    client: { ...source.client },
    sender: source.sender ? { ...source.sender } : null,
  };
  return rec;
}

/* ── Line-level diff ────────────────────────────────────────────── */

export type DiffKind = 'added' | 'removed' | 'changed' | 'same';

export interface LineDiff {
  kind: DiffKind;
  name: string;
  before?: Pick<InvoiceItem, 'quantity' | 'rate' | 'discount_percent' | 'tax_rate' | 'optional' | 'selected'>;
  after?: Pick<InvoiceItem, 'quantity' | 'rate' | 'discount_percent' | 'tax_rate' | 'optional' | 'selected'>;
  /** Which fields differ (`quantity`, `rate`, `discount_percent`, `tax_rate`, `optional`). */
  fields: string[];
}

export interface RevisionDiff {
  lines: LineDiff[];
  totalBefore: number;
  totalAfter: number;
  change: number;
}

const lineKey = (i: Pick<InvoiceItem, 'name' | 'hsn'>) => `${String(i.name ?? '').trim().toLowerCase()}|${String(i.hsn ?? '').trim()}`;
const pick = (i: InvoiceItem) => ({ quantity: num(i.quantity), rate: num(i.rate), discount_percent: num(i.discount_percent), tax_rate: num(i.tax_rate), optional: !!i.optional || !!i.alt_group, selected: !isExcludedLine(i) });

/** Pure: lines added / removed / changed between two revisions (matched by name + HSN, in order). */
export function revisionDiff(before: InvoiceRecord, after: InvoiceRecord): RevisionDiff {
  const pool = new Map<string, InvoiceItem[]>();
  for (const i of before.items ?? []) {
    if (!String(i.name ?? '').trim() && !num(i.rate)) continue;
    const k = lineKey(i);
    pool.set(k, [...(pool.get(k) ?? []), i]);
  }
  const lines: LineDiff[] = [];
  for (const i of after.items ?? []) {
    if (!String(i.name ?? '').trim() && !num(i.rate)) continue;
    const k = lineKey(i);
    const match = pool.get(k)?.shift();
    if (!match) {
      lines.push({ kind: 'added', name: i.name, after: pick(i), fields: [] });
      continue;
    }
    const a = pick(match);
    const b = pick(i);
    const fields = (['quantity', 'rate', 'discount_percent', 'tax_rate', 'optional', 'selected'] as const).filter((f) => a[f] !== b[f]);
    lines.push({ kind: fields.length ? 'changed' : 'same', name: i.name, before: a, after: b, fields: [...fields] });
  }
  for (const rest of pool.values()) for (const i of rest) lines.push({ kind: 'removed', name: i.name, before: pick(i), fields: [] });
  const total = (r: InvoiceRecord) => calculateInvoice(calcInputFromRecord(r, { amount_paid: 0 })).total;
  const totalBefore = total(before);
  const totalAfter = total(after);
  return { lines, totalBefore, totalAfter, change: round2(totalAfter - totalBefore) };
}

/* ── Storage ────────────────────────────────────────────────────── */

/**
 * Revise a sent quotation: saves the revision as a Draft (the editor opens it) and links the old one as
 * `revised` (→ Superseded). Both writes or neither (`withTablesRollback`); the period lock, roles and the
 * audit log apply through `localDb.invoices.save`.
 */
export function reviseQuotation(source: InvoiceRecord): InvoiceRecord {
  const links = getTable<LinkLike>(DOC_LINKS);
  const fresh = localDb.invoices.getById(source.id) ?? source;
  const blocked = reviseBlocked(fresh, links);
  if (blocked) throw new Error(blocked);
  const family = quoteFamily(fresh, localDb.invoices.getAll());
  const highest = family.reduce((m, q) => Math.max(m, revisionOf(q)), 1);
  const draft = buildRevision(fresh, { id: generateId(), today: localDayOf(new Date()), highest });
  return withTablesRollback([KEYS.invoices, DOC_LINKS], () => {
    const saved = localDb.invoices.save(draft);
    setTable(DOC_LINKS, [...getTable<object>(DOC_LINKS), { id: generateId(), from_id: fresh.id, to_id: saved.id, relation: 'revised', created_at: new Date().toISOString() }]);
    return saved;
  });
}

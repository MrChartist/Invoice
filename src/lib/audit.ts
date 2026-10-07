/**
 * Audit trail — Tally's "edit log" for this app.
 *
 * Every mutation made through `localDb` (invoices, payments, clients, settings)
 * is recorded here automatically, so no screen or module has to remember to log.
 * Logging is strictly best-effort: `audit.record` NEVER throws and a full quota
 * only costs the log row, never the user's save.
 *
 * Storage: table `audit_log` (`mrchartist_inv_audit_log`), oldest → newest,
 * capped at `AUDIT_MAX_ROWS` (oldest rows are dropped first).
 *
 * Privacy: rows carry field-level before/after for business data only. Contact
 * details (email, phone, address), bank details and free-text notes are never
 * copied in full — only the fact that they changed (notes: a short excerpt).
 */

import type { AuditAction, AuditChange, AuditEntry } from '../types/audit';
import type { Client, InvoiceRecord, Payment, SenderProfile } from '../types/invoice';
import { round2 } from './invoice-calc';
import { generateId, getTable, setTable } from './storage';
import { formatCurrency } from './utils';

export const AUDIT_TABLE = 'audit_log';
export const AUDIT_MAX_ROWS = 5000;
/** Text fields are excerpted to this many characters in a diff. */
const EXCERPT = 60;

export type AuditInput = Omit<AuditEntry, 'id' | 'at'> & { at?: string };

/* ── Diff helpers (pure) ───────────────────────────────────────── */

const money = (n: unknown, currency: string) => formatCurrency(round2(Number(n) || 0), currency || 'INR');
const sameMoney = (a: unknown, b: unknown) => Math.abs((Number(a) || 0) - (Number(b) || 0)) < 0.005;
const excerpt = (v: unknown) => {
  const t = String(v ?? '').replace(/\s+/g, ' ').trim();
  return t.length > EXCERPT ? `${t.slice(0, EXCERPT - 1)}…` : t;
};
const blank = (s: string | null | undefined) => (s === undefined || s === null || s === '' ? null : s);

function push(out: AuditChange[], field: string, from: string | null, to: string | null) {
  if ((from ?? '') !== (to ?? '')) out.push({ field, from: blank(from), to: blank(to) });
}

type Loose = Record<string, unknown>;

interface InvoiceFieldSpec {
  key: string;
  label: string;
  kind: 'text' | 'money' | 'bool' | 'excerpt';
}

const INVOICE_FIELDS: InvoiceFieldSpec[] = [
  { key: 'invoice_number', label: 'Number', kind: 'text' },
  { key: 'doc_type', label: 'Type', kind: 'text' },
  { key: 'status', label: 'Status', kind: 'text' },
  { key: 'issue_date', label: 'Issue date', kind: 'text' },
  { key: 'due_date', label: 'Due date', kind: 'text' },
  { key: 'currency', label: 'Currency', kind: 'text' },
  { key: 'place_of_supply', label: 'Place of supply', kind: 'text' },
  { key: 'gst_mode', label: 'GST type', kind: 'text' },
  { key: 'supply_type', label: 'Supply type', kind: 'text' },
  { key: 'reverse_charge', label: 'Reverse charge', kind: 'bool' },
  { key: 'po_number', label: 'PO / reference', kind: 'text' },
  { key: 'subtotal', label: 'Items value', kind: 'money' },
  { key: 'discount_amount', label: 'Discount', kind: 'money' },
  { key: 'shipping', label: 'Shipping', kind: 'money' },
  { key: 'other_charges', label: 'Other charges', kind: 'money' },
  { key: 'tax_amount', label: 'GST', kind: 'money' },
  { key: 'tcs_amount', label: 'TCS', kind: 'money' },
  { key: 'tds_amount', label: 'TDS', kind: 'money' },
  { key: 'total', label: 'Total', kind: 'money' },
  { key: 'amount_paid', label: 'Received', kind: 'money' },
  { key: 'notes', label: 'Notes', kind: 'excerpt' },
  { key: 'terms', label: 'Terms', kind: 'excerpt' },
];

const LINE_FIELDS: Array<{ key: string; label: string; money?: boolean }> = [
  { key: 'name', label: 'item' },
  { key: 'quantity', label: 'qty' },
  { key: 'rate', label: 'rate', money: true },
  { key: 'discount_percent', label: 'disc %' },
  { key: 'tax_rate', label: 'GST %' },
  { key: 'hsn', label: 'HSN' },
];
const MAX_LINE_CHANGES = 8;

/** Field-level differences between two versions of a document. Empty when nothing material changed. */
export function diffInvoice(before: Partial<InvoiceRecord>, after: Partial<InvoiceRecord>): AuditChange[] {
  const out: AuditChange[] = [];
  const a = before as Loose;
  const b = after as Loose;
  const currency = String(b.currency ?? a.currency ?? 'INR');

  for (const f of INVOICE_FIELDS) {
    const av = a[f.key];
    const bv = b[f.key];
    if (f.kind === 'money') {
      if (!sameMoney(av, bv)) push(out, f.label, money(av, currency), money(bv, currency));
    } else if (f.kind === 'bool') {
      if (Boolean(av) !== Boolean(bv)) push(out, f.label, av ? 'Yes' : 'No', bv ? 'Yes' : 'No');
    } else if (f.kind === 'excerpt') {
      if (String(av ?? '').trim() !== String(bv ?? '').trim()) push(out, f.label, excerpt(av) || null, excerpt(bv) || null);
    } else if (String(av ?? '') !== String(bv ?? '')) {
      push(out, f.label, av === undefined || av === null ? null : String(av), bv === undefined || bv === null ? null : String(bv));
    }
  }

  push(out, 'Client', before.client?.name ?? null, after.client?.name ?? null);
  push(out, 'Client GSTIN', before.client?.gstin ?? null, after.client?.gstin ?? null);
  // Contact / address edits on the document's client snapshot: flagged, never copied.
  const cb = (before.client ?? {}) as unknown as Loose;
  const ca = (after.client ?? {}) as unknown as Loose;
  if (['email', 'phone', 'address', 'city', 'zip', 'state_code'].some((k) => String(cb[k] ?? '').trim() !== String(ca[k] ?? '').trim())) {
    push(out, 'Client details', '(hidden)', '(changed)');
  }
  push(out, 'Issuing as', before.sender?.companyName ?? null, after.sender?.companyName ?? null);

  // Lines: count, then per-line edits matched by id.
  const ai = Array.isArray(before.items) ? before.items : [];
  const bi = Array.isArray(after.items) ? after.items : [];
  if (ai.length !== bi.length) push(out, 'Lines', String(ai.length), String(bi.length));
  const aById = new Map(ai.map((i, n) => [i.id, { item: i as unknown as Loose, n }]));
  const bIds = new Set(bi.map((i) => i.id));
  let lineChanges = 0;
  let omitted = 0;
  const lineChange = (field: string, from: string | null, to: string | null) => {
    if (lineChanges >= MAX_LINE_CHANGES) omitted++;
    else {
      push(out, field, from, to);
      lineChanges++;
    }
  };
  bi.forEach((item, n) => {
    const prev = aById.get(item.id);
    if (!prev) return lineChange(`Line ${n + 1} added`, null, excerpt(item.name) || 'untitled');
    for (const f of LINE_FIELDS) {
      const pv = prev.item[f.key];
      const nv = (item as unknown as Loose)[f.key];
      const differs = f.money ? !sameMoney(pv, nv) : String(pv ?? '') !== String(nv ?? '');
      if (!differs) continue;
      const fmt = (v: unknown) => (f.money ? money(v, currency) : v === undefined || v === null || v === '' ? null : String(v));
      lineChange(`Line ${n + 1} ${f.label}`, fmt(pv), fmt(nv));
    }
  });
  ai.forEach((item, n) => {
    if (!bIds.has(item.id)) lineChange(`Line ${n + 1} removed`, excerpt(item.name) || 'untitled', null);
  });
  if (omitted > 0) push(out, 'More line edits', null, `+${omitted}`);
  return out;
}

/** Client diff. Contact details are recorded as "changed" only — never copied. */
export function diffClient(before: Partial<Client>, after: Partial<Client>): AuditChange[] {
  const out: AuditChange[] = [];
  const open: Array<[keyof Client, string]> = [
    ['name', 'Name'],
    ['company', 'Company'],
    ['gstin', 'GSTIN'],
    ['state_code', 'State code'],
    ['city', 'City'],
  ];
  for (const [k, label] of open) push(out, label, blank(String(before[k] ?? '')), blank(String(after[k] ?? '')));
  const hidden: Array<[keyof Client, string]> = [
    ['email', 'Email'],
    ['phone', 'Phone'],
    ['address', 'Address'],
    ['zip', 'PIN code'],
    ['notes', 'Notes'],
  ];
  for (const [k, label] of hidden) {
    if (String(before[k] ?? '').trim() !== String(after[k] ?? '').trim()) push(out, label, '(hidden)', '(changed)');
  }
  return out;
}

/** Business-profile diff. Bank details, logo and signature are flagged, not copied. */
export function diffProfile(before: Partial<SenderProfile>, after: Partial<SenderProfile>): AuditChange[] {
  const out: AuditChange[] = [];
  const open: Array<[keyof SenderProfile, string]> = [
    ['companyName', 'Business name'],
    ['companyGstin', 'GSTIN'],
    ['pan', 'PAN'],
    ['stateCode', 'State code'],
    ['invoicePrefix', 'Number prefix'],
  ];
  for (const [k, label] of open) push(out, label, blank(String(before[k] ?? '')), blank(String(after[k] ?? '')));
  const hidden: Array<[keyof SenderProfile, string]> = [
    ['bankName', 'Bank details'],
    ['accountName', 'Bank details'],
    ['accountNumber', 'Bank details'],
    ['ifsc', 'Bank details'],
    ['upiId', 'UPI ID'],
    ['companyEmail', 'Email'],
    ['companyPhone', 'Phone'],
    ['companyAddress', 'Address'],
    ['logo', 'Logo'],
    ['signature', 'Signature'],
    ['defaultTerms', 'Default terms'],
  ];
  const seen = new Set<string>();
  for (const [k, label] of hidden) {
    if (seen.has(label)) continue;
    if (String(before[k] ?? '') !== String(after[k] ?? '')) {
      seen.add(label);
      push(out, label, '(hidden)', '(changed)');
    }
  }
  return out;
}

/** Plain-text one-liner for the first few changes of a diff. */
export function summarizeChanges(changes: AuditChange[], max = 3): string {
  const shown = changes.slice(0, max).map((c) => `${c.field} ${c.from ?? '—'} → ${c.to ?? '—'}`);
  const more = changes.length - max;
  return shown.join('; ') + (more > 0 ? `; +${more} more` : '');
}

/* ── Store ─────────────────────────────────────────────────────── */

function readAll(): AuditEntry[] {
  return getTable<AuditEntry>(AUDIT_TABLE);
}

function writeCapped(rows: AuditEntry[]): void {
  const capped = rows.length > AUDIT_MAX_ROWS ? rows.slice(rows.length - AUDIT_MAX_ROWS) : rows;
  try {
    setTable(AUDIT_TABLE, capped);
  } catch {
    // Quota: shed the oldest half once and retry. If that fails too, give up silently.
    try {
      setTable(AUDIT_TABLE, capped.slice(Math.floor(capped.length / 2)));
    } catch {
      /* the user's save matters more than its log row */
    }
  }
}

export const audit = {
  /** Append one row. Never throws; returns the row, or null if it could not be written. */
  record(input: AuditInput): AuditEntry | null {
    try {
      const entry: AuditEntry = {
        id: generateId(),
        at: input.at ?? new Date().toISOString(),
        entity: input.entity,
        entity_id: input.entity_id,
        action: input.action,
        summary: input.summary,
        ...(input.changes && input.changes.length ? { changes: input.changes } : {}),
        ...(input.doc_number ? { doc_number: input.doc_number } : {}),
        ...(input.parent_id ? { parent_id: input.parent_id } : {}),
      };
      const rows = readAll();
      rows.push(entry);
      writeCapped(rows);
      return entry;
    } catch {
      return null;
    }
  },

  /** Newest first. */
  all(): AuditEntry[] {
    return readAll().slice().reverse();
  },

  /** Rows about one document: its own edits plus its payments. Newest first. */
  forInvoice(invoiceId: string): AuditEntry[] {
    return audit.all().filter((e) => e.entity_id === invoiceId || e.parent_id === invoiceId);
  },

  count(): number {
    return readAll().length;
  },
};

/* ── Convenience builders used by localDb ──────────────────────── */

const docLabel = (inv: Partial<InvoiceRecord>) => inv.invoice_number || 'document';

export function invoiceCreated(inv: InvoiceRecord): AuditInput {
  return {
    entity: 'invoice',
    entity_id: inv.id,
    action: 'create',
    doc_number: inv.invoice_number,
    summary: `Created ${docLabel(inv)}${inv.client?.name ? ` for ${inv.client.name}` : ''} — ${money(inv.total, inv.currency)}`,
    changes: [
      { field: 'Status', from: null, to: inv.status },
      { field: 'Total', from: null, to: money(inv.total, inv.currency) },
    ],
  };
}

export function invoiceUpdated(before: InvoiceRecord, after: InvoiceRecord, note = ''): AuditInput | null {
  const changes = diffInvoice(before, after);
  if (changes.length === 0) return null;
  const was = before.status === 'Cancelled';
  const now = after.status === 'Cancelled';
  const action: AuditAction = !was && now ? 'cancel' : was && !now ? 'reinstate' : 'update';
  const verb = action === 'cancel' ? 'Cancelled' : action === 'reinstate' ? 'Reinstated' : 'Edited';
  const rest = action === 'update' ? changes : changes.filter((c) => c.field !== 'Status');
  return {
    entity: 'invoice',
    entity_id: after.id,
    action,
    doc_number: after.invoice_number,
    summary: `${verb} ${docLabel(after)}${rest.length ? `: ${summarizeChanges(rest)}` : ''}${note}`,
    changes,
  };
}

export function invoiceDeleted(inv: InvoiceRecord, paymentsRemoved: number, note = ''): AuditInput {
  return {
    entity: 'invoice',
    entity_id: inv.id,
    action: 'delete',
    doc_number: inv.invoice_number,
    summary:
      `Deleted ${docLabel(inv)}${inv.client?.name ? ` (${inv.client.name})` : ''} — ${money(inv.total, inv.currency)}` +
      `${paymentsRemoved ? `, with ${paymentsRemoved} payment${paymentsRemoved === 1 ? '' : 's'}` : ''}${note}`,
    changes: [
      { field: 'Status', from: inv.status, to: null },
      { field: 'Total', from: money(inv.total, inv.currency), to: null },
    ],
  };
}

export function paymentLogged(
  kind: 'payment_add' | 'payment_remove',
  p: Payment,
  inv: Partial<InvoiceRecord> | undefined,
): AuditInput {
  const cur = inv?.currency ?? 'INR';
  const amt = money(p.amount, cur);
  const num = inv?.invoice_number;
  return {
    entity: 'payment',
    entity_id: p.id,
    parent_id: p.invoice_id,
    action: kind,
    doc_number: num,
    summary:
      kind === 'payment_add'
        ? `Payment ${amt} received via ${p.method}${num ? ` on ${num}` : ''}`
        : `Removed payment ${amt} (${p.method})${num ? ` from ${num}` : ''}`,
    changes: [
      { field: 'Amount', from: kind === 'payment_add' ? null : amt, to: kind === 'payment_add' ? amt : null },
      { field: 'Method', from: kind === 'payment_add' ? null : p.method, to: kind === 'payment_add' ? p.method : null },
      { field: 'Date', from: kind === 'payment_add' ? null : p.date, to: kind === 'payment_add' ? p.date : null },
    ],
  };
}

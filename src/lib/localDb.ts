/**
 * Local Database — browser-resident storage layer.
 * Repositories on top of `storage.ts`. No network, no backend.
 *
 * Payment model: `invoice.amount_paid` is the total received so far. An advance
 * entered while drafting seeds it; every payment recorded in the ledger adds to
 * it and appends a row to the `transactions` table.
 */

import type {} from '../types/docs-r3'; // R3-C2: InvoiceRecord.delivery_proof
import type {
  Client,
  DocumentType,
  InvoiceItem,
  InvoiceRecord,
  Payment,
  SenderProfile,
} from '../types/invoice';
import { round2 } from './invoice-calc';
import { localDayOf } from './dates';
import { currentActor, requireAccess } from './access';
import type { BusinessType, ModuleId } from './shop-mode';
import { checkDocRight } from './rights';
import {
  DuplicateNumberError,
  findNumberClash,
  gapsIfIssued,
  nextInvoiceNumber,
  numberKey,
  type SeriesGap,
} from './invoice-number';
import {
  audit,
  invoiceCreated,
  invoiceDeleted,
  invoiceUpdated,
  paymentLogged,
  type AuditInput,
} from './audit';
import { clientLogged, settingsLogged } from './audit-events';
import { releaseAttachments, releaseDropped } from './attachments';
import { SERIES_TABLE, nextReceiptNumber, recordSeries, type SeriesCounter } from './series-counters';
import { binRows } from './audit-edits';
import { receivableTotal } from './rcm';
import { isRevenueDoc } from './stats';
import { linkedCredits, settledStatus, type CreditLinkRow } from './amount-due';
import { assertNotPendingApproval, holdIfApprovalNeeded, holdIfCreditBlocked, voidHook } from './approval-gate';
import {
  PeriodLockedError,
  SETTINGS_OVERRIDE,
  assertUnlocked,
  hasOverride,
  normalizeLockDate,
  revokeOverride,
  type LockAction,
} from './period-lock';
import {
  KEYS,
  SINGLETON_KEYS,
  generateId,
  getJson,
  getTable,
  peekTable,
  setJson,
  setTable,
} from './storage';

export { getTable, setTable, generateId } from './storage';
export { getIndianFY, getIndianFY as financialYearOf } from './invoice-number';

export interface AppSettings {
  profiles: SenderProfile[];
  activeProfileId: string;
  defaultCurrency: string;
  defaultTaxRate: number;
  invoicePrefix: string;
  defaultDueDays: number;
  defaultTerms: string;
  defaultNotes: string;
  roundOff: boolean;
  /** False until the user has filled in their own sender profile. */
  onboarded: boolean;
  /**
   * Period lock (YYYY-MM-DD): documents dated on or before this day are frozen.
   * Additive field — absent / '' means the books are open. See `period-lock.ts`.
   */
  lock_until?: string;
  /**
   * GST return filing frequency for the compliance calendar (`compliance.ts`).
   * Additive field — absent means monthly.
   */
  gst_filing_frequency?: 'monthly' | 'qrmp' | 'composition';
  /** Additive (8H shop mode, `shop-mode.ts`): what the business does. */
  business_type?: BusinessType;
  /** Additive (8H): modules shown in the sidebar / dashboard. Absent = everything (existing companies). */
  modules?: ModuleId[];
  /**
   * Additive (QA7 G1/G2): this database is the app-made Demo company. Written once, by the Demo-company flow, into
   * that company's own database; sample data loads only where it is set (`loadDemoData`).
   */
  demo_company?: true;
}

export const DEFAULT_TERMS =
  'Payment due within 14 days of the invoice date. Please quote the invoice number with your payment.';

/** A document counts as issued once it has left Draft (6.21: only the owner may delete one). */
export function isIssued(inv: Pick<InvoiceRecord, 'status'>): boolean {
  return inv.status !== 'Draft';
}

/**
 * QA6-1 F11: a gift-voucher receipt may not be removed once the voucher's unredeemed balance was recognised (breakage
 * journal, `gift_vouchers` row): the value would be stranded in "Gift vouchers outstanding". Undo the breakage first.
 */
function assertNoBreakage(rows: readonly Payment[]): void {
  const v = peekTable<{ id: string; number: string; breakage_voucher_id?: string }>('gift_vouchers').find((x) => x.breakage_voucher_id && rows.some((p) => p.gift_voucher_id === x.id));
  if (v) throw new Error(`Undo the breakage of gift voucher ${v.number} first`);
}

export function blankProfile(): SenderProfile {
  return {
    id: generateId(),
    companyName: '',
    companyTagline: '',
    companyEmail: '',
    companyPhone: '',
    companyAddress: '',
    companyGstin: '',
    pan: '',
    companyWebsite: '',
    stateCode: '',
    regLine: '',
    bankName: '',
    accountName: '',
    accountNumber: '',
    ifsc: '',
    upiId: '',
    invoicePrefix: '',
    defaultTerms: '',
  };
}

/**
 * Catalogue type of a line learnt from a saved invoice (QA-3 F24): a goods HSN (not chapter 99) is a Product, a SAC
 * (99…) a Service; with no HSN the line's own type is kept.
 */
export function catalogueItemType(item: { hsn?: string; type?: string }): string | undefined {
  const code = String(item.hsn ?? '').replace(/\s/g, '');
  if (/^\d{2,8}$/.test(code)) return code.startsWith('99') ? 'Service' : 'Product';
  return item.type || undefined;
}

/** Reads settings, upgrading the pre-2.1 flat shape to the profiles array. */
function readSettings(): AppSettings {
  const raw = getJson<Record<string, unknown> | null>(SINGLETON_KEYS.settings, null);
  const base: AppSettings = {
    profiles: [],
    activeProfileId: '',
    defaultCurrency: 'INR',
    defaultTaxRate: 18,
    invoicePrefix: 'INV',
    defaultDueDays: 14,
    defaultTerms: DEFAULT_TERMS,
    defaultNotes: '',
    roundOff: true,
    onboarded: false,
  };

  if (!raw) {
    const starter = blankProfile();
    return { ...base, profiles: [starter], activeProfileId: starter.id! };
  }

  const stored = raw as Partial<AppSettings> & Record<string, unknown>;
  let profiles = Array.isArray(stored.profiles) ? (stored.profiles as SenderProfile[]) : [];

  if (profiles.length === 0) {
    // Legacy flat settings — lift the company fields into a single profile.
    const legacy: SenderProfile = {
      ...blankProfile(),
      companyName: String(stored.companyName ?? ''),
      companyTagline: String(stored.companyTagline ?? ''),
      companyEmail: String(stored.companyEmail ?? ''),
      companyPhone: String(stored.companyPhone ?? ''),
      companyAddress: String(stored.companyAddress ?? ''),
      companyGstin: String(stored.companyGstin ?? ''),
      companyWebsite: String(stored.companyWebsite ?? ''),
    };
    profiles = [legacy];
  }

  profiles = profiles.map((p) => ({ ...blankProfile(), ...p, id: p.id ?? generateId() }));
  const activeProfileId = profiles.some((p) => p.id === stored.activeProfileId)
    ? String(stored.activeProfileId)
    : profiles[0].id!;

  return {
    ...base,
    ...stored,
    profiles,
    activeProfileId,
    defaultCurrency: String(stored.defaultCurrency ?? base.defaultCurrency),
    defaultTaxRate: Number(stored.defaultTaxRate ?? base.defaultTaxRate),
    invoicePrefix: String(stored.invoicePrefix ?? base.invoicePrefix),
    defaultDueDays: Number(stored.defaultDueDays ?? base.defaultDueDays),
    defaultTerms: String(stored.defaultTerms ?? base.defaultTerms),
    defaultNotes: String(stored.defaultNotes ?? base.defaultNotes),
    roundOff: Boolean(stored.roundOff ?? base.roundOff),
    onboarded: Boolean(stored.onboarded ?? Boolean(profiles[0]?.companyName)),
    lock_until: normalizeLockDate(stored.lock_until) || undefined,
    gst_filing_frequency:
      stored.gst_filing_frequency === 'qrmp' || stored.gst_filing_frequency === 'monthly' || stored.gst_filing_frequency === 'composition'
        ? stored.gst_filing_frequency
        : undefined,
  };
}

/**
 * Run an audit write that can never break the mutation that triggered it:
 * building the row, formatting the diff and writing it are all best-effort.
 */
function logSafe(make: () => AuditInput | AuditInput[] | null): void {
  try {
    const rows = make();
    if (!rows) return;
    for (const row of Array.isArray(rows) ? rows : [rows]) audit.record(row);
  } catch {
    /* logging must never break a save */
  }
}

const OVERRIDE_NOTE = ' (period-lock override)';

/** Copy of `obj` without undefined / null / empty-string fields. */
const PARTY_KEYS = 'id name email address city zip company gstin phone state state_code pan tan'.split(' ') as (keyof Client)[];

function keepFilled<T extends object>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined && v !== null && v !== '') (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

export const localDb = {
  settings: {
    get: readSettings,
    save: (settings: AppSettings) => {
      const before = readSettings();
      const next: AppSettings = { ...settings, lock_until: normalizeLockDate(settings.lock_until) || undefined };
      const lockBefore = before.lock_until ?? '';
      const lockAfter = next.lock_until ?? '';
      const loosening = lockBefore !== '' && (lockAfter === '' || lockAfter < lockBefore);
      if (loosening && !hasOverride(SETTINGS_OVERRIDE)) {
        throw new PeriodLockedError({ lockUntil: lockBefore, docDate: lockBefore, action: 'settings' });
      }
      setJson(SINGLETON_KEYS.settings, next);
      if (loosening) revokeOverride(SETTINGS_OVERRIDE);
      logSafe(() => settingsLogged(before, readSettings()));
    },
    activeProfile: (): SenderProfile | null => {
      const s = readSettings();
      return s.profiles.find((p) => p.id === s.activeProfileId) ?? s.profiles[0] ?? null;
    },
  },

  template: {
    get: (): string => getJson<string>(SINGLETON_KEYS.template, '') || 'classic_orange',
    set: (id: string) => setJson(SINGLETON_KEYS.template, id),
  },

  clients: {
    getAll: () => getTable<Client>(KEYS.clients),
    getById: (id: string) => getTable<Client>(KEYS.clients).find((c) => c.id === id),
    /** Matches on id first, then on a case-insensitive name, so the same client
     *  typed twice does not become two rows. Returns the row id.
     *
     *  An explicit id match is an EDIT (every field is taken, so a field can be cleared).
     *  A name-only match is "same party typed again" — blank fields in the typed copy must
     *  NOT wipe what the CRM already knows (GSTIN, phone, address). */
    upsert: (client: Partial<Client> & { name: string }): string => {
      const clients = getTable<Client>(KEYS.clients);
      const name = client.name.trim().toLowerCase();
      const byId = client.id ? clients.findIndex((c) => c.id === client.id) : -1;
      const idx =
        byId >= 0 ? byId : clients.findIndex((c) => c.name?.trim().toLowerCase() === name);
      if (idx >= 0) {
        const incoming = byId >= 0 ? client : keepFilled(client);
        const previous = clients[idx];
        clients[idx] = { ...previous, ...incoming, id: previous.id };
        setTable(KEYS.clients, clients);
        logSafe(() => clientLogged('update', previous, clients[idx]));
        return clients[idx].id!;
      }
      const id = client.id ?? generateId();
      const created = { ...(client as Client), id, created_at: new Date().toISOString() } as Client;
      clients.push(created);
      setTable(KEYS.clients, clients);
      logSafe(() => clientLogged('create', undefined, created));
      return id;
    },
    remove: (id: string) => {
      requireAccess('master.edit');
      const all = getTable<Client>(KEYS.clients);
      const gone = all.find((c) => c.id === id);
      setTable(KEYS.clients, all.filter((c) => c.id !== id));
      if (gone) logSafe(() => clientLogged('delete', gone, undefined));
    },
    search: (query: string) => {
      const q = query.trim().toLowerCase();
      if (!q) return getTable<Client>(KEYS.clients);
      return getTable<Client>(KEYS.clients).filter((c) =>
        [c.name, c.email, c.company, c.gstin, c.city].some((f) => f?.toLowerCase().includes(q)),
      );
    },
  },

  items: {
    getAll: () => getTable<InvoiceItem>(KEYS.items),
    /**
     * Adds or updates a catalogue item by name. With `fillOnly`, an existing item keeps every
     * value it already has and only gains the ones it was missing — used when learning from a
     * saved invoice, so a one-off price on one invoice never silently rewrites the default rate.
     */
    upsert: (item: Partial<InvoiceItem> & { name: string }, opts: { fillOnly?: boolean } = {}) =>
      localDb.items.upsertMany([item], opts),
    /** `upsert` for several items with one read and (only if something changed) one write. */
    upsertMany: (incoming: (Partial<InvoiceItem> & { name: string })[], opts: { fillOnly?: boolean } = {}) => {
      const items = getTable<InvoiceItem>(KEYS.items);
      let changed = false;
      for (const item of incoming) {
        const name = item.name.trim().toLowerCase();
        if (!name) continue;
        const idx = items.findIndex((i) => i.name?.trim().toLowerCase() === name);
        if (idx >= 0) {
          // A line typed without an HSN / unit must not erase the catalogue's.
          const next = opts.fillOnly
            ? { ...keepFilled(item), ...keepFilled(items[idx]) } as InvoiceItem
            : { ...items[idx], ...keepFilled(item) };
          // QA-3 F24: an item learnt before as "Service" although its own HSN is goods is corrected when learnt again.
          if (opts.fillOnly && item.type === 'Product' && next.type === 'Service' && catalogueItemType({ hsn: next.hsn }) === 'Product') next.type = 'Product';
          if (JSON.stringify(next) !== JSON.stringify(items[idx])) {
            items[idx] = next;
            changed = true;
          }
        } else {
          items.push({ ...(item as InvoiceItem), id: generateId() });
          changed = true;
        }
      }
      if (changed) setTable(KEYS.items, items);
    },
    remove: (id: string) =>
      setTable(KEYS.items, getTable<InvoiceItem>(KEYS.items).filter((i) => i.id !== id)),
    search: (query: string) => {
      const q = query.trim().toLowerCase();
      if (!q) return getTable<InvoiceItem>(KEYS.items);
      return getTable<InvoiceItem>(KEYS.items).filter(
        (i) => i.name?.toLowerCase().includes(q) || i.hsn?.toLowerCase().includes(q),
      );
    },
  },

  invoices: {
    getAll: () => getTable<InvoiceRecord>(KEYS.invoices),
    /** A private copy of one document (the table is parsed once per stored version, not per lookup). */
    getById: (id: string): InvoiceRecord | undefined => {
      const found = peekTable<InvoiceRecord>(KEYS.invoices).find((i) => i.id === id);
      return found ? structuredClone(found) : undefined;
    },

    /** Next number in the series, derived from the highest one already issued. */
    nextNumber: (dateStr?: string, docType: DocumentType = 'INVOICE', prefix?: string) =>
      nextInvoiceNumber({
        // R4-C4: the series high-water marks (`PREFIX/FYyy-yy` + seq) count as issued, so a deleted number is never reused.
        existingNumbers: [...peekTable<InvoiceRecord>(KEYS.invoices).map((i) => i.invoice_number), ...peekTable<SeriesCounter>(SERIES_TABLE).map((r) => `${r.id}/${r.seq}`)],
        dateStr,
        docType,
        customPrefix: prefix ?? readSettings().invoicePrefix,
      }),

    /**
     * Is `number` free for document `selfId`? Also reports the series gap a skipped-ahead
     * manual number would leave (a hint, never an error).
     */
    checkNumber: (
      number: string,
      selfId?: string,
    ): { ok: boolean; clash?: InvoiceRecord; gap: SeriesGap | null } => {
      const all = peekTable<InvoiceRecord>(KEYS.invoices); // read-only (PERF-1)
      const trimmed = (number ?? '').trim();
      if (!trimmed) return { ok: true, gap: null };
      const own = selfId ? all.find((i) => i.id === selfId) : undefined;
      // A document keeps its own number valid, even if legacy data already duplicated it.
      if (own && numberKey(own.invoice_number) === numberKey(trimmed)) return { ok: true, gap: null };
      const clash = findNumberClash(all, trimmed, selfId);
      if (clash) return { ok: false, clash: { ...clash }, gap: null };
      return { ok: true, gap: gapsIfIssued(all.filter((i) => i.id !== selfId).map((i) => i.invoice_number), trimmed) };
    },

    save: (invoice: InvoiceRecord): InvoiceRecord => {
      // PERF-1: the shared parsed rows with only the saved row replaced (never mutated); setTable then
      // reuses the untouched rows for the next version, so a save does not re-parse the table.
      const invoices = peekTable<InvoiceRecord>(KEYS.invoices).slice();
      const idx = invoices.findIndex((i) => i.id === invoice.id);
      const stored = idx >= 0 ? invoices[idx] : undefined;
      // Local roles (6.21): a viewer cannot write documents.
      requireAccess(stored ? 'doc.edit' : 'doc.create');
      // Finer user rights (8H): per-document right, back-dated window, discount cap (clerks / viewers only).
      checkDocRight(currentActor(), invoice.doc_type, stored ? 'alter' : 'create', invoice.issue_date, invoice);
      const now = new Date().toISOString();
      const toSave: InvoiceRecord = { ...invoice, updated_at: now };

      // Period lock: the stored version must be open, and so must the date it is moving to.
      let overridden = false;
      const cancelling = stored && stored.status !== 'Cancelled' && toSave.status === 'Cancelled';
      const reinstating = stored && stored.status === 'Cancelled' && toSave.status !== 'Cancelled';
      const action: LockAction = !stored ? 'create' : cancelling ? 'cancel' : reinstating ? 'reinstate' : 'edit';
      if (stored && assertUnlocked(stored, action) === 'overridden') overridden = true;
      if (assertUnlocked({ ...toSave, id: toSave.id || stored?.id }, stored ? 'edit' : 'create') === 'overridden') overridden = true;

      // R3-C2: the receiver signature is written only by setDeliveryProof — kept from the stored row, never copied to a new one.
      toSave.delivery_proof = stored?.delivery_proof;
      if (!toSave.delivery_proof) delete toSave.delivery_proof;
      if (stored) {
        toSave.created_at = stored.created_at ?? now;
        // 8.101: a signed acceptance is a snapshot — an edit of the quote never rewrites or drops it.
        if (stored.acceptance) toSave.acceptance = stored.acceptance;
        else delete toSave.acceptance;
      } else {
        toSave.id = invoice.id || generateId();
        toSave.created_at = now;
        if (!toSave.invoice_number && !isUnnumberedDraft(toSave)) {
          // The snapshotted sender profile's prefix wins, as in the editor (`saveInvoice`).
          toSave.invoice_number = localDb.invoices.nextNumber(
            toSave.issue_date,
            toSave.doc_type,
            toSave.sender?.invoicePrefix || undefined,
          );
        }
      }

      // QA-3 F6: an unnumbered (recurring) draft takes the next number of its series when it is issued.
      if (stored) Object.assign(toSave, numberOnIssue(toSave, stored.status));

      // WP-9 maker-checker: a clerk's document that needs the owner's approval is held as a pending draft.
      holdIfApprovalNeeded(toSave, stored);
      holdIfCreditBlocked(toSave, stored); // 8.80 credit limit: Block -> owner approval (audited override)

      // GST Rule 46: one number, one document (a document may keep its own legacy number).
      if (toSave.invoice_number && !(stored && numberKey(stored.invoice_number) === numberKey(toSave.invoice_number))) {
        const clash = findNumberClash(invoices, toSave.invoice_number, toSave.id);
        if (clash) throw new DuplicateNumberError(toSave.invoice_number, clash);
      }

      if (stored) {
        // Never let a stale editor copy (opened before a payment was recorded) wipe
        // receipts: the ledger rows are the floor for what has been received.
        const ledgerPaid = localDb.payments.totalFor(toSave.id);
        if (ledgerPaid > round2(Number(toSave.amount_paid) || 0) + 0.004) {
          const was = round2(Number(stored.amount_paid) || 0);
          Object.assign(toSave, withPaid(toSave, Math.max(was, ledgerPaid)));
        }
        invoices[idx] = toSave;
      } else {
        invoices.push(toSave);
      }
      setTable(KEYS.invoices, invoices);
      // A credit note edited / cancelled / reinstated changes what its invoice still owes.
      if (toSave.doc_type === 'CREDIT_NOTE' || stored?.doc_type === 'CREDIT_NOTE') resettleCreditedInvoices(toSave.id);
      // Files this document no longer lists (6.12) are deleted unless another record uses them.
      if (stored) releaseDropped(stored.attachments, toSave.attachments);

      logSafe(() => (stored ? invoiceUpdated(stored, toSave, overridden ? OVERRIDE_NOTE : '') : invoiceCreated(toSave)));

      // Grow the local CRM / catalogue from real usage.
      if (toSave.client?.name?.trim()) {
        // QA12 S1: only the party's identity is learnt from a document. Everything else on the master (credit terms,
        // distribution fields, enrolments, contacts, birthdays, defaults …) is the master's own: an old snapshot
        // re-saved must never reset it.
        const c = toSave.client;
        localDb.clients.upsert(Object.fromEntries(PARTY_KEYS.filter((k) => k in c).map((k) => [k, c[k]])) as unknown as Client);
      }
      localDb.items.upsertMany(
        (toSave.items ?? [])
          .filter((item) => item.name?.trim())
          .map((item) => ({ name: item.name, type: catalogueItemType(item), rate: item.rate, hsn: item.hsn, unit: item.unit, tax_rate: item.tax_rate })),
        { fillOnly: true },
      );
      return toSave;
    },

    remove: (id: string) => {
      const all = getTable<InvoiceRecord>(KEYS.invoices);
      const stored = all.find((i) => i.id === id);
      // Local roles (6.21): only the owner deletes an issued document; a clerk may delete drafts.
      if (stored) requireAccess(isIssued(stored) ? 'doc.deleteIssued' : 'doc.deleteDraft');
      if (stored) checkDocRight(currentActor(), stored.doc_type, 'delete');
      const overridden = stored ? assertUnlocked(stored, 'delete') === 'overridden' : false;
      voidHook.f?.(stored);
      const payments = getTable<Payment>(KEYS.transactions);
      const own = payments.filter((t) => t.invoice_id === id);
      assertNoBreakage(own);
      const mine = own.length;
      setTable(KEYS.invoices, all.filter((i) => i.id !== id));
      setTable(KEYS.transactions, payments.filter((t) => t.invoice_id !== id));
      // R4-C4: to the recycle bin (before its files are released); its number stays used.
      if (stored) {
        binRows('invoices', [stored as unknown as Record<string, unknown>]);
        recordSeries(stored.invoice_number);
      }
      if (stored?.doc_type === 'CREDIT_NOTE') resettleCreditedInvoices(id);
      if (stored?.attachments?.length) releaseAttachments(stored.attachments.map((a) => a.id));
      if (stored) logSafe(() => invoiceDeleted(stored, mine, overridden ? OVERRIDE_NOTE : ''));
    },

    setStatus: (id: string, status: InvoiceRecord['status']) => {
      const invoices = getTable<InvoiceRecord>(KEYS.invoices);
      const idx = invoices.findIndex((i) => i.id === id);
      if (idx < 0) return;
      requireAccess('doc.edit');
      const before = invoices[idx];
      const action: LockAction =
        status === 'Cancelled' && before.status !== 'Cancelled'
          ? 'cancel'
          : before.status === 'Cancelled' && status !== 'Cancelled'
            ? 'reinstate'
            : 'edit';
      const overridden = assertUnlocked(before, action) === 'overridden';
      // WP-9 / H3: a pending document is issued only by the owner's decision; a draft issued from
      // here passes the same gate as a save (held as a pending draft when it needs approval).
      if (status !== 'Draft' && status !== 'Cancelled') assertNotPendingApproval(before, 'it can be issued or marked paid');
      const next: InvoiceRecord = { ...before, status, updated_at: new Date().toISOString() };
      holdIfApprovalNeeded(next, before);
      holdIfCreditBlocked(next, before);
      invoices[idx] = numberOnIssue(next, before.status);
      setTable(KEYS.invoices, invoices);
      if (next.doc_type === 'CREDIT_NOTE') resettleCreditedInvoices(id);
      logSafe(() => invoiceUpdated(before, invoices[idx], overridden ? OVERRIDE_NOTE : ''));
    },

    /** Record (or clear) the client's answer to a quotation. Respects the period lock; audited. */
    setQuoteStatus: (id: string, quoteStatus: InvoiceRecord['quote_status']) => {
      const invoices = getTable<InvoiceRecord>(KEYS.invoices);
      const idx = invoices.findIndex((i) => i.id === id);
      if (idx < 0) return;
      const before = invoices[idx];
      if (before.doc_type !== 'QUOTATION' || before.quote_status === quoteStatus) return;
      const overridden = assertUnlocked(before, 'edit') === 'overridden';
      invoices[idx] = { ...before, quote_status: quoteStatus, updated_at: new Date().toISOString() };
      setTable(KEYS.invoices, invoices);
      logSafe(() => invoiceUpdated(before, invoices[idx], overridden ? OVERRIDE_NOTE : ''));
    },

    /** Close a sales order on `closedOn` (YYYY-MM-DD), or reopen it with `undefined`. Respects the period lock; audited. */
    setOrderClosed: (id: string, closedOn: string | undefined) => {
      const invoices = getTable<InvoiceRecord>(KEYS.invoices);
      const idx = invoices.findIndex((i) => i.id === id);
      if (idx < 0) return;
      const before = invoices[idx];
      if (before.doc_type !== 'SALES_ORDER' || (before.order_closed_on || undefined) === closedOn) return;
      const overridden = assertUnlocked(before, 'edit') === 'overridden';
      const next: InvoiceRecord = { ...before, updated_at: new Date().toISOString() };
      if (closedOn) next.order_closed_on = closedOn;
      else delete next.order_closed_on;
      invoices[idx] = next;
      setTable(KEYS.invoices, invoices);
      logSafe(() => invoiceUpdated(before, invoices[idx], overridden ? OVERRIDE_NOTE : ''));
    },
  },

  payments: {
    getAll: () => getTable<Payment>(KEYS.transactions),
    // PERF-1: filter the shared rows, copy only the matches (same top-level copies `getTable` gives).
    listFor: (invoiceId: string): Payment[] =>
      peekTable<Payment>(KEYS.transactions).filter((t) => t.invoice_id === invoiceId).map((t) => ({ ...t })),
    totalFor: (invoiceId: string) =>
      round2(
        peekTable<Payment>(KEYS.transactions)
          .filter((t) => t.invoice_id === invoiceId)
          .reduce((sum, t) => sum + (Number(t.amount) || 0), 0),
      ),

    /** Appends a payment and re-derives amount_paid / balance_due / status. */
    record: (input: { invoiceId: string; amount: number; method: string; reference?: string; note?: string; date?: string; realisedRate?: number; bankAccountId?: string; advanceId?: string; writeOff?: boolean }): Payment => {
      requireAccess('payment.record');
      checkDocRight(currentActor(), 'payment', 'create', input.date);
      const amount = round2(Number(input.amount) || 0);
      // A zero / negative / NaN "payment" would silently corrupt amount_paid and every report built on it.
      if (!(amount > 0)) throw new Error('Enter a payment amount above zero.');
      const payment: Payment = {
        id: generateId(),
        invoice_id: input.invoiceId,
        amount,
        method: input.method || 'Bank Transfer',
        reference: input.reference,
        note: input.note,
        // A local calendar day, not a UTC timestamp: at 1 am IST on 1 Apr the UTC
        // stamp still says 31 Mar and would file the receipt in the previous FY.
        date: input.date || localDayOf(new Date()),
      };
      // Multi-account BRS: which bank account it went into (never for cash).
      if (input.bankAccountId && (input.method || '').toLowerCase() !== 'cash') payment.bank_account_id = input.bankAccountId;
      // An advance adjusted against the invoice (5.3): settles the bill, but is not new money.
      if (input.advanceId) payment.advance_id = input.advanceId;
      // 8.106: a bad-debt write-off settles the bill without money (no receipt number).
      if (input.writeOff) payment.write_off = true;
      // Read-only lookup: the payment never changes this row (syncPaymentState writes a copy).
      const target = peekTable<InvoiceRecord>(KEYS.invoices).find((i) => i.id === input.invoiceId);
      // QA-3 F3: money is received only against a revenue document type. A receipt on a quotation,
      // proforma or delivery challan would be missing from every total (an advance against a quote goes
      // through Advances). Only the type is judged here: a receipt on a cancelled bill stays tracked and a
      // pending draft gets the approval message below. Opening bills have no invoice row.
      if (target && !isRevenueDoc({ doc_type: target.doc_type, status: 'Sent' })) {
        throw new Error('Payments are recorded against invoices only. For money received against this document, record an advance receipt for the customer.');
      }
      // Realised rate (6.19): only on a foreign-currency invoice; amount stays in that currency.
      const realised = Number(input.realisedRate);
      if (realised > 0 && Number.isFinite(realised) && (target?.currency || 'INR').toUpperCase() !== 'INR') {
        payment.realised_rate = realised;
      }
      const overridden = target ? assertUnlocked(target, 'pay') === 'overridden' : false;
      assertNotPendingApproval(target, 'record payments');
      const before = getTable<Payment>(KEYS.transactions);
      // Receipt voucher number, fixed at record time (never reused after a delete / cheque bounce).
      if (!payment.advance_id && !payment.write_off) payment.receipt_number = nextReceiptNumber(payment.date, before);
      setTable(KEYS.transactions, [...before, payment]);
      try {
        syncPaymentState(input.invoiceId, payment.amount);
      } catch (err) {
        // Keep ledger and invoice consistent: a payment row whose invoice update failed (quota)
        // would be recorded again on retry.
        setTable(KEYS.transactions, before);
        throw err;
      }
      if (payment.receipt_number) {
        try {
          recordSeries(payment.receipt_number);
        } catch {
          /* the stamped number itself is what keeps receipts stable */
        }
      }
      logSafe(() => {
        const row = paymentLogged('payment_add', payment, target);
        return overridden ? { ...row, summary: row.summary + OVERRIDE_NOTE } : row;
      });
      return payment;
    },

    /**
     * Set (or clear, with 0 / undefined) the realised exchange rate of a receipt on a foreign-currency
     * invoice (6.19). Changes the ledger's bank and FX figures, so it respects the period lock.
     */
    setRealisedRate: (paymentId: string, rate: number | undefined): Payment | undefined => {
      const rows = getTable<Payment>(KEYS.transactions);
      const idx = rows.findIndex((t) => t.id === paymentId);
      if (idx < 0) return undefined;
      const row = rows[idx];
      const target = getTable<InvoiceRecord>(KEYS.invoices).find((i) => i.id === row.invoice_id);
      if (!target || (target.currency || 'INR').toUpperCase() === 'INR') throw new Error('Only receipts on foreign-currency invoices carry a realised rate.');
      const value = Number(rate);
      const next: Payment = { ...row };
      if (value > 0 && Number.isFinite(value)) next.realised_rate = value;
      else delete next.realised_rate;
      if (next.realised_rate === row.realised_rate) return row;
      // Locked by the receipt's own date (the bank entry it changes) and the invoice's.
      const overridden =
        assertUnlocked({ id: target.id, issue_date: row.date, invoice_number: target.invoice_number }, 'edit') === 'overridden' ||
        assertUnlocked(target, 'edit') === 'overridden';
      rows[idx] = next;
      setTable(KEYS.transactions, rows);
      logSafe(() => ({
        entity: 'payment',
        entity_id: row.id,
        action: 'update',
        parent_id: target.id,
        doc_number: target.invoice_number,
        summary: `Realised rate on a ${target.currency} receipt against ${target.invoice_number} ${next.realised_rate ? `set to ₹${next.realised_rate}` : 'cleared'}${overridden ? OVERRIDE_NOTE : ''}`,
      }));
      return next;
    },

    remove: (paymentId: string) => {
      const rows = getTable<Payment>(KEYS.transactions);
      const row = rows.find((t) => t.id === paymentId);
      if (!row) return;
      requireAccess('payment.record');
      // QA5 F12: removing a write-off row reverses an owner-only, PIN-confirmed write-off (`reverseWriteOff`).
      if (row.write_off) requireAccess('doc.deleteIssued');
      assertNoBreakage([row]);
      const target = getTable<InvoiceRecord>(KEYS.invoices).find((i) => i.id === row.invoice_id);
      const overridden = target ? assertUnlocked(target, 'unpay') === 'overridden' : false;
      setTable(KEYS.transactions, rows.filter((t) => t.id !== paymentId));
      try {
        syncPaymentState(row.invoice_id, -row.amount);
      } catch (err) {
        setTable(KEYS.transactions, rows);
        throw err;
      }
      logSafe(() => {
        const entry = paymentLogged('payment_remove', row, target);
        return overridden ? { ...entry, summary: entry.summary + OVERRIDE_NOTE } : entry;
      });
    },
  },
};

/**
 * Re-derive amount_paid / balance_due / status for `inv` given the amount
 * received so far. TDS the customer withholds is settled with the tax office,
 * so it is never "owed" to us. A cancelled document stays cancelled: recording
 * (or removing) a payment must not resurrect it into revenue — the money is
 * still tracked in amount_paid. Live credit notes linked to the invoice settle
 * it too (`src/lib/amount-due.ts`): the status says Paid once receipts + credits
 * cover it, while `balance_due` keeps its stored meaning (total − TDS − received).
 */
function withPaid(inv: InvoiceRecord, paidRaw: number): InvoiceRecord {
  const paid = round2(Math.max(paidRaw, 0));
  // Outward reverse charge: the GST is the recipient's to pay, so it is never part of what is owed
  // (an older record's stored total includes it — src/lib/rcm.ts).
  const total = Math.max(receivableTotal(inv) - (Number(inv.tds_amount) || 0), 0);
  const status = settledStatus(inv.status, total, paid, creditedOn(inv.id));
  return { ...inv, amount_paid: paid, balance_due: round2(total - paid), status };
}

/** Σ live credit notes linked to `invoiceId` (shared parsed tables, nothing copied). */
function creditedOn(invoiceId: string | undefined): number {
  if (!invoiceId) return 0;
  const mine = peekTable<CreditLinkRow>('doc_links').filter((l) => l.relation === 'credit_note' && l.from_id === invoiceId);
  if (!mine.length) return 0;
  return linkedCredits(mine, peekTable<InvoiceRecord>(KEYS.invoices)).get(invoiceId) ?? 0;
}

/**
 * Re-derive the money status of the invoice(s) a credit note is linked to, after the note was
 * issued, edited, cancelled, reinstated or deleted. Writes only when a status actually changes
 * (a credit covering the rest makes the invoice Paid; cancelling it brings the balance back).
 */
export function resettleCreditedInvoices(noteId: string | undefined): void {
  if (!noteId) return;
  const targets = new Set(
    peekTable<CreditLinkRow>('doc_links').filter((l) => l.relation === 'credit_note' && l.to_id === noteId).map((l) => l.from_id),
  );
  for (const id of targets) {
    const inv = peekTable<InvoiceRecord>(KEYS.invoices).find((i) => i.id === id);
    if (!inv || inv.status === 'Draft' || inv.status === 'Cancelled') continue;
    if (withPaid(inv, Number(inv.amount_paid) || 0).status !== inv.status) syncPaymentState(id, 0);
  }
}

/** Apply a delta to an invoice's paid amount and re-derive its money status. */
function syncPaymentState(invoiceId: string, delta: number): void {
  // Perf: the shared parsed table (usually already read by the caller) with ONE row replaced by a
  // copy; the shared rows themselves are never mutated.
  const shared = peekTable<InvoiceRecord>(KEYS.invoices);
  const idx = shared.findIndex((i) => i.id === invoiceId);
  if (idx < 0) return;
  const inv = shared[idx];
  const invoices = shared.slice();
  invoices[idx] = numberOnIssue({
    ...withPaid(inv, (Number(inv.amount_paid) || 0) + delta),
    updated_at: new Date().toISOString(),
  }, inv.status);
  setTable(KEYS.invoices, invoices);
}

/**
 * QA-3 F6: a recurring draft is saved without a number, so a draft that is deleted (or never issued)
 * leaves no hole in the GST series (GSTR-1 Table 13 would report it as cancelled). A batch-run draft
 * (QA5-2 F15) follows the same rule. Every other document keeps the old behaviour: numbered when first saved.
 */
function isUnnumberedDraft(rec: InvoiceRecord): boolean {
  return rec.status === 'Draft' && !!(rec.recurring_id || rec.batch_run_id);
}

/**
 * An unnumbered draft that is being issued (`wasStatus` Draft, new status anything but Draft /
 * Cancelled) takes the next number of its series, dated by its issue date. A document that has a
 * number never changes it, and nothing already issued is touched.
 */
function numberOnIssue(rec: InvoiceRecord, wasStatus: InvoiceRecord['status'] | undefined): InvoiceRecord {
  if (wasStatus !== 'Draft' || rec.invoice_number?.trim() || rec.status === 'Draft' || rec.status === 'Cancelled') return rec;
  return { ...rec, invoice_number: localDb.invoices.nextNumber(rec.issue_date, rec.doc_type, rec.sender?.invoicePrefix || undefined) };
}

/**
 * Kept for the legacy call signature used by the regression test:
 * `generateInvoiceNumber('2025-04-10')` -> `INV/FY25-26/0001`.
 */
export function generateInvoiceNumber(dateStr?: string): string {
  return nextInvoiceNumber({
    existingNumbers: peekTable<InvoiceRecord>(KEYS.invoices).map((i) => i.invoice_number),
    dateStr,
    docType: 'INVOICE',
    customPrefix: 'INV',
  });
}

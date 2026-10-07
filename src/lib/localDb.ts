/**
 * Local Database — browser-resident storage layer.
 * Repositories on top of `storage.ts`. No network, no backend.
 *
 * Payment model: `invoice.amount_paid` is the total received so far. An advance
 * entered while drafting seeds it; every payment recorded in the ledger adds to
 * it and appends a row to the `transactions` table.
 */

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
import { nextInvoiceNumber } from './invoice-number';
import {
  KEYS,
  SINGLETON_KEYS,
  generateId,
  getJson,
  getTable,
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
}

export const DEFAULT_TERMS =
  'Payment due within 14 days of the invoice date. Please quote the invoice number with your payment.';

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
  };
}

/** Copy of `obj` without undefined / null / empty-string fields. */
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
    save: (settings: AppSettings) => setJson(SINGLETON_KEYS.settings, settings),
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
        clients[idx] = { ...clients[idx], ...incoming, id: clients[idx].id };
        setTable(KEYS.clients, clients);
        return clients[idx].id!;
      }
      const id = client.id ?? generateId();
      clients.push({ ...(client as Client), id, created_at: new Date().toISOString() } as Client);
      setTable(KEYS.clients, clients);
      return id;
    },
    remove: (id: string) =>
      setTable(KEYS.clients, getTable<Client>(KEYS.clients).filter((c) => c.id !== id)),
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
    upsert: (item: Partial<InvoiceItem> & { name: string }) => {
      const items = getTable<InvoiceItem>(KEYS.items);
      const name = item.name.trim().toLowerCase();
      if (!name) return;
      const idx = items.findIndex((i) => i.name?.trim().toLowerCase() === name);
      if (idx >= 0) {
        // A line typed without an HSN / unit must not erase the catalogue's.
        items[idx] = { ...items[idx], ...keepFilled(item) };
      } else {
        items.push({ ...(item as InvoiceItem), id: generateId() });
      }
      setTable(KEYS.items, items);
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
    getById: (id: string) => getTable<InvoiceRecord>(KEYS.invoices).find((i) => i.id === id),

    /** Next number in the series, derived from the highest one already issued. */
    nextNumber: (dateStr?: string, docType: DocumentType = 'INVOICE', prefix?: string) =>
      nextInvoiceNumber({
        existingNumbers: getTable<InvoiceRecord>(KEYS.invoices).map((i) => i.invoice_number),
        dateStr,
        docType,
        customPrefix: prefix ?? readSettings().invoicePrefix,
      }),

    save: (invoice: InvoiceRecord): InvoiceRecord => {
      const invoices = getTable<InvoiceRecord>(KEYS.invoices);
      const idx = invoices.findIndex((i) => i.id === invoice.id);
      const now = new Date().toISOString();
      const toSave: InvoiceRecord = { ...invoice, updated_at: now };

      if (idx >= 0) {
        toSave.created_at = invoices[idx].created_at ?? now;
        // Never let a stale editor copy (opened before a payment was recorded) wipe
        // receipts: the ledger rows are the floor for what has been received.
        const ledgerPaid = localDb.payments.totalFor(toSave.id);
        if (ledgerPaid > round2(Number(toSave.amount_paid) || 0) + 0.004) {
          const stored = round2(Number(invoices[idx].amount_paid) || 0);
          Object.assign(toSave, withPaid(toSave, Math.max(stored, ledgerPaid)));
        }
        invoices[idx] = toSave;
      } else {
        toSave.id = invoice.id || generateId();
        toSave.created_at = now;
        if (!toSave.invoice_number) {
          toSave.invoice_number = localDb.invoices.nextNumber(toSave.issue_date, toSave.doc_type);
        }
        invoices.push(toSave);
      }
      setTable(KEYS.invoices, invoices);

      // Grow the local CRM / catalogue from real usage.
      if (toSave.client?.name?.trim()) localDb.clients.upsert(toSave.client);
      for (const item of toSave.items ?? []) {
        if (item.name?.trim()) {
          localDb.items.upsert({
            name: item.name,
            type: item.type,
            rate: item.rate,
            hsn: item.hsn,
            unit: item.unit,
            tax_rate: item.tax_rate,
          });
        }
      }
      return toSave;
    },

    remove: (id: string) => {
      setTable(KEYS.invoices, getTable<InvoiceRecord>(KEYS.invoices).filter((i) => i.id !== id));
      setTable(
        KEYS.transactions,
        getTable<Payment>(KEYS.transactions).filter((t) => t.invoice_id !== id),
      );
    },

    setStatus: (id: string, status: InvoiceRecord['status']) => {
      const invoices = getTable<InvoiceRecord>(KEYS.invoices);
      const idx = invoices.findIndex((i) => i.id === id);
      if (idx < 0) return;
      invoices[idx] = { ...invoices[idx], status, updated_at: new Date().toISOString() };
      setTable(KEYS.invoices, invoices);
    },
  },

  payments: {
    getAll: () => getTable<Payment>(KEYS.transactions),
    listFor: (invoiceId: string) =>
      getTable<Payment>(KEYS.transactions).filter((t) => t.invoice_id === invoiceId),
    totalFor: (invoiceId: string) =>
      round2(
        getTable<Payment>(KEYS.transactions)
          .filter((t) => t.invoice_id === invoiceId)
          .reduce((sum, t) => sum + (Number(t.amount) || 0), 0),
      ),

    /** Appends a payment and re-derives amount_paid / balance_due / status. */
    record: (input: { invoiceId: string; amount: number; method: string; reference?: string; note?: string; date?: string }): Payment => {
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
      const rows = getTable<Payment>(KEYS.transactions);
      rows.push(payment);
      setTable(KEYS.transactions, rows);
      syncPaymentState(input.invoiceId, payment.amount);
      return payment;
    },

    remove: (paymentId: string) => {
      const rows = getTable<Payment>(KEYS.transactions);
      const row = rows.find((t) => t.id === paymentId);
      if (!row) return;
      setTable(KEYS.transactions, rows.filter((t) => t.id !== paymentId));
      syncPaymentState(row.invoice_id, -row.amount);
    },
  },
};

/**
 * Re-derive amount_paid / balance_due / status for `inv` given the amount
 * received so far. TDS the customer withholds is settled with the tax office,
 * so it is never "owed" to us. A cancelled document stays cancelled: recording
 * (or removing) a payment must not resurrect it into revenue — the money is
 * still tracked in amount_paid.
 */
function withPaid(inv: InvoiceRecord, paidRaw: number): InvoiceRecord {
  const paid = round2(Math.max(paidRaw, 0));
  const total = Math.max((Number(inv.total) || 0) - (Number(inv.tds_amount) || 0), 0);
  let status = inv.status;
  if (status !== 'Cancelled') {
    if (paid >= total && total > 0) status = 'Paid';
    else if (paid > 0) status = 'Partially Paid';
    else if (status === 'Paid' || status === 'Partially Paid') status = 'Sent';
  }
  return { ...inv, amount_paid: paid, balance_due: round2(total - paid), status };
}

/** Apply a delta to an invoice's paid amount and re-derive its money status. */
function syncPaymentState(invoiceId: string, delta: number): void {
  const invoices = getTable<InvoiceRecord>(KEYS.invoices);
  const idx = invoices.findIndex((i) => i.id === invoiceId);
  if (idx < 0) return;
  const inv = invoices[idx];
  invoices[idx] = {
    ...withPaid(inv, (Number(inv.amount_paid) || 0) + delta),
    updated_at: new Date().toISOString(),
  };
  setTable(KEYS.invoices, invoices);
}

/**
 * Kept for the legacy call signature used by the regression test:
 * `generateInvoiceNumber('2025-04-10')` -> `INV/FY25-26/0001`.
 */
export function generateInvoiceNumber(dateStr?: string): string {
  return nextInvoiceNumber({
    existingNumbers: getTable<InvoiceRecord>(KEYS.invoices).map((i) => i.invoice_number),
    dateStr,
    docType: 'INVOICE',
    customPrefix: 'INV',
  });
}

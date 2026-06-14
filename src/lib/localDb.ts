/**
 * Local Database — Browser-resident storage layer for Invoice Generator
 * ================================================
 * Provides a complete offline data store using localStorage.
 */

const DB_PREFIX = "mrchartist_inv_";

export function getTable<T = any>(name: string): T[] {
  try {
    const raw = localStorage.getItem(DB_PREFIX + name);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function setTable<T = any>(name: string, rows: T[]): void {
  localStorage.setItem(DB_PREFIX + name, JSON.stringify(rows));
}

export function generateId(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxx-xxxx-xxxx'.replace(/x/g, () => Math.floor(Math.random() * 16).toString(16));
}

export function getIndianFY(dateStr?: string): { label: string; startYear: number; endYear: number } {
  const d = dateStr ? new Date(dateStr) : new Date();
  const month = d.getMonth(); // 0-indexed (0=Jan, 3=Apr)
  const year = d.getFullYear();
  // FY starts in April (month index 3)
  const startYear = month >= 3 ? year : year - 1;
  const endYear = startYear + 1;
  return {
    label: `${startYear.toString().slice(2)}-${endYear.toString().slice(2)}`,
    startYear,
    endYear,
  };
}

/** Read a value from the saved settings object (key: mrchartist_inv_settings). */
export function getSetting<T = any>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(DB_PREFIX + "settings");
    if (!raw) return fallback;
    const s = JSON.parse(raw);
    return (s[key] ?? fallback) as T;
  } catch {
    return fallback;
  }
}

export function generateInvoiceNumber(dateStr?: string): string {
  const invoices = getTable("invoices");
  const fy = getIndianFY(dateStr);
  const prefix = (getSetting("invoicePrefix", "INV") || "INV").trim();
  // Filter invoices for this financial year
  const fyInvoices = invoices.filter((i: any) => i.invoice_number?.includes(`FY${fy.label}`));
  const count = fyInvoices.length + 1;
  return `${prefix}/FY${fy.label}/${count.toString().padStart(4, '0')}`;
}

// ─── API Emulation ──────────────────────────────────────────

export const localDb = {
  clients: {
    getAll: () => getTable("clients"),
    getById: (id: string) => getTable("clients").find((c: any) => c.id === id),
    upsert: (client: any) => {
      const clients = getTable("clients");
      const idx = clients.findIndex((c: any) => c.id === client.id);
      if (idx >= 0) {
        clients[idx] = { ...clients[idx], ...client };
      } else {
        clients.push({ id: generateId(), created_at: new Date().toISOString(), ...client });
      }
      setTable("clients", clients);
      return client.id || clients[clients.length - 1].id;
    },
    search: (query: string) => {
      const q = query.toLowerCase();
      return getTable("clients").filter((c: any) => 
        c.name?.toLowerCase().includes(q) || 
        c.email?.toLowerCase().includes(q)
      );
    }
  },
  
  items: {
    getAll: () => getTable("items_catalog"),
    upsert: (item: any) => {
      const items = getTable("items_catalog");
      const idx = items.findIndex((i: any) => i.name.toLowerCase() === item.name.toLowerCase());
      if (idx >= 0) {
        items[idx] = { ...items[idx], ...item };
      } else {
        items.push({ id: generateId(), created_at: new Date().toISOString(), ...item });
      }
      setTable("items_catalog", items);
    },
    search: (query: string) => {
      const q = query.toLowerCase();
      return getTable("items_catalog").filter((i: any) => i.name?.toLowerCase().includes(q));
    }
  },

  invoices: {
    getAll: () => getTable("invoices"),
    getById: (id: string) => getTable("invoices").find((i: any) => i.id === id),
    save: (invoice: any) => {
      const invoices = getTable("invoices");
      const idx = invoices.findIndex((i: any) => i.id === invoice.id);
      
      const toSave = {
        ...invoice,
        updated_at: new Date().toISOString()
      };

      if (idx >= 0) {
        invoices[idx] = toSave;
      } else {
        toSave.id = invoice.id || generateId();
        toSave.created_at = new Date().toISOString();
        if (!toSave.invoice_number) toSave.invoice_number = generateInvoiceNumber();
        invoices.push(toSave);
      }
      
      setTable("invoices", invoices);

      // Auto-save any new clients/items when invoice is saved
      if (toSave.client?.name) {
        localDb.clients.upsert(toSave.client);
      }
      if (toSave.items && toSave.items.length > 0) {
        toSave.items.forEach((item: any) => {
          if (item.name) localDb.items.upsert({ name: item.name, rate: item.rate, type: item.type });
        });
      }

      return toSave;
    }
  },

  payments: {
    getAll: () => getTable("transactions"),

    /** All payments recorded against a given invoice, oldest first. */
    getForInvoice: (invoiceId: string) =>
      getTable("transactions")
        .filter((t: any) => t.invoice_id === invoiceId)
        .sort((a: any, b: any) => (a.date < b.date ? -1 : 1)),

    /** Total amount paid against an invoice. */
    totalForInvoice: (invoiceId: string) =>
      getTable("transactions")
        .filter((t: any) => t.invoice_id === invoiceId)
        .reduce((sum: number, t: any) => sum + (t.amount || 0), 0),

    /** Record a payment and reconcile the invoice's status. */
    record: (invoiceId: string, payment: { amount: number; method: string; date?: string; note?: string }) => {
      const tx = getTable("transactions");
      const newTx = {
        id: generateId(),
        invoice_id: invoiceId,
        amount: payment.amount,
        method: payment.method,
        note: payment.note || '',
        date: payment.date || new Date().toISOString(),
      };
      tx.push(newTx);
      setTable("transactions", tx);
      localDb.payments.reconcile(invoiceId);
      return newTx;
    },

    /** Delete a recorded payment and reconcile the invoice. */
    delete: (txId: string) => {
      const tx = getTable("transactions");
      const removed = tx.find((t: any) => t.id === txId);
      setTable("transactions", tx.filter((t: any) => t.id !== txId));
      if (removed) localDb.payments.reconcile(removed.invoice_id);
    },

    /** Re-derive an invoice's paid amount and status from its payments. */
    reconcile: (invoiceId: string) => {
      const invoices = getTable("invoices");
      const idx = invoices.findIndex((i: any) => i.id === invoiceId);
      if (idx < 0) return;
      const paid = localDb.payments.totalForInvoice(invoiceId);
      invoices[idx].amount_paid = paid;
      if (paid <= 0) {
        // Revert to Sent unless it was an explicit Draft.
        if (invoices[idx].status === 'Paid' || invoices[idx].status === 'Partially Paid') {
          invoices[idx].status = 'Sent';
        }
      } else if (paid >= invoices[idx].total) {
        invoices[idx].status = 'Paid';
      } else {
        invoices[idx].status = 'Partially Paid';
      }
      setTable("invoices", invoices);
    },
  }
};

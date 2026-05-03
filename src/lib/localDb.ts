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

export function generateInvoiceNumber(dateStr?: string): string {
  const invoices = getTable("invoices");
  const fy = getIndianFY(dateStr);
  // Filter invoices for this financial year
  const fyInvoices = invoices.filter((i: any) => i.invoice_number?.includes(`FY${fy.label}`));
  const count = fyInvoices.length + 1;
  return `INV/FY${fy.label}/${count.toString().padStart(4, '0')}`;
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

  transactions: {
    getAll: () => getTable("transactions"),
    recordPayment: (invoiceId: string, amount: number, method: string) => {
      const tx = getTable("transactions");
      const newTx = {
        id: generateId(),
        invoice_id: invoiceId,
        amount,
        method,
        date: new Date().toISOString()
      };
      tx.push(newTx);
      setTable("transactions", tx);

      // Update invoice status if fully paid
      const invoices = getTable("invoices");
      const invIdx = invoices.findIndex((i: any) => i.id === invoiceId);
      if (invIdx >= 0) {
        const totalPaid = tx.filter((t: any) => t.invoice_id === invoiceId).reduce((sum, t) => sum + t.amount, 0);
        if (totalPaid >= invoices[invIdx].total) {
          invoices[invIdx].status = "Paid";
        } else {
          invoices[invIdx].status = "Partially Paid";
        }
        setTable("invoices", invoices);
      }
      return newTx;
    }
  }
};

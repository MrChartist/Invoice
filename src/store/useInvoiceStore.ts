import { create } from 'zustand';
import { generateId, localDb } from '../lib/localDb';

export interface InvoiceItem {
  id: string;
  name: string;
  type: string;
  rate: number;
  quantity: number;
  amount: number;
}

export interface Client {
  id?: string;
  name: string;
  email: string;
  address: string;
  city: string;
  zip: string;
}

export interface SenderProfile {
  id?: string;
  companyName: string;
  companyTagline: string;
  companyEmail: string;
  companyPhone: string;
  companyAddress: string;
  companyGstin: string;
  pan?: string;
  companyWebsite: string;
  logo?: string;
  signature?: string;
  bankName: string;
  accountName: string;
  accountNumber: string;
  ifsc: string;
  upiId: string;
}

export interface InvoiceState {
  id: string;
  invoice_number: string;
  issue_date: string;
  due_date: string;
  status: "Draft" | "Sent" | "Paid" | "Overdue";
  currency: string;
  
  client: Client;
  sender: SenderProfile | null;
  items: InvoiceItem[];
  
  discount_rate: number;
  tax_rate: number;
  
  // Computed (but stored for ease)
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total: number;

  // Actions
  setClient: (client: Partial<Client>) => void;
  setSender: (sender: SenderProfile) => void;
  setDates: (issue: string, due: string) => void;
  addItem: () => void;
  updateItem: (id: string, field: keyof InvoiceItem, value: any) => void;
  removeItem: (id: string) => void;
  setRates: (discount: number, tax: number) => void;
  setCurrency: (currency: string) => void;
  recalculate: () => void;
  loadInvoice: (id: string) => void;
  saveInvoice: () => void;
  reset: () => void;
}

const defaultClient: Client = {
  name: '',
  email: '',
  address: '',
  city: '',
  zip: ''
};

const initialState = {
  id: '',
  invoice_number: '',
  issue_date: new Date().toISOString().split('T')[0],
  due_date: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0], // +14 days
  status: "Draft" as const,
  currency: 'INR',
  client: { ...defaultClient },
  sender: null,
  items: [{ id: generateId(), name: '', type: 'Service', rate: 0, quantity: 1, amount: 0 }],
  discount_rate: 0,
  tax_rate: 0,
  subtotal: 0,
  discount_amount: 0,
  tax_amount: 0,
  total: 0,
};

export const useInvoiceStore = create<InvoiceState>((set, get) => ({
  ...initialState,

  setClient: (clientData) => set((state) => ({ 
    client: { ...state.client, ...clientData } 
  })),

  setSender: (sender) => set({ sender }),

  setDates: (issue, due) => set({ issue_date: issue, due_date: due }),

  addItem: () => set((state) => ({
    items: [...state.items, { id: generateId(), name: '', type: 'Service', rate: 0, quantity: 1, amount: 0 }]
  })),

  updateItem: (id, field, value) => {
    set((state) => {
      const items = state.items.map((item) => {
        if (item.id === id) {
          const updated = { ...item, [field]: value };
          if (field === 'rate' || field === 'quantity') {
            updated.amount = updated.rate * updated.quantity;
          }
          return updated;
        }
        return item;
      });
      return { items };
    });
    get().recalculate();
  },

  removeItem: (id) => {
    set((state) => ({
      items: state.items.filter((i) => i.id !== id)
    }));
    get().recalculate();
  },

  setRates: (discount, tax) => {
    set({ discount_rate: discount, tax_rate: tax });
    get().recalculate();
  },

  setCurrency: (currency) => set({ currency }),

  recalculate: () => set((state) => {
    const subtotal = state.items.reduce((sum, item) => sum + (item.amount || 0), 0);
    const discount_amount = subtotal * (state.discount_rate / 100);
    const afterDiscount = subtotal - discount_amount;
    const tax_amount = afterDiscount * (state.tax_rate / 100);
    const total = afterDiscount + tax_amount;

    return { subtotal, discount_amount, tax_amount, total };
  }),

  loadInvoice: (id) => {
    const invoice = localDb.invoices.getById(id);
    if (invoice) {
      set({ ...invoice });
    }
  },

  saveInvoice: () => {
    const state = get();
    // Exclude methods from the save payload
    const { setClient, setSender, setDates, addItem, updateItem, removeItem, setRates, setCurrency, recalculate, loadInvoice, saveInvoice, reset, ...payload } = state;
    
    const saved = localDb.invoices.save(payload);
    
    // Update local state with the generated IDs if this was a new draft
    if (!state.id) {
      set({ id: saved.id, invoice_number: saved.invoice_number });
    }
  },

  reset: () => set({ ...initialState, id: '', invoice_number: '', items: [{ id: generateId(), name: '', type: 'Service', rate: 0, quantity: 1, amount: 0 }] })
}));

import { create } from 'zustand';
import { localDb } from '../lib/localDb';
import { generateId, getJson, removeRaw, setJson, SINGLETON_KEYS } from '../lib/storage';
import {
  calculateInvoice,
  deriveGstMode,
  EMPTY_TOTALS,
  num,
  round2,
  type CalcTotals,
} from '../lib/invoice-calc';
import { resolveStateCode } from '../lib/india-states';
import { addDaysInput } from '../lib/utils';
import { blankItem, makeDraft, normalizeRecord, senderStateCode } from './invoice-defaults';
import type {
  Client,
  DiscountType,
  DocumentType,
  GstMode,
  InvoiceItem,
  InvoiceRecord,
  InvoiceStatus,
  SenderProfile,
} from '../types/invoice';

export type { Client, InvoiceItem, SenderProfile } from '../types/invoice';
/** Legacy alias — the store's own item type used to be called `InvoiceItem`. */
export type { InvoiceRecord } from '../types/invoice';

export interface SaveResult {
  ok: boolean;
  errors: string[];
  record?: InvoiceRecord;
}

export interface InvoiceState extends InvoiceRecord {
  /** Full calculation result: per-line values, GST slabs and HSN summary. */
  totals: CalcTotals;
  /** True once the user has edited an unsaved draft. */
  dirty: boolean;

  patch: (patch: Partial<InvoiceRecord>) => void;
  setClient: (client: Partial<Client>) => void;
  setSender: (sender: SenderProfile) => void;
  setDates: (issue: string, due: string) => void;
  setStatus: (status: InvoiceStatus) => void;
  setDocType: (docType: DocumentType) => void;
  setTemplate: (templateId: string) => void;
  setNotes: (notes: string) => void;
  setTerms: (terms: string) => void;
  setCurrency: (currency: string) => void;
  setInvoiceNumber: (value: string) => void;
  setPlaceOfSupply: (stateCode: string) => void;
  setGstMode: (mode: GstMode) => void;
  setReverseCharge: (on: boolean) => void;
  setDiscount: (type: DiscountType, value: number) => void;
  setTaxRate: (rate: number) => void;
  /** Legacy signature kept for older call sites: (discount %, tax %). */
  setRates: (discount: number, tax: number) => void;
  setShipping: (amount: number) => void;
  setOtherCharges: (amount: number) => void;
  setRoundOff: (on: boolean) => void;
  setAmountPaid: (amount: number) => void;

  addItem: () => void;
  updateItem: (id: string, field: keyof InvoiceItem, value: string | number) => void;
  applyCatalogItem: (id: string, source: Partial<InvoiceItem>) => void;
  duplicateItem: (id: string) => void;
  moveItem: (id: string, direction: -1 | 1) => void;
  removeItem: (id: string) => void;

  recalculate: () => void;
  validate: () => string[];
  newDraft: (docType?: DocumentType) => void;
  loadInvoice: (id: string) => boolean;
  saveInvoice: () => SaveResult;
  restoreDraft: () => boolean;
  reset: () => void;
}

/** Field list used to serialise the store back to a persistable record. */
function toRecord(state: InvoiceState): InvoiceRecord {
  return {
    id: state.id,
    invoice_number: state.invoice_number,
    doc_type: state.doc_type,
    issue_date: state.issue_date,
    due_date: state.due_date,
    status: state.status,
    currency: state.currency,
    template_id: state.template_id,
    client: state.client,
    sender: state.sender,
    items: state.items,
    gst_mode: state.gst_mode,
    place_of_supply: state.place_of_supply,
    reverse_charge: state.reverse_charge,
    discount_type: state.discount_type,
    discount_rate: state.discount_rate,
    tax_rate: state.tax_rate,
    shipping: state.shipping,
    other_charges: state.other_charges,
    round_off_enabled: state.round_off_enabled,
    amount_paid: state.amount_paid,
    notes: state.notes,
    terms: state.terms,
    po_number: state.po_number,
    subtotal: state.subtotal,
    discount_amount: state.discount_amount,
    taxable_value: state.taxable_value,
    cgst_amount: state.cgst_amount,
    sgst_amount: state.sgst_amount,
    igst_amount: state.igst_amount,
    tax_amount: state.tax_amount,
    round_off: state.round_off,
    total: state.total,
    balance_due: state.balance_due,
    created_at: state.created_at,
    updated_at: state.updated_at,
  };
}

function freshDraft(docType: DocumentType = 'INVOICE'): InvoiceRecord {
  return makeDraft({
    settings: localDb.settings.get(),
    sender: localDb.settings.activeProfile(),
    docType,
    templateId: localDb.template.get(),
  });
}

/**
 * Re-pick CGST+SGST vs IGST after the sender or place of supply changes.
 * `NONE` and `SINGLE` are explicit user/legacy choices and are left alone —
 * and `senderHasGstin` is asserted here because we are only refining the split
 * of an invoice that is already charging tax.
 */
function refineGstMode(
  current: GstMode,
  sender: SenderProfile | null,
  placeOfSupply: string,
): GstMode {
  if (current === 'NONE' || current === 'SINGLE') return current;
  return deriveGstMode({
    senderStateCode: senderStateCode(sender),
    placeOfSupply,
    senderHasGstin: true,
    taxEnabled: true,
  });
}

let draftTimer: ReturnType<typeof setTimeout> | undefined;

/** Debounced autosave of the in-progress draft so a refresh never loses work. */
function scheduleDraftSave(state: InvoiceState): void {
  if (state.id) return; // saved documents are persisted explicitly
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = setTimeout(() => {
    try {
      setJson(SINGLETON_KEYS.draft, toRecord(state));
    } catch {
      /* a full quota must not break typing — the explicit Save reports it */
    }
  }, 500);
}

export const useInvoiceStore = create<InvoiceState>((set, get) => {
  /** Apply a patch, recompute money, then autosave the draft. */
  const apply = (patch: Partial<InvoiceRecord>) => {
    set({ ...patch, dirty: true } as Partial<InvoiceState>);
    get().recalculate();
    scheduleDraftSave(get());
  };

  const mapItems = (id: string, fn: (item: InvoiceItem) => InvoiceItem) =>
    apply({ items: get().items.map((item) => (item.id === id ? fn(item) : item)) });

  return {
    ...freshDraft(),
    totals: EMPTY_TOTALS,
    dirty: false,

    patch: apply,

    setClient: (clientData) => {
      const client = { ...get().client, ...clientData };
      // A client's GSTIN/state decides the place of supply, which decides the split.
      const place_of_supply =
        resolveStateCode({ code: client.state_code, gstin: client.gstin, name: client.state }) ||
        get().place_of_supply;
      apply({
        client,
        place_of_supply,
        gst_mode: refineGstMode(get().gst_mode, get().sender, place_of_supply),
      });
    },

    setSender: (sender) => {
      const place_of_supply = get().place_of_supply || senderStateCode(sender);
      apply({
        sender,
        place_of_supply,
        terms: get().terms || sender.defaultTerms || '',
        gst_mode: refineGstMode(get().gst_mode, sender, place_of_supply),
      });
    },

    setDates: (issue, due) => apply({ issue_date: issue, due_date: due }),

    setStatus: (status) => apply({ status }),
    setDocType: (doc_type) => apply({ doc_type }),
    setTemplate: (template_id) => {
      localDb.template.set(template_id);
      apply({ template_id });
    },
    setNotes: (notes) => apply({ notes }),
    setTerms: (terms) => apply({ terms }),
    setCurrency: (currency) => apply({ currency }),
    setInvoiceNumber: (invoice_number) => apply({ invoice_number }),

    setPlaceOfSupply: (place_of_supply) =>
      apply({
        place_of_supply,
        gst_mode: refineGstMode(get().gst_mode, get().sender, place_of_supply),
      }),

    setGstMode: (gst_mode) => apply({ gst_mode }),
    setReverseCharge: (reverse_charge) => apply({ reverse_charge }),

    setDiscount: (discount_type, value) =>
      apply({ discount_type, discount_rate: Math.max(num(value), 0) }),

    /** Sets the fallback slab AND retunes every line still on the old slab. */
    setTaxRate: (rate) => {
      const next = Math.max(num(rate), 0);
      const previous = get().tax_rate;
      apply({
        tax_rate: next,
        items: get().items.map((item) =>
          item.tax_rate === undefined || item.tax_rate === previous
            ? { ...item, tax_rate: next }
            : item,
        ),
      });
    },

    setRates: (discount, tax) => {
      get().setDiscount(get().discount_type, discount);
      get().setTaxRate(tax);
    },

    setShipping: (shipping) => apply({ shipping: num(shipping) }),
    setOtherCharges: (other_charges) => apply({ other_charges: num(other_charges) }),
    setRoundOff: (round_off_enabled) => apply({ round_off_enabled }),
    setAmountPaid: (amount_paid) => apply({ amount_paid: Math.max(num(amount_paid), 0) }),

    addItem: () => apply({ items: [...get().items, blankItem(get().tax_rate)] }),

    updateItem: (id, field, value) =>
      mapItems(id, (item) => {
        const next = { ...item, [field]: value } as InvoiceItem;
        next.amount = round2(num(next.quantity) * num(next.rate));
        return next;
      }),

    applyCatalogItem: (id, source) =>
      mapItems(id, (item) => {
        const next: InvoiceItem = {
          ...item,
          name: source.name ?? item.name,
          type: source.type ?? item.type,
          hsn: source.hsn ?? item.hsn,
          unit: source.unit || item.unit,
          rate: num(source.rate, item.rate),
          tax_rate: typeof source.tax_rate === 'number' ? source.tax_rate : item.tax_rate,
        };
        next.amount = round2(num(next.quantity) * num(next.rate));
        return next;
      }),

    duplicateItem: (id) => {
      const items = get().items;
      const idx = items.findIndex((i) => i.id === id);
      if (idx < 0) return;
      const copy = { ...items[idx], id: generateId() };
      apply({ items: [...items.slice(0, idx + 1), copy, ...items.slice(idx + 1)] });
    },

    moveItem: (id, direction) => {
      const items = [...get().items];
      const idx = items.findIndex((i) => i.id === id);
      const target = idx + direction;
      if (idx < 0 || target < 0 || target >= items.length) return;
      [items[idx], items[target]] = [items[target], items[idx]];
      apply({ items });
    },

    removeItem: (id) => {
      const remaining = get().items.filter((i) => i.id !== id);
      apply({ items: remaining.length ? remaining : [blankItem(get().tax_rate)] });
    },

    recalculate: () => {
      const s = get();
      const totals = calculateInvoice({
        items: s.items,
        gst_mode: s.gst_mode,
        discount_type: s.discount_type,
        discount_rate: s.discount_rate,
        tax_rate: s.tax_rate,
        shipping: s.shipping,
        other_charges: s.other_charges,
        round_off_enabled: s.round_off_enabled,
        amount_paid: s.amount_paid,
      });
      set({
        totals,
        subtotal: totals.subtotal,
        discount_amount: totals.discount_amount,
        taxable_value: totals.taxable_value,
        cgst_amount: totals.cgst_amount,
        sgst_amount: totals.sgst_amount,
        igst_amount: totals.igst_amount,
        tax_amount: totals.tax_amount,
        round_off: totals.round_off,
        total: totals.total,
        balance_due: totals.balance_due,
      });
    },

    validate: () => {
      const s = get();
      const errors: string[] = [];
      if (!s.sender?.companyName?.trim()) errors.push('Add a sender profile in Settings first.');
      if (!s.client.name.trim()) errors.push('Client name is required.');
      const priced = s.items.filter((i) => i.name.trim() || num(i.rate) > 0);
      if (priced.length === 0) errors.push('Add at least one line item.');
      if (priced.some((i) => num(i.quantity) <= 0)) errors.push('Every item needs a quantity above zero.');
      if (!s.issue_date) errors.push('Issue date is required.');
      if (s.due_date && s.issue_date && s.due_date < s.issue_date) {
        errors.push('Due date cannot be before the issue date.');
      }
      if (s.total <= 0 && s.doc_type !== 'DELIVERY_CHALLAN') {
        errors.push('Document total is zero — check the rates.');
      }
      if (s.amount_paid > s.total) errors.push('Amount received is more than the total.');
      return errors;
    },

    newDraft: (docType) => {
      removeRaw(SINGLETON_KEYS.draft);
      set({ ...freshDraft(docType), totals: EMPTY_TOTALS, dirty: false });
      get().recalculate();
    },

    loadInvoice: (id) => {
      const found = localDb.invoices.getById(id);
      if (!found) return false;
      set({ ...normalizeRecord(found, localDb.template.get()), dirty: false });
      get().recalculate();
      return true;
    },

    saveInvoice: () => {
      const errors = get().validate();
      if (errors.length) return { ok: false, errors };

      const state = get();
      const record = toRecord(state);
      // Drop the empty trailing row users leave behind.
      record.items = record.items.filter((i) => i.name.trim() || num(i.rate) > 0);
      if (!record.invoice_number) {
        record.invoice_number = localDb.invoices.nextNumber(record.issue_date, record.doc_type);
      }
      if (record.status === 'Draft') record.status = 'Sent';

      try {
        const saved = localDb.invoices.save(record);
        removeRaw(SINGLETON_KEYS.draft);
        set({ ...saved, dirty: false });
        get().recalculate();
        return { ok: true, errors: [], record: saved };
      } catch (err) {
        return { ok: false, errors: [(err as Error).message] };
      }
    },

    restoreDraft: () => {
      const saved = getJson<InvoiceRecord | null>(SINGLETON_KEYS.draft, null);
      if (!saved || saved.id) return false;
      set({ ...normalizeRecord(saved, localDb.template.get()), dirty: true });
      get().recalculate();
      return true;
    },

    reset: () => get().newDraft(),
  };
});

/** Convenience for pages that only need a due date suggestion. */
export function suggestDueDate(issueDate: string): string {
  return addDaysInput(num(localDb.settings.get().defaultDueDays, 14), issueDate);
}

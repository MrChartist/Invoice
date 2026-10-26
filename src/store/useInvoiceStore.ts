import { cleanReference, fullyPaidAmount, splitCounterReceipt, type PayMode } from '../lib/counter-receipt';
import { create } from 'zustand';
import { localDb } from '../lib/localDb';
import { issuingProfile } from '../lib/sync-device';
import { DuplicateNumberError, type SeriesGap } from '../lib/invoice-number';
import { getLockUntil, isPeriodLockedError, lockMessage, lockState, prettyDay } from '../lib/period-lock';
import { DB_PREFIX, generateId, getJson, KEYS, removeRaw, setJson, SINGLETON_KEYS } from '../lib/storage';
import { changedElsewhereSince } from '../lib/cross-tab';
import {
  calculateInvoice,
  deriveGstMode,
  effectiveGstMode,
  EMPTY_TOTALS,
  isExcludedLine,
  isIgstZeroRated,
  num,
  round2,
  type CalcTotals,
} from '../lib/invoice-calc';
import { resolveStateCode } from '../lib/india-states';
import { addDaysInput } from '../lib/utils';
import { blankItem, makeDraft, normalizeRecord, R5B_RECORD_KEYS, senderStateCode } from './invoice-defaults';
import { nextPartyBalanceSnapshot } from '../lib/party-balance';
import { partyBalanceSnapshotFor } from '../lib/khata-actions';
import { customFieldsDb, finalizeValues, mergePartyValues, readValues, snapshotFromMap } from '../lib/custom-fields';
import '../types/sales-r2'; // R2-B: declaration-merged record fields (RECORD_KEYS below)
import type {} from '../types/restaurant'; // R3-A: declaration-merged record fields (type-only, erased)
import type {} from '../types/marketplace-r5'; // R5-A: declaration-merged record fields (type-only, erased)
import type {} from '../types/transport-works-r5'; // R5-B: declaration-merged record fields (type-only, erased)
import type {
  Client,
  DiscountType,
  DocumentType,
  GstMode,
  InvoiceItem,
  InvoiceRecord,
  InvoiceStatus,
  RoundMode,
  SenderProfile,
  SupplyType,
  TcsBase,
} from '../types/invoice';

export type { Client, InvoiceItem, SenderProfile } from '../types/invoice';
/** Legacy alias — the store's own item type used to be called `InvoiceItem`. */
export type { InvoiceRecord } from '../types/invoice';

export interface SaveResult {
  ok: boolean;
  errors: string[];
  record?: InvoiceRecord;
  /** True when the save was refused by the period lock (the editor shows the Unlock path). */
  locked?: boolean;
  /** A hand-typed number that skipped ahead of the series: the numbers left unused (a hint, not an error). */
  gap?: SeriesGap | null;
  /** Saved, but something after the save did not go through (e.g. the counter receipt). */
  warning?: string;
}

export interface InvoiceState extends InvoiceRecord {
  /** Full calculation result: per-line values, GST slabs and HSN summary. */
  totals: CalcTotals;
  /** True once the user has edited an unsaved draft. */
  dirty: boolean;
  /** Store-only (A3): how "Amount received" came in; on save the unbacked part becomes a receipt row. */
  pay_mode?: PayMode | null;
  /** Store-only (A3): UTR / reference for a UPI or bank receipt. */
  pay_ref?: string;
  /** Store-only (A3 / A6): keep "Amount received" equal to total − TDS until saved. */
  fully_paid?: boolean;

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
  setRoundMode: (mode: RoundMode) => void;
  setPriceIncludesTax: (on: boolean) => void;
  setSupplyType: (type: SupplyType) => void;
  setLut: (number: string, date: string) => void;
  setTcs: (cfg: { enabled?: boolean; rate?: number; base?: TcsBase; label?: string }) => void;
  setTds: (cfg: { enabled?: boolean; section?: string; rate?: number; onTaxable?: boolean }) => void;

  addItem: () => void;
  updateItem: (id: string, field: keyof InvoiceItem, value: string | number) => void;
  applyCatalogItem: (id: string, source: Partial<InvoiceItem>) => void;
  /** Merge fields into a line; a field set to `undefined` is removed (batch / serial / godown pickers). */
  patchItem: (id: string, patch: Partial<InvoiceItem>) => void;
  /** Replace one line by several (FEFO split across batches). */
  replaceItem: (id: string, lines: InvoiceItem[]) => void;
  duplicateItem: (id: string) => void;
  moveItem: (id: string, direction: -1 | 1) => void;
  removeItem: (id: string) => void;

  recalculate: () => void;
  validate: () => string[];
  newDraft: (docType?: DocumentType) => void;
  loadInvoice: (id: string) => boolean;
  /** `asDraft` keeps the status as Draft instead of promoting it to Sent. */
  saveInvoice: (opts?: { asDraft?: boolean }) => SaveResult;
  restoreDraft: () => boolean;
  reset: () => void;
}

/**
 * Every persisted field of `InvoiceRecord`. The compile-time check below fails when a field is
 * added to the record type but not here — otherwise the editor would silently drop it on save.
 */
export const RECORD_KEYS = [
  // R2-B sales documents (declared in src/types/sales-r2.ts / contacts.ts)
  'milestones', 'progress_of', 'revision_of', 'revision_no', 'proposal_sections', 'attention',
  'id', 'invoice_number', 'doc_type', 'issue_date', 'due_date', 'status', 'currency', 'template_id',
  'client', 'sender', 'items', 'gst_mode', 'place_of_supply', 'reverse_charge', 'discount_type',
  'discount_rate', 'tax_rate', 'shipping', 'other_charges', 'round_off_enabled', 'amount_paid', 'notes',
  'terms', 'po_number', 'recurring_id', 'recurring_date', 'batch_run_id', 'subtotal', 'discount_amount', 'taxable_value',
  'cgst_amount', 'sgst_amount', 'igst_amount', 'tax_amount', 'round_off', 'total', 'balance_due',
  'supply_type', 'lut_number', 'lut_date', 'price_includes_tax', 'round_mode', 'tcs_enabled', 'tcs_rate',
  'tcs_base', 'tcs_label', 'tds_enabled', 'tds_section', 'tds_rate', 'tds_on_taxable', 'cess_amount',
  'tcs_amount', 'tds_amount', 'created_at', 'updated_at', 'quote_status', 'ship_to',
  'charges_taxable', 'exchange_rate', 'shipping_bill_no', 'shipping_bill_date', 'port_code', 'late_fee_for',
  'sales_order_id', 'order_closed_on',
  'cost_centre_id',
  'custom_values', 'attachments',
  'exempt_kind', 'amends',
  'pos',
  'rcm_tax_excluded',
  'goods_returned',
  'eco_gstin', 'eco_section', 'challan_purpose', 'challan_hide_amounts', 'challan_returnable', 'challan_return_by',
  'transport',
  'approval', 'branch_id', 'loyalty_redeem', 'branch_transfer_id',
  'agent_id', 'offer', 'rx',
  'party_balance_snapshot',
  'payment_schedule', 'acceptance',
  // Round 2 (R2-A): financial credit notes
  'note_kind', 'financial_reason', 'financial_account', 'payment_terms',
  // R3-A
  'table_order_id', 'split_of',
  'annexure', // R3-B (src/types/service-r3.ts)
  'delivery_proof', // R3-C
  'incoterm', 'port_of_loading', 'port_of_discharge', 'country_of_origin', 'country_of_destination', 'pre_carriage', 'vessel_flight', 'marks_numbers', 'export_payment_terms', // R4-C
  'channel_id', 'channel_order_id', 'channel_import_id', // R5-A
  'fee_plan_id', 'fee_instalment', // R5-C
  ...R5B_RECORD_KEYS, // R5-B (src/types/transport-works-r5.ts)
] as const satisfies readonly (keyof InvoiceRecord)[];

type UnlistedRecordKey = Exclude<keyof InvoiceRecord, (typeof RECORD_KEYS)[number]>;
// If this line errors, add the named field(s) to RECORD_KEYS.
const recordKeysComplete: [UnlistedRecordKey] extends [never] ? true : UnlistedRecordKey = true;
void recordKeysComplete;

/** Serialise the store back to a persistable record (store-only fields and actions are left out). */
function toRecord(state: InvoiceState): InvoiceRecord {
  const out: Record<string, unknown> = {};
  for (const k of RECORD_KEYS) out[k] = state[k];
  return out as unknown as InvoiceRecord;
}

/**
 * A whole document for `set()`: every persisted key is present (undefined when the record lacks it),
 * so loading a record can never inherit an optional field (charges_taxable, exchange_rate, ship_to …)
 * from the document that was open before — zustand's `set` merges.
 */
function wholeRecord(rec: InvoiceRecord): InvoiceRecord {
  const out: Record<string, unknown> = {};
  for (const k of RECORD_KEYS) out[k] = rec[k];
  return out as unknown as InvoiceRecord;
}

function freshDraft(docType?: DocumentType): InvoiceRecord {
  return makeDraft({
    settings: localDb.settings.get(),
    // Folder sync (5.7): a device can issue as its own profile (own number prefix).
    sender: issuingProfile(localDb.settings.get().profiles, localDb.settings.activeProfile()),
    docType,
    templateId: localDb.template.get(),
  });
}

const isCompositionSender = (sender: SenderProfile | null | undefined) => sender?.gst_scheme === 'composition';

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

/** When the editor last loaded or saved its document (for the cross-tab stale-copy check). */
let loadedAt = Date.now();

export const STALE_COPY_MESSAGE =
  'This document was changed in another tab or window after you opened it. Reopen it to see the latest version before saving.';

let draftTimer: ReturnType<typeof setTimeout> | undefined;

function cancelDraftSave(): void {
  if (draftTimer) clearTimeout(draftTimer);
  draftTimer = undefined;
}

/**
 * Debounced autosave of the in-progress draft so a refresh never loses work.
 * Reads the live state when it fires (not the state that scheduled it), and is
 * cancelled by save / reset so a late write can never resurrect a stale draft.
 */
function scheduleDraftSave(read: () => InvoiceState): void {
  if (read().id) return; // saved documents are persisted explicitly
  cancelDraftSave();
  draftTimer = setTimeout(() => {
    draftTimer = undefined;
    const state = read();
    if (state.id) return;
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
    scheduleDraftSave(get);
  };

  const mapItems = (id: string, fn: (item: InvoiceItem) => InvoiceItem) =>
    apply({ items: get().items.map((item) => (item.id === id ? fn(item) : item)) });

  return {
    ...freshDraft(),
    totals: EMPTY_TOTALS,
    dirty: false,

    patch: apply,

    setClient: (clientData) => {
      // A picked client brings its party custom-field values (6.23): they replace the previous
      // client's in the document snapshot; the map itself never lives on the invoice's client copy.
      const { custom_fields: partyMap, ...rest } = clientData;
      const client = { ...get().client, ...rest };
      delete client.custom_fields;
      const partyPatch: Partial<InvoiceRecord> = {};
      if (partyMap !== undefined) {
        const own = readValues(get().custom_values).filter((v) => v.scope !== 'party');
        const merged = mergePartyValues(own, partyMap, customFieldsDb.all());
        partyPatch.custom_values = merged.length ? merged : undefined;
      }
      // A client picked from the master (it brings its party map) on a new document: its default
      // credit period (6.25 `credit_days`) sets the due date (8.6). Typing a name never does.
      if (partyMap !== undefined && !get().id && client.name?.trim()) {
        const key = client.name.trim().toLowerCase();
        const master = localDb.clients.getAll().find((c) => (c.name ?? '').trim().toLowerCase() === key);
        const days = Math.round(Number(master?.credit_days) || 0);
        if (days > 0) partyPatch.due_date = addDaysInput(days, get().issue_date);
      }
      // A client's GSTIN/state decides the place of supply, which decides the split.
      const place_of_supply =
        resolveStateCode({ code: client.state_code, gstin: client.gstin, name: client.state }) ||
        get().place_of_supply;
      apply({
        client,
        place_of_supply,
        gst_mode: refineGstMode(get().gst_mode, get().sender, place_of_supply),
        ...partyPatch,
      });
    },

    setSender: (sender) => {
      const place_of_supply = get().place_of_supply || senderStateCode(sender);
      // A composition dealer cannot issue tax invoices: an unsaved invoice switches to a Bill of Supply.
      const toBos = isCompositionSender(sender) && !get().id && (get().doc_type === 'INVOICE' || get().doc_type === 'TAX_INVOICE');
      apply({
        sender,
        place_of_supply,
        terms: get().terms || sender.defaultTerms || '',
        gst_mode: toBos || get().doc_type === 'BILL_OF_SUPPLY' ? 'NONE' : refineGstMode(get().gst_mode, sender, place_of_supply),
        ...(toBos ? { doc_type: 'BILL_OF_SUPPLY' as DocumentType, reverse_charge: false, rcm_tax_excluded: undefined } : {}),
      });
    },

    setDates: (issue, due) => apply({ issue_date: issue, due_date: due }),

    setStatus: (status) => apply({ status }),
    setDocType: (doc_type) => {
      const prev = get().doc_type;
      // QA5-2 F10: optional / alternative lines exist only on a quotation. Leaving it keeps the selected
      // lines (flags cleared) and drops the rest, as conversion does (`keepSelectedLines` in documents.ts).
      if (prev === 'QUOTATION' && doc_type !== 'QUOTATION' && get().items.some((i) => i.optional || i.alt_group || i.selected !== undefined)) {
        const kept = get().items.filter((i) => !isExcludedLine(i)).map((i) => {
          const { optional: _o, selected: _s, alt_group: _g, ...rest } = i;
          void [_o, _s, _g];
          return rest;
        });
        apply({ items: kept.length ? kept : [blankItem(get().tax_rate)] });
      }
      if (doc_type === 'BILL_OF_SUPPLY') {
        // No tax on a Bill of Supply (Rule 49); reverse charge does not arise either.
        apply({ doc_type, gst_mode: 'NONE', reverse_charge: false, rcm_tax_excluded: undefined });
      } else if (prev === 'BILL_OF_SUPPLY' && get().gst_mode === 'NONE' && !isCompositionSender(get().sender)) {
        // Leaving a Bill of Supply on a regular profile: pick the split back up from the states.
        const sender = get().sender;
        apply({
          doc_type,
          gst_mode: deriveGstMode({
            senderStateCode: senderStateCode(sender),
            placeOfSupply: get().place_of_supply,
            senderHasGstin: Boolean(sender?.companyGstin?.trim()),
            taxEnabled: true,
          }),
        });
      } else {
        apply({ doc_type });
      }
    },
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
    // Ticking reverse charge calculates the document the current way: the GST is shown as payable by
    // the recipient and stays out of the total (src/lib/rcm.ts). An older reverse-charge record keeps
    // its stored figures until the box is ticked again (Critical Rule 3).
    setReverseCharge: (reverse_charge) => apply({ reverse_charge, rcm_tax_excluded: reverse_charge ? true : undefined }),

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
    setRoundOff: (round_off_enabled) => {
      const cur = get().round_mode;
      apply({
        round_off_enabled,
        // Only touch round_mode if the record already uses it.
        ...(cur !== undefined
          ? { round_mode: round_off_enabled ? (cur === 'none' ? 'nearest' : cur) : 'none' }
          : {}),
      } as Partial<InvoiceRecord>);
    },
    setRoundMode: (round_mode) => apply({ round_mode, round_off_enabled: round_mode !== 'none' }),
    setPriceIncludesTax: (price_includes_tax) => apply({ price_includes_tax }),
    setSupplyType: (supply_type) => {
      const gst = get().gst_mode;
      apply({
        supply_type,
        // IGST-with-payment supplies are always inter-state style.
        ...(isIgstZeroRated(supply_type) && gst === 'CGST_SGST' ? { gst_mode: 'IGST' as GstMode } : {}),
      });
    },
    setLut: (lut_number, lut_date) => apply({ lut_number, lut_date }),
    setTcs: (c) =>
      apply({
        ...(c.enabled !== undefined ? { tcs_enabled: c.enabled } : {}),
        ...(c.rate !== undefined ? { tcs_rate: Math.max(num(c.rate), 0) } : {}),
        ...(c.base !== undefined ? { tcs_base: c.base } : {}),
        ...(c.label !== undefined ? { tcs_label: c.label } : {}),
      }),
    setTds: (c) =>
      apply({
        ...(c.enabled !== undefined ? { tds_enabled: c.enabled } : {}),
        ...(c.section !== undefined ? { tds_section: c.section } : {}),
        ...(c.rate !== undefined ? { tds_rate: Math.max(num(c.rate), 0) } : {}),
        ...(c.onTaxable !== undefined ? { tds_on_taxable: c.onTaxable } : {}),
      }),
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
        // Item custom fields (6.23) flow onto the line with today's labels.
        const values = snapshotFromMap(source.custom_fields, customFieldsDb.all(), 'item');
        if (values.length) next.custom_values = values;
        else delete next.custom_values;
        // A picked item starts in its catalogue unit (WP-8): any alternate-unit factor of the old line goes.
        if (num(source.unit_factor) > 0 && num(source.unit_factor) !== 1) next.unit_factor = num(source.unit_factor);
        else delete next.unit_factor;
        next.amount = round2(num(next.quantity) * num(next.rate));
        return next;
      }),

    patchItem: (id, patch) =>
      mapItems(id, (item) => {
        const next = { ...item, ...patch } as InvoiceItem & Record<string, unknown>;
        for (const k of Object.keys(patch)) if (next[k] === undefined) delete next[k];
        next.amount = round2(num(next.quantity) * num(next.rate));
        return next;
      }),

    replaceItem: (id, lines) => {
      const items = get().items;
      const idx = items.findIndex((i) => i.id === id);
      if (idx < 0 || lines.length === 0) return;
      apply({ items: [...items.slice(0, idx), ...lines, ...items.slice(idx + 1)] });
    },

    duplicateItem: (id) => {
      const items = get().items;
      const idx = items.findIndex((i) => i.id === id);
      if (idx < 0) return;
      // A serial / IMEI can only be on one line: the copy starts without them.
      const { serials: _serials, ...rest } = items[idx];
      void _serials;
      const copy = { ...rest, id: generateId() };
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
        gst_mode: effectiveGstMode(s.doc_type, s.gst_mode),
        discount_type: s.discount_type,
        discount_rate: s.discount_rate,
        tax_rate: s.tax_rate,
        shipping: s.shipping,
        other_charges: s.other_charges,
        round_off_enabled: s.round_off_enabled,
        amount_paid: s.amount_paid,
        round_mode: s.round_mode,
        price_includes_tax: s.price_includes_tax,
        supply_type: s.supply_type,
        tcs_enabled: s.tcs_enabled,
        tcs_rate: s.tcs_rate,
        tcs_base: s.tcs_base,
        tds_enabled: s.tds_enabled,
        tds_rate: s.tds_rate,
        tds_on_taxable: s.tds_on_taxable,
        charges_taxable: s.charges_taxable,
        rcm_exclude_tax: s.reverse_charge && !!s.rcm_tax_excluded && s.doc_type !== 'BILL_OF_SUPPLY',
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
        cess_amount: totals.cess_amount,
        tcs_amount: totals.tcs_amount,
        tds_amount: totals.tds_amount,
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
      if (s.amount_paid > s.total - (s.tds_amount ?? 0)) errors.push('Amount received is more than the total.');

      // Period lock: a frozen document is read-only, and nothing may be dated into a frozen period.
      const lockUntil = getLockUntil();
      if (lockUntil) {
        const stored = s.id ? localDb.invoices.getById(s.id) : undefined;
        if (stored && lockState(stored, lockUntil) === 'locked') {
          errors.push(lockMessage(lockUntil, 'edit', stored.issue_date, stored.invoice_number));
        } else if (lockState({ id: s.id, issue_date: s.issue_date }, lockUntil) === 'locked') {
          errors.push(`Issue date ${prettyDay(s.issue_date)} is inside the locked period (books locked up to ${prettyDay(lockUntil)}). Choose a later date.`);
        }
      }
      // GST Rule 46: the number must be unique.
      const typed = s.invoice_number.trim();
      if (typed) {
        const check = localDb.invoices.checkNumber(typed, s.id || undefined);
        if (!check.ok && check.clash) errors.push(new DuplicateNumberError(typed, check.clash).message);
      }
      return errors;
    },

    newDraft: (docType) => {
      cancelDraftSave();
      removeRaw(SINGLETON_KEYS.draft);
      set({ ...wholeRecord(freshDraft(docType)), totals: EMPTY_TOTALS, dirty: false, pay_mode: null, pay_ref: '', fully_paid: false });
      get().recalculate();
    },

    loadInvoice: (id) => {
      const found = localDb.invoices.getById(id);
      if (!found) return false;
      loadedAt = Date.now();
      set({ ...wholeRecord(normalizeRecord(found, localDb.template.get())), dirty: false, pay_mode: null, pay_ref: '', fully_paid: false });
      get().recalculate();
      return true;
    },

    saveInvoice: (opts) => {
      const errors = get().validate();
      if (errors.length) return { ok: false, errors, locked: errors.some((e) => e.startsWith('Books are locked')) };

      const state = get();
      // Another tab saved this same document after we loaded it: never overwrite it with our stale copy.
      if (state.id && changedElsewhereSince(DB_PREFIX + KEYS.invoices, loadedAt)) {
        const stored = localDb.invoices.getById(state.id);
        if (stored && stored.updated_at !== state.updated_at) return { ok: false, errors: [STALE_COPY_MESSAGE] };
      }
      // A hand-typed number that skips ahead leaves holes in the series: remember them for the hint.
      const typedNumber = state.invoice_number.trim();
      const gap = typedNumber ? localDb.invoices.checkNumber(typedNumber, state.id || undefined).gap : null;
      const record = toRecord(state);
      // Drop the empty trailing row users leave behind.
      record.items = record.items.filter((i) => i.name.trim() || num(i.rate) > 0);
      // Custom fields (6.23): normalise values; a first save records today's labels, later saves keep theirs.
      const defs = customFieldsDb.all();
      const isNew = !state.id;
      record.custom_values = finalizeValues(record.custom_values, defs, isNew);
      record.items = record.items.map((i) => {
        const values = finalizeValues(i.custom_values, defs, isNew);
        if (values) return { ...i, custom_values: values };
        if (!i.custom_values) return i;
        const rest = { ...i };
        delete rest.custom_values;
        return rest;
      });
      if (!record.invoice_number) {
        // The sender profile's own prefix wins (the creator page previews it); else the global one.
        record.invoice_number = localDb.invoices.nextNumber(
          record.issue_date,
          record.doc_type,
          record.sender?.invoicePrefix || undefined,
        );
      }
      if (record.status === 'Draft' && !opts?.asDraft) record.status = 'Sent';
      // Party balance on the bill (8.5): frozen at first issue, kept on later saves; legacy stays without.
      const storedCopy = state.id ? localDb.invoices.getById(state.id) : undefined;
      const snapshot = nextPartyBalanceSnapshot(record, storedCopy, () => partyBalanceSnapshotFor(record));
      if (snapshot) record.party_balance_snapshot = snapshot;
      else delete record.party_balance_snapshot;

      // A3 / A6: "Fully paid" follows the final total (lines may have changed after it was ticked).
      if (state.fully_paid) {
        record.amount_paid = fullyPaidAmount(record);
        record.balance_due = 0;
      }
      // A3: the part of "Amount received" not yet in the ledger becomes a receipt with the chosen mode.
      const split = splitCounterReceipt(record, state.id ? localDb.payments.totalFor(state.id) : 0, state.pay_mode);
      try {
        let saved = localDb.invoices.save(split.record);
        let warning: string | undefined;
        if (split.amount > 0 && state.pay_mode) {
          try {
            localDb.payments.record({ invoiceId: saved.id, amount: split.amount, method: state.pay_mode, reference: cleanReference(state.pay_mode, state.pay_ref), date: saved.issue_date, note: 'Received at billing' });
            saved = localDb.invoices.getById(saved.id) ?? saved;
          } catch (err) {
            warning = (err as Error).message;
          }
        }
        loadedAt = Date.now();
        cancelDraftSave();
        removeRaw(SINGLETON_KEYS.draft);
        set({ ...saved, dirty: false, pay_ref: '', fully_paid: false });
        get().recalculate();
        return { ok: true, errors: [], record: saved, gap, warning };
      } catch (err) {
        return { ok: false, errors: [(err as Error).message], locked: isPeriodLockedError(err) };
      }
    },

    restoreDraft: () => {
      const saved = getJson<InvoiceRecord | null>(SINGLETON_KEYS.draft, null);
      if (!saved || saved.id) return false;
      set({ ...wholeRecord(normalizeRecord(saved, localDb.template.get())), dirty: true });
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

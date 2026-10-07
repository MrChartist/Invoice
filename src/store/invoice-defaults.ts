/**
 * Draft factory + legacy-record normaliser.
 *
 * Records written by earlier versions have no GST fields. `normalizeRecord`
 * fills them in such a way that a legacy document still recalculates to the
 * exact total it was issued with (flat `tax_rate` + a single "Tax" line).
 */

import { generateId } from '../lib/storage';
import { deriveGstMode, num } from '../lib/invoice-calc';
import { resolveStateCode } from '../lib/india-states';
import { addDaysInput, todayInput } from '../lib/utils';
import type { AppSettings } from '../lib/localDb';
import type {
  Client,
  DocumentType,
  InvoiceItem,
  InvoiceRecord,
  SenderProfile,
} from '../types/invoice';

export function blankClient(): Client {
  return {
    name: '',
    email: '',
    address: '',
    city: '',
    zip: '',
    company: '',
    gstin: '',
    phone: '',
    state: '',
    state_code: '',
  };
}

export function blankItem(taxRate = 0): InvoiceItem {
  return {
    id: generateId(),
    name: '',
    description: '',
    type: 'Service',
    hsn: '',
    unit: 'NOS',
    quantity: 1,
    rate: 0,
    tax_rate: taxRate,
    discount_percent: 0,
    amount: 0,
  };
}

/** Sender's own state — the default place of supply (an intra-state sale). */
export function senderStateCode(sender: SenderProfile | null): string {
  if (!sender) return '';
  return resolveStateCode({ code: sender.stateCode, gstin: sender.companyGstin });
}

export interface DraftOptions {
  settings: AppSettings;
  sender: SenderProfile | null;
  docType?: DocumentType;
  templateId?: string;
}

/** A fresh, unsaved document seeded from the user's settings. */
export function makeDraft(opts: DraftOptions): InvoiceRecord {
  const { settings, sender } = opts;
  const issue = todayInput();
  const homeState = senderStateCode(sender);
  const taxRate = num(settings.defaultTaxRate);
  const gst_mode = deriveGstMode({
    senderStateCode: homeState,
    placeOfSupply: homeState,
    senderHasGstin: Boolean(sender?.companyGstin?.trim()),
    taxEnabled: taxRate > 0,
  });

  return {
    id: '',
    invoice_number: '',
    doc_type: opts.docType ?? 'INVOICE',
    issue_date: issue,
    due_date: addDaysInput(num(settings.defaultDueDays, 14), issue),
    status: 'Draft',
    currency: settings.defaultCurrency || 'INR',
    template_id: opts.templateId || 'classic_orange',

    client: blankClient(),
    sender: sender ?? null,
    items: [blankItem(taxRate)],

    gst_mode,
    place_of_supply: homeState,
    reverse_charge: false,

    discount_type: 'PERCENT',
    discount_rate: 0,
    tax_rate: taxRate,
    shipping: 0,
    other_charges: 0,
    round_off_enabled: settings.roundOff !== false,
    amount_paid: 0,

    ...advancedTaxDefaults(),

    notes: settings.defaultNotes ?? '',
    terms: sender?.defaultTerms || settings.defaultTerms || '',
    po_number: '',

    subtotal: 0,
    discount_amount: 0,
    taxable_value: 0,
    cgst_amount: 0,
    sgst_amount: 0,
    igst_amount: 0,
    tax_amount: 0,
    round_off: 0,
    total: 0,
    balance_due: 0,
    cess_amount: 0,
    tcs_amount: 0,
    tds_amount: 0,
  };
}

/** Advanced-tax fields, all off. Legacy records fall back to the same values. */
export function advancedTaxDefaults(): Partial<InvoiceRecord> {
  return {
    supply_type: 'B2B',
    lut_number: '',
    lut_date: '',
    price_includes_tax: false,
    tcs_enabled: false,
    tcs_rate: 0,
    tcs_base: 'total',
    tcs_label: 'TCS',
    tds_enabled: false,
    tds_section: '194J',
    tds_rate: 10,
    tds_on_taxable: true,
  };
}

function normalizeItem(raw: unknown, fallbackTaxRate: number): InvoiceItem {
  const item = (raw ?? {}) as Partial<InvoiceItem>;
  const quantity = num(item.quantity, 1);
  const rate = num(item.rate);
  return {
    id: item.id || generateId(),
    name: item.name ?? '',
    description: item.description ?? '',
    type: item.type ?? 'Service',
    hsn: item.hsn ?? '',
    unit: item.unit ?? '',
    quantity,
    rate,
    tax_rate: typeof item.tax_rate === 'number' ? item.tax_rate : fallbackTaxRate,
    discount_percent: num(item.discount_percent),
    ...(num(item.cess_rate) > 0 ? { cess_rate: num(item.cess_rate) } : {}),
    ...(num(item.cess_per_unit) > 0 ? { cess_per_unit: num(item.cess_per_unit) } : {}),
    amount: num(item.amount, quantity * rate),
  };
}

/** Upgrade any stored record (old or new) to the current `InvoiceRecord` shape. */
export function normalizeRecord(raw: unknown, fallbackTemplateId = 'classic_orange'): InvoiceRecord {
  const r = (raw ?? {}) as Partial<InvoiceRecord> & Record<string, unknown>;
  const flatTaxRate = num(r.tax_rate);
  const isLegacy = r.gst_mode === undefined;

  const gst_mode: InvoiceRecord['gst_mode'] = isLegacy
    ? flatTaxRate > 0
      ? 'SINGLE'
      : 'NONE'
    : (r.gst_mode as InvoiceRecord['gst_mode']);

  const sender = (r.sender as SenderProfile | null) ?? null;
  const client = { ...blankClient(), ...((r.client as Client) ?? {}) };
  const items = Array.isArray(r.items) ? r.items : [];

  return {
    id: r.id ?? '',
    invoice_number: r.invoice_number ?? '',
    doc_type: (r.doc_type as DocumentType) ?? 'INVOICE',
    issue_date: r.issue_date ?? todayInput(),
    due_date: r.due_date ?? todayInput(),
    status: r.status ?? 'Draft',
    currency: r.currency ?? 'INR',
    template_id: r.template_id ?? fallbackTemplateId,

    client,
    sender,
    items: items.length ? items.map((i) => normalizeItem(i, flatTaxRate)) : [blankItem(flatTaxRate)],

    gst_mode,
    place_of_supply:
      r.place_of_supply ??
      resolveStateCode({ gstin: client.gstin, name: client.state }) ??
      '',
    reverse_charge: Boolean(r.reverse_charge),

    discount_type: r.discount_type ?? 'PERCENT',
    discount_rate: num(r.discount_rate),
    tax_rate: flatTaxRate,
    shipping: num(r.shipping),
    other_charges: num(r.other_charges),
    round_off_enabled: Boolean(r.round_off_enabled),
    amount_paid: num(r.amount_paid),

    ...advancedTaxDefaults(),
    ...(r.supply_type ? { supply_type: r.supply_type } : {}),
    lut_number: r.lut_number ?? '',
    lut_date: r.lut_date ?? '',
    price_includes_tax: Boolean(r.price_includes_tax),
    // round_mode stays undefined for legacy rows: round_off_enabled decides.
    ...(r.round_mode ? { round_mode: r.round_mode } : {}),
    tcs_enabled: Boolean(r.tcs_enabled),
    tcs_rate: num(r.tcs_rate),
    tcs_base: r.tcs_base === 'taxable' ? 'taxable' : 'total',
    tcs_label: r.tcs_label || 'TCS',
    tds_enabled: Boolean(r.tds_enabled),
    tds_section: r.tds_section || '194J',
    tds_rate: num(r.tds_rate, 10),
    tds_on_taxable: r.tds_on_taxable !== false,

    notes: r.notes ?? '',
    terms: r.terms ?? '',
    po_number: r.po_number ?? '',

    subtotal: num(r.subtotal),
    discount_amount: num(r.discount_amount),
    taxable_value: num(r.taxable_value),
    cgst_amount: num(r.cgst_amount),
    sgst_amount: num(r.sgst_amount),
    igst_amount: num(r.igst_amount),
    tax_amount: num(r.tax_amount),
    round_off: num(r.round_off),
    total: num(r.total),
    balance_due: num(r.balance_due, num(r.total) - num(r.amount_paid)),
    cess_amount: num(r.cess_amount),
    tcs_amount: num(r.tcs_amount),
    tds_amount: num(r.tds_amount),

    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

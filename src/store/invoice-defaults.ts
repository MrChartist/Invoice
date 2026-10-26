/**
 * Draft factory + legacy-record normaliser.
 *
 * Records written by earlier versions have no GST fields. `normalizeRecord`
 * fills them in such a way that a legacy document still recalculates to the
 * exact total it was issued with (flat `tax_rate` + a single "Tax" line).
 */

import type {} from '../types/docs-r3'; // R3-C2: delivery_proof (RECORD_KEYS)
import { generateId } from '../lib/storage';
import { deriveGstMode, num } from '../lib/invoice-calc';
import { resolveStateCode } from '../lib/india-states';
import { addDaysInput, todayInput } from '../lib/utils';
import { readValues } from '../lib/custom-fields';
import { readRefs } from '../lib/attachments';
import { normalizeTransport } from '../lib/transport';
import { sanitizePartyBalance } from '../lib/party-balance';
import { normalizeSchedule, sanitizeAcceptance } from '../lib/doc-snapshots';
import type {} from '../types/sales-r2';
import type { AppSettings } from '../lib/localDb';
import type {
  AmendmentInfo,
  ChallanPurpose,
  EcoSection,
  Client,
  DocumentType,
  InvoiceItem,
  InvoiceRecord,
  SenderProfile,
  ShipTo,
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
  // Composition dealers issue Bills of Supply (no tax) by default.
  const composition = sender?.gst_scheme === 'composition';
  const docType: DocumentType = opts.docType ?? (composition ? 'BILL_OF_SUPPLY' : 'INVOICE');
  const gst_mode = docType === 'BILL_OF_SUPPLY' ? 'NONE' : deriveGstMode({
    senderStateCode: homeState,
    placeOfSupply: homeState,
    senderHasGstin: Boolean(sender?.companyGstin?.trim()),
    taxEnabled: taxRate > 0,
  });

  return {
    id: '',
    invoice_number: '',
    doc_type: docType,
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
    ...(item.order_line_id ? { order_line_id: String(item.order_line_id) } : {}),
    // R2-B (additive): optional / alternative quotation lines, the source line a stage invoice bills.
    ...(item.optional ? { optional: true } : {}),
    ...(typeof item.selected === 'boolean' && (item.optional || item.alt_group) ? { selected: item.selected } : {}),
    ...(typeof item.alt_group === 'string' && item.alt_group.trim() ? { alt_group: item.alt_group.trim() } : {}),
    ...(item.progress_line_of ? { progress_line_of: String(item.progress_line_of) } : {}),
    ...(typeof item.cost_centre_id === 'string' && item.cost_centre_id ? { cost_centre_id: item.cost_centre_id } : {}),
    ...(Array.isArray(item.bill_refs) && item.bill_refs.length ? { bill_refs: item.bill_refs.map(String) } : {}),
    ...(readValues(item.custom_values).length ? { custom_values: readValues(item.custom_values) } : {}),
    // Stock tracking (6.6 / 6.10 / 6.11): absent on untracked lines so their snapshots never change.
    ...(item.batch_no ? { batch_no: String(item.batch_no) } : {}),
    ...(item.batch_expiry ? { batch_expiry: String(item.batch_expiry).slice(0, 10) } : {}),
    ...(item.batch_mfg ? { batch_mfg: String(item.batch_mfg).slice(0, 10) } : {}),
    ...(Array.isArray(item.serials) && item.serials.length ? { serials: item.serials.map(String) } : {}),
    ...(num(item.warranty_months) > 0 ? { warranty_months: num(item.warranty_months) } : {}),
    ...(item.godown_id ? { godown_id: String(item.godown_id) } : {}),
    // Pricing (6.9): absent unless a level / slab / scheme set the line.
    ...(item.price_basis ? { price_basis: String(item.price_basis) } : {}),
    ...(item.scheme_id ? { scheme_id: String(item.scheme_id) } : {}),
    ...(item.free_of ? { free_of: String(item.free_of) } : {}),
    // Alternate unit (WP-8): only on lines typed in one, so base-unit lines keep their exact shape.
    ...(num(item.unit_factor) > 0 && num(item.unit_factor) !== 1 ? { unit_factor: num(item.unit_factor) } : {}),
    // R3-C2 (additive): the catalogue photo reference the line snapshotted at save.
    ...(typeof item.image === 'string' && item.image.startsWith('asset:') ? { image: item.image } : {}),
  };
}

/** A stored amendment marker, or undefined when it is missing or unusable. */
function normalizeAmends(raw: unknown): AmendmentInfo | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const a = raw as Partial<AmendmentInfo>;
  const original_number = String(a.original_number ?? '').trim();
  const original_date = String(a.original_date ?? '').slice(0, 10);
  const amended_on = String(a.amended_on ?? '').slice(0, 10);
  if (!original_number || !/^\d{4}-\d{2}-\d{2}$/.test(original_date) || !/^\d{4}-\d{2}-\d{2}$/.test(amended_on)) return undefined;
  return {
    original_number,
    original_date,
    period: String(a.period ?? ''),
    amended_on,
    ...(a.reason ? { reason: String(a.reason) } : {}),
    ...(a.original && typeof a.original === 'object' ? { original: a.original } : {}),
  };
}

const CHALLAN_PURPOSES = new Set(['JOB_WORK', 'APPROVAL', 'LIQUID_GAS', 'OTHER_THAN_SUPPLY', 'ANTICIPATION']);

/** E-commerce operator fields: kept only with a GSTIN; the section only when it is a known one. */
function ecoFields(gstin: unknown, section: unknown): { eco_gstin?: string; eco_section?: EcoSection } {
  const g = typeof gstin === 'string' ? gstin.trim().toUpperCase() : '';
  if (!g) return {};
  return { eco_gstin: g, ...(section === 'TCS_52' || section === 'PAY_9_5' ? { eco_section: section } : {}) };
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
    // Only stored on reverse-charge documents calculated without the tax in the total (src/lib/rcm.ts).
    ...(r.reverse_charge && r.rcm_tax_excluded ? { rcm_tax_excluded: true } : {}),
    ...(typeof r.goods_returned === 'boolean' ? { goods_returned: r.goods_returned } : {}),
    // WP-9 (additive): approval state, branch, loyalty redemption.
    ...(r.approval && typeof r.approval === 'object' ? { approval: r.approval as InvoiceRecord['approval'] } : {}),
    ...(typeof r.branch_id === 'string' && r.branch_id ? { branch_id: r.branch_id } : {}),
    ...(typeof r.branch_transfer_id === 'string' && r.branch_transfer_id ? { branch_transfer_id: r.branch_transfer_id } : {}),
    ...(r.loyalty_redeem && typeof r.loyalty_redeem === 'object' && Number((r.loyalty_redeem as { points?: unknown }).points) > 0
      ? { loyalty_redeem: { points: Number((r.loyalty_redeem as { points: number }).points), value: Number((r.loyalty_redeem as { value?: number }).value) || 0 } }
      : {}),
    // 7U (additive): sales agent, bill-value offer, prescription (pharma pack).
    ...(typeof r.agent_id === 'string' && r.agent_id ? { agent_id: r.agent_id } : {}),
    ...(r.offer && typeof r.offer === 'object' && Number((r.offer as { value?: unknown }).value) > 0 ? { offer: r.offer as InvoiceRecord['offer'] } : {}),
    ...(r.rx && typeof r.rx === 'object' ? { rx: r.rx as InvoiceRecord['rx'] } : {}),
    // 8.5 (additive): party balance frozen on the bill at first issue.
    ...(() => {
      const snap = sanitizePartyBalance(r.party_balance_snapshot);
      return snap ? { party_balance_snapshot: snap } : {};
    })(),
    // 8G (additive): instalments and the quote acceptance snapshot.
    ...(() => {
      const sched = normalizeSchedule(r.payment_schedule);
      return sched.length ? { payment_schedule: sched } : {};
    })(),
    ...(() => {
      const acc = sanitizeAcceptance(r.acceptance);
      return acc ? { acceptance: acc } : {};
    })(),
    // Round 2 (R2-A, additive): financial credit notes and the payment-term snapshot.
    ...(r.note_kind === 'financial' ? { note_kind: 'financial' as const } : {}),
    ...(typeof r.financial_reason === 'string' && r.financial_reason ? { financial_reason: r.financial_reason as InvoiceRecord['financial_reason'] } : {}),
    ...(typeof r.financial_account === 'string' && r.financial_account ? { financial_account: r.financial_account } : {}),
    ...(r.payment_terms && typeof r.payment_terms === 'object' && typeof (r.payment_terms as { name?: unknown }).name === 'string'
      ? { payment_terms: r.payment_terms as InvoiceRecord['payment_terms'] }
      : {}),

    // R2-B (additive): milestones, stage marks, quotation revisions / proposal sections, Kind attn.
    ...(Array.isArray(r.milestones) && r.milestones.length ? { milestones: r.milestones as InvoiceRecord['milestones'] } : {}),
    ...(r.progress_of && typeof r.progress_of === 'object' ? { progress_of: r.progress_of as InvoiceRecord['progress_of'] } : {}),
    ...(typeof r.revision_of === 'string' && r.revision_of ? { revision_of: r.revision_of } : {}),
    ...(num(r.revision_no) > 0 ? { revision_no: num(r.revision_no) } : {}),
    ...(Array.isArray(r.proposal_sections) && r.proposal_sections.length ? { proposal_sections: r.proposal_sections as InvoiceRecord['proposal_sections'] } : {}),
    ...(r.attention && typeof r.attention === 'object' && (r.attention as { name?: unknown }).name ? { attention: r.attention as InvoiceRecord['attention'] } : {}),
    // R3-A (additive): the table order a POS bill settled, and its split part.
    ...(typeof r.table_order_id === 'string' && r.table_order_id ? { table_order_id: r.table_order_id } : {}),
    ...(r.split_of && typeof r.split_of === 'object' ? { split_of: r.split_of as InvoiceRecord['split_of'] } : {}),
    // R3-C2 (additive): receiver signature snapshot (proof of delivery).
    ...(r.delivery_proof && typeof r.delivery_proof === 'object' && (r.delivery_proof as { receiver?: unknown }).receiver ? { delivery_proof: r.delivery_proof as InvoiceRecord['delivery_proof'] } : {}),

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
    recurring_id: r.recurring_id,
    recurring_date: r.recurring_date,

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

    ...(r.quote_status === 'Accepted' || r.quote_status === 'Declined' ? { quote_status: r.quote_status } : {}),
    ...(r.ship_to && typeof r.ship_to === 'object' ? { ship_to: { ...(r.ship_to as ShipTo) } } : {}),
    // Additive fields stay absent on legacy rows so their snapshots never change.
    ...(r.charges_taxable ? { charges_taxable: true } : {}),
    ...(num(r.exchange_rate) > 0 ? { exchange_rate: num(r.exchange_rate) } : {}),
    ...(r.shipping_bill_no ? { shipping_bill_no: String(r.shipping_bill_no) } : {}),
    ...(r.shipping_bill_date ? { shipping_bill_date: String(r.shipping_bill_date).slice(0, 10) } : {}),
    ...(r.port_code ? { port_code: String(r.port_code).toUpperCase() } : {}),
    ...(typeof r.late_fee_for === 'string' && r.late_fee_for ? { late_fee_for: r.late_fee_for } : {}),
    ...(r.sales_order_id ? { sales_order_id: String(r.sales_order_id) } : {}),
    ...(r.order_closed_on ? { order_closed_on: String(r.order_closed_on).slice(0, 10) } : {}),
    ...(typeof r.cost_centre_id === 'string' && r.cost_centre_id ? { cost_centre_id: r.cost_centre_id } : {}),
    ...(readValues(r.custom_values).length ? { custom_values: readValues(r.custom_values) } : {}),
    ...(readRefs(r.attachments).length ? { attachments: readRefs(r.attachments) } : {}),
    ...(r.exempt_kind === 'NIL' || r.exempt_kind === 'EXEMPT' || r.exempt_kind === 'NON_GST' ? { exempt_kind: r.exempt_kind } : {}),
    ...(normalizeAmends(r.amends) ? { amends: normalizeAmends(r.amends) } : {}),
    ...(r.pos === true ? { pos: true } : {}),
    ...ecoFields(r.eco_gstin, r.eco_section),
    ...(CHALLAN_PURPOSES.has(String(r.challan_purpose)) ? { challan_purpose: r.challan_purpose as ChallanPurpose } : {}),
    // 8H delivery challan toggles (additive).
    ...(r.challan_hide_amounts === true ? { challan_hide_amounts: true } : {}),
    ...(r.challan_returnable === true ? { challan_returnable: true } : {}),
    ...(typeof r.challan_return_by === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.challan_return_by) ? { challan_return_by: r.challan_return_by } : {}),
    ...(() => {
      const transport = normalizeTransport(r.transport);
      return transport ? { transport } : {};
    })(),

    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/** The client fields an invoice copies from a directory entry (shared by the picker and the typeahead). */
export function clientToParty(c: Partial<Client>): Partial<Client> {
  return {
    name: c.name ?? '',
    company: c.company ?? '',
    email: c.email ?? '',
    phone: c.phone ?? '',
    address: c.address ?? '',
    city: c.city ?? '',
    state: c.state ?? '',
    state_code: c.state_code ?? '',
    zip: c.zip ?? '',
    gstin: c.gstin ?? '',
    // Party custom-field values (6.23): the store copies them into the document snapshot and
    // never keeps this map on the invoice's client copy.
    custom_fields: c.custom_fields ?? {},
  };
}

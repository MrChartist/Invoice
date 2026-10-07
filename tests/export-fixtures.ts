/** Hand-computed fixtures shared by the export tests (not itself a test file). */
import type { Client, InvoiceRecord, Payment } from '../src/types/invoice.ts';
import type { ExportSource } from '../src/lib/export-shared.ts';

export const ACME: Client = {
  id: 'c1',
  name: 'Acme Traders',
  email: 'accounts@acme.test',
  address: '12 MG Road',
  city: 'Mumbai',
  zip: '400001',
  gstin: '27AAAAA0000A1Z5',
  phone: '+91 98200 00000',
  state_code: '27',
};

export function makeInvoice(over: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'inv-1',
    invoice_number: 'INV/FY25-26/0001',
    doc_type: 'TAX_INVOICE',
    issue_date: '2025-04-15',
    due_date: '2025-04-29',
    status: 'Sent',
    currency: 'INR',
    template_id: 'classic_orange',
    client: ACME,
    sender: null,
    items: [
      {
        id: 'i1', name: 'Consulting', type: 'Service', hsn: '998313', unit: 'HRS',
        quantity: 2, rate: 500, tax_rate: 18, amount: 1000,
      },
    ],
    gst_mode: 'CGST_SGST',
    place_of_supply: '27',
    reverse_charge: false,
    discount_type: 'PERCENT',
    discount_rate: 0,
    tax_rate: 18,
    shipping: 0,
    other_charges: 0,
    round_off_enabled: false,
    amount_paid: 0,
    notes: '',
    terms: '',
    subtotal: 1000,
    discount_amount: 0,
    taxable_value: 1000,
    cgst_amount: 90,
    sgst_amount: 90,
    igst_amount: 0,
    tax_amount: 180,
    round_off: 0,
    total: 1180,
    balance_due: 1180,
    ...over,
  };
}

/** Inter-state, 999.50 @ 18% IGST = 179.91, total 1179.41 rounded to 1179 (round off -0.41). */
export const INVOICE_IGST_ROUNDED = makeInvoice({
  id: 'inv-2',
  invoice_number: 'INV/FY25-26/0002',
  issue_date: '2025-05-01',
  client: { ...ACME, id: 'c2', name: 'Delhi Buyer', gstin: '07BBBBB1111B1Z6', state_code: '07' },
  place_of_supply: '07',
  gst_mode: 'IGST',
  items: [
    { id: 'i2', name: 'Widget', type: 'Product', hsn: '8471', unit: 'NOS', quantity: 1, rate: 999.5, tax_rate: 18, amount: 999.5 },
  ],
  subtotal: 999.5,
  taxable_value: 999.5,
  cgst_amount: 0,
  sgst_amount: 0,
  igst_amount: 179.91,
  tax_amount: 179.91,
  round_off_enabled: true,
  round_off: -0.41,
  total: 1179,
  balance_due: 1179,
});

export const CREDIT_NOTE = makeInvoice({
  id: 'cn-1',
  invoice_number: 'CRN/FY25-26/0001',
  doc_type: 'CREDIT_NOTE',
  issue_date: '2025-06-10',
});

export const PAYMENTS: Payment[] = [
  { id: 'p1', invoice_id: 'inv-1', amount: 500, method: 'UPI', reference: 'UTR123', date: '2025-04-20' },
  { id: 'p2', invoice_id: 'inv-1', amount: 300, method: 'Cash', date: '2025-04-25' },
];

export const PURCHASE = {
  id: 'pb-1',
  bill_number: 'B-1',
  vendor_name: 'Supplies & Co',
  vendor_gstin: '29CCCCC2222C1Z7',
  bill_date: '2025-05-02',
  taxable_value: 2000,
  cgst_amount: 180,
  sgst_amount: 180,
  total: 2360,
};

export function fullSource(): ExportSource {
  return {
    invoices: [INVOICE_IGST_ROUNDED, makeInvoice(), CREDIT_NOTE],
    payments: PAYMENTS,
    clients: [ACME],
    items: [{ id: 'x', name: 'Consulting', hsn: '998313', unit: 'hrs', rate: 500, tax_rate: 18, type: 'Service' }],
    purchases: [PURCHASE],
    vendors: [],
  };
}

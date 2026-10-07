import { calculateInvoice } from '../../lib/invoice-calc';
import type { InvoiceItem, InvoiceRecord, SenderProfile } from '../../types/invoice';

/** Fictional data for the Design Studio's live preview — never persisted. */
export const SAMPLE_SENDER: SenderProfile = {
  companyName: 'Chartist Research Desk',
  companyTagline: 'Market research & advisory',
  companyEmail: 'hello@example.com',
  companyPhone: '+91 98765 43210',
  companyAddress: '12 Dalal Street, Fort\nMumbai, Maharashtra 400001',
  companyGstin: '27ABCDE1234F1Z5',
  pan: 'ABCDE1234F',
  companyWebsite: 'www.example.com',
  stateCode: '27',
  regLine: '',
  bankName: 'Sample Bank',
  accountName: 'Chartist Research Desk',
  accountNumber: '000123456789',
  ifsc: 'SAMP0000001',
  upiId: 'sample@upi',
};

const ITEMS: InvoiceItem[] = [
  { id: 's1', name: 'Quarterly research subscription', description: 'Equity + derivatives desk, 3 months', type: 'Service', hsn: '998399', unit: 'NOS', quantity: 1, rate: 12000, tax_rate: 18, discount_percent: 0, amount: 12000 },
  { id: 's2', name: 'Portfolio review session', description: '60-minute 1:1', type: 'Service', hsn: '998311', unit: 'HRS', quantity: 2, rate: 2500, tax_rate: 18, discount_percent: 10, amount: 5000 },
  { id: 's3', name: 'Printed market handbook', type: 'Goods', hsn: '490110', unit: 'PCS', quantity: 3, rate: 450, tax_rate: 5, discount_percent: 0, amount: 1350 },
];

export function buildSampleInvoice(extra: Partial<InvoiceRecord> = {}): InvoiceRecord {
  const base = {
    items: ITEMS,
    gst_mode: 'CGST_SGST' as const,
    discount_type: 'PERCENT' as const,
    discount_rate: 0,
    tax_rate: 18,
    shipping: 0,
    other_charges: 0,
    round_off_enabled: true,
    amount_paid: 0,
  };
  const totals = calculateInvoice(base);
  return {
    id: 'sample',
    invoice_number: 'INV/FY26-27/0042',
    doc_type: 'TAX_INVOICE',
    issue_date: '2026-04-12',
    due_date: '2026-04-27',
    status: 'Paid',
    currency: 'INR',
    template_id: 'classic_orange',
    client: {
      name: 'Aarav Mehta',
      company: 'Mehta Traders LLP',
      email: 'aarav@example.com',
      address: '45 Linking Road, Bandra West',
      city: 'Mumbai',
      zip: '400050',
      gstin: '27AAAAA0000A1Z5',
      phone: '+91 90000 11111',
      state: 'Maharashtra',
      state_code: '27',
    },
    sender: SAMPLE_SENDER,
    ...base,
    place_of_supply: '27',
    reverse_charge: false,
    notes: 'Thank you for your business.',
    terms: 'Payment due within 15 days. Late payments attract 1.5% monthly interest.',
    po_number: 'PO-2291',
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
    ...extra,
  };
}

/** An invoice with `count` line items — used to eyeball pagination. */
export function buildLongInvoice(count: number): InvoiceRecord {
  const items: InvoiceItem[] = Array.from({ length: count }, (_, i) => ({
    id: `l${i}`,
    name: `Line item ${i + 1} — consulting & analysis`,
    description: i % 4 === 0 ? 'Includes detailed write-up and follow-up call' : undefined,
    type: 'Service',
    hsn: i % 3 === 0 ? '998399' : '998311',
    unit: 'HRS',
    quantity: 1 + (i % 4),
    rate: 1000 + i * 125,
    tax_rate: i % 2 ? 18 : 12,
    discount_percent: i % 5 === 0 ? 5 : 0,
    amount: 0,
  }));
  const totals = calculateInvoice({
    items,
    gst_mode: 'CGST_SGST',
    discount_type: 'PERCENT',
    discount_rate: 0,
    tax_rate: 18,
    shipping: 0,
    other_charges: 0,
    round_off_enabled: true,
    amount_paid: 0,
  });
  return buildSampleInvoice({
    items,
    subtotal: totals.subtotal,
    discount_amount: totals.discount_amount,
    taxable_value: totals.taxable_value,
    cgst_amount: totals.cgst_amount,
    sgst_amount: totals.sgst_amount,
    tax_amount: totals.tax_amount,
    round_off: totals.round_off,
    total: totals.total,
    balance_due: totals.balance_due,
  });
}

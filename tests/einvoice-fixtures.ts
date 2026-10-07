import { gstinChecksumChar } from '../src/lib/gstin.ts';
import type { InvoiceRecord, InvoiceItem, SenderProfile } from '../src/types/invoice.ts';

export const gstin = (first14: string) => first14 + gstinChecksumChar(first14);

export const SELLER_GSTIN = gstin('27AABCU9603R1Z'); // Maharashtra
export const BUYER_MH = gstin('27AAACB2230M1Z');
export const BUYER_KA = gstin('29AABCT1332L1Z');

export const sender: SenderProfile = {
  companyName: 'Mr Chartist Research',
  companyTagline: '',
  companyEmail: 'billing@example.com',
  companyPhone: '+91 98765 43210',
  companyAddress: '12 Dalal Street, Fort, Mumbai, Maharashtra 400001',
  companyGstin: SELLER_GSTIN,
  companyWebsite: '',
  stateCode: '27',
  bankName: '',
  accountName: '',
  accountNumber: '',
  ifsc: '',
  upiId: '',
};

export function item(over: Partial<InvoiceItem> = {}): InvoiceItem {
  const quantity = over.quantity ?? 1;
  const rate = over.rate ?? 1000;
  return {
    id: 'i' + Math.random(),
    name: 'Widget',
    type: 'goods',
    hsn: '847130',
    unit: 'NOS',
    quantity,
    rate,
    tax_rate: 18,
    amount: quantity * rate,
    ...over,
  };
}

export function invoice(over: Partial<InvoiceRecord> = {}): InvoiceRecord {
  return {
    id: 'inv-1',
    invoice_number: 'INV/FY25-26/0001',
    doc_type: 'TAX_INVOICE',
    issue_date: '2025-06-18',
    due_date: '2025-07-02',
    status: 'Sent',
    currency: 'INR',
    template_id: 'classic_orange',
    client: {
      name: 'Acme Traders',
      company: 'Acme Traders Pvt Ltd',
      email: 'acc@acme.test',
      address: '5 MG Road',
      city: 'Mumbai',
      zip: '400002',
      gstin: BUYER_MH,
      state_code: '27',
    },
    sender,
    items: [item()],
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

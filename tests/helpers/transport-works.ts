/** R5-B test worlds: a GTA in Maharashtra, and a civil contractor billing a government department. */
import { resetStorage } from './shim.ts';
import { clientKA, clientMH, gstin, installSettings } from './world.ts';
import { localDb } from '../../src/lib/localDb.ts';
import type { InvoiceRecord } from '../../src/types/invoice.ts';

export function setupTransport(over: Record<string, unknown> = {}): void {
  resetStorage();
  installSettings({ industry_packs: ['transport'], ...over } as never);
  localDb.clients.upsert({ ...clientMH });
  localDb.clients.upsert({ ...clientKA });
  localDb.clients.upsert({ id: 'c-retail', name: 'Ramesh Kumar', email: '', address: 'Pune', city: 'Pune', zip: '', state_code: '27' });
}

export const DEPT = { id: 'c-pwd', name: 'PWD Division 3', email: '', address: 'Mumbai', city: 'Mumbai', zip: '', gstin: gstin('27AAAGP0100A1Z'), state_code: '27', gst_tds_deductor: true };

/** A works contractor with a two-line BOQ (contract value ₹11,50,000 before GST at 18%). */
export function setupWorks(over: Record<string, unknown> = {}): InvoiceRecord {
  resetStorage();
  installSettings({ industry_packs: ['works'], ...over } as never);
  localDb.clients.upsert({ ...DEPT });
  return localDb.invoices.save({
    id: 'boq1', invoice_number: '', doc_type: 'SALES_ORDER', issue_date: '2026-05-01', due_date: '2026-05-31', status: 'Sent', currency: 'INR', template_id: 't',
    client: { ...DEPT }, sender: localDb.settings.activeProfile(),
    items: [
      { id: 'l1', name: 'Earthwork excavation', boq_ref: '2.1', type: 'Service', hsn: '995411', unit: 'CUM', quantity: 1000, rate: 250, tax_rate: 18, amount: 250000 },
      { id: 'l2', name: 'PCC 1:4:8', boq_ref: '2.2', type: 'Service', hsn: '995411', unit: 'CUM', quantity: 200, rate: 4500, tax_rate: 18, amount: 900000 },
    ],
    gst_mode: 'CGST_SGST', place_of_supply: '27', reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0, tax_rate: 0,
    shipping: 0, other_charges: 0, round_off_enabled: false, amount_paid: 0, notes: '', terms: '',
    subtotal: 1150000, discount_amount: 0, taxable_value: 1150000, cgst_amount: 103500, sgst_amount: 103500, igst_amount: 0, tax_amount: 207000, round_off: 0, total: 1357000, balance_due: 1357000,
  } as InvoiceRecord);
}

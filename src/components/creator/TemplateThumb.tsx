import { memo, useMemo } from 'react';
import { TemplateEngine } from '../templates/TemplateEngine';
import { calculateInvoice } from '../../lib/invoice-calc';
import type { InvoiceItem, InvoiceRecord, SenderProfile } from '../../types/invoice';
import styles from './TemplateThumb.module.css';

const PAPER_W = 794;
const PAPER_H = 1123;
/** Same as `THUMB_SCALE` (editor-layout.ts); kept local so this lazy chunk shares nothing new with the editor. */
const SCALE = 0.18;

/** A tiny fictional document for tiles when the draft is still empty (never persisted). */
const SAMPLE_SENDER = { companyName: 'Your Business', companyAddress: 'Mumbai, Maharashtra', companyGstin: '27ABCDE1234F1Z5', stateCode: '27' } as SenderProfile;
const SAMPLE_ITEMS: InvoiceItem[] = [
  { id: 's1', name: 'Consulting', type: 'Service', hsn: '998311', unit: 'HRS', quantity: 4, rate: 2500, tax_rate: 18, discount_percent: 0, amount: 10000 },
  { id: 's2', name: 'Printed handbook', type: 'Goods', hsn: '490110', unit: 'PCS', quantity: 3, rate: 450, tax_rate: 5, discount_percent: 0, amount: 1350 },
];
const SAMPLE = {
  id: 'sample', invoice_number: 'INV/FY26-27/0042', doc_type: 'TAX_INVOICE', issue_date: '2026-04-12', due_date: '2026-04-27', status: 'Sent', currency: 'INR',
  template_id: 'classic_orange', client: { name: 'Aarav Mehta', email: '', address: 'Bandra West', city: 'Mumbai', zip: '400050', state: 'Maharashtra' },
  sender: SAMPLE_SENDER, items: SAMPLE_ITEMS, gst_mode: 'CGST_SGST', place_of_supply: '27', reverse_charge: false, discount_type: 'PERCENT', discount_rate: 0,
  tax_rate: 18, shipping: 0, other_charges: 0, round_off_enabled: true, amount_paid: 0, notes: '', terms: '',
} as unknown as InvoiceRecord;

/**
 * R3-C1 live template tile: the current draft (or a small sample when the draft is empty — the picker
 * passes `draft = null`) in this template at 0.18 scale, native look (no Design Studio overrides, so tiles
 * differ by template). Lazy; memoised by template id + draft hash.
 */
function TemplateThumbInner({ templateId, draft, sender }: { templateId: string; draft: InvoiceRecord | null; sender: SenderProfile | null; hash: string }) {
  const doc = useMemo(() => {
    const invoice = draft ?? SAMPLE;
    return { invoice, sender: (draft ? sender : null) ?? SAMPLE_SENDER, totals: calculateInvoice(invoice) };
  }, [draft, sender]);
  return (
    <span className={styles.live} aria-hidden="true">
      <span className={styles.sheet} style={{ width: PAPER_W, height: PAPER_H, transform: `scale(${SCALE})` }}>
        <TemplateEngine invoice={doc.invoice} sender={doc.sender} totals={doc.totals} templateId={templateId} einvoiceMeta={null} />
      </span>
    </span>
  );
}

export default memo(TemplateThumbInner, (a, b) => a.templateId === b.templateId && a.hash === b.hash);

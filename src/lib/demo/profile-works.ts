/**
 * R6-B4 works profile (works pack on): a three-line BOQ (a sales order with a 5% retention term), its first
 * measurement and the RA bill for it, linked to the BOQ as a progress stage the way `saveRaBill` links it. The 5%
 * retention is worked out here (not through the pack's modules, which stay in their own chunks); the test pins it to
 * `computeDeductions` / `withDeductions`. Pure.
 */
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { DeductionRule, RaMeasurement } from '../../types/transport-works-r5';
import type { DocLink } from '../documents';
import { applyTotals, type Demo, type DemoExtras } from '../demo-data';
import { round2 } from '../invoice-calc';
import { shiftDay } from '../dates';
import { buildInvoiceNumber, getIndianFY } from '../invoice-number';
import type { ProfileContext } from './profiles';

/** `YYYY-MM-DD` + whole months, day clamped (as `addMonthsDay` in works/measurements.ts; pinned by the test). */
export function plusMonths(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const t = y * 12 + (m - 1) + months;
  const ny = Math.floor(t / 12);
  const nm = (t % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, new Date(ny, nm, 0).getDate())).padStart(2, '0')}`;
}

const BOQ_LINES = [
  { ref: '1.1', name: 'Excavation in ordinary soil', unit: 'CUM', qty: 400, rate: 320, done: 0.6 },
  { ref: '2.1', name: 'PCC 1:4:8 below foundations', unit: 'CUM', qty: 60, rate: 5200, done: 0.5 },
  { ref: '3.1', name: 'Brick masonry in CM 1:6', unit: 'CUM', qty: 120, rate: 6100, done: 0.25 },
];

export function worksExtras({ today, base }: ProfileContext): DemoExtras {
  const client = base.clients[1];
  const template = base.invoices[0];
  const boqDay = shiftDay(today, -45);
  const raDay = shiftDay(today, -10);
  const rules: DeductionRule[] = [{ kind: 'retention', rate: 5, basis: 'taxable', label: 'Retention' }];
  const boqItems: InvoiceItem[] = BOQ_LINES.map((l, i) => ({
    id: `demo-boq-l${i + 1}`, name: l.name, description: '', type: 'Service', hsn: '995411', unit: l.unit, quantity: l.qty, rate: l.rate, tax_rate: 18, discount_percent: 0, amount: round2(l.qty * l.rate), boq_ref: l.ref,
  }));
  const common = { client: { ...client }, gst_mode: 'CGST_SGST' as const, place_of_supply: client.state_code ?? '27', discount_rate: 0, po_number: 'WO-DEMO-17', amount_paid: 0 };
  const boq: Demo<InvoiceRecord> = applyTotals({
    ...template,
    ...common,
    id: 'demo-boq-1',
    demo: true,
    doc_type: 'SALES_ORDER',
    invoice_number: buildInvoiceNumber('DEMOBOQ', getIndianFY(boqDay).label, 1),
    issue_date: boqDay,
    due_date: boqDay,
    status: 'Sent',
    items: boqItems,
    notes: 'Sample BOQ / work order (demo).',
    boq_terms: { deductions: rules, dlp_months: 12, work_order: 'WO-DEMO-17' },
    created_at: `${boqDay}T09:00:00.000Z`,
  } as Demo<InvoiceRecord>);

  const lines = BOQ_LINES.map((l, i) => ({ line_id: boqItems[i].id, this_qty: round2(l.qty * l.done), cumulative_qty: round2(l.qty * l.done) }));
  const stageItems: InvoiceItem[] = boqItems.map((it, i) => ({ ...it, id: `demo-ra1-l${i + 1}`, quantity: lines[i].this_qty, amount: round2(lines[i].this_qty * it.rate), progress_line_of: it.id }));
  const contract = boq.taxable_value;
  let bill: Demo<InvoiceRecord> = applyTotals({
    ...template,
    ...common,
    id: 'demo-ra-1',
    demo: true,
    doc_type: 'TAX_INVOICE',
    invoice_number: buildInvoiceNumber('DEMORA', getIndianFY(raDay).label, 1),
    issue_date: raDay,
    due_date: shiftDay(raDay, 30),
    status: 'Sent',
    items: stageItems,
    notes: `RA bill no. 1 — ${boq.invoice_number} · work order WO-DEMO-17\nSample RA bill (demo).`,
    created_at: `${raDay}T09:00:00.000Z`,
  } as Demo<InvoiceRecord>);
  // Retention 5% of the taxable value; net payable = total − retention (no RCM on a works contract bill).
  const retention = round2((bill.taxable_value * 5) / 100);
  bill = {
    ...bill,
    ra_deductions: [{ kind: 'retention', label: 'Retention 5%', base: bill.taxable_value, rate: 5, amount: retention }],
    ra_net_payable: round2(bill.total - retention),
    progress_of: { source_id: boq.id, basis: 'measured', value: round2((bill.taxable_value / (contract || 1)) * 100), stage: 1 },
    ra_no: 1,
    boq_id: boq.id,
    retention_release_on: plusMonths(raDay, 12),
  };
  const measurement: Demo<RaMeasurement> = { id: 'demo-ra-m1', demo: true, boq_id: boq.id, ra_no: 1, date: raDay, lines, invoice_id: bill.id, status: 'billed', created_at: `${raDay}T09:00:00.000Z` };
  const link: Demo<DocLink> = { id: 'demo-link-ra1', demo: true, from_id: boq.id, to_id: bill.id, relation: 'progress', created_at: `${raDay}T09:00:00.000Z` };
  return { invoices: [boq, bill], tables: { ra_measurements: [measurement], doc_links: [link] } };
}

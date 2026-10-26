/**
 * R6-B4 transport profile (transport pack on): a lorry, two consignment notes (LRs) carried on one trip, and the
 * freight bill for the delivered one. The bill is the shape Transport → Create bill makes under the default GTA option
 * (reverse charge, the registered consignor liable: SAC and rate from `transport-works-rules.ts`); built here without
 * the pack's modules so they stay in their own chunks — `tests/demo-data.test.ts` pins it to `buildFreightBill` and
 * `derivedLiable`. Pure.
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { ConsignmentNote, Trip, Vehicle } from '../../types/transport-works-r5';
import { applyTotals, type Demo, type DemoExtras } from '../demo-data';
import { deriveGstMode, round2 } from '../invoice-calc';
import { shiftDay } from '../dates';
import { buildInvoiceNumber, getIndianFY } from '../invoice-number';
import { gtaRate, gtaSac } from '../transport-works-rules';
import type { ProfileContext } from './profiles';

export function transportExtras({ today, base }: ProfileContext): DemoExtras {
  const [consignor, consignee] = base.clients;
  const vehicle: Demo<Vehicle> = {
    id: 'demo-vehicle-1',
    demo: true,
    reg_no: 'MH 12 AB 1234',
    own: true,
    type: '10-wheeler (demo)',
    capacity_kg: 16000,
    docs: [{ kind: 'insurance', number: 'DEMO-INS-1', expires_on: shiftDay(today, 200) }],
    created_at: `${shiftDay(today, -60)}T00:00:00.000Z`,
  };
  const lrDay = (n: number) => shiftDay(today, -12 + n * 3);
  const lr = (n: number): Demo<ConsignmentNote> => {
    const date = lrDay(n);
    const weight = 800 + n * 200;
    return {
      id: `demo-lr-${n + 1}`,
      demo: true,
      number: buildInvoiceNumber('DEMOLR', getIndianFY(date).label, n + 1),
      date,
      from: { place: 'Pune', state: '27' },
      to: { place: 'Bengaluru', state: '29' },
      consignor_id: consignor.id!,
      consignee_id: consignee.id!,
      lines: [{ description: n ? 'Packaging cartons' : 'Printed brochures', packages: 40 + n * 10, actual_weight: weight, charged_weight: weight, value: 120000 + n * 40000 }],
      vehicle_id: vehicle.id,
      vehicle_no: vehicle.reg_no,
      driver: 'Sample Driver',
      basis: 'per_kg',
      rate: 6,
      charges: [{ kind: 'loading', amount: 500 }],
      // To be billed to the consignor, a registered company: under the default GTA option (reverse charge) the
      // recipient pays the GST.
      payment_basis: 'tbb',
      liable: 'recipient',
      status: n ? 'in_transit' : 'delivered',
      trip_id: 'demo-trip-1',
      ...(n ? {} : { pod: { delivered_on: shiftDay(date, 2), received_by: 'Stores (demo)' } }),
      created_at: `${date}T08:00:00.000Z`,
    };
  };
  const lrs = [lr(0), lr(1)];
  const trip: Demo<Trip> = {
    id: 'demo-trip-1',
    demo: true,
    number: buildInvoiceNumber('DEMOTRP', getIndianFY(lrDay(0)).label, 1),
    vehicle_id: vehicle.id,
    driver: 'Sample Driver',
    start_date: lrDay(0),
    start_km: 120400,
    route: 'Pune → Bengaluru',
    lr_ids: lrs.map((l) => l.id),
    advance_ids: [],
    status: 'open',
    created_at: `${lrDay(0)}T07:00:00.000Z`,
  };

  // The freight bill for the delivered LR (reverse charge: the recipient pays the GST, so it is not collected).
  const first = lrs[0];
  const billDay = shiftDay(first.pod!.delivered_on, 1);
  const freight = round2(first.rate * (first.lines[0].charged_weight ?? 0) + first.charges.reduce((s, c) => s + c.amount, 0));
  const pos = consignor.gstin?.slice(0, 2) || '27';
  const bill: Demo<InvoiceRecord> = applyTotals({
    ...base.invoices[0],
    id: 'demo-freight-1',
    demo: true,
    doc_type: 'TAX_INVOICE',
    invoice_number: buildInvoiceNumber('DEMOFR', getIndianFY(billDay).label, 1),
    issue_date: billDay,
    due_date: shiftDay(billDay, 15),
    status: 'Sent',
    client: { ...consignor },
    items: [{
      id: 'demo-freight-1-l1', name: `Freight — LR ${first.number}`, description: `${first.number} / ${first.date}, Pune → Bengaluru, 40 pkgs, 800 kg`,
      type: 'Service', hsn: gtaSac(billDay), unit: 'TRIP', quantity: 1, rate: freight, tax_rate: gtaRate('rcm', billDay).rate, discount_percent: 0, amount: freight,
    }],
    place_of_supply: pos,
    gst_mode: deriveGstMode({ senderStateCode: base.profile.stateCode, placeOfSupply: pos, senderHasGstin: true, taxEnabled: true }),
    reverse_charge: true,
    rcm_tax_excluded: true,
    discount_rate: 0,
    po_number: undefined,
    amount_paid: 0,
    lr_ids: [first.id],
    notes: 'Freight bill for 1 consignment note(s).\nGST payable by: the recipient (reverse charge).\nSample freight bill (demo).',
    created_at: `${billDay}T10:00:00.000Z`,
  } as Demo<InvoiceRecord>);
  lrs[0] = { ...first, bill_id: bill.id, status: 'billed' };
  return { invoices: [bill], tables: { vehicles: [vehicle], consignment_notes: lrs, trips: [trip] } };
}

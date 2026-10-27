/**
 * R9 (RT-A1) retail sample rows, per shop profile — Demo company only (loaded through `loadDemoData`, which refuses
 * outside the marked Demo company). The shop is read from the Demo company's packs (pharmacy / apparel / electronics /
 * jewellery), else grocery for a kirana counter. One block per package (§6 of docs/prd/round-9.md): RT-A writes the
 * grocery block; RT-B … RT-E fill their own block functions. Pure. Extra tables must be in `DEMO_EXTRA_TABLES`.
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { AlterationJob, DeliveryRider, Doctor, ImeiCheck, RxRefill, ServiceJob, ShortBookEntry } from '../../types/retail-r9';
import type { StockItem } from '../inventory';
import { applyTotals, type Demo, type DemoExtras } from '../demo-data';
import { shiftDay } from '../dates';
import { buildInvoiceNumber, getIndianFY } from '../invoice-number';
import type { ProfileContext } from './profiles';

export type RetailDemoKind = 'grocery' | 'pharmacy' | 'apparel' | 'electronics' | 'jewellery';

/** The shop a Demo company shows: its retail pack, else grocery for a kirana counter (undefined otherwise). */
export function retailDemoKind(ctx: Pick<ProfileContext, 'packs' | 'businessType'>): RetailDemoKind | undefined {
  for (const k of ['pharmacy', 'apparel', 'electronics', 'jewellery'] as const) if (ctx.packs.includes(k)) return k;
  return ctx.businessType === 'kirana' ? 'grocery' : undefined;
}

/** Merge extras blocks (rows of the same table are appended). */
export function mergeExtras(...parts: DemoExtras[]): DemoExtras {
  const out: DemoExtras = { invoices: [], payments: [], tables: {} };
  for (const p of parts) {
    out.invoices!.push(...(p.invoices ?? []));
    out.payments!.push(...(p.payments ?? []));
    for (const [k, rows] of Object.entries(p.tables ?? {})) {
      const key = k as keyof NonNullable<DemoExtras['tables']>;
      out.tables![key] = [...(out.tables![key] ?? []), ...(rows ?? [])];
    }
  }
  return out;
}

/* ── RT-A: grocery / supermarket — a loose (by weight) item, a rider, a COD delivery order, a short-book row ── */
function groceryBlock({ today, base }: ProfileContext): DemoExtras {
  const loose: Demo<StockItem> = {
    id: 'demo-stock-loose-rice', demo: true, name: 'Loose rice (demo)', hsn: '1006', unit: 'KG', track_stock: true,
    opening_qty: 200, opening_rate: 42, reorder_level: 25, sale_rate: 58, tax_rate: 0, created_at: `${shiftDay(today, -60)}T00:00:00.000Z`,
  };
  const rider: Demo<DeliveryRider> = { id: 'demo-rider-1', demo: true, name: 'Raju (demo rider)', phone: '9800000001', active: true, created_at: `${shiftDay(today, -30)}T00:00:00.000Z` };
  const template = base.invoices[0];
  const fy = getIndianFY(today).label;
  const order = applyTotals({
    ...template,
    id: 'demo-delivery-1', demo: true, invoice_number: buildInvoiceNumber('DEMODLV', fy, 1), issue_date: today, due_date: today, status: 'Sent',
    client: { id: 'demo-walkin-dlv', name: 'Mrs. Sharma (demo)', email: '', address: '12 Park Lane, Mumbai', city: 'Mumbai', zip: '', state_code: '27', phone: '9800000002' },
    items: [{ id: 'demo-delivery-1-l1', name: loose.name, type: 'Goods', hsn: '1006', unit: 'KG', quantity: 5, rate: 58, tax_rate: 0, discount_percent: 0, amount: 290 }],
    gst_mode: 'CGST_SGST', place_of_supply: '27', discount_rate: 0, amount_paid: 0, pos: true,
    delivery: { address: '12 Park Lane, Mumbai', phone: '9800000002', slot: '6–8 pm', rider_id: rider.id, status: 'out', cod: true },
    notes: 'Sample home-delivery order (demo).',
  } as Demo<InvoiceRecord>);
  const short: Demo<ShortBookEntry> = { id: 'demo-short-1', demo: true, date: today, name: 'Basmati rice 5 kg (demo)', qty: 2, customer: 'Mrs. Sharma (demo)', phone: '9800000002', status: 'open', created_at: `${today}T09:00:00.000Z` };
  return { invoices: [order], tables: { stock_items: [loose], delivery_riders: [rider], short_book: [short] } };
}

/* ── RT-B: pharmacy (scheduled drugs, two doctors, an Rx bill, a refill) ── */
function pharmacyBlock({ today, base }: ProfileContext): DemoExtras {
  const at = (d: number) => `${shiftDay(today, d)}T00:00:00.000Z`;
  const azi = {
    id: 'demo-stock-azi', demo: true, name: 'Azithromycin 500 TAB (demo)', hsn: '3004', unit: 'TAB', track_stock: true, opening_qty: 90, opening_rate: 18,
    sale_rate: 23.5, tax_rate: 5, drug_schedule: 'H1', alt_units: [{ unit: 'STRIP', factor: 3 }], ceiling_prices: [{ from: shiftDay(today, -200), price_per_unit: 23.98 }], reorder_level: 0, created_at: at(-90),
  } as Demo<StockItem>; // drug_schedule: the 7U pharma field (pharma.ts)
  const para: Demo<StockItem> = {
    id: 'demo-stock-para', demo: true, name: 'Paracetamol 650 TAB (demo)', hsn: '3004', unit: 'TAB', track_stock: true, opening_qty: 300, opening_rate: 1.4,
    sale_rate: 2.04, tax_rate: 5, alt_units: [{ unit: 'STRIP', factor: 15 }], reorder_level: 0, created_at: at(-90),
  };
  const doctors: Demo<Doctor>[] = [
    { id: 'demo-doctor-1', demo: true, name: 'Dr. A. Mehta (demo)', qualification: 'MBBS, MD', reg_no: 'MMC 2011/04/1234', council: 'Maharashtra Medical Council', clinic: 'Mehta Clinic', phone: '9800000011', active: true, created_at: at(-60) },
    { id: 'demo-doctor-2', demo: true, name: 'Dr. S. Rao (demo)', qualification: 'MBBS', reg_no: 'MMC 2016/02/5678', council: 'Maharashtra Medical Council', active: true, created_at: at(-60) },
  ];
  const fy = getIndianFY(today).label;
  const day = shiftDay(today, -27);
  const bill = applyTotals({
    ...base.invoices[0],
    id: 'demo-rx-bill-1', demo: true, invoice_number: buildInvoiceNumber('DEMORX', fy, 1), issue_date: day, due_date: day, status: 'Paid', pos: true,
    client: { id: 'demo-walkin-rx', name: 'Mrs. Kulkarni (demo)', email: '', address: '4 Lake Road, Pune', city: 'Pune', zip: '', state_code: '27', phone: '9800000012' },
    items: [
      { id: 'demo-rx-bill-1-l1', name: azi.name, type: 'Goods', hsn: '3004', unit: 'TAB', quantity: 3, rate: 23.5, tax_rate: 5, discount_percent: 0, amount: 70.5 },
      { id: 'demo-rx-bill-1-l2', name: para.name, type: 'Goods', hsn: '3004', unit: 'TAB', quantity: 15, rate: 2.04, tax_rate: 5, discount_percent: 0, amount: 30.6 },
    ],
    gst_mode: 'CGST_SGST', place_of_supply: '27', discount_rate: 0,
    rx: { patient: 'Mrs. Kulkarni (demo)', patient_address: '4 Lake Road, Pune', prescriber: doctors[0].name, prescriber_reg: `${doctors[0].reg_no}, ${doctors[0].council}`, doctor_id: doctors[0].id, age: 58, gender: 'F', rx_no: 'MC-118', rx_date: day },
    notes: 'Sample prescription bill (demo).',
  } as Demo<InvoiceRecord>);
  bill.amount_paid = bill.total;
  const refill: Demo<RxRefill> = {
    id: 'demo-refill-1', demo: true, name: 'Mrs. Kulkarni (demo)', phone: '9800000012', items: [{ name: para.name, quantity: 15 }], every_days: 30,
    next_due: shiftDay(day, 30), invoice_id: bill.id, doctor_id: doctors[0].id, active: true, created_at: `${day}T10:00:00.000Z`,
  };
  return { invoices: [bill], tables: { stock_items: [azi, para], doctors, rx_refills: [refill] } };
}
/* ── RT-C: apparel (a 4 × 3 style, a band-crossing discount, an alteration) ── */
function apparelBlock({ today, base }: ProfileContext): DemoExtras {
  const at = `${shiftDay(today, -45)}T00:00:00.000Z`;
  const axes = [{ name: 'Size', values: ['S', 'M', 'L', 'XL'] }, { name: 'Colour', values: ['Red', 'Blue', 'Green'] }];
  const style: Demo<StockItem> = { id: 'demo-krt-104', demo: true, name: 'Kurta KRT-104 (demo)', sku: 'KRT-104', hsn: '6211', unit: 'PCS', track_stock: true, opening_qty: 0, opening_rate: 1400, reorder_level: 0, sale_rate: 2799, tax_rate: 18, gst_band: 'apparel', variant_axes: axes, created_at: at };
  const kids: Demo<StockItem>[] = axes[0].values.flatMap((size, i) => axes[1].values.map((colour, j) => ({
    id: `demo-krt-104-${size}-${colour}`.toLowerCase(), demo: true as const, name: `${style.name} - ${size} / ${colour}`, sku: `KRT-104-${size}-${colour.slice(0, 3).toUpperCase()}`, hsn: '6211', unit: 'PCS', track_stock: true,
    opening_qty: size === 'XL' && colour === 'Green' ? 0 : 2 + ((i + j) % 3), opening_rate: 1400, reorder_level: 1, sale_rate: 2799, tax_rate: 18, gst_band: 'apparel' as const, variant_of: style.id, variant_attrs: { Size: size, Colour: colour }, created_at: at,
  })));
  const fy = getIndianFY(today).label;
  // ₹2,799 less 15% = ₹2,379.15 per piece → the 5% band (from 22 Sep 2025; verify with your CA).
  const sale = applyTotals({
    ...base.invoices[0],
    id: 'demo-apparel-1', demo: true, invoice_number: buildInvoiceNumber('DEMOAPP', fy, 1), issue_date: today, due_date: today, status: 'Paid',
    client: { id: 'demo-walkin-app', name: 'Mr. Khan (demo)', email: '', address: '', city: 'Mumbai', zip: '', state_code: '27', phone: '9800000003' },
    items: [{ id: 'demo-apparel-1-l1', name: kids[4].name, type: 'Goods', hsn: '6211', unit: 'PCS', quantity: 1, rate: 2799, tax_rate: 5, discount_percent: 15, amount: 2379.15, band_rate: { kind: 'apparel', value_per_piece: 2379.15, rate: 5 } }],
    gst_mode: 'CGST_SGST', place_of_supply: '27', discount_rate: 0, amount_paid: 0, pos: true, notes: 'Festive 15% off: the price band is decided after the discount (demo).',
  } as Demo<InvoiceRecord>);
  sale.amount_paid = sale.total;
  const alteration: Demo<AlterationJob> = {
    id: 'demo-alt-1', demo: true, number: buildInvoiceNumber('DEMOALT', fy, 1), date: today, customer: 'Mr. Khan (demo)', phone: '9800000003', invoice_id: sale.id, invoice_number: sale.invoice_number,
    garment: 'Kurta KRT-104 M / Blue', notes: 'Sleeves 1 inch shorter', tailor_name: 'Imran (demo tailor)', due: shiftDay(today, 3), charge: 0, tailor_rate: 60, status: 'with_tailor', created_at: `${today}T10:00:00.000Z`,
  };
  return { invoices: [sale], tables: { stock_items: [style, ...kids], alteration_jobs: [alteration] } };
}
/* ── RT-D: electronics (phones with IMEIs, a finance sale, a buy-back) — filled by RT-D ── */
// Demo extras cannot hold purchases or vouchers, so the finance DO and the URD buy-back voucher are made from the desk:
// the sample has a finance-ready bill (loan part unpaid), a second-hand phone in the "Used goods" godown, a clear
// IMEI check and an open repair job.
function electronicsBlock({ today, base }: ProfileContext): DemoExtras {
  const at = `${shiftDay(today, -40)}T00:00:00.000Z`;
  const imeis = ['490154203237518', '353918052034572', '356938035643809'];
  const phone: Demo<StockItem> = { id: 'demo-redmi13', demo: true, name: 'Redmi 13 5G 8/128 (demo)', hsn: '8517', unit: 'NOS', track_stock: true, track_serials: true, serial_kind: 'imei', warranty_months: 12, opening_qty: 2, opening_rate: 11500, opening_serials: imeis.slice(0, 2), reorder_level: 1, sale_rate: 13999, tax_rate: 18, created_at: at };
  const used: Demo<StockItem> = { id: 'demo-iphone12-used', demo: true, name: 'iPhone 12 64GB (used) (demo)', hsn: '8517', unit: 'NOS', track_stock: true, track_serials: true, serial_kind: 'imei', second_hand: true, opening_qty: 1, opening_rate: 18000, opening_serials: [imeis[2]], reorder_level: 0, sale_rate: 22000, tax_rate: 18, created_at: at };
  const godown: Demo<{ id: string; name: string; kind: 'used' }> = { id: 'demo-godown-used', demo: true, name: 'Used goods (demo)', kind: 'used' };
  const fy = getIndianFY(today).label;
  const sale = applyTotals({
    ...base.invoices[0],
    id: 'demo-emi-1', demo: true, invoice_number: buildInvoiceNumber('DEMOEMI', fy, 1), issue_date: today, due_date: today, status: 'Partially Paid',
    client: { id: 'demo-walkin-emi', name: 'Mr. Iyer (demo)', email: '', address: '', city: 'Mumbai', zip: '', state_code: '27', phone: '9800000011' },
    items: [{ id: 'demo-emi-1-l1', name: 'LED TV 43" (demo)', type: 'Goods', hsn: '8528', unit: 'NOS', quantity: 1, rate: 35593.22, tax_rate: 18, discount_percent: 0, amount: 35593.22 }],
    gst_mode: 'CGST_SGST', place_of_supply: '27', discount_rate: 0, amount_paid: 8400, pos: true, notes: 'EMI sale (demo): ₹8,400 down payment; record the ₹33,600 loan on Inventory → Devices → Finance.',
  } as Demo<InvoiceRecord>);
  const check: Demo<ImeiCheck> = { id: 'demo-imei-check', demo: true, date: today, imei: imeis[2], result: 'clear', portal_ref: 'DEMO-REF-1', created_at: `${today}T09:00:00.000Z` };
  const job: Demo<ServiceJob> = {
    id: 'demo-svc-1', demo: true, number: buildInvoiceNumber('DEMOSVC', fy, 1), date: today, kind: 'phone', customer: 'Ms. Rao (demo)', phone: '9800000012', asset: { model: 'Redmi Note 12', serial: '358240051111110' },
    complaint: 'Broken screen', estimate: 3200, status: 'received', parts: [], labour: 0, due: shiftDay(today, 3), warranty: { status: 'none' }, history: [{ status: 'received', date: today }], created_at: `${today}T10:00:00.000Z`,
  };
  return {
    invoices: [sale],
    payments: [{ id: 'demo-emi-1-p1', demo: true, invoice_id: sale.id, amount: 8400, method: 'Cash', date: today, note: 'Down payment (demo)' }],
    tables: { stock_items: [phone, used], godowns: [godown], imei_checks: [check], service_jobs: [job] },
  };
}
/* ── RT-E: jewellery (today's rates, five tags, a sale with old gold) — filled by RT-E ── */
const jewelleryBlock = (ctx: ProfileContext): DemoExtras => (void ctx, {});

const BLOCKS: Readonly<Record<RetailDemoKind, (ctx: ProfileContext) => DemoExtras>> = {
  grocery: groceryBlock, pharmacy: pharmacyBlock, apparel: apparelBlock, electronics: electronicsBlock, jewellery: jewelleryBlock,
};

/** The retail rows of the Demo company's shop (empty for a non-retail company). */
export function retailExtras(ctx: ProfileContext): DemoExtras {
  const kind = retailDemoKind(ctx);
  return kind ? BLOCKS[kind](ctx) : {};
}

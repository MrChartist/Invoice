/**
 * R9 (RT-A1) retail sample rows, per shop profile — Demo company only (loaded through `loadDemoData`, which refuses
 * outside the marked Demo company). The shop is read from the Demo company's packs (pharmacy / apparel / electronics /
 * jewellery), else grocery for a kirana counter. One block per package (§6 of docs/prd/round-9.md): RT-A writes the
 * grocery block; RT-B … RT-E fill their own block functions. Pure. Extra tables must be in `DEMO_EXTRA_TABLES`.
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { AlterationJob, DeliveryRider, Doctor, JewelTag, Metal, MetalRate, RxRefill, ShortBookEntry } from '../../types/retail-r9';
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
const electronicsBlock = (ctx: ProfileContext): DemoExtras => (void ctx, {});
/* ── RT-E: jewellery (today's rates, five tags, a sale with old gold) — filled by RT-E ── */
function jewelleryBlock({ today, base }: ProfileContext): DemoExtras {
  const at = `${shiftDay(today, -20)}T00:00:00.000Z`;
  const board: [Metal, string, number, number][] = [['gold', '24K', 10200, 10000], ['gold', '22K', 9350, 9150], ['gold', '18K', 7650, 7400], ['silver', '925', 112, 100]];
  const rates: Demo<MetalRate>[] = board.map(([metal, purity, sale, buy]) => ({ id: `demo-rate-${metal}-${purity}`, demo: true, date: today, metal, purity, sale, buy, created_at: `${today}T09:00:00.000Z` }));
  const tagNos = ['JW-D001', 'JW-D002', 'JW-D003', 'JW-D004', 'JW-D005'];
  const item: Demo<StockItem> = { id: 'demo-stock-rings', demo: true, name: 'Rings 22K (demo)', hsn: '7113', unit: 'PCS', track_stock: true, track_serials: true, jewel: true, opening_qty: 5, opening_rate: 50000, opening_serials: tagNos, reorder_level: 0, tax_rate: 3, created_at: at };
  const weights = [[6.42, 0.38], [4.85, 0], [5.6, 0.25], [7.1, 0.5], [3.95, 0]];
  const tags: Demo<JewelTag>[] = tagNos.map((tag, i) => ({
    id: `demo-tag-${i + 1}`, demo: true, tag, item_id: item.id, item_name: item.name, metal: 'gold', purity: '22K', gross_wt: weights[i][0], stone_wt: weights[i][1], net_wt: Math.round((weights[i][0] - weights[i][1]) * 1000) / 1000,
    stone_value: weights[i][1] ? 4800 : 0, wastage_pct: 2, making: { basis: 'per_gram', value: 650 }, hallmark_charge: 45, ...(i === 4 ? {} : { huid: `AB12C${i}` }), created_at: at,
  }));
  const fy = getIndianFY(today).label;
  const t = tags[0];
  // 6.040 g × ₹9,350 + 2% wastage + ₹650/g making + ₹4,800 stones + ₹45 hallmarking = ₹66,374.48 (rt-jewel-line.ts).
  const line = {
    id: 'demo-jw-1-l1', name: item.name, type: 'Goods' as const, hsn: '7113', unit: 'PCS', quantity: 1, rate: 66374.48, tax_rate: 3, discount_percent: 0, amount: 66374.48, serials: [t.tag],
    jw: { tag: t.tag, metal: 'gold' as const, purity: '22K', gross_wt: t.gross_wt, stone_wt: t.stone_wt, net_wt: t.net_wt, rate: 9350, wastage_pct: 2, making: t.making, stone_value: t.stone_value, hallmark_charge: 45, huid: t.huid, bis: 'Purity of hallmarked jewellery can be verified at any BIS-recognised A&H centre.' },
  };
  const sale = applyTotals({
    ...base.invoices[0], id: 'demo-jw-1', demo: true, invoice_number: buildInvoiceNumber('DEMOJW', fy, 1), issue_date: today, due_date: today, status: 'Paid', pos: true,
    client: { id: 'demo-walkin-jw', name: 'Mrs. Iyer (demo)', email: '', address: '', city: 'Chennai', zip: '', state_code: '33', phone: '9800000021' },
    items: [line], gst_mode: 'CGST_SGST', place_of_supply: '33', discount_rate: 0, notes: 'Sample jewellery bill: 22K ring by tag, net weight × day rate + wastage + making + stones + hallmarking, GST 3% (demo).',
  } as Demo<InvoiceRecord>);
  sale.amount_paid = sale.total;
  return { invoices: [sale], tables: { stock_items: [item], metal_rates: rates, jewel_tags: tags } };
}

const BLOCKS: Readonly<Record<RetailDemoKind, (ctx: ProfileContext) => DemoExtras>> = {
  grocery: groceryBlock, pharmacy: pharmacyBlock, apparel: apparelBlock, electronics: electronicsBlock, jewellery: jewelleryBlock,
};

/** The retail rows of the Demo company's shop (empty for a non-retail company). */
export function retailExtras(ctx: ProfileContext): DemoExtras {
  const kind = retailDemoKind(ctx);
  return kind ? BLOCKS[kind](ctx) : {};
}

/**
 * R9 (RT-A1) retail sample rows, per shop profile — Demo company only (loaded through `loadDemoData`, which refuses
 * outside the marked Demo company). The shop is read from the Demo company's packs (pharmacy / apparel / electronics /
 * jewellery), else grocery for a kirana counter. One block per package (§6 of docs/prd/round-9.md): RT-A writes the
 * grocery block; RT-B … RT-E fill their own block functions. Pure. Extra tables must be in `DEMO_EXTRA_TABLES`.
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { DeliveryRider, ShortBookEntry } from '../../types/retail-r9';
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

/* ── RT-B: pharmacy (scheduled drugs, two doctors, an Rx bill, a refill) — filled by RT-B ── */
const pharmacyBlock = (ctx: ProfileContext): DemoExtras => (void ctx, {});
/* ── RT-C: apparel (a 4 × 3 style, a band-crossing discount, an alteration) — filled by RT-C ── */
const apparelBlock = (ctx: ProfileContext): DemoExtras => (void ctx, {});
/* ── RT-D: electronics (phones with IMEIs, a finance sale, a buy-back) — filled by RT-D ── */
const electronicsBlock = (ctx: ProfileContext): DemoExtras => (void ctx, {});
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

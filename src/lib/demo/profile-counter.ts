/**
 * R6-B4 counter profile (kirana / restaurant): the sample goods as stock items with an opening quantity, six paid POS
 * bills over the last three days and yesterday's closed cashier shift. Pure.
 */
import type { InvoiceItem, InvoiceRecord, Payment } from '../../types/invoice';
import type { PosShift } from '../pos-shifts';
import type { StockItem } from '../inventory';
import { applyTotals, type Demo, type DemoExtras } from '../demo-data';
import { round2 } from '../invoice-calc';
import { shiftDay } from '../dates';
import { buildInvoiceNumber, getIndianFY } from '../invoice-number';
import type { ProfileContext } from './profiles';

export const DEMO_OPENING_QTY = 300;
const WALK_IN = { id: 'demo-walkin', name: 'Walk-in customer (demo)', email: '', address: '', city: 'Mumbai', zip: '', state_code: '27' };

export function counterExtras({ today, base }: ProfileContext): DemoExtras {
  const goods = base.items.filter((i) => i.type === 'Goods');
  const stock: Demo<StockItem>[] = goods.map((g, i) => ({
    id: `demo-stock-${i + 1}`,
    demo: true,
    name: g.name,
    hsn: g.hsn,
    unit: g.unit || 'NOS',
    track_stock: true,
    opening_qty: DEMO_OPENING_QTY,
    opening_rate: round2(g.rate * 0.6),
    reorder_level: 20,
    sale_rate: g.rate,
    tax_rate: g.tax_rate,
    created_at: `${shiftDay(today, -180)}T00:00:00.000Z`,
  }));

  const template = base.invoices[0];
  const invoices: Demo<InvoiceRecord>[] = [];
  const payments: Demo<Payment>[] = [];
  const seq = new Map<string, number>();
  for (let n = 0; n < 6; n++) {
    const day = shiftDay(today, -(2 - Math.floor(n / 2)));
    const fy = getIndianFY(day).label;
    const no = (seq.get(fy) ?? 0) + 1;
    seq.set(fy, no);
    const id = `demo-pos-${n + 1}`;
    const picks = [goods[n % goods.length], goods[(n + 1) % goods.length]].slice(0, 1 + (n % 2));
    const items: InvoiceItem[] = picks.map((g, li) => {
      const { demo: _d, ...line } = g;
      void _d;
      const qty = 1 + ((n + li) % 3);
      return { ...line, id: `${id}-l${li + 1}`, quantity: qty, amount: round2(qty * line.rate) };
    });
    const draft = applyTotals({
      ...template,
      id,
      demo: true,
      invoice_number: buildInvoiceNumber('DEMOPOS', fy, no),
      issue_date: day,
      due_date: day,
      status: 'Sent',
      client: { ...WALK_IN },
      items,
      gst_mode: 'CGST_SGST',
      place_of_supply: '27',
      discount_rate: 0,
      po_number: undefined,
      amount_paid: 0,
      notes: 'Sample counter bill (demo).',
      pos: true,
      created_at: `${day}T${String(10 + n).padStart(2, '0')}:00:00.000Z`,
    } as Demo<InvoiceRecord>);
    payments.push({ id: `demo-pos-pay-${n + 1}`, demo: true, invoice_id: id, amount: draft.total, method: n % 2 ? 'UPI' : 'Cash', note: 'Sample counter payment', date: day });
    invoices.push(applyTotals({ ...draft, amount_paid: draft.total, status: 'Paid' }));
  }

  const yesterday = shiftDay(today, -1);
  const yBills = invoices.filter((i) => i.issue_date === yesterday);
  const cash = round2(yBills.filter((_, i) => i % 2 === 0).reduce((s, b) => s + b.total, 0));
  const upi = round2(yBills.filter((_, i) => i % 2 === 1).reduce((s, b) => s + b.total, 0));
  const shift: Demo<PosShift> = {
    id: 'demo-shift-1',
    demo: true,
    day: yesterday,
    number: 1,
    user_id: 'owner',
    user_name: 'Owner',
    opened_at: `${yesterday}T03:30:00.000Z`,
    opening_float: 2000,
    bill_ids: yBills.map((b) => b.id),
    closed_at: `${yesterday}T15:30:00.000Z`,
    expected_cash: round2(2000 + cash),
    counted_cash: round2(2000 + cash),
    difference: 0,
    totals: { bills: yBills.length, net: round2(cash + upi), cash, upi, card: 0, other: 0, credit: 0, returns: 0, cash_refunds: 0 },
    note: 'Sample shift (demo)',
  };
  return { invoices, payments, tables: { stock_items: stock, pos_shifts: [shift] } };
}

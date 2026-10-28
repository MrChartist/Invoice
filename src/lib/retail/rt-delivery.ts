/**
 * RT-A3: home-delivery / phone orders and rider cash (COD) settlement.
 *
 *  - A delivery order is a normal sale invoice with the snapshot `delivery` (address, slot, rider, status, COD). Its
 *    status runs new → packed → out → delivered, or returned / cancelled (`moveDelivery`).
 *  - **Cash on delivery**: marking a COD order *delivered* records the receipt on the bill as a normal payment (method
 *    Cash, dated the delivery day) tagged `rider_id`. The cash really moved — into the rider's hands — so it is NOT a
 *    `movedNoCash` row: the ledger posts it to the user ledger "Cash with riders" (Cash & bank group, created on first
 *    use) instead of counter cash, the Z report keeps it out of the drawer and shows it on its own line.
 *  - **Rider settlement** (`rider_settlements`, `payment.record`, dated): expected = the rider's COD receipts not yet
 *    settled; saving posts Dr Cash / Cr Cash with riders (`saveVoucher`); a shortage / excess goes to a ledger the user
 *    picks (never silently). Cash readers see the money once: the receipt in "Cash with riders", the settlement in Cash.
 *  - A returned order: one click makes the goods-returned credit note (`documents.createCreditNote`).
 * Working paper — verify with your CA (RT6).
 */
import './rt-registry';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import type { DeliveryInfo, DeliveryRider, DeliveryStatus, RiderSettlement } from '../../types/retail-r9';
import { num, round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { KEYS, generateId, getTable, setTable } from '../storage';
import { localDb } from '../localDb';
import { assertUnlocked } from '../period-lock';
import { withTablesRollback } from '../table-txn';
import { deleteVoucher, saveVoucher } from '../ledger/vouchers';
import { A } from '../ledger/accounts';
import { ensureLedger } from '../trade/tr-ledger';
import { RIDER_CASH_LEDGER, RT_TABLES } from './rt-shared';
import { cashWithRiders } from '../pos';

export { cashWithRiders };

export const RIDERS_TABLE = RT_TABLES.deliveryRiders;
export const SETTLEMENTS_TABLE = RT_TABLES.riderSettlements;

/* ── Pure ───────────────────────────────────────────────────────────────────────────────────────────── */

/** The next step of the flow (null at the end). Returned / cancelled are side exits. */
export const NEXT_STATUS: Readonly<Record<DeliveryStatus, DeliveryStatus | null>> = {
  new: 'packed', packed: 'out', out: 'delivered', delivered: null, returned: null, cancelled: null,
};

/** May an order go from `from` to `to`? Forward one step, or returned (once out) / cancelled (before delivery). */
export function canMove(from: DeliveryStatus, to: DeliveryStatus): boolean {
  if (NEXT_STATUS[from] === to) return true;
  if (to === 'returned') return from === 'out' || from === 'delivered';
  if (to === 'cancelled') return from === 'new' || from === 'packed';
  return false;
}

/** Normalise a delivery snapshot from the strip (address required; status defaults to `new`). */
export function cleanDelivery(d: Partial<DeliveryInfo> | null | undefined): DeliveryInfo | undefined {
  if (!d || !String(d.address ?? '').trim()) return undefined;
  const status: DeliveryStatus = d.status && d.status in NEXT_STATUS ? d.status : 'new';
  return {
    address: String(d.address).trim(),
    status,
    ...(d.phone?.trim() ? { phone: d.phone.trim() } : {}),
    ...(d.slot?.trim() ? { slot: d.slot.trim() } : {}),
    ...(d.rider_id ? { rider_id: d.rider_id } : {}),
    ...(num(d.charge) > 0 ? { charge: round2(num(d.charge)) } : {}),
    ...(d.cod ? { cod: true } : {}),
    ...(d.note?.trim() ? { note: d.note.trim() } : {}),
  };
}

/**
 * The delivery charge as a normal line at the goods' rate and HSN (the highest-value goods line: a charge for
 * delivering goods is part of their value, G5 / RT6). Undefined without a charge.
 */
export function deliveryChargeLine(items: readonly { name: string; hsn?: string; tax_rate?: number; quantity?: number; rate?: number }[], charge: number, id = generateId()) {
  if (!(num(charge) > 0)) return undefined;
  const main = [...items].filter((i) => i.name.trim()).sort((a, b) => num(b.quantity) * num(b.rate) - num(a.quantity) * num(a.rate))[0];
  return { id, name: 'Delivery charge', description: '', type: 'Service', hsn: main?.hsn ?? '', unit: 'OTH', quantity: 1, rate: round2(num(charge)), tax_rate: num(main?.tax_rate), discount_percent: 0, amount: round2(num(charge)) };
}

export interface DeliveryRow {
  invoice: InvoiceRecord;
  delivery: DeliveryInfo;
  /** Still to collect on the bill (COD orders). */
  toCollect: number;
}

/** Live delivery orders (not cancelled invoices), newest first. */
export function deliveryRows(invoices: readonly InvoiceRecord[]): DeliveryRow[] {
  return invoices
    .filter((i) => i?.delivery && i.status !== 'Cancelled' && i.doc_type !== 'CREDIT_NOTE')
    .map((i) => ({ invoice: i, delivery: i.delivery as DeliveryInfo, toCollect: Math.max(round2(num(i.balance_due)), 0) }))
    .sort((a, b) => b.invoice.issue_date.localeCompare(a.invoice.issue_date) || b.invoice.invoice_number.localeCompare(a.invoice.invoice_number));
}

/** COD receipts a rider holds up to `day` (cash, tagged, not yet settled). */
export function riderOpenReceipts(payments: readonly Payment[], settlements: readonly RiderSettlement[], riderId: string, day: string): Payment[] {
  const done = new Set(settlements.flatMap((s) => s.payment_ids));
  return payments.filter((p) => p.rider_id === riderId && p.date <= day && !done.has(p.id) && String(p.method).toLowerCase() === 'cash');
}

/** The settlement journal lines (paise): Dr Cash counted, Cr Cash with riders expected, the difference to `diffAcc`. */
export function settlementLines(expected: number, counted: number, riderAcc: string, diffAcc?: string): { account_id: string; dr: number; cr: number }[] {
  const e = Math.round(round2(expected) * 100);
  const c = Math.round(round2(counted) * 100);
  const d = c - e;
  if (d !== 0 && !diffAcc) throw new Error('Choose the ledger the shortage or excess goes to.');
  return [
    ...(c > 0 ? [{ account_id: A.cash, dr: c, cr: 0 }] : []),
    ...(d < 0 ? [{ account_id: diffAcc!, dr: -d, cr: 0 }] : []),
    { account_id: riderAcc, dr: 0, cr: e },
    ...(d > 0 ? [{ account_id: diffAcc!, dr: 0, cr: d }] : []),
  ];
}

/* ── Storage ────────────────────────────────────────────────────────────────────────────────────────── */

export const loadRiders = (): DeliveryRider[] => getTable<DeliveryRider>(RIDERS_TABLE).filter((r) => r && typeof r.id === 'string');
export const loadSettlements = (): RiderSettlement[] => getTable<RiderSettlement>(SETTLEMENTS_TABLE).filter((r) => r && typeof r.id === 'string');

/** Add or edit a rider (`master.edit`). */
export function saveRider(input: { id?: string; name: string; phone?: string; active?: boolean }): DeliveryRider {
  requireAccess('master.edit');
  const name = input.name.trim();
  if (!name) throw new Error('Enter the rider name.');
  const all = loadRiders();
  const now = new Date().toISOString();
  const prev = input.id ? all.find((r) => r.id === input.id) : undefined;
  const row: DeliveryRider = { id: prev?.id ?? generateId(), name, ...(input.phone?.trim() ? { phone: input.phone.trim() } : {}), active: input.active ?? true, created_at: prev?.created_at ?? now, updated_at: now };
  setTable(RIDERS_TABLE, prev ? all.map((r) => (r.id === prev.id ? row : r)) : [...all, row]);
  return row;
}

/** "Cash with riders" ledger id (created on first use, Cash & bank group). */
export const riderCashLedger = (): string => ensureLedger(RIDER_CASH_LEDGER, 'CASH_BANK', 3520);

const invoiceOf = (id: string): InvoiceRecord => {
  const inv = localDb.invoices.getById(id);
  if (!inv || !inv.delivery) throw new Error('This delivery order no longer exists.');
  return inv;
};

/**
 * Move an order to `status` on `day` (local). Delivered + COD: the balance is received as cash tagged with the rider
 * (and the "Cash with riders" ledger is created if missing). Returns the updated invoice and the receipt, if any.
 */
export function moveDelivery(invoiceId: string, status: DeliveryStatus, day: string, riderId?: string): { invoice: InvoiceRecord; receipt?: Payment } {
  requireAccess('doc.edit');
  const inv = invoiceOf(invoiceId);
  const d = inv.delivery as DeliveryInfo;
  if (!canMove(d.status, status)) throw new Error(`An order that is ${d.status} cannot be marked ${status}.`);
  const next: DeliveryInfo = { ...d, status, ...(riderId ? { rider_id: riderId } : {}), ...(status === 'delivered' || status === 'returned' ? { done_on: day } : {}) };
  const saved = localDb.invoices.save({ ...inv, delivery: next });
  let receipt: Payment | undefined;
  const due = round2(num(saved.balance_due));
  if (status === 'delivered' && next.cod && due > 0.004) {
    if (!next.rider_id) throw new Error('Pick the rider who collected the cash.');
    try {
      riderCashLedger();
    } catch {
      /* a clerk without books rights: the ledger is created at settlement; the receipt is still the rider's */
    }
    const row = localDb.payments.record({ invoiceId: saved.id, amount: due, method: 'Cash', date: day, note: 'COD' });
    const rows = getTable<Payment>(KEYS.transactions);
    setTable(KEYS.transactions, rows.map((p) => (p.id === row.id ? { ...p, rider_id: next.rider_id } : p)));
    receipt = { ...row, rider_id: next.rider_id };
  }
  return { invoice: localDb.invoices.getById(saved.id) ?? saved, receipt };
}

/** A returned order's goods-returned credit note (every line, full quantity); the note id is kept on the order. */
export async function returnedCreditNote(invoiceId: string): Promise<InvoiceRecord> {
  const inv = invoiceOf(invoiceId);
  if (inv.delivery?.status !== 'returned') throw new Error('Mark the order returned first.');
  if (inv.delivery.credit_note_id) throw new Error('The credit note was already made.');
  const { createCreditNote } = await import('../documents');
  const note = createCreditNote(inv, { lines: inv.items.filter((i) => num(i.quantity) > 0).map((i) => ({ itemId: i.id, quantity: num(i.quantity) })), reason: 'Delivery order returned', goodsReturned: true });
  const fresh = localDb.invoices.getById(inv.id) ?? inv;
  localDb.invoices.save({ ...fresh, delivery: { ...(fresh.delivery as DeliveryInfo), credit_note_id: note.id } });
  return note;
}

/** Settle a rider's cash up to `day`: posts the journal and stores the settlement row. */
export function settleRider(input: { riderId: string; day: string; counted: number; differenceAccountId?: string; note?: string }): RiderSettlement {
  requireAccess('payment.record');
  const rider = loadRiders().find((r) => r.id === input.riderId);
  if (!rider) throw new Error('Pick the rider.');
  const all = loadSettlements();
  const open = riderOpenReceipts(getTable<Payment>(KEYS.transactions), all, rider.id, input.day);
  if (!open.length) throw new Error('This rider holds no unsettled cash.');
  const expected = round2(open.reduce((s, p) => s + num(p.amount), 0));
  const counted = round2(num(input.counted));
  const id = generateId();
  assertUnlocked({ id, issue_date: input.day, invoice_number: `Rider ${rider.name}` }, 'create');
  const lines = settlementLines(expected, counted, riderCashLedger(), input.differenceAccountId);
  const v = saveVoucher({ type: 'JOURNAL', date: input.day, narration: `Cash settled by rider ${rider.name}: expected ₹${expected}, counted ₹${counted} — verify with your CA`, lines, voucher_class: RIDER_SETTLEMENT_CLASS });
  const returned = deliveryRows(localDb.invoices.getAll()).filter((r) => r.delivery.rider_id === rider.id && r.delivery.status === 'returned' && (r.delivery.done_on ?? '') <= input.day).map((r) => r.invoice.id);
  const row: RiderSettlement = {
    id, date: input.day, rider_id: rider.id, rider_name: rider.name, payment_ids: open.map((p) => p.id), expected, counted,
    difference: round2(counted - expected), ...(input.differenceAccountId && counted !== expected ? { difference_account_id: input.differenceAccountId } : {}),
    ...(returned.length ? { returned_ids: returned } : {}), voucher_id: v.id, voucher_number: v.number, ...(input.note?.trim() ? { note: input.note.trim() } : {}),
    created_at: new Date().toISOString(),
  };
  setTable(SETTLEMENTS_TABLE, [...all, row]);
  return row;
}

/** The journal class of a rider settlement (owned by `rider_settlements`: Books refuses to delete it on its own). */
export const RIDER_SETTLEMENT_CLASS = 'Rider settlement';

/**
 * QA10 R17: undo a settlement — the row and its journal go together (recycle bin; restored together), so the rider holds
 * the COD cash again. Refused inside a locked period (the journal's own delete check).
 */
export function undoSettlement(id: string): void {
  requireAccess('payment.record');
  const all = loadSettlements();
  const row = all.find((s) => s.id === id);
  if (!row) return;
  assertUnlocked({ id, issue_date: row.date, invoice_number: row.voucher_number ?? '' }, 'delete');
  withTablesRollback([SETTLEMENTS_TABLE, 'vouchers', 'transactions', 'invoices'], () => {
    setTable(SETTLEMENTS_TABLE, all.filter((s) => s.id !== id)); // first: the journal is then no longer owned
    if (row.voucher_id) deleteVoucher(row.voucher_id);
  });
}

/** Cash with riders now (live data), for the Z report line. */
export const liveCashWithRiders = (day: string): number => cashWithRiders(getTable<Payment>(KEYS.transactions), loadSettlements(), day);

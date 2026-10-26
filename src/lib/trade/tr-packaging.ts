/**
 * TR-A5 returnable packaging ledger: crates, cans, bardana given (out) and taken back (in) per party.
 *
 * Masters `packaging_types` (deposit / charge-if-lost per unit, HSN / GST of the crate); movements `packaging_moves`
 * (dated; from the editor strip, the bill modal or Distribution → Packaging). Balances per party × type as on a date,
 * FIFO ageing of the units not yet back, deposits held. A refundable **deposit** is not a supply: Dr Cash / Cr
 * "Packaging deposits" (a current liability), no GST; a refund reverses it. Units **not returned** are billed on a
 * draft invoice line "Crates not returned" at the charge rate with the crate's HSN and GST (a sale of the crate),
 * and an `in` move closes them. §8 Q16, TR8 — verify with your CA.
 */
import './tr-registry';
import type { Client, InvoiceRecord } from '../../types/invoice';
import type { PackagingMove, PackagingType } from '../../types/trade-r8';
import { calcInputFromRecord, calculateInvoice, deriveGstMode, num, round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { withTablesRollback } from '../table-txn';
import { localDb } from '../localDb';
import { isValidGstin } from '../gstin';
import { A } from '../ledger/accounts';
import { deleteVoucher } from '../ledger/vouchers';
import { makeDraft, senderStateCode } from '../../store/invoice-defaults';
import { TR_TABLES } from './tr-shared';
import { ensureLedger, postPair } from './tr-ledger';

const dayNumber = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / 86_400_000;

export const TYPES_TABLE = TR_TABLES.packagingTypes;
export const MOVES_TABLE = TR_TABLES.packagingMoves;
export const DEPOSIT_LEDGER = 'Packaging deposits';

export const loadPackTypes = (): readonly PackagingType[] => peekTable<PackagingType>(TYPES_TABLE).filter((r) => r && typeof r.id === 'string');
export const loadPackMoves = (): readonly PackagingMove[] => peekTable<PackagingMove>(MOVES_TABLE).filter((r) => r && typeof r.id === 'string');

export interface PackBalance {
  key: string;
  party_kind: PackagingMove['party_kind'];
  party_id?: string;
  party: string;
  type_id: string;
  out: number;
  in: number;
  balance: number;
  deposit: number;
  /** Units out longer than `ageDays` and not back (FIFO). */
  aged: number;
  oldest?: string;
}

/** Pure: balances per party × type as on `asOf` (FIFO ageing against `ageDays`). */
export function packBalances(moves: readonly PackagingMove[], asOf: string, ageDays = 60): PackBalance[] {
  const out = new Map<string, PackBalance & { q: { date: string; qty: number }[] }>();
  for (const m of [...moves].filter((x) => x.date <= asOf).sort((a, b) => a.date.localeCompare(b.date))) {
    const k = `${m.party_kind}|${m.party_id || m.party_name.trim().toLowerCase()}|${m.type_id}`;
    const b = out.get(k) ?? { key: k, party_kind: m.party_kind, party_id: m.party_id, party: m.party_name, type_id: m.type_id, out: 0, in: 0, balance: 0, deposit: 0, aged: 0, q: [] };
    b.out += num(m.out);
    b.in += num(m.in);
    b.deposit = round2(b.deposit + num(m.deposit));
    if (num(m.out) > 0) b.q.push({ date: m.date, qty: num(m.out) });
    for (let left = num(m.in); left > 0 && b.q.length; ) {
      const take = Math.min(left, b.q[0].qty);
      b.q[0].qty -= take;
      left -= take;
      if (b.q[0].qty <= 0) b.q.shift();
    }
    out.set(k, b);
  }
  const today = dayNumber(asOf);
  return [...out.values()].map(({ q, ...b }) => ({ ...b, balance: b.out - b.in, aged: q.filter((x) => today - dayNumber(x.date) > ageDays).reduce((t, x) => t + x.qty, 0), ...(q[0] ? { oldest: q[0].date } : {}) }));
}

export function savePackType(t: Omit<PackagingType, 'id'> & { id?: string }): PackagingType {
  requireAccess('master.edit');
  if (!t.name.trim()) throw new Error('Name the crate / bag type.');
  const all = getTable<PackagingType>(TYPES_TABLE);
  const row: PackagingType = { ...t, id: t.id || generateId(), name: t.name.trim(), deposit: round2(num(t.deposit)), charge_rate: round2(num(t.charge_rate)), returnable: t.returnable !== false };
  setTable(TYPES_TABLE, all.some((x) => x.id === row.id) ? all.map((x) => (x.id === row.id ? row : x)) : [...all, row]);
  return row;
}

export type MoveInput = Omit<PackagingMove, 'id' | 'voucher_id' | 'created_at'> & { cash_account?: string };

/** Record a movement; a deposit received (+) or refunded (−) posts its receipt / payment voucher. */
export function recordPackMove(input: MoveInput): PackagingMove {
  requireAccess('doc.create');
  if (!input.type_id || !input.party_name.trim()) throw new Error('Choose the party and the crate / bag type.');
  if (!(num(input.out) >= 0 && num(input.in) >= 0) || !(num(input.out) + num(input.in) > 0 || num(input.deposit))) throw new Error('Enter the quantity given or taken back.');
  const id = generateId();
  assertUnlocked({ id, issue_date: input.date, invoice_number: input.doc_no ?? '' }, 'create');
  const dep = round2(num(input.deposit));
  return withTablesRollback([MOVES_TABLE, 'vouchers', 'accounts'], () => {
    const cash = input.cash_account || A.cash;
    const ledger = dep ? ensureLedger(DEPOSIT_LEDGER, 'OTHER_CL', 2440) : '';
    const v = dep
      ? postPair(dep > 0
        ? { type: 'RECEIPT', date: input.date, dr: cash, cr: ledger, amount: dep, narration: `Packaging deposit from ${input.party_name.trim()} (refundable, no GST)`, cls: 'Packaging deposit' }
        : { type: 'PAYMENT', date: input.date, dr: ledger, cr: cash, amount: -dep, narration: `Packaging deposit refunded to ${input.party_name.trim()}`, cls: 'Packaging deposit' })
      : undefined;
    const { cash_account: _c, ...rest } = input;
    void _c;
    const row: PackagingMove = { ...rest, id, party_name: input.party_name.trim(), out: num(input.out), in: num(input.in), ...(dep ? { deposit: dep, voucher_id: v!.id } : { deposit: undefined }), created_at: new Date().toISOString() };
    setTable(MOVES_TABLE, [...getTable<PackagingMove>(MOVES_TABLE), row]);
    return row;
  });
}

/** QA8 T8: a charge movement whose invoice is gone (deleted) or cancelled no longer closes any crates. */
export const orphanCharge = (m: Pick<PackagingMove, 'charge_invoice_id'>, invoices: readonly Pick<InvoiceRecord, 'id' | 'status'>[]): boolean =>
  !!m.charge_invoice_id && !invoices.some((i) => i.id === m.charge_invoice_id && i.status !== 'Cancelled');

/** Movements that count (orphaned charge movements — their invoice deleted or cancelled — reopen the crates). */
export const activeMoves = (moves: readonly PackagingMove[], invoices: readonly Pick<InvoiceRecord, 'id' | 'status'>[] = peekTable<InvoiceRecord>('invoices')): PackagingMove[] =>
  moves.filter((m) => !orphanCharge(m, invoices));

/** Delete a movement (recycle bin through the watched table); its deposit voucher goes too. */
export function removePackMove(id: string): void {
  requireAccess('doc.create');
  const all = getTable<PackagingMove>(MOVES_TABLE);
  const m = all.find((x) => x.id === id);
  if (!m) return;
  if (m.charge_invoice_id && !orphanCharge(m, getTable<InvoiceRecord>('invoices'))) throw new Error('This movement closed crates billed on an invoice: cancel that invoice instead.');
  assertUnlocked({ id, issue_date: m.date, invoice_number: m.doc_no ?? '' }, 'delete');
  withTablesRollback([MOVES_TABLE, 'vouchers'], () => {
    if (m.voucher_id) deleteVoucher(m.voucher_id);
    setTable(MOVES_TABLE, all.filter((x) => x.id !== id));
  });
}

/** Pure: the draft invoice charging `qty` unreturned units of `t` to `client`. */
export function buildChargeInvoice(t: PackagingType, qty: number, client: Client, date: string, ctx: { settings: ReturnType<typeof localDb.settings.get>; sender: InvoiceRecord['sender']; lastSale?: Pick<InvoiceRecord, 'supply_type' | 'lut_number' | 'lut_date'> }): InvoiceRecord {
  const home = senderStateCode(ctx.sender);
  const pos = (isValidGstin(client.gstin ?? '') ? client.gstin!.slice(0, 2) : client.state_code) || home;
  const draft = makeDraft({ settings: ctx.settings, sender: ctx.sender, docType: isValidGstin(client.gstin ?? '') ? 'TAX_INVOICE' : 'INVOICE' });
  const rate = round2(num(t.charge_rate));
  const rec: InvoiceRecord = {
    ...draft, issue_date: date, due_date: date > draft.due_date ? date : draft.due_date, status: 'Draft', client: { ...client }, place_of_supply: pos,
    gst_mode: deriveGstMode({ senderStateCode: home, placeOfSupply: pos, senderHasGstin: !!ctx.sender?.companyGstin?.trim(), taxEnabled: true }),
    items: [{ id: generateId(), name: `${t.name} not returned`, description: 'Returnable packaging not returned — charged as a sale of the packaging (verify with your CA).', type: 'Goods', ...(t.hsn ? { hsn: t.hsn } : {}), unit: t.unit || 'NOS', quantity: qty, rate, tax_rate: num(t.tax_rate), discount_percent: 0, amount: round2(qty * rate) }],
  };
  // QA8 T6: an SEZ customer's crates follow the supply type of their latest sale (zero-rated under LUT / IGST).
  const sez = ctx.lastSale?.supply_type?.startsWith('SEZ') ? ctx.lastSale : undefined;
  if (sez) Object.assign(rec, { supply_type: sez.supply_type, gst_mode: 'IGST', ...(sez.lut_number ? { lut_number: sez.lut_number } : {}), ...(sez.lut_date ? { lut_date: sez.lut_date } : {}) });
  const x = calculateInvoice(calcInputFromRecord(rec, { amount_paid: 0 }));
  return { ...rec, subtotal: x.subtotal, discount_amount: x.discount_amount, taxable_value: x.taxable_value, cgst_amount: x.cgst_amount, sgst_amount: x.sgst_amount, igst_amount: x.igst_amount, tax_amount: x.tax_amount, round_off: x.round_off, total: x.total, balance_due: x.balance_due, cess_amount: x.cess_amount, tcs_amount: x.tcs_amount, tds_amount: x.tds_amount };
}

/** Bill `qty` unreturned units of a client's balance: a draft invoice and the `in` move that closes them. */
export function chargeUnreturned(b: Pick<PackBalance, 'party_id' | 'party' | 'type_id' | 'balance'>, qty: number, date: string): { invoice: InvoiceRecord; move: PackagingMove } {
  requireAccess('doc.create');
  const t = loadPackTypes().find((x) => x.id === b.type_id);
  const client = b.party_id ? localDb.clients.getById(b.party_id) : undefined;
  if (!t || !client) throw new Error('Only a customer from Clients can be charged.');
  if (!(qty > 0) || qty > b.balance) throw new Error(`Charge between 1 and ${b.balance} units.`);
  if (!(num(t.charge_rate) > 0)) throw new Error(`Set the charge-if-lost rate of ${t.name} first.`);
  return withTablesRollback(['invoices', MOVES_TABLE, 'items_catalog', 'series_counters', 'vouchers'], () => {
    const catalogue = peekTable<unknown>('items_catalog');
    const lastSale = localDb.invoices.getAll().filter((i) => i.client?.id === client.id && i.status !== 'Draft' && i.status !== 'Cancelled' && i.doc_type !== 'CREDIT_NOTE' && i.doc_type !== 'QUOTATION').sort((a, b) => b.issue_date.localeCompare(a.issue_date))[0];
    const invoice = localDb.invoices.save(buildChargeInvoice(t, qty, client, date, { settings: localDb.settings.get(), sender: localDb.settings.activeProfile(), lastSale }));
    if (peekTable<unknown>('items_catalog').length !== catalogue.length) setTable('items_catalog', catalogue as unknown[]);
    const move = recordPackMove({ date, party_kind: 'client', party_id: client.id, party_name: client.name, type_id: t.id, out: 0, in: qty, doc_id: invoice.id, doc_no: invoice.invoice_number, note: 'Charged as not returned' });
    setTable(MOVES_TABLE, getTable<PackagingMove>(MOVES_TABLE).map((m) => (m.id === move.id ? { ...m, charge_invoice_id: invoice.id } : m)));
    return { invoice, move: { ...move, charge_invoice_id: invoice.id } };
  });
}

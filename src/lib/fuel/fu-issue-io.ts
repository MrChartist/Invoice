/**
 * Round 21 issue bridge (`fu-*-io.ts`: the only fuel modules that reach shared lazy code). R21-B3 day close: every
 * closed shift of a day becomes ONE non-GST Bill of Supply of its counter litres ("Counter sales — fuel", `fu.shift_id`,
 * lines per tank × product), all written by ONE `localDb.invoices.saveMany`, then receipts by mode: cash → cash, UPI →
 * the chosen bank, card → "Card settlements clearing", fleet card / OMC loyalty → "Fleet-card receivable (OMC)"
 * (clearing accounts: never offered by `pickableBankAccounts` to cheques / BRS). An attendant's excess is kept
 * out of the receipts and shown as a note (the "Excess at pump" journal was cut at the R21-B cap, PRD §11 cut 2: post
 * it in Books as other income, FU29); a shortage stays open on the bill until `settleShort` records a cash receipt
 * from the attendant or a write-off row (no cash). Undo = the shift's receipts removed and its bill cancelled (the number
 * stays used), status back to `closed`. Working papers — verify with your CA (FU6, FU10, FU26, FU29).
 */
import './fu-registry';
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { FuelNozzle, FuelPrice, FuelSettings, FuelShift, FuLine } from '../../types/fuel-r21';
import { DB_PREFIX, generateId, getJson, getTable } from '../storage';
import { requireAccess } from '../access';
import { localDb } from '../localDb';
import { withTablesRollback } from '../table-txn';
import { calcInputFromRecord, calculateInvoice, round2 } from '../invoice-calc';
import { blankClient, makeDraft } from '../../store/invoice-defaults';
import { stockDb } from '../inventory';
import { bankAccountsDb, DEFAULT_BANK_ID } from '../bank-accounts';
import { WRITE_OFF_METHOD } from '../write-off';
import { FU_NAMES, FU_OBJECTS, FU_TABLES } from './fu-shared';
import { markShift, planShift, readShifts, type ShiftPlan } from './fu-dayclose';
import type { FuMode } from './fu-settle';
import { fbT } from '../../i18n/areas/fuel-r21b';

/** The data a plan reads (live). */
export const fuData = () => ({ nozzles: getTable<FuelNozzle>(FU_TABLES.nozzles), prices: getTable<FuelPrice>(FU_TABLES.prices), invoices: localDb.invoices.getAll(), slips: getTable<never>(FU_TABLES.slips) });
/** The stored fuel settings over the shift defaults (read directly: the A writers stay in the desk chunk). */
export const fuCfg = (): FuelSettings => ({ shift_count: 2, shift_starts: ['06:00', '14:00'], test_litres: 5, ...getJson<FuelSettings | null>(`${DB_PREFIX}${FU_OBJECTS.settings}`, null) });
/** A shift's live plan (refused with the reason). */
export const planOf = (s: FuelShift): ShiftPlan => planShift(s, fuData());
/** The shift's live Bill of Supply (day close), if any. */
export const shiftBill = (id: string): InvoiceRecord | undefined => localDb.invoices.getAll().find((i) => i.fu?.shift_id === id && i.status !== 'Cancelled');

const noteOf = (s: FuelShift) => `Pump shift ${s.date} #${s.shift_no}`;
const METHOD: Record<FuMode, string> = { cash: 'Cash', upi: 'UPI', card: 'Card', fleet: 'Fleet card', loyalty: 'OMC loyalty', credit: 'Credit slips' };

/** A clearing account by name (created once; not a real bank). */
function clearing(name: string): string {
  const hit = bankAccountsDb.all().find((a) => a.name.toLowerCase() === name.toLowerCase());
  if (hit) return (hit.clearing ? hit : bankAccountsDb.save({ ...hit, clearing: true })).id;
  return bankAccountsDb.save({ id: generateId(), name, active: true, clearing: true }).id;
}
const bankOf = (m: FuMode, upi: string): string | undefined => (m === 'cash' ? undefined : m === 'upi' ? upi : clearing(m === 'card' ? FU_NAMES.card : FU_NAMES.fleet));

function billOf(s: FuelShift, p: ShiftPlan, prices: readonly FuelPrice[]): InvoiceRecord | null {
  if (!p.lines.length) return null;
  const settings = localDb.settings.get();
  const items = stockDb.items();
  const cs = fuCfg().counter_client_id;
  const fu: Record<string, FuLine> = {};
  const lines: InvoiceItem[] = p.lines.map((l) => {
    const it = items.find((x) => x.id === l.item_id);
    const id = generateId();
    const pr = prices.find((x) => x.id === l.price_id);
    // QA25 W3: each line names the price row it was sold at (Rule 42 duty working, 3.1(e) check).
    fu[id] = { litres: l.litres, price_id: l.price_id, rsp: l.rsp, ...(pr ? { at: `${pr.date} ${pr.time}` } : {}), ...(it?.fu?.unit === 'KG' ? { unit: 'KG' as const } : {}) };
    return { id, name: it?.name ?? l.item_id, type: 'Goods', hsn: it?.hsn ?? '', unit: it?.unit ?? 'LTR', quantity: l.litres, rate: Math.round((l.amount / l.litres) * 1e6) / 1e6, amount: l.amount, tax_rate: 0, sv: { exempt: 'NON_GST' }, ...(l.tank_id ? { godown_id: l.tank_id } : {}) };
  });
  const rec: InvoiceRecord = {
    ...makeDraft({ settings, sender: localDb.settings.activeProfile() ?? null, docType: 'BILL_OF_SUPPLY', templateId: localDb.template.get() }),
    id: generateId(), issue_date: s.date, due_date: s.date, status: 'Sent', exempt_kind: 'NON_GST', gst_mode: 'NONE', supply_type: 'B2C', round_off_enabled: false, // the meter value is exact; collections settle it to the paisa
    client: { ...blankClient(), ...((cs && localDb.clients.getById(cs)) || { name: FU_NAMES.counter }) }, items: lines,
    notes: noteOf(s), fu: { shift_id: s.id, lines: fu },
  };
  const t = calculateInvoice(calcInputFromRecord(rec));
  return { ...rec, subtotal: t.subtotal, discount_amount: t.discount_amount, taxable_value: t.taxable_value, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, tax_amount: 0, cess_amount: 0, round_off: t.round_off, total: t.total, balance_due: t.balance_due };
}

/** Day close of `date`: every closed shift posted (one `saveMany`), receipts by mode (an excess stays out). Returns the bills. */
export function dayClose(date: string, o: { upiBank?: string } = {}): InvoiceRecord[] {
  requireAccess('doc.create');
  requireAccess('payment.record');
  const shifts = readShifts().filter((s) => s.date === date && s.status === 'closed');
  if (!shifts.length) throw new Error(fbT('eNothing'));
  const data = fuData();
  const plans = shifts.map((s) => ({ s, p: planShift(s, data) }));
  return withTablesRollback(['invoices', 'clients', 'items_catalog', 'transactions', 'bank_accounts', FU_TABLES.shifts], () => {
    const drafts = plans.map(({ s, p }) => ({ s, p, rec: billOf(s, p, data.prices) }));
    const saved = localDb.invoices.saveMany(drafts.flatMap((d) => (d.rec ? [d.rec] : [])));
    for (const { s, p, rec } of drafts) {
      const bill = rec && saved.find((x) => x.fu?.shift_id === s.id);
      const pay = { ...p.pay };
      // Receipts never exceed the bill: an overflow (credit typed below the slips) stays out like an excess.
      let over = round2(Object.values(pay).reduce((v, x) => v + (x ?? 0), 0) - (bill?.total ?? 0));
      for (const m of Object.keys(pay) as FuMode[]) {
        if (over <= 0.004) break;
        const cut = Math.min(pay[m] ?? 0, over);
        pay[m] = round2((pay[m] ?? 0) - cut);
        over = round2(over - cut);
      }
      if (bill) for (const [m, v] of Object.entries(pay) as [FuMode, number][]) if (v > 0.004) localDb.payments.record({ invoiceId: bill.id, amount: v, method: METHOD[m], date: s.date, note: noteOf(s), bankAccountId: bankOf(m, o.upiBank || DEFAULT_BANK_ID) });
      markShift(s.id, { status: 'posted' });
    }
    return saved;
  });
}

/** Settle attendant `idx`'s shortage on the posted shift: a cash receipt from them, or a write-off ("Shortage at pump"). */
export function settleShort(shiftId: string, idx: number, how: 'cash' | 'write_off'): void {
  requireAccess('payment.record');
  if (how === 'write_off') requireAccess('doc.deleteIssued');
  const s = readShifts().find((x) => x.id === shiftId);
  const bill = shiftBill(shiftId);
  if (!s || s.status !== 'posted' || !bill) throw new Error(fbT('eNotPosted'));
  if (s.settled?.some((x) => x.attendant === idx)) throw new Error(fbT('eSettled'));
  const a = planOf(s).people[idx];
  const amount = round2(Math.min(-(a?.diff ?? 0), Number(bill.balance_due) || 0));
  if (!(amount > 0.004)) throw new Error(fbT('eNoShort'));
  withTablesRollback(['transactions', 'invoices', FU_TABLES.shifts], () => {
    const p = localDb.payments.record({ invoiceId: bill.id, amount, date: s.date, method: how === 'cash' ? 'Cash' : WRITE_OFF_METHOD, writeOff: how === 'write_off', note: `${FU_NAMES.short}: ${a.name}` });
    markShift(s.id, { settled: [...(s.settled ?? []), { attendant: idx, how, payment_id: p.id, amount }] });
  });
}

/** Undo a posted shift: its receipts removed, its bill cancelled (number kept); back to `closed`. */
export function undoShift(shiftId: string): void {
  requireAccess('doc.create');
  const s = readShifts().find((x) => x.id === shiftId);
  if (!s || s.status !== 'posted') throw new Error(fbT('eNotPosted'));
  withTablesRollback(['transactions', 'invoices', FU_TABLES.shifts], () => {
    for (const b of localDb.invoices.getAll().filter((i) => i.fu?.shift_id === s.id && i.status !== 'Cancelled')) {
      for (const p of localDb.payments.listFor(b.id)) localDb.payments.remove(p.id);
      localDb.invoices.setStatus(b.id, 'Cancelled');
    }
    markShift(s.id, { status: 'closed', settled: undefined });
  });
}

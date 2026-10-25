/**
 * Storage side of the year-end wizard and the books integrity check (WP-7). Reads are fail-soft;
 * writes go through the guarded APIs (`saveVoucher`, `localDb.settings.save`, `setTable`).
 */

import { requireAccess } from './access';
import { checkBooksIntegrity, type IntegrityReport } from './books-integrity';
import { loadPositions } from './inventory';
import { loadAssets } from './ledger/assets';
import { A } from './ledger/accounts';
import { loadLedgerInput, buildLedger, loadVouchers, saveVoucher, loadOpenings, type ManualVoucher, type Ledger } from './ledger/index';
import { localDb } from './localDb';
import { loadOpeningBills } from './opening-bills';
import { getLockUntil } from './period-lock';
import { getTable, setTable } from './storage';
import { isoDay } from './dates';
import {
  CLOSING_STOCK_CLASS,
  YEAR_END_TABLE,
  fyEndOf,
  fyId,
  markStep,
  partyBalancesAt,
  yearEndChecklist,
  yearEndJournal,
  type YearEndRecord,
  type YearEndStep,
  type YearEndStepId,
} from './year-end';

export function loadIntegrity(ledger: Ledger = buildLedger(loadLedgerInput()), asOf?: string): IntegrityReport {
  const ids = (t: string) => getTable<{ id?: string }>(t).map((r) => String(r?.id ?? '')).filter(Boolean);
  return checkBooksIntegrity({
    ledger,
    invoices: getTable('invoices'),
    transactions: getTable('transactions'),
    purchases: getTable<unknown>('purchases'),
    purchasePayments: getTable('purchase_payments'),
    docLinks: getTable('doc_links'),
    openingBills: loadOpeningBills(),
    manualVoucherIds: loadVouchers().map((v) => v.id),
    clientIds: ids('clients'),
    vendorIds: ids('vendors'),
    openingSum: loadOpenings().reduce((s, o) => s + o.dr - o.cr, 0),
    ...(asOf ? { asOf } : {}),
  });
}

export function loadYearEndRecord(fyStart: number): YearEndRecord | undefined {
  return getTable<YearEndRecord>(YEAR_END_TABLE).find((r) => r?.id === fyId(fyStart));
}

export function saveYearEndMark(fyStart: number, step: YearEndStepId): YearEndRecord {
  requireAccess('books.edit');
  const all = getTable<YearEndRecord>(YEAR_END_TABLE);
  const next = markStep(all.find((r) => r?.id === fyId(fyStart)), fyStart, step, new Date().toISOString());
  setTable(YEAR_END_TABLE, [...all.filter((r) => r?.id !== next.id), next]);
  return next;
}

export interface YearEndState {
  steps: YearEndStep[];
  ledger: Ledger;
  integrity: IntegrityReport;
  manual: ManualVoucher[];
}

export function loadYearEnd(fyStart: number): YearEndState {
  const today = isoDay(new Date());
  const ledger = buildLedger(loadLedgerInput());
  const end = fyEndOf(fyStart);
  const integrity = loadIntegrity(ledger, end);
  let stock = { value: 0, items: 0 };
  try {
    const pos = loadPositions({ asOf: end });
    stock = { value: Math.round(pos.reduce((s, p) => s + (p.value > 0 ? p.value : 0), 0) * 100), items: pos.filter((p) => p.qty !== 0).length };
  } catch {
    /* no inventory */
  }
  const fyBegin = `${fyStart}-04-01`;
  // An opening bill from before this year counts as still open while its party carries a balance at year end.
  const debt = partyBalancesAt(ledger, A.debtors, end);
  const cred = partyBalancesAt(ledger, A.creditors, end);
  const old = loadOpeningBills().filter((b) => b.date < fyBegin && (b.side === 'payable' ? cred : debt).has(b.party_name));
  const manual = loadVouchers();
  const steps = yearEndChecklist({
    fyStart,
    ledger,
    integrity,
    closingStock: stock,
    assets: loadAssets(),
    manual,
    lockUntil: getLockUntil(),
    oldOpenBills: { count: old.length, amount: Math.round(old.reduce((s, b) => s + b.amount, 0) * 100) },
    record: loadYearEndRecord(fyStart),
    today,
  });
  return { steps, ledger, integrity, manual };
}

/** Post (or replace) the closing-stock journal on 31 March. */
export function postClosingStock(fyStart: number, valuePaise: number, reverse = true): ManualVoucher {
  const existing = loadVouchers().find((v) => v.voucher_class === CLOSING_STOCK_CLASS && v.date === fyEndOf(fyStart));
  const j = yearEndJournal('closing_stock', fyStart, [{ account_id: A.stock, amount: valuePaise }], reverse);
  return saveVoucher({ ...j, ...(existing ? { id: existing.id } : {}) });
}

/** Post a provisions journal on 31 March (Dr each expense | Cr Provisions). */
export function postProvisions(fyStart: number, lines: Array<{ account_id: string; amount: number }>, reverse = true): ManualVoucher {
  return saveVoucher(yearEndJournal('provision', fyStart, lines, reverse));
}

/** Lock the year: period lock up to 31 March (never moves an existing later lock back). Owner only. */
export function lockYear(fyStart: number): string {
  requireAccess('settings.manage');
  const end = fyEndOf(fyStart);
  const s = localDb.settings.get();
  if (s.lock_until && s.lock_until >= end) return s.lock_until;
  localDb.settings.save({ ...s, lock_until: end });
  return end;
}

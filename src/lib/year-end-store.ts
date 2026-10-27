/**
 * Storage side of the year-end wizard and the books integrity check (WP-7). Reads are fail-soft;
 * writes go through the guarded APIs (`saveVoucher`, `localDb.settings.save`, `setTable`).
 */

import { requireAccess } from './access';
import { checkBooksIntegrity, type IntegrityReport } from './books-integrity';
import { loadPositions, loadSettings as loadInventorySettings, type StockPosition } from './inventory';
import { loadClosingStockConfig, saveClosingStockConfig, stockValuerFor } from './ledger/closing-stock';
import { loadAssets } from './ledger/assets';
import { A } from './ledger/accounts';
import { loadLedgerInput, buildLedger, loadVouchers, saveVoucher, loadOpenings, type ManualVoucher, type Ledger } from './ledger/index';
import { localDb } from './localDb';
import { loadOpeningBills } from './opening-bills';
import { getLockUntil } from './period-lock';
import { getTable, setTable } from './storage';
import { isoDay } from './dates';
import type { InvoiceRecord } from '../types/invoice';
import { agencySales, loadArrivals } from './trade/tr-arrivals';
import { loadPattis, unsettledLots } from './trade/tr-patti';
import { rxRetainedInYear } from './retail/rt-pharmacy-registers';
import {
  CLOSING_STOCK_CLASS,
  YEAR_END_TABLE,
  fyEndOf,
  fyId,
  markStep,
  partyBalancesAt,
  yearEndChecklist,
  yearEndJournal,
  type YearEndInput,
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

/** QA8 T10: unsettled agency lots at `end` (undefined when the company has no arrivals), whatever the pack. */
export function loadAgencyLots(end: string): { number: string; lot_no: string; principal: string }[] | undefined {
  const arrivals = loadArrivals().filter((a) => a.date <= end);
  if (!arrivals.length) return undefined;
  const sales = agencySales(getTable<InvoiceRecord>('invoices')).filter((x) => x.date <= end);
  return unsettledLots(arrivals, sales, loadPattis().filter((p) => p.date <= end)).map((a) => ({ number: a.number, lot_no: a.lot_no, principal: a.principal_name }));
}

export interface YearEndState {
  steps: YearEndStep[];
  ledger: Ledger;
  integrity: IntegrityReport;
  manual: ManualVoucher[];
  /** Report-time closing-stock valuation in effect (absent when the inventory could not be read). */
  valuation?: YearEndInput['valuation'];
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
  let valuation: YearEndInput['valuation'];
  try {
    let all: StockPosition[] | undefined;
    const raw = stockValuerFor(loadClosingStockConfig(), () => (all ??= loadPositions()), loadInventorySettings().method);
    valuation = raw ? { mode: raw.mode, label: raw.label, value: raw.value(end) } : { mode: 'none', label: '', value: 0 };
  } catch {
    /* no inventory */
  }
  const fyBegin = `${fyStart}-04-01`;
  // An opening bill from before this year counts as still open while its party carries a balance at year end.
  const debt = partyBalancesAt(ledger, A.debtors, end);
  const cred = partyBalancesAt(ledger, A.creditors, end);
  const old = loadOpeningBills().filter((b) => b.date < fyBegin && (b.side === 'payable' ? cred : debt).has(b.party_name));
  const manual = loadVouchers();
  const agencyLots = loadAgencyLots(end);
  const rxRetained = rxRetainedInYear(localDb.invoices.getAll() as InvoiceRecord[], fyBegin, end, today); // R9 (RT-B2)
  const steps = yearEndChecklist({
    fyStart,
    ledger,
    integrity,
    closingStock: stock,
    ...(valuation ? { valuation } : {}),
    assets: loadAssets(),
    manual,
    lockUntil: getLockUntil(),
    oldOpenBills: { count: old.length, amount: Math.round(old.reduce((s, b) => s + b.amount, 0) * 100) },
    record: loadYearEndRecord(fyStart),
    today,
    ...(agencyLots ? { agencyLots } : {}),
    ...(rxRetained ? { rxRetained } : {}),
  });
  return { steps, ledger, integrity, manual, ...(valuation ? { valuation } : {}) };
}

/**
 * Turn report-time stock valuation off (`mode: 'none'`) so a posted closing-stock journal is the only
 * source of closing stock. Keeps any typed figures for later.
 */
export function stopValuingStock(): void {
  requireAccess('books.edit');
  saveClosingStockConfig({ ...loadClosingStockConfig(), mode: 'none' });
}

/**
 * Post (or replace) the closing-stock journal on 31 March. Refused while report-time valuation is on
 * (the statements already carry the stock; a journal would only be netted off).
 */
export function postClosingStock(fyStart: number, valuePaise: number, reverse = true): ManualVoucher {
  const cfg = loadClosingStockConfig();
  if (stockValuerFor(cfg, () => loadPositions(), loadInventorySettings().method)) {
    throw new Error('Closing stock is valued at report time, so a journal is not needed. Choose "Do not value stock" first to post it as a journal.');
  }
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

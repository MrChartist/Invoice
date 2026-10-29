/**
 * Month-end report pack (8G, 8.109): one ZIP with the month's P&L, balance sheet (as at month end),
 * receivables ageing, GSTR-1 section CSVs, the GSTR-3B summary and a printable GST summary page.
 * Built entirely on the device from the same engines as the screens (ledger + `loadStockValuer`, so
 * Books and the pack agree). Lazy-loaded; every file is a working paper — verify with your CA.
 */

import { loadLedger, loadStockValuer } from './ledger';
import { balanceSheetLedgerCsv, ledgerBalanceSheet, ledgerProfitAndLoss, type LedgerProfitLoss } from './ledger/reports';
import { agingCsv, buildReceivables, type ReceiptRow } from './receivables';
import { loadReceivableOpeningBills } from './opening-bills';
import { buildGstReport, journalItcReversals, periodForDate, periodLabel } from './gst-reports';
import { buildSummaryHtml, gstr3bCsv, sectionCsv, type SectionId } from './gstr-json';
import { toCsv } from './csv';
import { localDb } from './localDb';
import { getTable } from './storage';
import { zipBlob, type ZipInput } from './zip';
import { monthPeriod } from './report-views';
import type { AdvanceRecord } from '../types/advances';

const r = (p: number) => Math.round(p) / 100;

export function pnlCsv(p: LedgerProfitLoss): string {
  const rows: (string | number)[][] = [[`Profit & loss ${p.period.start} to ${p.period.end}`, 'Working paper: verify with your CA'], ['Particulars', 'Amount']];
  for (const [title, list, total] of [['INCOME', p.income, p.totalIncome], ['EXPENSES', p.expenses, p.totalExpenses]] as const) {
    rows.push([title, '']);
    for (const s of list) {
      rows.push([s.label, '']);
      for (const l of s.lines) rows.push([`  ${l.account.name}`, r(l.amount)]);
      rows.push([`Total ${s.label.toLowerCase()}`, r(s.total)]);
    }
    rows.push([`TOTAL ${title}`, r(total)]);
  }
  rows.push(['Gross profit', r(p.grossProfit)], ['Net profit', r(p.netProfit)]);
  return toCsv(rows);
}

const GST_SECTIONS: SectionId[] = ['b2b', 'b2cl', 'b2cs', 'cdnr', 'cdnur', 'exp', 'nil', 'hsn', 'docs'];

export interface PackFile {
  name: string;
  text: string;
}

/** Every file of the pack for "YYYY-MM" (pure apart from reading the open company's tables). */
export function buildPackFiles(month: string, now: Date = new Date()): PackFile[] {
  const period = monthPeriod(month);
  const files: PackFile[] = [];
  const ledger = loadLedger();
  const stock = loadStockValuer();
  files.push({ name: `PnL_${month}.csv`, text: pnlCsv(ledgerProfitAndLoss(ledger, period, stock)) });
  files.push({ name: `BalanceSheet_${period.end}.csv`, text: balanceSheetLedgerCsv(ledgerBalanceSheet(ledger, period.end, stock)) });
  const clients = localDb.clients.getAll();
  const receivables = buildReceivables(
    { invoices: localDb.invoices.getAll(), payments: localDb.payments.getAll() as ReceiptRow[], clients, advances: getTable<AdvanceRecord>('advances'), openingBills: loadReceivableOpeningBills(clients) },
    { currency: 'INR', now: new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, Number(period.end.slice(8, 10)), 12) },
  );
  files.push({ name: `Ageing_${period.end}.csv`, text: agingCsv(receivables) });
  const gstPeriod = periodForDate('month', period.start);
  const profile = localDb.settings.activeProfile();
  const rep = buildGstReport(localDb.invoices.getAll(), getTable('purchases'), {
    period: gstPeriod,
    gstin: profile?.companyGstin?.trim().toUpperCase() || undefined,
    filerStateCode: profile?.stateCode,
    links: getTable('doc_links'),
    purchaseNotes: getTable('purchase_returns'),
    itcReversals: journalItcReversals(getTable('vouchers')), // R6-C4: Rule 42 / 43 journals in the pack's 3B
  });
  for (const id of GST_SECTIONS) files.push({ name: `GSTR1_${month}_${id}.csv`, text: sectionCsv(rep.gstr1, id) });
  files.push({ name: `GSTR3B_${month}.csv`, text: gstr3bCsv(rep.gstr3b) });
  files.push({ name: `GST_summary_${month}.html`, text: buildSummaryHtml(rep, periodLabel(gstPeriod), profile?.companyName ?? '') });
  files.push({ name: 'README.txt', text: `Month-end pack for ${month}, generated ${now.toISOString()} on this device by Mr. Chartist Invoice.\nAll files are working papers, not portal-validated returns: verify with your CA before filing.\n` });
  return files;
}

export async function buildPackZip(month: string, now: Date = new Date()): Promise<{ name: string; blob: Blob }> {
  const enc = new TextEncoder();
  const files: ZipInput[] = buildPackFiles(month, now).map((f) => ({ name: f.name, data: enc.encode(f.text) }));
  return { name: `MonthEndPack_${month}.zip`, blob: await zipBlob(files) };
}

/**
 * R4-C3 "Post duty": Dr Customs duty on imports | Cr Customs duty payable for a saved import bill's BOE sheet,
 * through `saveVoucher` (period lock, roles, audit); the voucher id is stamped on the bill's `boe_duty`. All or
 * nothing (`withTablesRollback`). The customs payment voucher then clears "Customs duty payable" and 2311.
 */
import { requireAccess } from '../access';
import { withTablesRollback } from '../table-txn';
import { saveVoucher, type ManualVoucher } from '../ledger/vouchers';
import { purchasesDb } from '../purchases';
import { dutyJournalLines } from './boe-duty';
import { ensureTradeLedger } from './ledgers';

export const BOE_DUTY_CLASS = 'Customs duty (BOE)';

export function postBoeDuty(billId: string): ManualVoucher {
  requireAccess('books.edit');
  return withTablesRollback(['vouchers', 'accounts', 'purchases'], () => {
    const bill = purchasesDb.get(billId);
    if (!bill?.boe_duty) throw new Error('boeNoSheet');
    if (bill.boe_duty.voucher_id) throw new Error('boePostedAlready');
    if (!(bill.boe_duty.totals.duty > 0)) throw new Error('boeNoDuty');
    const v = saveVoucher({
      type: 'JOURNAL',
      date: bill.boe_date || bill.date,
      narration: `Customs duty on BOE ${bill.boe_number ?? ''} (${bill.vendor_name}, bill ${bill.bill_number}): BCD + SWS + other duties, in stock cost for valuation; verify with your CA`.replace(/\s+/g, ' '),
      lines: dutyJournalLines(bill.boe_duty.totals.duty, { customsDuty: ensureTradeLedger('customsDuty'), customsPayable: ensureTradeLedger('customsPayable') }),
      voucher_class: BOE_DUTY_CLASS,
    });
    purchasesDb.save({ ...bill, boe_duty: { ...bill.boe_duty, voucher_id: v.id } });
    return v;
  });
}

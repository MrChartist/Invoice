/** TR-A: find-or-create a named ledger (scheme claims received, packaging deposits) and post a two-line voucher. */
import { chartOf, loadUserAccounts, saveUserAccount, type GroupId } from '../ledger/accounts';
import { saveVoucher } from '../ledger/vouchers';

export function ensureLedger(name: string, group: GroupId, from: number): string {
  const chart = chartOf(loadUserAccounts());
  const found = chart.find((a) => a.name.trim().toLowerCase() === name.toLowerCase());
  if (found) return found.id;
  const codes = new Set(chart.map((a) => a.code));
  let n = from;
  while (codes.has(String(n))) n++;
  return saveUserAccount({ code: String(n), name, group }).id;
}

/** Dr `dr` / Cr `cr` for ₹`amount` (paise in the voucher); `drParty` / `crParty` name the party on a party ledger. */
export function postPair(o: { type: 'JOURNAL' | 'RECEIPT' | 'PAYMENT'; date: string; dr: string; cr: string; amount: number; narration: string; cls: string; drParty?: string; crParty?: string }) {
  const p = Math.round(o.amount * 100);
  return saveVoucher({
    type: o.type,
    date: o.date,
    narration: `${o.narration} — verify with your CA`,
    lines: [
      { account_id: o.dr, dr: p, cr: 0, ...(o.drParty ? { party: o.drParty } : {}) },
      { account_id: o.cr, dr: 0, cr: p, ...(o.crParty ? { party: o.crParty } : {}) },
    ],
    voucher_class: o.cls,
  });
}

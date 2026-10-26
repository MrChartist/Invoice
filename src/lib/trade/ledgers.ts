/**
 * R4-C user ledgers created on first use (like "Sales commission"): export incentives receivable / income for
 * R4-C2 and customs duty on imports / payable for R4-C3. Looked up by name, so a ledger the user renamed or made
 * by hand with the same name is reused.
 */
import { chartOf, loadUserAccounts, saveUserAccount, type GroupId } from '../ledger/accounts';

export const TRADE_LEDGERS = {
  incentivesReceivable: { name: 'Export incentives receivable', group: 'OTHER_CA', code: 3750 },
  incentivesIncome: { name: 'Export incentives income', group: 'OTHER_INCOME', code: 4950 },
  customsDuty: { name: 'Customs duty on imports', group: 'DIRECT_EXPENSES', code: 5150 },
  customsPayable: { name: 'Customs duty payable', group: 'DUTIES_TAXES', code: 2315 },
} as const satisfies Record<string, { name: string; group: GroupId; code: number }>;
export type TradeLedger = keyof typeof TRADE_LEDGERS;

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Id of the ledger, created under its group with the first free code from its default. */
export function ensureTradeLedger(which: TradeLedger): string {
  const spec = TRADE_LEDGERS[which];
  const chart = chartOf(loadUserAccounts());
  const found = chart.find((a) => norm(a.name) === norm(spec.name));
  if (found) return found.id;
  const codes = new Set(chart.map((a) => a.code));
  let code: number = spec.code;
  while (codes.has(String(code))) code++;
  return saveUserAccount({ code: String(code), name: spec.name, group: spec.group }).id;
}

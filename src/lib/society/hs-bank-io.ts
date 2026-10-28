/**
 * R18-C4 bridge (outside `f-society`): society suggestions for the bank reconcile strip — a credit whose narration
 * names one unit becomes a receipt from its member (`RuleAction` kind `receipt`, applied by the existing bank-rules
 * apply step, oldest bills first), labelled with the unit and whether the amount equals an open bill or the dues.
 * Reads nothing unless the company is a society; the amount hint compares open bills (no interest). Working papers — verify with your CA.
 */
import type { BankLine } from '../bank-recon';
import type { RuleSuggestion } from '../bank-rules';
import { getTable } from '../storage';
import { localDb } from '../localDb';
import type { Payment } from '../../types/invoice';
import type { SocietyUnit } from '../../types/society-r18';
import { duesIndex, unitDues, type InterestFn } from './hs-dues';
import { amountFits, matchUnitInNarration } from './hs-bank-match';
import { HS_TABLES } from './hs-shared';

export function societySuggestions(lines: readonly BankLine[]): RuleSuggestion[] {
  if (!localDb.settings.get().society_kind) return [];
  const units = getTable<SocietyUnit>(HS_TABLES.units).filter((u) => u?.code && u.status === 'active' && u.owner_id);
  const credits = lines.filter((l) => l.credit > 0);
  if (!units.length || !credits.length) return [];
  const ix = duesIndex(localDb.invoices.getAll(), getTable<Payment>('transactions'), getTable('doc_links'));
  return credits.flatMap((l): RuleSuggestion[] => {
    const u = matchUnitInNarration(l.narration, units);
    if (!u) return [];
    const d = unitDues(u.id, l.date, ix, {}, (() => ({ segments: [] })) as unknown as InterestFn, u.owner_id); // open bills only (no interest)
    const fit = amountFits(l.credit, d.bills.filter((b) => b.open > 0).map((b) => b.open), d.arrears);
    return [{ lineId: l.id, source: 'rule', action: { kind: 'receipt', client_id: u.owner_id }, label: `${u.code}${fit === 'bill' ? ' = open bill' : fit === 'dues' ? ' = dues' : ''}` }];
  });
}

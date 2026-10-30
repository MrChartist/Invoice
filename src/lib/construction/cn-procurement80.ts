/**
 * CN-C5 80% registered-procurement test (promoters at 1% / 5%, N 03/2019 + N 07/2019): per project (its cost centre)
 * and FY, inputs and input services on purchase bills from registered vs unregistered suppliers, leaving out TDR / FSI,
 * long-term lease premium, electricity, HSD, motor spirit, natural gas and capital goods (`REALTY_PROCUREMENT_RULES`).
 * Cement from unregistered suppliers bears RCM at its own rate; the rest of a shortfall below 80% bears RCM at 18%.
 * Shown as a working paper with a "Book RCM liability" journal draft (optional voucher), never posted on its own.
 * Reads purchases through `readPurchase` / `readPurchaseLines` (tests/purchase-contract.test.ts). Verify with your CA (CN20).
 */
import type { RealtyProject } from '../../types/construction-r11';
import { isVoidStatus, readPurchase, readPurchaseLines } from '../purchase-normalize';
import { round2 } from '../invoice-calc';
import { ruleAt } from '../tax-rules';
import { A } from '../ledger/accounts';
import { saveVoucher, type ManualVoucher } from '../ledger/vouchers';
import { REALTY_PROCUREMENT_RULES } from '../construction-rules';
import { ledger } from './cn-cancellations';

export interface Procurement80 {
  fy: string;
  total: number;
  registered: number;
  unregistered: number;
  excluded: number;
  cementUnreg: number;
  pct: number;
  required: number;
  shortfall: number;
  cementRcm: number;
  rcm18Base: number;
  rcm: number;
}

/** Pure: the test for `project` over the FY starting 1 April `fyStart`. */
export function procurement80(project: Pick<RealtyProject, 'cost_centre_id'>, fyStart: number, purchases: readonly unknown[], vendors: readonly unknown[] = []): Procurement80 {
  const from = `${fyStart}-04-01`, to = `${fyStart + 1}-03-31`;
  const r = ruleAt(REALTY_PROCUREMENT_RULES, to);
  let total = 0, registered = 0, excluded = 0, cementUnreg = 0, cementRcm = 0;
  for (const raw of purchases) {
    const row = raw as { cost_centre_id?: string; lines?: { cost_centre_id?: string }[] };
    const c = readPurchase(raw, vendors);
    if (!c || isVoidStatus(c.status) || c.date < from || c.date > to || !project.cost_centre_id) continue;
    if (row.cost_centre_id !== project.cost_centre_id && !row.lines?.some((l) => l?.cost_centre_id === project.cost_centre_id)) continue;
    const reg = !!c.partyGstin;
    const rate = ruleAt(REALTY_PROCUREMENT_RULES, c.date);
    const lines = readPurchaseLines(raw);
    const parts = lines.length ? lines.map((l) => ({ hsn: l.hsn, text: `${l.name} ${c.category}`, value: l.quantity * l.unitCost })) : [{ hsn: '', text: c.category, value: c.taxable }];
    for (const p of parts) {
      const text = p.text.toLowerCase();
      if (rate.excludeHsn.some((h) => p.hsn.startsWith(h)) || rate.excludeWords.some((w) => text.includes(w))) {
        excluded += p.value;
        continue;
      }
      total += p.value;
      if (reg) registered += p.value;
      else if (p.hsn.startsWith(rate.cementHsn)) {
        cementUnreg += p.value;
        cementRcm += (p.value * rate.cementRate) / 100;
      }
    }
  }
  const required = round2((total * r.pct) / 100);
  const shortfall = round2(Math.max(required - registered, 0));
  const rcm18Base = round2(Math.max(shortfall - cementUnreg, 0));
  cementRcm = round2(cementRcm);
  return {
    fy: `${fyStart}-${String((fyStart + 1) % 100).padStart(2, '0')}`, total: round2(total), registered: round2(registered), unregistered: round2(total - registered), excluded: round2(excluded),
    cementUnreg: round2(cementUnreg), pct: total ? round2((registered * 100) / total) : 100, required, shortfall, cementRcm, rcm18Base, rcm: round2(cementRcm + (rcm18Base * r.rcmRate) / 100),
  };
}

/** "Book RCM liability": an optional (draft) journal — Dr RCM cost (no ITC) to the project, Cr RCM payable. */
export function bookRcmDraft(project: Pick<RealtyProject, 'name' | 'cost_centre_id'>, t: Procurement80, date: string): ManualVoucher {
  if (!(t.rcm > 0)) throw new Error('No RCM is due on this test.');
  const p = Math.round(t.rcm * 100);
  return saveVoucher({
    type: 'JOURNAL', date, variant: 'OPTIONAL', voucher_class: 'RCM — 80% procurement shortfall',
    narration: `RCM on the FY ${t.fy} procurement shortfall of ${project.name} (cement at its rate; the rest at 18%): working paper, verify with your CA (CN20).`,
    lines: [{ account_id: ledger('RCM on procurement shortfall (no ITC)', 'DIRECT_EXPENSES', 5810), dr: p, cr: 0, ...(project.cost_centre_id ? { cost_centre_id: project.cost_centre_id } : {}) }, { account_id: A.rcmPayable, dr: 0, cr: p }],
  });
}

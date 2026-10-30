/**
 * PS-D1 posting of the year-end run (one `partner_runs` row `kind: 'year_end'` per FY, `books.edit`, all-or-nothing,
 * reversible by the owner while the period is open):
 *  - Dr "Partners' remuneration" and "Interest on partners' capital" / Cr Current — partner (net of 194T) / Cr TDS payable;
 *  - Dr Current — partner / Cr "Interest on drawings" (income);
 *  - residual profit: Dr "Profit & loss appropriation" (capital group) / Cr Current — partner in the ratio (a loss the
 *    other way round) (PS33). No GST on partner remuneration (PS21). Working paper — verify with your CA.
 */
import './ps-registry';
import type { PartnerRun } from '../../types/prof-r14';
import { generateId, setTable } from '../storage';
import { requireAccess } from '../access';
import { round2 } from '../invoice-calc';
import { withTablesRollback } from '../table-txn';
import { A } from '../ledger/accounts';
import { saveVoucher, type ManualVoucherLine } from '../ledger/vouchers';
import { closingBalances, ledgerProfitAndLoss, loadLedger, loadStockValuer } from '../ledger/index';
import { PS_D_ACCOUNTS, PS_D_CLASSES, PS_TABLES } from './ps-shared';
import { drawingsOf, ensureLedger, loadPartners } from './ps-partners';
import { loadPartnerRuns, record194t, tds194tFor, undoPartnerRun } from './ps-194t';
import { averageCapital, fyBounds, type RunInput, type RunResult } from './ps-partner-run';

const p2 = (x: number) => Math.round(round2(x) * 100);

/**
 * The run's inputs from the books: net profit per the ledger (stock through `loadStockValuer`, like every statement),
 * monthly credits already posted, capital (opening balance, or daily-balance average) and drawings per partner.
 */
export function loadRunInput(fy: number, capitalMode: 'opening' | 'daily' = 'opening', adjustments: RunInput['adjustments'] = []): RunInput {
  const { start, end } = fyBounds(fy);
  const ledger = loadLedger();
  const partners = loadPartners();
  const netProfit = round2(ledgerProfitAndLoss(ledger, { start, end }, loadStockValuer()).netProfit / 100);
  const opening = closingBalances(ledger, `${fy}-03-31`);
  const capital: Record<string, number> = {};
  const drawings: Record<string, { date: string; amount: number }[]> = {};
  const remunerationPosted: Record<string, number> = {};
  const interestPosted: Record<string, number> = {};
  for (const p of partners) {
    const open = round2(-(opening.get(p.capital_account_id) ?? 0) / 100);
    const moves = ledger.vouchers.filter((v) => v.date >= start && v.date <= end).flatMap((v) => v.lines.filter((l) => l.account === p.capital_account_id).map((l) => ({ date: v.date, amount: round2((l.cr - l.dr) / 100) })));
    capital[p.id] = capitalMode === 'daily' ? averageCapital(open, moves, fy) : open;
    drawings[p.id] = drawingsOf(p, start, end);
  }
  for (const r of loadPartnerRuns()) {
    if (r.kind !== 'credit' || r.fy !== fy || !r.partner_id) continue;
    const bucket = r.credit_kind === 'interest' ? interestPosted : remunerationPosted;
    bucket[r.partner_id] = round2((bucket[r.partner_id] ?? 0) + (r.amount ?? 0));
  }
  return { fy, partners, netProfit, capital, drawings, remunerationPosted, interestPosted, adjustments };
}

/** The live year-end run of an FY, if posted. */
export const yearEndRun = (fy: number, runs = loadPartnerRuns()): PartnerRun | undefined => runs.find((r) => r.kind === 'year_end' && r.fy === fy);

/** Post a computed run. Refuses a second run for the FY, problems in the run, or a locked period (through the vouchers). */
export function postRun(res: RunResult, adjustments: readonly { label: string; amount: number }[] = []): PartnerRun {
  requireAccess('books.edit');
  if (res.problems.length) throw new Error(res.problems[0]);
  if (yearEndRun(res.fy)) throw new Error(`The year-end run for FY ${res.fy}-${String(res.fy + 1).slice(2)} is already posted. Undo it first.`);
  const partners = new Map(loadPartners().map((p) => [p.id, p]));
  const date = fyBounds(res.fy).end;
  return withTablesRollback([PS_TABLES.partnerRuns, 'vouchers', 'accounts', 'tds_deductions'], () => {
    const id = generateId();
    const vouchers: string[] = [];
    const lines = res.lines.map((l) => ({ ...l }));
    // 1. Remuneration and interest (194T on the two together).
    const credit: ManualVoucherLine[] = [];
    let tdsTotal = 0;
    for (const l of lines) {
      const amt = round2(l.remuneration + l.interest);
      if (!(amt > 0)) continue;
      const p = partners.get(l.partner_id)!;
      const s = tds194tFor(p, date, amt);
      const row = record194t(p, date, s, `194T on remuneration / interest, year-end FY ${res.fy}-${String(res.fy + 1).slice(2)}`);
      if (row) Object.assign(l, { tds: s!.amount, tds_row_id: row });
      tdsTotal += row ? s!.amount : 0;
      credit.push({ account_id: p.current_account_id, dr: 0, cr: p2(amt) - p2(l.tds ?? 0) });
    }
    const rem = round2(lines.reduce((s, l) => s + l.remuneration, 0));
    const int = round2(lines.reduce((s, l) => s + l.interest, 0));
    if (credit.length) {
      vouchers.push(saveVoucher({
        type: 'JOURNAL', date, voucher_class: PS_D_CLASSES.appropriation,
        narration: `Partners' remuneration ₹${rem} and interest on capital ₹${int} for FY ${res.fy}-${String(res.fy + 1).slice(2)} (Sec 40(b) working paper)${tdsTotal ? `, TDS u/s 194T ₹${round2(tdsTotal)}` : ''}: verify with your CA`,
        lines: [
          ...(rem > 0 ? [{ account_id: ensureLedger(PS_D_ACCOUNTS.remuneration, 'INDIRECT_EXPENSES', 6180), dr: p2(rem), cr: 0 }] : []),
          ...(int > 0 ? [{ account_id: ensureLedger(PS_D_ACCOUNTS.interest, 'FINANCE', 6290), dr: p2(int), cr: 0 }] : []),
          ...credit,
          ...(tdsTotal > 0 ? [{ account_id: A.tdsPayable, dr: 0, cr: p2(tdsTotal) }] : []),
        ],
      }).id);
    }
    // 2. Interest on drawings (the firm's income).
    const di = lines.filter((l) => l.drawings_interest > 0);
    if (di.length) {
      vouchers.push(saveVoucher({
        type: 'JOURNAL', date, voucher_class: PS_D_CLASSES.appropriation,
        narration: `Interest on partners' drawings for FY ${res.fy}-${String(res.fy + 1).slice(2)} (product method): verify with your CA`,
        lines: [...di.map((l) => ({ account_id: partners.get(l.partner_id)!.current_account_id, dr: p2(l.drawings_interest), cr: 0 })), { account_id: ensureLedger(PS_D_ACCOUNTS.drawingsInterest, 'OTHER_INCOME', 4190), dr: 0, cr: p2(res.drawingsInterestTotal) }],
      }).id);
    }
    // 3. Residual profit (or loss) in the ratio.
    const shares = lines.filter((l) => l.share);
    if (shares.length) {
      const app = ensureLedger(PS_D_ACCOUNTS.appropriation, 'CAPITAL', 1095);
      const profit = res.residual > 0;
      vouchers.push(saveVoucher({
        type: 'JOURNAL', date, voucher_class: PS_D_CLASSES.appropriation,
        narration: `Residual ${profit ? 'profit' : 'loss'} ₹${Math.abs(res.residual)} shared in the profit-sharing ratio, FY ${res.fy}-${String(res.fy + 1).slice(2)}: verify with your CA`,
        lines: [
          { account_id: app, dr: profit ? p2(res.residual) : 0, cr: profit ? 0 : p2(-res.residual) },
          ...shares.map((l) => ({ account_id: partners.get(l.partner_id)!.current_account_id, dr: l.share < 0 ? p2(-l.share) : 0, cr: l.share > 0 ? p2(l.share) : 0 })),
        ],
      }).id);
    }
    const row: PartnerRun = {
      id, kind: 'year_end', date, fy: res.fy, net_profit: res.netProfit, book_profit: res.bookProfit, ...(adjustments.length ? { adjustments: [...adjustments] } : {}),
      allowable: res.allowable, remuneration_total: res.remunerationTotal, disallowed: res.disallowed, interest_total: res.interestTotal, residual: res.residual,
      lines, voucher_ids: vouchers, created_at: new Date().toISOString(),
    };
    setTable(PS_TABLES.partnerRuns, [...loadPartnerRuns(), row]);
    return row;
  });
}

/** Owner only: reverse the FY's run (journals and TDS rows deleted; refused in a locked period). */
export function reverseRun(fy: number): void {
  requireAccess('settings.manage');
  const r = yearEndRun(fy);
  if (!r) throw new Error('No year-end run is posted for this year.');
  undoPartnerRun(r.id);
}

/** One partner's capital and current account statement for an FY (₹; balances credit-positive). */
export interface PartnerStatement { partner_id: string; name: string; opening: number; introduced: number; drawings: number; interest: number; remuneration: number; tds: number; drawingsInterest: number; share: number; closing: number }

/** Statements of every partner for an FY from the books and the FY's postings (the annual pack's partners' note reads these). */
export function partnerStatements(fy: number): PartnerStatement[] {
  const { start, end } = fyBounds(fy);
  const ledger = loadLedger();
  const open = closingBalances(ledger, `${fy}-03-31`);
  const close = closingBalances(ledger, end);
  const runs = loadPartnerRuns().filter((r) => r.fy === fy);
  const bal = (m: Map<string, number>, ids: string[]) => round2(-ids.reduce((s, id) => s + (m.get(id) ?? 0), 0) / 100);
  return loadPartners().filter((p) => p.joined <= end && (!p.left || p.left >= start)).map((p) => {
    const ids = [p.capital_account_id, p.current_account_id];
    const capMoves = ledger.vouchers.filter((v) => v.date >= start && v.date <= end).flatMap((v) => v.lines.filter((l) => l.account === p.capital_account_id));
    const lines = runs.flatMap((r) => (r.lines ?? []).filter((l) => l.partner_id === p.id));
    const credits = runs.filter((r) => r.kind === 'credit' && r.partner_id === p.id);
    const sum = (f: (x: (typeof lines)[number]) => number) => round2(lines.reduce((s, l) => s + f(l), 0));
    const cr = (pick: (k?: string) => boolean, f: (c: (typeof credits)[number]) => number) => credits.filter((c) => pick(c.credit_kind)).reduce((s, c) => s + f(c), 0);
    return {
      partner_id: p.id, name: p.name, opening: bal(open, ids), introduced: round2(capMoves.reduce((s, l) => s + (l.cr - l.dr), 0) / 100),
      drawings: round2(drawingsOf(p, start, end).reduce((s, d) => s + d.amount, 0)),
      interest: round2(sum((l) => l.interest) + cr((k) => k === 'interest', (c) => c.amount ?? 0)),
      remuneration: round2(sum((l) => l.remuneration) + cr((k) => k !== 'interest', (c) => c.amount ?? 0)),
      tds: round2(sum((l) => l.tds ?? 0) + cr(() => true, (c) => c.tds ?? 0)),
      drawingsInterest: sum((l) => l.drawings_interest), share: sum((l) => l.share), closing: bal(close, ids),
    };
  });
}

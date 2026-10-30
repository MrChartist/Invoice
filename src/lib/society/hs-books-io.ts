/**
 * R18-D1 bridge (outside `f-society`): the society's funds through the R5-C4 fund cost centres (`saveFund`, nature
 * `restricted`) and reserve ledgers (`ensureAccount`, group Reserves), the period / year-end transfer journal (one manual
 * voucher, class "Society fund transfer", `saveVoucher` — period lock and audit as every voucher), and the fund
 * figures from the ledger (`fundStatement`: opening, receipts, utilisation, closing) beside what was billed and moved.
 * Working papers — verify with your CA.
 */
import { requireAccess } from '../access';
import { hsdT } from '../../i18n/areas/society-r18d';
import { localDb } from '../localDb';
import { round2 } from '../invoice-calc';
import { withTablesRollback } from '../table-txn';
import { fyPeriod } from '../books';
import { loadFunds, saveFund } from '../nonprofit/funds';
import { fundStatement } from '../nonprofit/fund-statement';
import { ensureAccount } from '../institutions/r5c';
import { loadVouchers, saveVoucher, type ManualVoucher } from '../ledger/vouchers';
import { loadLedger } from '../ledger/index';
import { groupOf } from '../ledger/accounts';
import type { HsAudit, SocietySettings } from '../../types/society-r18';
import { itaxLines, mutualSplit } from './hs-itax';
import { FUND_CLASS, FUND_KEYS, FUND_NAMES, fundBilled, fundMinimum, transferDelta, type FundKey } from './hs-funds';
import { periodRange, stateRule } from './hs-tariff';
import { readSocietySettings, saveSocietySettings } from './hs-settings';
import { loadUnits } from './hs-units-save';

/** A billing period (`2026-10`, `2026-Q3`, `2026-H1`) or a FY (`FY2026`) as dates. */
export function rangeOf(p: string): { from: string; to: string } | null {
  const fy = /^FY(\d{4})$/.exec(p);
  if (fy) { const r = fyPeriod(+fy[1]); return { from: r.start, to: r.end }; }
  return periodRange(p);
}

const reserve = (k: FundKey) => ensureAccount(FUND_NAMES[k], 'RESERVES', 1330);

/** "Map funds" (owner): the three fund cost centres (created once, by name) and their ids in the society settings. */
export function mapFunds(): NonNullable<SocietySettings['funds']> {
  requireAccess('settings.manage');
  const have = loadFunds();
  return withTablesRollback(['cost_centres', 'accounts'], () => {
    const funds = Object.fromEntries(FUND_KEYS.map((k) => [k, (have.find((f) => f.name.toLowerCase() === FUND_NAMES[k].toLowerCase()) ?? saveFund({ name: FUND_NAMES[k], fund: { nature: 'restricted', purpose: 'Society fund (bye-laws)' } })).id]));
    for (const k of FUND_KEYS) reserve(k);
    saveSocietySettings({ funds, fund_transfer: readSocietySettings().fund_transfer ?? 'period' });
    return funds;
  });
}

/** The period / FY a transfer journal was posted for (its narration's `— <period>`), else its own day. */
const coverOf = (v: Pick<ManualVoucher, 'date' | 'narration'>): { p: string; from: string; to: string } => {
  const p = /(?:—|:) (\S+)$/.exec(v.narration ?? '')?.[1] ?? '';
  return { p: p || v.date, ...(rangeOf(p) ?? { from: v.date, to: v.date }) };
};

/**
 * What the transfer journals of the range already moved into each fund (rupees; a FY counts its periods'). QA21 W4: a
 * journal posted for a WIDER or overlapping range (a year-end journal, then a month of that FY; a quarter, then one of
 * its months) refuses the transfer — counting it by its date double-moved the month or reversed March.
 */
function moved(r: { from: string; to: string }, acc: Record<FundKey, string>): Partial<Record<FundKey, number>> {
  const out: Partial<Record<FundKey, number>> = {};
  for (const v of loadVouchers()) {
    if (v.voucher_class !== FUND_CLASS) continue;
    const c = coverOf(v);
    if (c.to < r.from || c.from > r.to) continue;
    if (c.from < r.from || c.to > r.to) throw new Error(hsdT('covered', { p: c.p }));
    for (const l of v.lines) for (const k of FUND_KEYS) if (l.account_id === acc[k]) out[k] = round2((out[k] ?? 0) + (l.cr - l.dr) / 100);
  }
  return out;
}

/** "Transfer for <period>" (`books.edit`): one journal for what the period's bills put in the funds and is not moved yet. */
export function postFundTransfer(p: string): ManualVoucher | null {
  requireAccess('books.edit');
  const r = rangeOf(p), cc = readSocietySettings().funds;
  if (!r || !cc) throw new Error(hsdT('noFunds'));
  const acc = Object.fromEntries(FUND_KEYS.map((k) => [k, reserve(k)])) as Record<FundKey, string>;
  const d = transferDelta(fundBilled(localDb.invoices.getAll(), r.from, r.to), moved(r, acc));
  const lines = FUND_KEYS.filter((k) => d[k] && cc[k]).flatMap((k) => {
    const n = Math.round(Math.abs(d[k]) * 100), into = d[k] > 0;
    return [{ account_id: 'sales', dr: into ? n : 0, cr: into ? 0 : n, cost_centre_id: cc[k] }, { account_id: acc[k], dr: into ? 0 : n, cr: into ? n : 0, cost_centre_id: cc[k] }];
  });
  if (!lines.length) return null;
  return saveVoucher({ type: 'JOURNAL', date: r.to, narration: `Society fund transfer (contributions billed): ${p}`, voucher_class: FUND_CLASS, lines });
}

export interface FundRow { key: FundKey; name: string; opening: number; billed: number; transferred: number; spent: number; closing: number }

/** The funds of a FY: billed and moved (journals of the FY) beside the ledger's fund statement; and the minimum hints. */
export function fundsView(fyStart: number): { rows: FundRow[]; low: ReturnType<typeof fundMinimum> } {
  const s = readSocietySettings(), per = fyPeriod(fyStart), billed = fundBilled(localDb.invoices.getAll(), per.start, per.end);
  const low = fundMinimum(billed, loadUnits(), stateRule(s.state, per.end, s.confirmed)?.fund_min ?? null);
  if (!s.funds) return { rows: [], low };
  const ledger = loadLedger(), funds = loadFunds();
  const rows = FUND_KEYS.flatMap((k): FundRow[] => {
    const f = funds.find((x) => x.id === s.funds?.[k]);
    if (!f) return [];
    const st = fundStatement(ledger, f, per);
    const tr = ledger.vouchers.filter((v) => v.date >= per.start && v.date <= per.end && /Society fund transfer/.test(v.narration)).reduce((t, v) => t + v.lines.filter((l) => l.cost_centre === f.id && l.account !== 'sales').reduce((x, l) => x + (l.cr - l.dr) / 100, 0), 0);
    return [{ key: k, name: f.name, opening: st.opening, billed: billed[k], transferred: round2(tr), spent: st.utilisationTotal, closing: st.closing }];
  });
  return { rows, low };
}

/** D3: save one FY's audit row (owner; replaces the row of that FY). */
export function saveAudit(a: HsAudit): void {
  saveSocietySettings({ audit: [...(readSocietySettings().audit ?? []).filter((x) => x.fy !== a.fy), a].sort((x, y) => x.fy.localeCompare(y.fy)) });
}

/** D4: a FY's mutual / non-mutual figures — the bills' split, and interest / dividend income ledgers other than sales. */
export function itaxFigures(fyStart: number) {
  const per = fyPeriod(fyStart), split = mutualSplit(localDb.invoices.getAll(), per.start, per.end), ledger = loadLedger();
  let other = 0;
  for (const v of ledger.vouchers) if (v.date >= per.start && v.date <= per.end) for (const l of v.lines) {
    const a = ledger.byId.get(l.account);
    if (a && a.group !== 'SALES' && groupOf(a.group).nature === 'income' && /interest|dividend/i.test(a.name)) other += (l.cr - l.dr) / 100;
  }
  return { ...split, other: round2(other), rule: itaxLines(fyStart, localDb.settings.get().society_kind === 'chs') };
}

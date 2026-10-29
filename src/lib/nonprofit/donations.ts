/**
 * R5-C3 donations: numbered receipts (`DON/FY26-27/0001`, Indian FY, series high-water mark), the 80G / 35 checks
 * (cash above the date-keyed limit, gifts in kind, missing donor id, anonymous above the Sec 115BBC limit) and
 * the books entry — ONE receipt voucher per donation: Dr cash / bank | Cr "Donations received" (income) or
 * "Donations — corpus fund" (a fund account), tagged with its fund (cost centre, C4). A gift in kind posts a JOURNAL
 * Dr the ledger chosen for the goods (`kind_account_id`, at the value on the receipt) | Cr the same income / corpus
 * account (PENDING 29); without a ledger it posts nothing, as before. A receipt is never edited once the FY's Form 10BD is marked filed: cancel + new.
 * Working paper — verify with your CA (§7 Q10).
 */
import type { Client } from '../../types/invoice';
import type { Donation, DonationMode, DonationSection, DonationType, DonorIdCode } from '../../types/institutions-r5';
import { requireAccess } from '../access';
import { assertUnlocked } from '../period-lock';
import { A, chartOf, loadUserAccounts } from '../ledger/accounts';
import { deleteVoucher, saveVoucher } from '../ledger/vouchers';
import { bankLedgerId } from '../bank-ledgers';
import { getIndianFY } from '../invoice-number';
import { nextSeriesNumberFor, recordSeries, SERIES_TABLE } from '../series-counters';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { withTablesRollback } from '../table-txn';
import { isValidPan, isValidTan } from '../validators';
import { ANON_DONATION_RULES, DONATION_CASH_LIMIT_RULES, ruleAt } from '../r5c-rules';
import { CORPUS_ACCOUNT, DONATIONS_ACCOUNT, DONATIONS_TABLE, FORM_10BD_TABLE, R5cError, day, ensureAccount, money, paise, str } from '../institutions/r5c';

export const DON_PREFIX = 'DON';
export const MODES: readonly DonationMode[] = ['cash', 'electronic', 'kind', 'others'];
export const TYPES: readonly DonationType[] = ['others', 'corpus', 'specific_grant'];
export const SECTIONS: readonly DonationSection[] = ['80G', '35(1)(ii)', '35(1)(iia)', '35(1)(iii)', 'none'];
export const ID_CODES: readonly DonorIdCode[] = ['pan', 'aadhaar', 'tan', 'passport', 'voter_id', 'driving_licence', 'ration_card', 'foreign_tax_id'];

/**
 * QA23 W4: groups a gift in kind may not be journalised to — money and parties (a journal Dr cash / bank would show
 * money that never came in), and the liability / income side (the credit already goes to income or corpus).
 */
export const KIND_EXCLUDED_GROUPS: readonly string[] = ['CASH_BANK', 'TRADE_RECEIVABLES', 'CAPITAL', 'RESERVES', 'LOANS_LT', 'LOANS_ST', 'TRADE_PAYABLES', 'DUTIES_TAXES', 'OTHER_CL', 'PROVISIONS', 'SALES', 'OTHER_INCOME'];

export const ensureDonationsAccount = () => ensureAccount(DONATIONS_ACCOUNT, 'OTHER_INCOME', 4810);
export const ensureCorpusAccount = () => ensureAccount(CORPUS_ACCOUNT, 'RESERVES', 1310);

/** Is the donor id number valid for its code (PAN / TAN / Aadhaar checked; others: present). */
export function donorIdValid(code: DonorIdCode | undefined, no: string | undefined): boolean {
  const v = str(no).toUpperCase().replace(/\s+/g, '');
  if (!code || !v) return false;
  if (code === 'pan') return isValidPan(v);
  if (code === 'tan') return isValidTan(v);
  if (code === 'aadhaar') return /^[2-9]\d{11}$/.test(v);
  return v.length >= 4;
}

export function loadDonations(): Donation[] {
  return peekTable<Donation>(DONATIONS_TABLE).filter((d) => d && d.id) as Donation[];
}

/** FY start year of a day (2026-05-10 → 2026). */
export const fyOf = (d: string) => getIndianFY(d).startYear;

export const isFiled = (fy: number): boolean => peekTable<{ fy?: number; filed_on?: string }>(FORM_10BD_TABLE).some((f) => f.fy === fy && !!f.filed_on);

export type DonationWarning = 'cash' | 'kind' | 'noId' | 'anon';

/** Warnings (never blocks) for a donation; `fyDonations` = the other live donations of its FY (Sec 115BBC). */
export function donationWarnings(d: Pick<Donation, 'amount' | 'mode' | 'section' | 'date' | 'anonymous'>, donor: Pick<Client, 'donor'> | undefined, fyDonations: readonly Pick<Donation, 'amount' | 'anonymous'>[] = []): DonationWarning[] {
  const out: DonationWarning[] = [];
  if (d.mode === 'cash' && d.section === '80G' && money(d.amount) > ruleAt(DONATION_CASH_LIMIT_RULES, d.date)) out.push('cash');
  if (d.mode === 'kind' && d.section !== 'none') out.push('kind');
  if (d.section !== 'none' && !d.anonymous && !donorIdValid(donor?.donor?.id_code, donor?.donor?.id_no)) out.push('noId');
  if (d.anonymous) {
    const r = ruleAt(ANON_DONATION_RULES, d.date);
    const total = fyDonations.reduce((s, x) => s + money(x.amount), money(d.amount));
    const anon = fyDonations.reduce((s, x) => s + (x.anonymous ? money(x.amount) : 0), money(d.amount));
    if (anon > Math.max((total * r.pct) / 100, r.floor)) out.push('anon');
  }
  return out;
}

export interface DonationInput extends Omit<Donation, 'id' | 'number' | 'voucher_id' | 'cancelled' | 'created_at'> {
  id?: string;
}

/** Record (or correct, before the FY's 10BD is filed) a donation and its receipt voucher. All or nothing. */
export function saveDonation(input: DonationInput, donorName: string): Donation {
  requireAccess('doc.create');
  const date = day(input.date);
  const amount = money(input.amount);
  if (!date) throw new R5cError('date');
  if (!(amount > 0)) throw new R5cError('amount');
  if (!str(input.donor_id)) throw new R5cError('donor');
  const all = getTable<Donation>(DONATIONS_TABLE);
  const prev = input.id ? all.find((d) => d.id === input.id) : undefined;
  if (prev?.cancelled) throw new R5cError('cancelled');
  if (prev && (isFiled(fyOf(date)) || isFiled(fyOf(prev.date)))) throw new R5cError('filed');
  if (prev && fyOf(prev.date) !== fyOf(date)) throw new R5cError('fy');
  const id = prev?.id ?? generateId();
  const number = prev?.number ?? nextSeriesNumberFor(DON_PREFIX, date, all.map((d) => d.number));
  assertUnlocked({ id, issue_date: date, invoice_number: number }, prev ? 'edit' : 'create');
  const kindAccount = input.mode === 'kind' ? str(input.kind_account_id) : '';
  if (kindAccount) {
    const acc = chartOf(loadUserAccounts()).find((a) => a.id === kindAccount);
    if (!acc || KIND_EXCLUDED_GROUPS.includes(acc.group)) throw new R5cError('input');
  }
  return withTablesRollback([DONATIONS_TABLE, 'vouchers', 'accounts', SERIES_TABLE], () => {
    let voucherId: string | undefined;
    // The voucher type changes with the mode (receipt ↔ journal), so a changed mode replaces the old voucher; so does
    // a gift in kind whose ledger is cleared (QA23 W4: it posts nothing now, so its old journal must go).
    const posts = input.mode !== 'kind' || !!kindAccount;
    const reuse = posts && prev?.voucher_id && (prev.mode === 'kind') === (input.mode === 'kind') ? prev.voucher_id : undefined;
    if (prev?.voucher_id && !reuse) deleteVoucher(prev.voucher_id);
    if (posts) {
      const credit = input.type === 'corpus' ? ensureCorpusAccount() : ensureDonationsAccount();
      const money_ = kindAccount || (input.mode === 'cash' ? A.cash : bankLedgerId(input.bank_account_id));
      const p = paise(amount);
      voucherId = saveVoucher({
        ...(reuse ? { id: reuse } : {}),
        type: kindAccount ? 'JOURNAL' : 'RECEIPT', date,
        narration: `Donation ${number} from ${input.anonymous ? 'anonymous donor' : donorName}: ${input.section === 'none' ? 'no deduction' : input.section}, ${input.type}${input.reference ? `, ref ${input.reference}` : ''}${kindAccount ? ': gift in kind' : ''}`,
        lines: [{ account_id: money_, dr: p, cr: 0 }, { account_id: credit, dr: 0, cr: p, ...(input.fund_id ? { cost_centre_id: input.fund_id } : {}) }],
        voucher_class: 'Donation',
      }).id;
    }
    const row: Donation = {
      id, number, date, donor_id: str(input.donor_id), amount, mode: input.mode, type: input.type, section: input.section,
      ...(str(input.reference) ? { reference: str(input.reference) } : {}),
      ...(input.fund_id ? { fund_id: input.fund_id } : {}),
      ...(str(input.purpose) ? { purpose: str(input.purpose) } : {}),
      ...(input.anonymous ? { anonymous: true } : {}),
      ...(input.bank_account_id && input.mode !== 'cash' && input.mode !== 'kind' ? { bank_account_id: input.bank_account_id } : {}),
      ...(kindAccount ? { kind_account_id: kindAccount } : {}),
      ...(voucherId ? { voucher_id: voucherId } : {}),
      created_at: prev?.created_at ?? new Date().toISOString(),
    };
    setTable(DONATIONS_TABLE, prev ? all.map((d) => (d.id === id ? row : d)) : [...all, row]);
    recordSeries(number);
    return row;
  });
}

/** Cancel a receipt (its voucher is deleted; the number stays used; the edit log keeps the change). After the FY's 10BD is filed this is how a receipt is corrected: cancel + new. */
export function cancelDonation(id: string, reason: string, on: string): Donation {
  requireAccess('doc.create');
  const all = getTable<Donation>(DONATIONS_TABLE);
  const d = all.find((x) => x.id === id);
  if (!d || d.cancelled) throw new R5cError('cancelled');
  if (!str(reason)) throw new R5cError('reason');
  return withTablesRollback([DONATIONS_TABLE, 'vouchers'], () => {
    if (d.voucher_id) deleteVoucher(d.voucher_id);
    const { voucher_id: _v, ...rest } = d;
    void _v;
    const row: Donation = { ...rest, cancelled: { on: day(on) || d.date, reason: str(reason) } };
    setTable(DONATIONS_TABLE, all.map((x) => (x.id === id ? row : x)));
    return row;
  });
}

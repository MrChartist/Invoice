/**
 * R19-C2 duty deposits (pure; family `f-logistics`). A deposit is an existing advance receipt (`advances.ts`, `ADV`)
 * with `tax_rate: 0`, `pass_through: true` (the CN-C2 flag: no GST, money held for the client) and `AdvanceRecord.lg =
 * { job_id }`, saved through `lg-recv-io.ts`. Applying it to the job's reimbursement invoice is the existing
 * `applyAdvance` (a payment with `advance_id`, which every cash reader skips through `movedNoCash`); the excess goes back
 * by `refundAdvance` (Refund Voucher). The position per job sets deposits − applied − refunded against unrecovered
 * disbursements. No new receipt marker (`no-cash.ts` unchanged). Working papers — verify with your CA (LG12).
 */
import type { AdvanceInput } from '../advances';
import type { LgJob, LogisticsSettings } from '../../types/logistics-r19';
import { round2 } from '../invoice-calc';

/** Printed as the voucher's description of supply (LG12). */
export const DEPOSIT_TEXT = "Deposit towards customs duty and charges payable on the client's behalf: not consideration for our supply";

export interface DepositReceipt { amount: number; date: string; method: string; reference?: string; bankAccountId?: string }

/** The advance input of a deposit: 0 %, pass-through, the job in the description and in `lg`. */
export function depositInput(job: Pick<LgJob, 'id' | 'number'>, client: AdvanceInput['client'], pos: string, x: DepositReceipt): AdvanceInput & { lg: { job_id: string } } {
  return {
    date: x.date, client, place_of_supply: pos, supply: 'services', tax_rate: 0, amount: round2(Number(x.amount) || 0), method: x.method || 'Bank transfer',
    ...(x.reference?.trim() ? { reference: x.reference.trim() } : {}), ...(x.bankAccountId ? { bankAccountId: x.bankAccountId } : {}),
    description: `${DEPOSIT_TEXT}: job ${job.number}`, booking: { pass_through: true }, lg: { job_id: job.id },
  };
}

/** One deposit with its balance (worked out by the bridge through `advanceBalance`). */
export interface DepositBal { id: string; job_id: string; number: string; date: string; amount: number; applied: number; refunded: number; open: number }

export interface DepositPosition { received: number; applied: number; refunded: number; open: number; unrecovered: number; owed: number; gap: number; state: 'short' | 'excess' | 'even' }

/**
 * Deposits of a job (received − applied − refunded) vs what the client still has to bear: unrecovered disbursements
 * plus what its issued invoices still owe. `gap` > 0 = excess (to refund or apply), < 0 = short (to collect).
 */
export function depositPosition(deps: readonly DepositBal[], unrecovered: number, owed = 0): DepositPosition {
  const s = (k: 'amount' | 'applied' | 'refunded' | 'open') => round2(deps.reduce((t, d) => t + d[k], 0));
  const open = s('open');
  const gap = round2(open - unrecovered - owed);
  return { received: s('amount'), applied: s('applied'), refunded: s('refunded'), open, unrecovered: round2(unrecovered), owed: round2(owed), gap, state: gap > 0.004 ? 'excess' : gap < -0.004 ? 'short' : 'even' };
}

/** `deposit_required`: a duty disbursement that leaves the job short of deposit → the shortfall (hint, never a block), else 0. */
export const depositShortfall = (s: Pick<LogisticsSettings, 'deposit_required'>, kind: string, p: DepositPosition): number => (s.deposit_required && kind === 'duty' && p.state === 'short' ? -p.gap : 0);

/** How much of a deposit to apply to an invoice: the smaller of the deposit's open amount and what the invoice still owes. */
export const applyAmount = (depositOpen: number, invoiceOpen: number): number => round2(Math.max(Math.min(depositOpen, invoiceOpen), 0));

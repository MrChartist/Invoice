/**
 * CN-B5: bank guarantees (table `bank_guarantees`) — performance, mobilisation, secured, retention-release, EMD and
 * other BGs with expiry, claim period, margin FD and commission; "Extend" keeps a history, "Release" / "Invoked" close
 * it. Expiry alerts at ≤ 30 days (`RECOVERY_DEFAULTS.bg_alert_days`). The bank's commission is an ordinary bank-charges
 * expense (18% GST, ITC — CN13) and the margin FD an ordinary bank deposit: both are booked where they are paid, so the
 * register posts no journal. EMD / security deposits paid to a client are R5-C6 `security_deposits` rows with
 * `contract_id` (`direction: 'paid'`). Working paper — verify with your CA.
 */
import type { BankGuarantee } from '../../types/construction-r11';
import type { SecurityDeposit } from '../../types/institutions-r5';
import { num, round2 } from '../invoice-calc';
import { requireAccess } from '../access';
import { generateId, getTable, peekTable, setTable } from '../storage';
import { shiftDay } from '../dates';
import { daysBetween } from './cn-contracts';
import './cn-registry';

export const BG_TABLE = 'bank_guarantees';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export const loadGuarantees = (): BankGuarantee[] => peekTable<BankGuarantee>(BG_TABLE).filter((b) => b && typeof b.id === 'string');
export const isLiveBg = (b: Pick<BankGuarantee, 'status'>) => b.status === 'live' || b.status === 'extended';

/** Live guarantees expiring within `days` (or already expired), soonest first. */
export const expiringGuarantees = (list: readonly BankGuarantee[], today: string, days = 30): BankGuarantee[] =>
  list.filter((b) => isLiveBg(b) && b.expires_on <= shiftDay(today, days)).sort((a, b) => a.expires_on.localeCompare(b.expires_on));

/** Bank commission for the BG's life: amount × % a year × days / 365 (booked as bank charges where paid). */
export const bgCommission = (b: Pick<BankGuarantee, 'amount' | 'commission_pct' | 'issued_on' | 'expires_on'>): number => round2((num(b.amount) * num(b.commission_pct) * Math.max(daysBetween(b.issued_on, b.expires_on), 0)) / 36500);

function write(next: BankGuarantee): BankGuarantee {
  const all = getTable<BankGuarantee>(BG_TABLE);
  setTable(BG_TABLE, all.some((b) => b.id === next.id) ? all.map((b) => (b.id === next.id ? next : b)) : [...all, next]);
  return next;
}

/** Add / edit a guarantee (books rights; dates checked). */
export function saveGuarantee(i: Partial<BankGuarantee>): BankGuarantee {
  requireAccess('books.edit');
  if (!i.bank?.trim() || !i.bg_no?.trim() || !(num(i.amount) > 0)) throw new Error('Bank, BG number and amount are required.');
  if (!DAY.test(i.issued_on ?? '') || !DAY.test(i.expires_on ?? '') || i.expires_on! < i.issued_on!) throw new Error('The expiry date must be on or after the issue date.');
  const old = loadGuarantees().find((b) => b.id === i.id);
  return write({
    id: i.id || generateId(), ...(i.contract_id ? { contract_id: i.contract_id } : {}), kind: i.kind ?? 'performance', bank: i.bank.trim().slice(0, 80), bg_no: i.bg_no.trim().slice(0, 40), amount: round2(num(i.amount)),
    issued_on: i.issued_on!, expires_on: i.expires_on!, ...(DAY.test(i.claim_until ?? '') ? { claim_until: i.claim_until } : {}),
    ...(i.margin && (i.margin.fd_ref || num(i.margin.amount) > 0) ? { margin: i.margin } : {}), ...(num(i.commission_pct) > 0 ? { commission_pct: num(i.commission_pct) } : {}),
    status: old?.status ?? 'live', history: old?.history ?? [], created_at: old?.created_at ?? new Date().toISOString(),
  });
}

/** Extend to a later expiry (history kept). */
export function extendGuarantee(id: string, expires_on: string, on: string, ref?: string): BankGuarantee {
  requireAccess('books.edit');
  const b = loadGuarantees().find((x) => x.id === id);
  if (!b || !isLiveBg(b)) throw new Error('Only a live guarantee can be extended.');
  if (!DAY.test(expires_on) || expires_on <= b.expires_on) throw new Error('The new expiry must be after the current one.');
  return write({ ...b, expires_on, status: 'extended', history: [...b.history, { on, action: 'extended', expires_on, ...(ref ? { ref } : {}) }] });
}

/** Released by the client / invoked by the client (closes the guarantee). */
export function closeGuarantee(id: string, action: 'released' | 'invoked', on: string, ref?: string): BankGuarantee {
  requireAccess('books.edit');
  const b = loadGuarantees().find((x) => x.id === id);
  if (!b || !isLiveBg(b)) throw new Error('This guarantee is already closed.');
  return write({ ...b, status: action, history: [...b.history, { on, action, ...(ref ? { ref } : {}) }] });
}

/** Delete a guarantee (to the recycle bin). */
export function deleteGuarantee(id: string): void {
  requireAccess('books.edit');
  setTable(BG_TABLE, getTable<BankGuarantee>(BG_TABLE).filter((b) => b.id !== id));
}

/** EMD / security deposits paid to the client (R5-C6 rows, `direction: 'paid'`): this contract's, then the client's unlinked ones. */
export const contractDeposits = (contractId: string, clientId?: string): SecurityDeposit[] =>
  peekTable<SecurityDeposit>('security_deposits').filter((d) => d?.direction === 'paid' && (d.contract_id === contractId || (!d.contract_id && !!clientId && d.party_id === clientId)));

/** Link a deposit paid (recorded in Recurring → Leases → Deposits) to a contract (additive `contract_id`). */
export function linkDeposit(id: string, contractId: string): void {
  requireAccess('books.edit');
  setTable('security_deposits', getTable<SecurityDeposit>('security_deposits').map((d) => (d.id === id ? { ...d, contract_id: contractId } : d)));
}

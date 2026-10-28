/**
 * R18-C2 transfer of membership and the dues-certificate log (pure; family `f-society`). A transfer records the date,
 * the outgoing and incoming members, the transfer premium (typed; the MH cap is a hint only, HS18) and whether the dues
 * were settled, sets the unit's owner (later bills go to the new member) — the caller re-links `Client.hs` with
 * `memberLinks`. A dues certificate states only what the books hold (principal, interest to the date, bills dated after
 * it) and is logged on the unit with a reference and its validity (KA s.20(5), HS33). Working papers — verify with your CA.
 */
import { round2 } from '../invoice-calc';
import { shiftDay } from '../dates';
import type { HsCertificate, SocietyUnit } from '../../types/society-r18';

export interface TransferInput { date: string; to_id: string; premium?: number; dues_settled: boolean }
export type TransferError = 'date' | 'to' | 'same' | 'dues' | '';

/** Why a transfer cannot be recorded ('' = it can): open dues need the "dues settled" tick. */
export function transferError(unit: SocietyUnit, t: TransferInput, open: number): TransferError {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date)) return 'date';
  if (!t.to_id) return 'to';
  if (t.to_id === unit.owner_id) return 'same';
  return open > 0.004 && !t.dues_settled ? 'dues' : '';
}

/** The unit after the transfer (owner and joint members replaced; the history appended). */
export function transferUnit(unit: SocietyUnit, t: TransferInput, now = new Date().toISOString()): SocietyUnit {
  const from = [unit.owner_id, ...(unit.joint_ids ?? [])].filter((x): x is string => !!x);
  const premium = round2(Math.max(0, t.premium ?? 0));
  return { ...unit, owner_id: t.to_id, joint_ids: [], transfers: [...(unit.transfers ?? []), { date: t.date, from_ids: from, to_ids: [t.to_id], ...(premium ? { premium } : {}), dues_settled: t.dues_settled }], updated_at: now };
}

/** The next certificate of a unit: `<code>/DC/<n>`, valid for `days` (default 30). */
export function nextCertificate(unit: SocietyUnit, date: string, amount: number, days = 30): HsCertificate {
  return { no: `${unit.code}/DC/${(unit.certificates?.length ?? 0) + 1}`, date, amount: round2(amount), valid_till: shiftDay(date, Math.max(1, days)) };
}

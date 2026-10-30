/**
 * SV-A follow-up (pure, lazy): staff on POS / editor lines, the printed staff name, and tips.
 *  - `withStaff`: puts a staff member on a line (`sv.staff_id` / `staff_name`) and, when "staff names on the bill" is
 *    on (`service_settings.print_staff`), the snapshot `sv.staff_print` the paper prints. A line without the snapshot
 *    prints as before, so plain invoices never change.
 *  - Tips (`service_settings.tips === 'pass-through'`): one 0% line "Tip — <staff>" (`sv.tip`, `sv.exempt` NON_GST, the
 *    staff on it). Commission never earns on it; the staff's statement adds it in full and the payout pays it out with
 *    the commission. GST and books treatment of a tip collected on the bill is a CA question (SV70).
 */
import type { InvoiceItem } from '../../types/invoice';
import type { ServiceStaff, SvLine } from '../../types/services-r10';
import { blankItem } from '../../store/invoice-defaults';
import { round2 } from '../invoice-calc';

type Staff = Pick<ServiceStaff, 'id' | 'name'>;

/** The line with `staff` on it (or off it with `undefined`); `print` adds the printed-name snapshot. */
export function withStaff<T extends Pick<InvoiceItem, 'sv'>>(line: T, staff: Staff | undefined, print: boolean): T {
  const sv: SvLine = { ...line.sv };
  delete sv.staff_id;
  delete sv.staff_name;
  delete sv.staff_print;
  if (staff) Object.assign(sv, { staff_id: staff.id, staff_name: staff.name }, print ? { staff_print: staff.name } : {});
  const out = { ...line };
  if (Object.keys(sv).length) out.sv = sv;
  else delete out.sv;
  return out;
}

export const isTipLine = (l: Pick<InvoiceItem, 'sv'> | undefined): boolean => !!l?.sv?.tip;

/**
 * "Staff required on service lines" (`service_settings.staff_required`, PENDING #21): the service lines still without a
 * staff member (tips, free items and modifiers left out). Empty = the bill may be saved.
 */
export function linesWithoutStaff(items: readonly InvoiceItem[]): InvoiceItem[] {
  return items.filter((l) => l.type === 'Service' && !isTipLine(l) && !l.free_of && !l.modifier_of && !l.sv?.staff_id);
}

/** A tip line for `staff` (0%, non-GST, never discounted). */
export function tipLine(staff: Staff, amount: number): InvoiceItem {
  const a = round2(Math.max(Number(amount) || 0, 0));
  return { ...blankItem(0), name: `Tip: ${staff.name}`, hsn: '', unit: 'NOS', quantity: 1, rate: a, amount: a, tax_rate: 0, sv: { tip: true, staff_id: staff.id, staff_name: staff.name, exempt: 'NON_GST' } };
}

/** Lines with the tip set to `amount` for `staff` (one tip line per bill; 0 removes it). */
export function setTip(items: readonly InvoiceItem[], staff: Staff | undefined, amount: number): InvoiceItem[] {
  const rest = items.filter((l) => !isTipLine(l));
  if (!staff || !(Number(amount) > 0)) return rest;
  return [...rest, tipLine(staff, amount)];
}

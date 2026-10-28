/**
 * MF-C3 job-work e-Way JSON, the cases `eway-job-work.ts` (sub-type 4, Material Out) does not cover — built with its
 * builder and layout, whose own output is unchanged:
 *  - job-work RETURN (we are the job worker sending the principal's goods back): sub-type 6 "job work returns" from a
 *    principal-register return (`job_work_principal`, `JWP`); values from the principal's challan (value of the
 *    principal's goods — MF11);
 *  - job worker → job worker (our goods sent onward, ITC-04 5B): sub-type 4 on our challan, dispatched from the first job
 *    worker's premises (transaction type 3, bill-from / dispatch-from);
 *  - supply from the job worker's premises (ITC-04 5C): the invoice's e-way with dispatch-from = the job worker.
 * Needed: inter-State whatever the value (Rule 138 proviso), intra-State above ₹50,000 — unless the State's job-work
 * exemption is ticked (`eway_jw_intra_exempt`, default off, MF11). Not portal-validated: verify with your CA.
 */
import type { MaterialOut, PrincipalMovement } from '../../types/job-work';
import type { Vendor } from '../../types/purchases';
import type { StockItem } from '../inventory';
import { num } from '../invoice-calc';
import { stateByCode } from '../india-states';
import { extractPin, guessLocality, splitAddress } from '../einvoice';
import { EWAY_SUB_JOB_WORK_RETURN, EWAY_THRESHOLD, type EwayBill, type EwayTransMode } from '../eway';
import { buildJobWorkEway, type JobWorkEwayBuild, type JobWorkEwaySender } from '../eway-job-work';
import type { UnitMaster } from '../units';

export const JW_EWAY_CA = 'Job-work e-Way JSON (returns sub-type 6 / dispatch-from a job worker) — not validated against the portal; verify with your CA (MF11).';
type Party = Pick<Vendor, 'name' | 'gstin' | 'state_code' | 'address'>;
const codeNum = (c?: string) => (Number.isFinite(parseInt(c ?? '', 10)) ? parseInt(c ?? '', 10) : 0);
const stateOf = (p?: Pick<Party, 'gstin' | 'state_code'>) => p?.state_code || (/^\d{2}/.test(p?.gstin ?? '') ? p!.gstin!.slice(0, 2) : '');

/** Needed under Rule 138: inter-State always; intra-State above ₹50,000 unless the State exempts job work (setting). */
export function jwEwayNeeded(fromState: string, toState: string, value: number, intraExempt = false): { needed: boolean; note: string } {
  if (fromState && toState && fromState !== toState) return { needed: true, note: 'Inter-State movement for job work: e-Way bill needed whatever the value (Rule 138(1) proviso).' };
  if (intraExempt) return { needed: false, note: 'Your State exempts intra-State job-work movement (setting) — verify the notification with your CA (MF11).' };
  return num(value) > EWAY_THRESHOLD ? { needed: true, note: 'Intra-State above ₹50,000: e-Way bill needed.' } : { needed: false, note: 'Intra-State up to ₹50,000: not needed (check your State\'s rules).' };
}

/** Point the "from" side of a bill at another premises (dispatch-from), keeping the supplier's GSTIN. */
export function dispatchFrom(bill: EwayBill, from: Party): EwayBill {
  const st = stateOf(from);
  const a = splitAddress(from.address ?? '');
  return {
    ...bill, transType: bill.transType === 2 || bill.transType === 4 ? 4 : 3, fromAddr1: a.addr1, fromAddr2: a.addr2,
    fromPlace: guessLocality(from.address ?? '', stateByCode(st)?.name) || stateByCode(st)?.name || '', fromPincode: extractPin(from.address),
    actFromStateCode: codeNum(st) || bill.actFromStateCode,
  };
}

export interface JwEwayOpts {
  sender: JobWorkEwaySender;
  mode?: EwayTransMode;
  intraExempt?: boolean;
  units?: readonly UnitMaster[];
}

/** Sub-type 6: our return of the principal's goods (a `return` movement of the principal register). */
export function buildJwReturnEway(m: PrincipalMovement, principal: Party | undefined, o: JwEwayOpts & { vehicle_no?: string; distance_km?: number }): JobWorkEwayBuild {
  if (m.kind !== 'return') throw new Error(`${m.number} is not a return to the principal.`);
  const items = m.lines.map((l) => ({ id: l.id, name: l.name, hsn: l.hsn, unit: l.unit, tax_rate: 0 } as StockItem));
  const out: MaterialOut = {
    id: m.id, number: m.number, date: m.date, party_name: m.party_name, party_gstin: m.party_gstin, job_worker_godown: '',
    lines: m.lines.filter((l) => num(l.qty) > 0).map((l) => ({ id: l.id, item_id: l.id, qty: num(l.qty), unit: l.unit, hsn: l.hsn, rate: num(l.qty) > 0 ? num(l.value) / num(l.qty) : 0 })),
    ...(o.vehicle_no ? { vehicle_no: o.vehicle_no } : {}), ...(o.distance_km ? { distance_km: o.distance_km } : {}),
  };
  const b = buildJobWorkEway(out, { sender: o.sender, vendor: principal ? { ...principal, gstin: principal.gstin ?? m.party_gstin } : { name: m.party_name, gstin: m.party_gstin }, items, units: o.units, mode: o.mode });
  const bill: EwayBill = { ...b.bill, subSupplyType: EWAY_SUB_JOB_WORK_RETURN };
  const need = jwEwayNeeded(String(bill.actFromStateCode).padStart(2, '0'), String(bill.actToStateCode).padStart(2, '0'), bill.totInvValue, o.intraExempt);
  const notes = b.notes.filter((n) => !/job worker has no GSTIN|job worker's address/.test(n));
  if (!principal?.address) notes.push("The principal's address is not in the customer master: add it before uploading.");
  notes.push('Values are the principal\'s goods as on his challan (MF11: a GSTAT ruling left them out of a return\'s value — verify).', need.note);
  // QA16: references disagree on whether "job work returns" is valid with an OUTWARD supply type (MF92).
  notes.push('Outward + sub-type 6 (job work returns): if the portal refuses the combination (error 203), the principal generates it as Inward / job work returns instead — verify MF92.');
  return { payload: { ...b.payload, billLists: [bill] }, bill, notes, required: need.needed };
}

/** Job worker → job worker (ITC-04 5B): our challan, dispatched from the first job worker's premises. */
export function buildJwOnwardEway(out: MaterialOut, firstJw: Party, nextJw: Party | undefined, items: readonly StockItem[], o: JwEwayOpts): JobWorkEwayBuild {
  const b = buildJobWorkEway(out, { sender: o.sender, vendor: nextJw, items, units: o.units, mode: o.mode });
  const bill = dispatchFrom(b.bill, firstJw);
  const need = jwEwayNeeded(stateOf(firstJw), String(bill.actToStateCode).padStart(2, '0'), bill.totInvValue, o.intraExempt);
  return { payload: { ...b.payload, billLists: [bill] }, bill, notes: [...b.notes, `Dispatched from ${firstJw.name} (job worker to job worker, ITC-04 Table 5B).`, need.note], required: need.needed };
}

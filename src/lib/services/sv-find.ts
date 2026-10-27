/**
 * SV-B patient search, kept tiny and free of storage so the general client picker (editor) can use it when the clinic
 * pack is on without pulling the clinic desk's modules.
 */
import type { Client } from '../../types/invoice';

/** UHID of a patient (the clinic's patient object, else the R5-C roll no.). */
export const uhidOf = (c: Pick<Client, 'patient' | 'roll_no'> | undefined): string => String(c?.patient?.uhid || c?.roll_no || '');

/** A client matches `q` by UHID, name or (4+ digits) phone. */
export function patientMatch(c: Client, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  const digits = s.replace(/\D/g, '');
  return uhidOf(c).toLowerCase().includes(s) || String(c.name ?? '').toLowerCase().includes(s) || (digits.length >= 4 && String(c.phone ?? '').replace(/\D/g, '').includes(digits));
}

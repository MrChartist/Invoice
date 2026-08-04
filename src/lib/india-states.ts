/**
 * Indian States / UTs with their official GST state codes.
 * The first two digits of a GSTIN are the state code — this table is the
 * bridge between a GSTIN, a "Place of Supply" and the CGST+SGST vs IGST split.
 */

export interface IndianState {
  /** Two-digit GST state code, e.g. "27" */
  code: string;
  name: string;
}

export const INDIAN_STATES: IndianState[] = [
  { code: '01', name: 'Jammu & Kashmir' },
  { code: '02', name: 'Himachal Pradesh' },
  { code: '03', name: 'Punjab' },
  { code: '04', name: 'Chandigarh' },
  { code: '05', name: 'Uttarakhand' },
  { code: '06', name: 'Haryana' },
  { code: '07', name: 'Delhi' },
  { code: '08', name: 'Rajasthan' },
  { code: '09', name: 'Uttar Pradesh' },
  { code: '10', name: 'Bihar' },
  { code: '11', name: 'Sikkim' },
  { code: '12', name: 'Arunachal Pradesh' },
  { code: '13', name: 'Nagaland' },
  { code: '14', name: 'Manipur' },
  { code: '15', name: 'Mizoram' },
  { code: '16', name: 'Tripura' },
  { code: '17', name: 'Meghalaya' },
  { code: '18', name: 'Assam' },
  { code: '19', name: 'West Bengal' },
  { code: '20', name: 'Jharkhand' },
  { code: '21', name: 'Odisha' },
  { code: '22', name: 'Chhattisgarh' },
  { code: '23', name: 'Madhya Pradesh' },
  { code: '24', name: 'Gujarat' },
  { code: '26', name: 'Dadra & Nagar Haveli and Daman & Diu' },
  { code: '27', name: 'Maharashtra' },
  { code: '29', name: 'Karnataka' },
  { code: '30', name: 'Goa' },
  { code: '31', name: 'Lakshadweep' },
  { code: '32', name: 'Kerala' },
  { code: '33', name: 'Tamil Nadu' },
  { code: '34', name: 'Puducherry' },
  { code: '35', name: 'Andaman & Nicobar Islands' },
  { code: '36', name: 'Telangana' },
  { code: '37', name: 'Andhra Pradesh' },
  { code: '38', name: 'Ladakh' },
  { code: '97', name: 'Other Territory' },
  { code: '99', name: 'Other Country (Export)' },
];

const BY_CODE = new Map(INDIAN_STATES.map((s) => [s.code, s]));
const BY_NAME = new Map(INDIAN_STATES.map((s) => [s.name.toLowerCase(), s]));

export function stateByCode(code?: string): IndianState | undefined {
  if (!code) return undefined;
  return BY_CODE.get(code.trim().padStart(2, '0'));
}

/** Loose name lookup — tolerates "maharashtra", "MAHARASHTRA ", "Maharashtra". */
export function stateByName(name?: string): IndianState | undefined {
  if (!name) return undefined;
  return BY_NAME.get(name.trim().toLowerCase());
}

/** "27" -> "27 — Maharashtra" for display on the invoice's Place of Supply line. */
export function formatPlaceOfSupply(code?: string): string {
  const st = stateByCode(code);
  return st ? `${st.code} — ${st.name}` : '';
}

/** Resolve a state code from either an explicit code, a GSTIN, or a state name. */
export function resolveStateCode(opts: { code?: string; gstin?: string; name?: string }): string {
  const direct = stateByCode(opts.code);
  if (direct) return direct.code;

  const fromGstin = opts.gstin?.trim().slice(0, 2);
  const viaGstin = stateByCode(fromGstin);
  if (viaGstin) return viaGstin.code;

  return stateByName(opts.name)?.code ?? '';
}

/**
 * ITC-04 JSON (7S, roadmap 7.73) from the ITC-04 working paper (`buildItc04`).
 *
 * LAYOUT UNVERIFIED. The keys follow the GST offline tool's ITC-04 sections as publicly described —
 * `m2jw` (Table 4, manufacturer → job worker, grouped by job worker GSTIN `ctin` / state `jw_stcd`),
 * `jw2m` (Table 5A, received back from the same job worker), `jw2jw` (5B, received through another job worker)
 * and `jwsupply` (5C, supplied from the job worker's premises) — but the app has not validated this file against
 * the portal or the offline tool. Check it with the offline tool and your CA before uploading; the CSV of the same
 * paper stays the reference.
 *
 * `fp` is the return period: MMYYYY of the period's last month (e.g. "092026" for H1 2026-27). Dates are
 * dd-mm-yyyy, quantities in each item's base unit with its UQC, values in rupees. Pure.
 */
import type { Itc04Report, Itc04Table5Row } from './itc04';
import { round2 } from './invoice-calc';

/**
 * 7.167 check (Oct 2026): the layout could not be verified from a primary source. GSTN publishes the ITC-04 offline tool
 * (an Excel workbook that writes the JSON) but no JSON schema; gst.gov.in / tutorial.gst.gov.in were unreachable from
 * the build environment, and only the GSTN FAQ's "hidden module m2jw" error text corroborates one section name. So the
 * file stays a working paper: `verified: false` until a CA (or the offline tool's import) confirms it — CA item G43.
 */
export const ITC04_JSON_LAYOUT = { verified: false, checked: '2026-10-29', ca: 'G43' } as const;

export const ITC04_JSON_NOTE = 'ITC-04 JSON — layout unverified (not validated against the GST portal / offline tool); verify with your CA before uploading.';

const ddmmyyyy = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};

/** Return period code: MMYYYY of the last month of the period. */
export function itc04Fp(to: string): string {
  const m = /^(\d{4})-(\d{2})/.exec(to ?? '');
  return m ? `${m[2]}${m[1]}` : '';
}

interface Grouped<T> {
  ctin: string;
  jw_stcd: string;
  items: T[];
}

function group<T>(rows: readonly { jw_gstin: string; jw_state: string }[], map: (i: number) => T): Grouped<T>[] {
  const out = new Map<string, Grouped<T>>();
  rows.forEach((r, i) => {
    const k = `${r.jw_gstin}|${r.jw_state}`;
    const g = out.get(k) ?? { ctin: r.jw_gstin, jw_stcd: r.jw_state, items: [] };
    g.items.push(map(i));
    out.set(k, g);
  });
  return [...out.values()];
}

const t5Item = (x: Itc04Table5Row) => ({
  o_chnum: x.original_challan_no,
  o_chdt: ddmmyyyy(x.original_challan_date),
  jw2_chnum: x.jw_challan_no,
  jw2_chdt: ddmmyyyy(x.jw_challan_date),
  nat_jw: x.nature,
  desc: x.item,
  uqc: x.uqc,
  qty: round2(x.qty),
  lwuqc: x.uqc,
  lwqty: round2(x.loss_qty),
});

export interface Itc04Json {
  gstin: string;
  fp: string;
  m2jw: Grouped<Record<string, string | number>>[];
  jw2m: Grouped<ReturnType<typeof t5Item>>[];
  jw2jw: Grouped<ReturnType<typeof t5Item> & { jw_ctin: string }>[];
  jwsupply: Grouped<ReturnType<typeof t5Item>>[];
}

/** Build the JSON object (stringify with `JSON.stringify(x, null, 2)`). */
export function buildItc04Json(r: Itc04Report, gstin: string): Itc04Json {
  const t4 = r.table4;
  const pick = (t: Itc04Table5Row['table']) => r.table5.filter((x) => x.table === t);
  const t5a = pick('5A');
  const t5b = pick('5B');
  const t5c = pick('5C');
  return {
    gstin: gstin.trim().toUpperCase(),
    fp: itc04Fp(r.period.to),
    m2jw: group(t4, (i) => ({
      chnum: t4[i].challan_no,
      chdt: ddmmyyyy(t4[i].challan_date),
      // Plain text (the portal's code list for the type of goods is not confirmed here).
      goods_ty: t4[i].goods_type,
      desc: t4[i].item,
      hsn: t4[i].hsn,
      uqc: t4[i].uqc,
      qty: round2(t4[i].qty),
      txval: round2(t4[i].taxable_value),
      tx_i: t4[i].rate && t4[i].igst ? t4[i].rate : 0,
      tx_c: t4[i].rate && t4[i].cgst ? t4[i].rate / 2 : 0,
      tx_s: t4[i].rate && t4[i].sgst ? t4[i].rate / 2 : 0,
      tx_cs: 0,
    })),
    jw2m: group(t5a, (i) => t5Item(t5a[i])),
    // 5B rows are grouped by the job worker the goods were sent to; `jw_ctin` names the one they came through.
    jw2jw: group(t5b, (i) => ({ ...t5Item(t5b[i]), jw_ctin: t5b[i].jw_gstin })),
    jwsupply: group(t5c, (i) => t5Item(t5c[i])),
  };
}

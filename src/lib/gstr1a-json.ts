/**
 * 8.66 — GSTR-1A JSON (working paper). GSTR-1A (Rule 59(4A)) adds or amends records of the SAME tax period after
 * GSTR-1 is filed; `gstr1aDiff` (gst-guards.ts) lists what changed against the frozen "as filed" snapshot. This
 * writes those rows in the GSTR-1 JSON layout of `buildGstr1Json` (same sections, keys, item numbers and dates):
 *
 *  - added / changed documents (B2B, B2CL, CDNR, CDNUR, EXP) with their values as in the books now (a changed
 *    record is written whole, as revised);
 *  - B2CS: the DIFFERENCE per supply type × POS × rate (books now − as filed), only for the rows that moved;
 *  - removed documents cannot be expressed as an addition: they are returned in `removed` for the user to deal with on
 *    the portal (a removal is usually a credit note, not a GSTR-1A row);
 *  - Nil (Table 8), HSN (Table 12) and documents issued (Table 13) are not written.
 *
 * `GSTR1A_JSON_LAYOUT` holds the assumptions — NOT verified against the GSTR-1A offline tool / schema. Import it into
 * the offline tool, let it validate, and verify with your CA before filing. Pure.
 */

import { buildGstr1Json } from './gstr-json';
import { round2 } from './invoice-calc';
import type { B2csRow, Gstr1Report } from './gst-reports';
import type { Gstr1aDocRow, Gstr1aPaper } from './gst-guards';

/** Assumptions of the GSTR-1A JSON — change here only once the offline tool is checked. */
export const GSTR1A_JSON_LAYOUT = { version: 'GST3.0.4', b2csAsDifference: true, verified: false } as const;

export interface Gstr1aJsonResult {
  json: Record<string, unknown>;
  /** Documents written (added + changed). */
  docs: number;
  b2cs: number;
  /** Documents in the filed GSTR-1 that are no longer in the books — not in the JSON. */
  removed: Gstr1aDocRow[];
}

export function buildGstr1aJson(paper: Gstr1aPaper, g1: Gstr1Report): Gstr1aJsonResult {
  const want = new Set(paper.docs.filter((d) => d.kind !== 'removed').map((d) => d.id));
  const pick = <T extends { invoiceId: string }>(rows: readonly T[]) => rows.filter((r) => want.has(r.invoiceId));
  const b2cs: B2csRow[] = [];
  for (const r of paper.b2cs) {
    const a = r.after;
    const b = r.before;
    const x = a ?? b!;
    const d = (k: 'txval' | 'igst' | 'cgst' | 'sgst') => round2((a?.[k] ?? 0) - (b?.[k] ?? 0));
    const row: B2csRow = { supply: x.supply, pos: x.pos, rate: x.rate, txval: d('txval'), igst: d('igst'), cgst: d('cgst'), sgst: d('sgst'), cess: 0 };
    const etin = x.key.split('|')[3];
    if (etin) row.etin = etin;
    if (row.txval || row.igst || row.cgst || row.sgst) b2cs.push(row);
  }
  const sub: Gstr1Report = {
    ...g1,
    b2b: pick(g1.b2b),
    b2cl: pick(g1.b2cl),
    cdnr: pick(g1.cdnr),
    cdnur: pick(g1.cdnur),
    exp: pick(g1.exp),
    b2cs,
    nil: [],
    hsn: [],
    hsnB2b: [],
    hsnB2c: [],
    docIssue: [],
    amendments: undefined,
    at: undefined,
    txpd: undefined,
    eco: undefined,
  };
  const json = buildGstr1Json(sub);
  // GSTR-1 turnover fields do not belong to GSTR-1A.
  delete json.gt;
  delete json.cur_gt;
  json.version = GSTR1A_JSON_LAYOUT.version;
  const docs = sub.b2b.length + sub.b2cl.length + sub.cdnr.length + sub.cdnur.length + sub.exp.length;
  return { json, docs, b2cs: b2cs.length, removed: paper.docs.filter((d) => d.kind === 'removed') };
}

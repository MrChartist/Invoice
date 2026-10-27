/**
 * PS-A5 print helpers for the lazy paper parts (`ProfBlock`, `ProfAnnexurePage`): the professional particulars rows of
 * the `ps` snapshot (one arm per package: B legal / stage / media, C export, D UDIN) and the annexure sections (A's time
 * summary by timekeeper from the document's own annexure snapshot; B / C / D add theirs). Pure; from the snapshot only
 * (never recomputed). Write-down columns are internal (pre-bill print) and never on the client copy.
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { EngagementModel, PsSnapshot } from '../../types/prof-r14';
import { num, round2 } from '../invoice-calc';

export interface PsBox { title: string; rows: [string, string][] }
export interface PsSection { title: string; head: string[]; rows: (string | number)[][] }

export const MODEL_LABEL: Readonly<Record<EngagementModel, string>> = {
  hourly: 'Time and materials', fixed: 'Fixed fee', milestone: 'Milestones', retainer: 'Retainer', capped: 'Capped fee', success: 'Success fee', blended: 'Blended rate',
};

const rows = (pairs: [string, string | number | undefined][]): [string, string][] => pairs.filter((p) => p[1] !== undefined && p[1] !== '').map(([k, v]) => [k, String(v)]);

/** The boxes printed after the parties, in a fixed order; empty boxes are left out. */
export function psBoxes(ps: PsSnapshot): PsBox[] {
  const m = ps.matter;
  const e = ps.engagement;
  const out: PsBox[] = [{
    title: 'Professional particulars',
    rows: rows([
      ['Matter', m ? `${m.code} — ${m.name}` : undefined], ['Court / forum', m?.court], ['Case no.', m?.case_no],
      ['Engagement', e ? `${e.number} · ${MODEL_LABEL[e.model] ?? e.model}` : undefined], ['Billing basis', ps.basis],
      // PS-B: the advocate's enrolment, the design stage and the media commission
      ['Enrolment no.', ps.legal?.enrolment ? `${ps.legal.enrolment}${ps.legal.bar_council ? ` · ${ps.legal.bar_council}` : ''}` : undefined],
      ['Stage', ps.stage?.no ? `${ps.stage.no} of ${ps.stage.of}${ps.stage.label ? ` — ${ps.stage.label}` : ''}` : undefined],
      ['Media commission', ps.media?.commission_pct ? `${ps.media.commission_pct}%` : undefined],
      // PS-C: purpose code and the export check
      ['Purpose code', ps.purpose_code], ['Export check', ps.export?.checks?.length ? `${ps.export.checks.filter((c) => c.ok).length} / ${ps.export.checks.length} conditions` : undefined],
      ['EDF', ps.export?.edf_no ? `${ps.export.edf_no}${ps.export.edf_date ? ` · ${ps.export.edf_date}` : ''}` : undefined],
      // PS-D: UDINs of the certificates billed
      ['UDIN', ps.udin?.join(', ')],
    ]),
  }];
  return out.filter((b) => b.rows.length);
}

/** The annexure sections (following page): A's time summary by timekeeper from the document's annexure rows. */
export function psAnnexure(inv: Pick<InvoiceRecord, 'ps' | 'annexure'>): PsSection[] {
  const out: PsSection[] = [];
  const rs = inv.annexure?.rows ?? [];
  if (inv.ps && rs.some((r) => r.who)) {
    const by = new Map<string, { min: number; amt: number; rates: Set<number> }>();
    for (const r of rs) {
      const k = r.who || '—';
      const x = by.get(k) ?? { min: 0, amt: 0, rates: new Set<number>() };
      x.min += num(r.billed_minutes);
      x.amt += num(r.amount);
      x.rates.add(num(r.rate));
      by.set(k, x);
    }
    out.push({ title: 'Time by timekeeper', head: ['Timekeeper', 'Hours', 'Rate', 'Amount'], rows: [...by].map(([k, x]) => [k, round2(x.min / 60), x.rates.size === 1 ? [...x.rates][0] : 'Various', round2(x.amt)]) });
  }
  // PS-B: the stage computation and the media schedule (from the snapshot; the disbursement lines print as items)
  const st = inv.ps?.stage;
  if (st?.project_cost) {
    const cum = round2((num(st.project_cost) * num(st.fee_pct) * num(st.stage_pct)) / 10000);
    out.push({ title: 'Stage computation', head: ['Project cost', 'Fee %', 'Stage % (cumulative)', 'Cumulative fee', 'Billed before', 'This bill'], rows: [[num(st.project_cost), num(st.fee_pct), num(st.stage_pct), cum, num(st.billed_before), round2(cum - num(st.billed_before))]] });
  }
  if (inv.ps?.media?.rows?.length) out.push({ title: 'Media schedule', head: ['RO', 'Medium', 'Publication / platform', 'Date', 'Amount'], rows: inv.ps.media.rows.map((r) => [r.ro, r.media, r.edition ?? '', r.date ?? '', round2(num(r.amount))]) });
  return out;
}

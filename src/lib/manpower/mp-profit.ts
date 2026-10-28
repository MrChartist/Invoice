/**
 * R17-C2 site P&L for a month (pure; no posting — the cost-centre P&L stays the books' view). Per site:
 *  - billed: bills of the service month (`mp.month`) naming the site (`mp.site`, or the site's post rows on a grouped
 *    bill), arrears debit notes in, credit notes out — taxable values, GST excluded;
 *  - wages and employer PF / ESI: the C1 shares of the finalised run (apportioned by duties, MP26), relievers apart;
 *  - purchase bills tagged to the site (`PurchaseRecord.mp.site_id`: uniforms, consumables, equipment hire), at cost;
 *  - margin and margin %.
 * Reads only the month's invoices, musters, run and bills. Working papers — verify with your CA (MP25, MP26).
 */
import type { InvoiceRecord } from '../../types/invoice';
import type { SiteMuster } from '../../types/manpower-r17';
import type { Site } from './mp-sites';
import { round2 } from '../invoice-calc';
import { employerCost, siteShares, sumShares, type RunLine } from './mp-compliance';

export interface SiteBill { site_id: string; cost: number }
export interface ProfitRow { site: Site; billed: number; wages: number; relief: number; statutory: number; bills: number; margin: number; pct: number | null }

/** Taxable value a document bills for a site (signed: credit notes out). */
export function billedFor(i: InvoiceRecord, site: Site): number {
  const mp = i.mp;
  if (!mp || i.status === 'Cancelled') return 0;
  const v = mp.site ? (mp.site.id === site.id ? Number(i.taxable_value) || 0 : 0) : (mp.posts ?? []).filter((p) => p.site === site.mp.code).reduce((t, p) => t + (p.amount ?? 0), 0);
  return i.doc_type === 'CREDIT_NOTE' ? -v : v;
}

export function siteProfit(i: { month: string; sites: readonly Site[]; invoices: readonly InvoiceRecord[]; musters: readonly SiteMuster[]; lines: readonly RunLine[] | null; bills: readonly SiteBill[] }): ProfitRow[] {
  const docs = i.invoices.filter((x) => x.mp?.month === i.month);
  return i.sites.map((site) => {
    const m = i.musters.find((x) => x.site_id === site.id && x.month === i.month);
    const sh = m && i.lines ? siteShares(m, i.musters, i.lines) : [];
    const staff = sumShares(sh.filter((s) => !s.relief));
    const rel = sumShares(sh.filter((s) => s.relief));
    const billed = round2(docs.reduce((t, d) => t + billedFor(d, site), 0));
    const statutory = round2(employerCost(staff) + employerCost(rel));
    const bills = round2(i.bills.filter((b) => b.site_id === site.id).reduce((t, b) => t + b.cost, 0));
    const margin = round2(billed - staff.gross - rel.gross - statutory - bills);
    return { site, billed, wages: staff.gross, relief: rel.gross, statutory, bills, margin, pct: billed ? round2((margin / billed) * 100) : null };
  });
}

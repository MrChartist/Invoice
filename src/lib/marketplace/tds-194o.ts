/**
 * R5-A5: 194-O deducted by e-commerce operators, from imported settlements, as non-invoice expected TDS lines for the
 * TDS register and its 26AS reconciler (`buildTdsRegister` / `reconcileTds` `extraExpected`). Kept small: the TDS tab
 * loads it only with the marketplace pack on. Working paper — verify with your CA.
 */
import type { Client } from '../../types/invoice';
import type { SalesChannel, Settlement } from '../../types/marketplace-r5';
import { round2 } from '../invoice-calc';
import { tdsSections } from '../tax-rules';
import { peekTable } from '../storage';
import type { Quarter, TdsExpectedLine } from '../tds-register';
import { loadChannels, SETTLEMENTS_TABLE } from './channels';

// Same rules as `tdsPeriodOf` / `normalizeTan` in tds-register.ts, kept local (type-only import) so the TDS tab's
// chunk is not split for this lazy helper. The register test pins both to the same answers.
export function periodOf(day: string): { fy: number; quarter: Quarter; key: string } | null {
  const m = /^(\d{4})-(\d{2})-\d{2}/.exec(day);
  const mo = m ? Number(m[2]) : 0;
  if (!m || mo < 1 || mo > 12) return null;
  const fy = mo >= 4 ? Number(m[1]) : Number(m[1]) - 1;
  const quarter: Quarter = mo <= 3 ? 4 : mo <= 6 ? 1 : mo <= 9 ? 2 : 3;
  return { fy, quarter, key: `${fy}-Q${quarter}` };
}
const normalizeTan = (v: string | undefined) => (v ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase();

/**
 * Settlement `tds_194o` lines as expected TDS lines for the 26AS reconciler: deductor = the channel's operator party
 * (TAN from the channel), quarter by deposit date, base = gross sale lines of the settlement.
 */
export function tds194oExpectedLines(channels: readonly SalesChannel[], settlements: readonly Settlement[], clients: readonly Client[]): TdsExpectedLine[] {
  const out: TdsExpectedLine[] = [];
  for (const s of settlements) {
    const c = channels.find((x) => x.id === s.channel_id);
    if (!c) continue;
    const tds = round2(-s.lines.filter((l) => l.bucket === 'tds_194o').reduce((a, l) => a + l.amount, 0));
    const period = periodOf(s.deposit_date);
    if (!(tds > 0) || !period) continue;
    const gross = round2(s.lines.filter((l) => l.bucket === 'sale' || l.bucket === 'shipping_recovered').reduce((a, l) => a + l.amount, 0));
    const party = clients.find((x) => x.id === c.party_id);
    out.push({
      invoiceId: s.id,
      number: `Settlement ${s.settlement_id}`,
      date: s.deposit_date,
      fy: period.fy,
      quarter: period.quarter,
      periodKey: period.key,
      partyKey: c.party_id || `channel:${c.id}`,
      partyName: party?.name || c.name,
      pan: (party?.pan || '').toUpperCase(),
      tan: normalizeTan(c.tan || party?.tan),
      section: '194O',
      taxable: gross,
      total: gross,
      tds,
      settled: true,
    });
  }
  return out;
}


export function liveTds194oLines(): TdsExpectedLine[] {
  const settlements = peekTable<Settlement>(SETTLEMENTS_TABLE).filter((s) => s && Array.isArray(s.lines));
  return tds194oExpectedLines(loadChannels(), settlements, peekTable<Client>('clients'));
}

/**
 * The 194-O rate on a date, from the existing date-keyed TDS section history in `tax-rules.ts` (1% from 1 Oct 2020,
 * 0.75% to 31 Mar 2021, 1% again, 0.1% from 1 Oct 2024 — verify with your CA). Not duplicated in `tds-rules.ts`.
 */
export function tds194oRate(date?: string): number {
  return tdsSections(date).find((s) => s.section === '194O')?.rate ?? 0;
}

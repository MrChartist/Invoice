/**
 * R17-B4 bridge: the client's expected TDS on a manpower bill, through R14-D's receivable-side path (`expectedTds`:
 * thresholds of `tds-rules.ts`, the client's FY total, rate by OUR firm form — 1 % individual / HUF, 2 % others) on the
 * taxable value without GST (MP14). Section: `Client.mp.tds`, else 194C (manpower supply is "work" from 1 Apr 2026:
 * Sec 402(47)(f), Sec 393(1) Table Sl. 6(i); labels by the bill date through `ita2025.ts` / `MANPOWER_WORK_RULES`). A
 * client's own 194J before 1 Apr 2026 is accepted (MP15). The GST TDS u/s 51 hint for a Government client registered
 * only for TDS (`GST_TDS_51_RULES`), never on a reverse-charge bill (MP13). Working papers — verify with your CA.
 */
import { mbT } from '../../i18n/areas/manpower-r17b';
import type { Client, InvoiceRecord } from '../../types/invoice';
import type { MpRegime, MpSnapshot } from '../../types/manpower-r17';
import type { EntityType } from '../../types/books-r2';
import { ruleAt } from '../tax-rules';
import { MANPOWER_WORK_RULES } from '../tds-rules';
import { sectionText } from '../ita2025';
import { GST_TDS_51_RULES } from '../transport-works-rules';
import { expectedTds } from '../prof/ps-tds-recv';

/** `mp.tds` of a bill (null when the client deducts none or the threshold is not crossed). */
export function clientTds(client: Pick<Client, 'id' | 'name' | 'mp'>, date: string, base: number, invoices: readonly InvoiceRecord[], ourForm: string, excludeId?: string): NonNullable<MpSnapshot['tds']> | null {
  const section = client.mp?.tds?.section ?? '194C';
  const e = expectedTds({ client, def: { section }, date, base, invoices, ourForm: ourForm as EntityType, excludeId });
  if (!e?.applies || !e.amount) return null;
  const work = section === '194C' ? ruleAt(MANPOWER_WORK_RULES, date) : null;
  return { section: e.code, rate: e.rate, expected: e.amount, label: work ? `${sectionText(e.code, date)}: supply of manpower is work (from 1 Apr 2026)` : sectionText(e.code, date) };
}

/** GST TDS u/s 51 hint (2 % above the contract threshold) for a TDS-only Government client; '' otherwise. */
export function gstTdsHint(client: Pick<Client, 'mp'> | undefined, regime: MpRegime | undefined, taxable: number, date: string): string {
  const r = ruleAt(GST_TDS_51_RULES, date);
  if (!r || !client?.mp?.gst_tds_only || regime === 'rcm' || taxable <= r.threshold) return '';
  return mbT('gstTds', { r: r.rate, t: r.threshold.toLocaleString('en-IN') });
}

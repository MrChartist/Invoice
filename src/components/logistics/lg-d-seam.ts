/**
 * R19-D local seam over shared lazy code, until B's bridge `lg-issue-io.ts` / `lg-tax-io.ts` / `lg-books-io.ts` takes
 * it over at merge (D creates no bridge): the editor's document base (`makeDraft`: the sender snapshot, template,
 * terms), the LUT in force on a day (R4-C register), the currency master's rate on a day and the netted-bill roll-up
 * (`syncNettedPaid`, R15-A). The D writers take these as arguments.
 */
import { makeDraft } from '../../store/invoice-defaults';
import { localDb } from '../../lib/localDb';
import { getTable } from '../../lib/storage';
import { loadRates, rateOn } from '../../lib/currency-rates';
import { downloadText } from '../../lib/download';
import { toCsv } from '../../lib/csv';
import type { LutRow } from '../../types/trade-r4';

export { syncNettedPaid } from '../../lib/retail/rt-registry';

export const draftBase = () => makeDraft({ settings: localDb.settings.get(), sender: localDb.settings.activeProfile(), docType: 'TAX_INVOICE', templateId: localDb.template.get() });

/** The LUT on a day (the R4-C register; `f-trade` loads only when a note is issued). */
export async function lutOn(day: string): Promise<{ lut_number: string; lut_date: string } | null> {
  const { LUT_TABLE, pickLut } = await import('../../lib/trade/lut-register');
  const r = pickLut(getTable<LutRow>(LUT_TABLE), day, localDb.settings.activeProfile()?.companyGstin);
  return r ? { lut_number: r.arn, lut_date: r.filed_on } : null;
}

export const fxOn = (currency: string, day: string): number | undefined => rateOn(loadRates(), currency, day)?.rate;

export const downloadCsv = (name: string, rows: unknown[][]): void => downloadText(name, toCsv(rows), 'text/csv');

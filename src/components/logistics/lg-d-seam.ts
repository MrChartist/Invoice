/**
 * R19-D seam over shared lazy code (D creates no bridge): the editor's document base (`makeDraft`: the sender
 * snapshot, template, terms), the LUT in force on a day (B's `lg-tax-io.ts`), the currency master's rate on a day, the
 * netted-bill roll-up (`syncNettedPaid`, R15-A) and the CSV download. The D writers take these as arguments.
 */
import { makeDraft } from '../../store/invoice-defaults';
import { localDb } from '../../lib/localDb';
import { loadRates, rateOn } from '../../lib/currency-rates';
import { downloadText } from '../../lib/download';
import { toCsv } from '../../lib/csv';
import { lutOn } from '../../lib/logistics/lg-tax-io';

export { syncNettedPaid } from '../../lib/retail/rt-registry';

export const draftBase = () => makeDraft({ settings: localDb.settings.get(), sender: localDb.settings.activeProfile(), docType: 'TAX_INVOICE', templateId: localDb.template.get() });

/** The LUT on a day (B's `lg-tax-io.ts`, the R4-C register). */
export const lutOnDay = (day: string): { lut_number: string; lut_date: string } | null => lutOn(day, localDb.settings.activeProfile()?.companyGstin);

export const fxOn = (currency: string, day: string): number | undefined => rateOn(loadRates(), currency, day)?.rate;

export const downloadCsv = (name: string, rows: unknown[][]): void => downloadText(name, toCsv(rows), 'text/csv');

/** MF-D5 year-end WIP statement download (lazy: the year-end wizard and the Statutory desk). */
import { toCsv } from '../csv';
import { downloadText } from '../download';
import { liveWipStatement } from './mf-inventories-live';
import { wipSheet } from './mf-inventories';

export function downloadWipStatement(date: string): void {
  downloadText(`WIP_statement_${date}.csv`, toCsv(wipSheet(liveWipStatement(date), date)), 'text/csv');
}

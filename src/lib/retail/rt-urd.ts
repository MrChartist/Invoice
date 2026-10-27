/**
 * RT-A: the `URD/FY<yy-yy>/<seq>` series — our own number on a purchase voucher for goods bought from an unregistered
 * person (an old phone taken in exchange, RT-D3; old gold, RT-E3). The voucher is an ordinary `purchases` row whose
 * `bill_number` carries this number. Numbers come from `series-counters.ts` (highest existing + 1, above the
 * high-water mark), so a deleted voucher's number is never issued again.
 */
import { getTable } from '../storage';
import { nextSeriesNumberFor, recordSeries } from '../series-counters';
import { RT_SERIES } from './rt-shared';

export const URD_PREFIX = RT_SERIES.urd;

/** Every URD number already on a purchases row (live or not). */
export function urdNumbers(): string[] {
  return getTable<{ bill_number?: unknown }>('purchases')
    .map((p) => (typeof p?.bill_number === 'string' ? p.bill_number : ''))
    .filter((n) => n.toUpperCase().startsWith(`${URD_PREFIX}/`));
}

/** The next URD number for a voucher dated `date` (local day). Call `recordUrd` after the voucher is saved. */
export const nextUrdNumber = (date: string): string => nextSeriesNumberFor(URD_PREFIX, date, urdNumbers());

/** Remember a URD number as issued (deletes never hand it out again). */
export const recordUrd = (number: string): void => recordSeries(number);

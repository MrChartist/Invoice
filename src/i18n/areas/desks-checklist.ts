/**
 * PENDING 51 (QA19 §2, "GSTR-1 filed" on the practice desk): the built-in monthly checklist items
 * (`BUILTIN_TEMPLATE` in `src/lib/client-checklist.ts`) are stored in English; the panel shows them translated.
 * Items the user typed are data and stay as typed. Keys are the item's index in `BUILTIN_TEMPLATE`.
 */
import { defineArea } from '../area';

export const ckItemT = defineArea(
  {
    i0: 'Bank statement received',
    i1: 'Sales register shared',
    i2: 'Purchase bills received',
    i3: 'GSTR-2B downloaded',
    i4: 'GSTR-1 filed',
    i5: 'GSTR-3B filed',
    i6: 'TDS challan paid',
    i7: 'Books updated',
  } as const,
  {
    i0: 'बैंक स्टेटमेंट मिला',
    i1: 'बिक्री रजिस्टर भेजा गया',
    i2: 'खरीद बिल मिले',
    i3: 'GSTR-2B डाउनलोड किया',
    i4: 'GSTR-1 भरा गया',
    i5: 'GSTR-3B भरा गया',
    i6: 'TDS चालान जमा किया',
    i7: 'बही-खाता अपडेट किया',
  },
);

type CkKey = Parameters<typeof ckItemT>[0];
const BY_TEXT = new Map(Object.entries(ckItemT.en).map(([k, v]) => [v, k as CkKey]));

/** A checklist item's label: a built-in item in the interface language, anything typed as it is. */
export function checklistLabel(label: string): string {
  const key = BY_TEXT.get(label);
  return key ? ckItemT(key) : label;
}

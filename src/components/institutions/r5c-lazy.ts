/**
 * R5-C: the one door to the package's lazy chunk. Hosts (Recurring, Receivables, Books, GST, Settings, the bell) load
 * the screens through this tiny module, so the long preload list of the R5-C chunk is written once here instead of
 * into every host chunk.
 */
export const r5c = () => import('./r5c-screens');

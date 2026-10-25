/**
 * What still uses a stock item by id (WP-8, closing the manufacturing gap "deleting a stock item does
 * not check BOMs / vouchers"): BOMs (as finished item, component or output), Manufacturing Journals,
 * Stock Journals and Physical Stock counts. Documents and bills match items by name, so they keep
 * their own history and are not listed here. Pure over raw rows (types only).
 */

type Lines = readonly { item_id?: string }[] | undefined;

export interface ItemReferenceTables {
  boms?: readonly { item_id?: string; components?: Lines; outputs?: Lines }[];
  manufacturing?: readonly { item_id?: string; components?: Lines; outputs?: Lines }[];
  stockJournals?: readonly { consume?: Lines; produce?: Lines }[];
  physical?: readonly { lines?: Lines }[];
  /** 7M: job work orders, Material Out (`lines`) and Material In (`consumed` / `received` / `losses` / `supplied`). */
  jobWork?: readonly { finished_item_id?: string; lines?: Lines; consumed?: Lines; received?: Lines; losses?: Lines; supplied?: Lines }[];
}

/** Readable names of the record kinds that name `itemId` ([] = free to delete). */
export function itemVoucherReferences(itemId: string, t: ItemReferenceTables): string[] {
  const has = (rows: Lines) => (rows ?? []).some((l) => l?.item_id === itemId);
  const out: string[] = [];
  const boms = (t.boms ?? []).filter((b) => b?.item_id === itemId || has(b?.components) || has(b?.outputs)).length;
  if (boms) out.push(`${boms} bill${boms === 1 ? '' : 's'} of materials`);
  const mfg = (t.manufacturing ?? []).filter((v) => v?.item_id === itemId || has(v?.components) || has(v?.outputs)).length;
  if (mfg) out.push(`${mfg} manufacturing journal${mfg === 1 ? '' : 's'}`);
  const sj = (t.stockJournals ?? []).filter((v) => has(v?.consume) || has(v?.produce)).length;
  if (sj) out.push(`${sj} stock journal${sj === 1 ? '' : 's'}`);
  const phy = (t.physical ?? []).filter((v) => has(v?.lines)).length;
  if (phy) out.push(`${phy} physical stock count${phy === 1 ? '' : 's'}`);
  const jw = (t.jobWork ?? []).filter((v) => v?.finished_item_id === itemId || has(v?.lines) || has(v?.consumed) || has(v?.received) || has(v?.losses) || has(v?.supplied)).length;
  if (jw) out.push(`${jw} job work order${jw === 1 ? '' : 's'} / challan${jw === 1 ? '' : 's'}`);
  return out;
}

/**
 * Masters screen ids (WP-1) — tiny, importable without loading the masters chunk. The Gateway of
 * Tally (WIP-D) and the lead route to `/books?tab=coa&m=<screen>&mid=<item id>`.
 */
export type MasterScreen =
  | 'menu'
  | 'group-create'
  | 'group-alter'
  | 'group-display'
  | 'ledger-create'
  | 'ledger-alter'
  | 'ledger-display'
  | 'opening-tb'
  | 'billwise';

export const MASTER_SCREENS: readonly MasterScreen[] = ['menu', 'group-create', 'group-alter', 'group-display', 'ledger-create', 'ledger-alter', 'ledger-display', 'opening-tb', 'billwise'];

export function isMasterScreenParam(v: unknown): v is MasterScreen {
  return typeof v === 'string' && (MASTER_SCREENS as readonly string[]).includes(v);
}

/** In-app URL of a masters screen (Gateway links, cross-links). */
export function mastersHref(screen: MasterScreen = 'menu', itemId?: string): string {
  const q = new URLSearchParams({ tab: 'coa', m: screen });
  if (itemId) q.set('mid', itemId);
  return `/books?${q.toString()}`;
}

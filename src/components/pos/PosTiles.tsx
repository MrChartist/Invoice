import { useMemo, useState } from 'react';
import { num } from '../../lib/invoice-calc';
import { favouriteItems, groupTabs, loadFavs, saveFavs, stockClass, toggleFav } from '../../lib/pos-tiles';
import { cn, formatCurrency } from '../../lib/utils';
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import { useT } from '../../i18n';
import { posT } from '../../i18n/areas/pos';
import styles from './counter.module.css';

export interface PosTilesProps {
  sources: readonly InvoiceItem[];
  stock: readonly { name: string; group_id?: string }[];
  groups: readonly { id: string; name: string; parent_id?: string }[];
  invoices: readonly InvoiceRecord[];
  /** Stock on hand of a tracked item (null = not tracked). */
  qtyOf: (item: InvoiceItem) => number | null;
  onPick: (item: InvoiceItem) => void;
}

/** Favourites + stock-group tabs of tappable items (8.22) for loose goods without a barcode. */
export function PosTiles({ sources, stock, groups, invoices, qtyOf, onPick }: PosTilesProps) {
  useT();
  const [favs, setFavs] = useState(loadFavs);
  const [tab, setTab] = useState('fav');
  const tabs = useMemo(() => groupTabs(sources, stock, groups), [sources, stock, groups]);
  const favItems = useMemo(() => favouriteItems(sources, favs, invoices), [sources, favs, invoices]);
  if (!favItems.length && !tabs.length) return null;
  const shown = tab === 'fav' ? favItems : tabs.find((t) => t.id === tab)?.items ?? favItems;
  const star = (id: string) => {
    const next = toggleFav(favs, id);
    setFavs(next);
    saveFavs(next);
  };

  return (
    <div className={styles.tiles} role="group" aria-label={posT('tilesAria')} data-pos-tiles>
      <div className={styles.tabs} role="tablist">
        {[{ id: 'fav', name: posT('tilesFav') }, ...tabs].map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={cn(styles.tab, tab === t.id && styles.tabOn)} onClick={() => setTab(t.id)}>
            {t.name}
          </button>
        ))}
      </div>
      {tab === 'fav' && !favs.some((id) => sources.some((s) => s.id === id)) && <p className={styles.upiSmall}>{posT('tilesNoFav')}</p>}
      <div className={styles.grid}>
        {shown.map((item) => {
          const qty = qtyOf(item);
          const cls = stockClass(qty);
          const starred = favs.includes(item.id);
          return (
            <div key={item.id} className={styles.tile}>
              <button type="button" className={cn(styles.tileBtn, (cls === 'zero' || cls === 'neg') && styles.noStock)} onClick={() => onPick(item)} data-pos-tile={item.name} data-stock={cls ?? undefined}>
                <span className={styles.tileName}>{item.name}</span>
                <span className={styles.tileMeta}>
                  {formatCurrency(num(item.rate))}
                  {cls === 'zero' ? ` · ${posT('outOfStock')}` : cls === 'neg' ? ` · ${posT('negStock', { n: qty ?? 0 })}` : ''}
                </span>
              </button>
              <button type="button" className={styles.star} onClick={() => star(item.id)} aria-pressed={starred} aria-label={posT(starred ? 'tilesUnstar' : 'tilesStar', { name: item.name })}>
                {starred ? '★' : '☆'}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

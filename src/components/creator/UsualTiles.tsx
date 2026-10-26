import { useMemo } from 'react';
import type { Client, InvoiceItem } from '../../types/invoice';
import { localDb } from '../../lib/localDb';
import { usualItems } from '../../lib/party-habits';
import { todayInput } from '../../lib/utils';
import styles from './party-habits.module.css';
import { useT } from '../../i18n';
import { svcT } from '../../i18n/areas/service-r3';

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();

/**
 * R3-B6 on the POS counter: a "Usual" tile row for a saved customer (loaded by dynamic import only when
 * one is picked). A tile adds the catalogue item with the customer's last quantity through the counter's
 * own add path (prices, levels and schemes as for any scanned item).
 */
export default function UsualTiles({ client, onPick }: { client: Client; onPick: (item: InvoiceItem, qty?: number) => void }) {
  useT();
  const tiles = useMemo(() => {
    const catalog = localDb.items.getAll();
    return usualItems(localDb.invoices.getAll(), client, todayInput(), { limit: 8 })
      .map((u) => ({ u, item: catalog.find((c) => norm(c.name) === norm(u.name)) }))
      .filter((x): x is { u: typeof x.u; item: InvoiceItem } => !!x.item);
  }, [client]);
  if (!tiles.length) return null;
  return (
    <div className={styles.strip} aria-label={svcT('posUsual')} data-pos-usual>
      <span className={styles.label}>{svcT('posUsual')}</span>
      <div className={styles.tiles}>
        {tiles.map(({ u, item }) => (
          <button key={u.name} type="button" className={styles.tile} onClick={() => onPick(item, u.last_qty)} aria-label={svcT('usualAdd', { item: u.name })}>
            {u.name}
            <span>× {u.last_qty}{u.unit ? ` ${u.unit}` : ''}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Receivables → Marketplace (R5-A2…A6): channels, SKU map, sales / returns import, settlements & payout
 * reconciliation, GST TCS / TDS credit and the returns desk. Loaded lazily; listed only with the marketplace pack on
 * (its URL still opens it). Sub-view in `?view=`.
 */
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../i18n';
import { mT } from '../../i18n/areas/packs-marketplace-r5';
import { isPackOn } from '../../lib/industry-packs';
import { localDb } from '../../lib/localDb';
import { loadChannels } from '../../lib/marketplace/channels';
import type { unmappedList } from '../../lib/marketplace/sku-map';
import { ChannelsPanel } from './ChannelsPanel';
import { SkuMapPanel } from './SkuMapPanel';
import { ImportPanel } from './ImportPanel';
import { SettlementsPanel } from './SettlementsPanel';
import TcsCreditPanel from './TcsCreditPanel';
import { ReturnsPanel } from './ReturnsPanel';
import surface from '../../styles/surface.module.css';
import styles from './marketplace.module.css';

import type { Notify } from './file-read';

export type Unmapped = ReturnType<typeof unmappedList>;

const VIEWS = ['channels', 'skus', 'import', 'settlements', 'tcs', 'returns'] as const;
type View = (typeof VIEWS)[number];

export default function MarketplaceTab({ notify }: { notify: Notify }) {
  useT();
  const [params, setParams] = useSearchParams();
  const view: View = (VIEWS as readonly string[]).includes(params.get('view') ?? '') ? (params.get('view') as View) : 'channels';
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const channels = useMemo(() => loadChannels(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [channelId, setChannelId] = useState('');
  const current = channels.find((c) => c.id === channelId) ?? channels[0];
  const [unmapped, setUnmapped] = useState<Unmapped>([]);
  const packOn = isPackOn(localDb.settings.get(), 'marketplace');
  const go = (v: View) => {
    const next = new URLSearchParams(params);
    next.set('view', v);
    setParams(next, { replace: true });
  };
  const shared = { channels, channel: current, setChannelId, notify, refresh, tick };

  return (
    <div className={styles.stack}>
      {!packOn && <p className={styles.warn}>{mT('packOffNote')}</p>}
      <div className={styles.views} role="tablist" aria-label={mT('viewsAria')}>
        {VIEWS.map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? styles.viewActive : styles.view} onClick={() => go(v)} data-mkt-view={v}>
            {mT(`view.${v}`)}
          </button>
        ))}
      </div>
      <div className={surface.card}>
        <div className={surface.cardBody}>
          {view === 'channels' && <ChannelsPanel {...shared} />}
          {view === 'skus' && <SkuMapPanel {...shared} unmapped={unmapped} />}
          {view === 'import' && <ImportPanel {...shared} onUnmapped={(u) => { setUnmapped(u); }} />}
          {view === 'settlements' && <SettlementsPanel {...shared} />}
          {view === 'tcs' && <TcsCreditPanel kind="tcs" notify={notify} />}
          {view === 'returns' && <ReturnsPanel {...shared} />}
        </div>
      </div>
      <p className={styles.note}>{mT('workingPaper')}</p>
    </div>
  );
}

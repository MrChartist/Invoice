/**
 * Distribution → Transport (R5-B1 … B3): consignment notes, freight bills, trips, vehicles and the GTA option per FY.
 * Loaded lazily; listed only with the transport pack on (its URL still opens it). Sub-view in `?view=`.
 */
import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../i18n';
import { twT } from '../../i18n/areas/packs-transport-works-r5';
import { isPackOn } from '../../lib/industry-packs';
import { localDb } from '../../lib/localDb';
import { LrList } from './LrList';
import FreightBillDialog from './FreightBillDialog';
import { VehiclesPanel } from './VehiclesPanel';
import { TripsPanel } from './TripsPanel';
import { GtaOptionCard } from './GtaOptionCard';
import type { Notify } from './shared';
import styles from './transport.module.css';

const VIEWS = ['lrs', 'bills', 'trips', 'vehicles', 'settings'] as const;
type View = (typeof VIEWS)[number];

export default function TransportTab({ onDone }: { onDone: (msg: string, error?: boolean) => void }) {
  useT();
  const [params, setParams] = useSearchParams();
  const view: View = (VIEWS as readonly string[]).includes(params.get('view') ?? '') ? (params.get('view') as View) : 'lrs';
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const notify: Notify = (m, tone) => onDone(m, tone === 'error');
  const go = (v: View) => {
    const next = new URLSearchParams(params);
    next.set('view', v);
    setParams(next, { replace: true });
  };
  const shared = { notify, refresh, tick };
  return (
    <div className={styles.stack} data-transport-tab>
      {!isPackOn(localDb.settings.get(), 'transport') && <p className={styles.warn}>{twT('packOffTransport')}</p>}
      <div className={styles.views} role="tablist" aria-label={twT('tab.transport')}>
        {VIEWS.map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? styles.viewActive : styles.view} onClick={() => go(v)} data-tw-view={v}>
            {twT(`view.${v}`)}
          </button>
        ))}
      </div>
      {view === 'lrs' && <LrList {...shared} />}
      {view === 'bills' && <FreightBillDialog {...shared} />}
      {view === 'trips' && <TripsPanel {...shared} />}
      {view === 'vehicles' && <VehiclesPanel {...shared} />}
      {view === 'settings' && <GtaOptionCard {...shared} />}
      <p className={styles.note}>{twT('workingPaper')}</p>
    </div>
  );
}


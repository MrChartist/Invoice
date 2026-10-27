/**
 * Time → Works (R5-B4 … B6): BOQ and its terms, measured RA bills with the register, retention & held amounts, sites,
 * and the GST TDS (Sec 51) credit panel of R5-A5 (`kind="tds"`). Loaded lazily; listed only with the works pack on.
 */
import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../i18n';
import { twT } from '../../i18n/areas/packs-transport-works-r5';
import { isPackOn } from '../../lib/industry-packs';
import { localDb } from '../../lib/localDb';
import { listBoqs } from '../../lib/works/boq';
import { BoqPanel } from './BoqPanel';
import { MeasurementForm } from './MeasurementForm';
import { RaRegister } from './RaRegister';
import { RetentionPanel } from './RetentionPanel';
import { SitesPanel } from './SitesPanel';
import { type Notify } from '../transport/shared';
import { F } from '../transport/Field';
import controls from '../../styles/controls.module.css';
import styles from '../transport/transport.module.css';

// R5-A5's credit panel, mounted for GST TDS u/s 51 (contractors need no marketplace pack).
const TcsCreditPanel = lazy(() => import('../marketplace/TcsCreditPanel'));

// R11 (CN-A1): CN-B / CN-D append their views here ('contracts', 'advances', 'escalation', 'guarantees', 'subcon',
// 'labour', 'plant', 'reco', 'pnl'), each listed when `construction_settings.views[view]` is on (`worksViewOn`); an
// unknown view (a profile landing before its package merged) opens the BOQ view.
const VIEWS = ['boq', 'ra', 'retention', 'sites', 'gsttds'] as const;
type View = (typeof VIEWS)[number];

export default function WorksTab({ notify }: { notify: Notify }) {
  useT();
  const [params, setParams] = useSearchParams();
  const view: View = (VIEWS as readonly string[]).includes(params.get('view') ?? '') ? (params.get('view') as View) : 'boq';
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const boqs = useMemo(() => listBoqs(localDb.invoices.getAll()), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const boqId = boqs.some((b) => b.id === params.get('boq')) ? params.get('boq')! : boqs[0]?.id ?? '';
  const boq = boqs.find((b) => b.id === boqId);
  const go = (k: 'view' | 'boq', v: string) => {
    const next = new URLSearchParams(params);
    next.set(k, v);
    setParams(next, { replace: true });
  };
  const shared = { notify, refresh, tick };
  return (
    <div className={styles.stack} data-works-tab>
      {!isPackOn(localDb.settings.get(), 'works') && <p className={styles.warn}>{twT('packOffWorks')}</p>}
      <div className={styles.views} role="tablist" aria-label={twT('tab.works')}>
        {VIEWS.map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? styles.viewActive : styles.view} onClick={() => go('view', v)} data-tw-view={v}>{twT(`view.${v}`)}</button>
        ))}
      </div>
      {view !== 'gsttds' && view !== 'retention' && (
        <F l={twT('boq')}>
          <select className={controls.select} value={boqId} onChange={(e) => go('boq', e.target.value)} data-works-boq>
            {boqs.length === 0 && <option value="">{twT('noBoq')}</option>}
            {boqs.map((b) => <option key={b.id} value={b.id}>{b.invoice_number} · {b.client?.name} · {b.issue_date}</option>)}
          </select></F>
      )}
      {view === 'boq' && <BoqPanel {...shared} boq={boq} onCreated={(id) => go('boq', id)} />}
      {view === 'ra' && boq && <><MeasurementForm key={boq.id} {...shared} boq={boq} /><RaRegister {...shared} boq={boq} /></>}
      {view === 'retention' && <RetentionPanel {...shared} />}
      {view === 'sites' && boq && <SitesPanel key={boq.id} {...shared} boq={boq} />}
      {view === 'gsttds' && <Suspense fallback={null}><TcsCreditPanel kind="tds" notify={notify} /></Suspense>}
      <p className={styles.note}>{twT('workingPaper')}</p>
    </div>
  );
}

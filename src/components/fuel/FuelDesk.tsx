/**
 * R21 fuel desk (`/inventory?tab=fuel&view=`, packs `fuel` / `lpg`). Views are mounted by file name
 * (`import.meta.glob` over `./*View.tsx`, each its own lazy chunk): A ships `tanks` and `prices`; B adds `ShiftView` /
 * `DsrView`, C `DipsView` / `StockView`, D `CreditView` / `OmcView` / `LpgView` — files only, this desk is not edited
 * again (A wrote every view's label, icon and pack here). A view whose file is missing or whose pack is off is not
 * listed (its URL still opens it, when the file exists). Nothing is read until the tab opens.
 * Working papers — verify with your CA.
 */
import { lazy, Suspense, type ComponentType } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Boxes, Car, ClipboardList, Clock, Receipt, Ruler, Scale, Truck, Wallet } from 'lucide-react';
import { useT } from '../../i18n';
import { fuT } from '../../i18n/areas/fuel-r21a';
import { activePacks } from '../../lib/industry-packs';
import { localDb } from '../../lib/localDb';
import controls from '../../styles/controls.module.css';
import TanksView from './TanksView';
import PricesView from './PricesView';

export type Done = (message: string, bad?: boolean) => void;
// A's two views ship in the desk chunk (with the tank / price writers); B–D's views are lazy by file name.
const FILES = import.meta.glob<{ default: ComponentType<{ onDone: Done }> }>(['./*View.tsx', '!./TanksView.tsx', '!./PricesView.tsx']);
const AboutStrip = lazy(() => import('../help/AboutStrip'));
/** Every Round 21 view in desk order, with its icon (PRD §1.5) and pack (`lpg` for the LPG view, else `fuel`). */
const ORDER = [['shift', Clock], ['dsr', ClipboardList], ['dips', Ruler], ['stock', Scale], ['tanks', Boxes], ['prices', Receipt], ['credit', Car], ['omc', Wallet], ['lpg', Truck]] as const;
type View = (typeof ORDER)[number][0];
const load = (v: string) => FILES[`./${v[0].toUpperCase()}${v.slice(1)}View.tsx`];
const VIEWS: Record<string, ComponentType<{ onDone: Done }>> = { ...Object.fromEntries(ORDER.filter(([v]) => load(v)).map(([v]) => [v, lazy(load(v))])), tanks: TanksView, prices: PricesView };

export default function FuelDesk({ view, onDone }: { view?: string; onDone: Done }) {
  useT();
  const [, setParams] = useSearchParams();
  const on = activePacks(localDb.settings.get());
  const ids = ORDER.filter(([v]) => VIEWS[v] && (v === view || on.includes(v === 'lpg' ? 'lpg' : 'fuel')));
  const v = (VIEWS[view ?? ''] ? view : ids[0]?.[0] ?? 'tanks') as View;
  const Body = VIEWS[v];
  return (
    <section data-fuel-desk>
      <Suspense fallback={null}><AboutStrip /></Suspense>
      <div className={controls.segment} role="tablist" style={{ marginBottom: '0.75rem' }}>
        {ids.map(([k, Icon]) => (
          <button key={k} type="button" role="tab" aria-selected={k === v} className={k === v ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setParams({ tab: 'fuel', view: k }, { replace: true })} data-fuel-view={k}><Icon size={14} /> {fuT(`v.${k}`)}</button>
        ))}
      </div>
      {Body && <Suspense fallback={null}><Body onDone={onDone} /></Suspense>}
      <p className={controls.hint}>{fuT('wp')}</p>
    </section>
  );
}

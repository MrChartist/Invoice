/**
 * AG-B Dairy desk (Inventory → Dairy, pack `dairy`): views *Rate charts*, *Collection* (shift sheet with analyser and
 * scale), *Milk bills* (10-day cycles on AG-A4), *Dispatch* (union / plant, fat-SNF reconciliation), *Products* (BOM
 * starters, fat memo) and *Milk cards*. One lazy chunk (desk, views, engines and strings); nothing is read until a
 * view mounts. Working papers — verify with your CA.
 */
import { Link } from 'react-router-dom';
import { CalendarDays, ClipboardList, Package, Percent, Receipt, Truck } from 'lucide-react';
import { useT } from '../../i18n';
import { bT } from '../../i18n/areas/agri-r12b';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import type { Done } from './dairy-kit';

// One chunk for the desk and its views (gzip shares their vocabulary: ≈ 6 kB less than a chunk per view, AG-B budget).
import RateChartsView from './RateChartsView';
import CollectionView from './CollectionView';
import MilkBillsView from './MilkBillsView';
import DispatchView from './DispatchView';
import ProductsView from './ProductsView';
import MilkCardsView from './MilkCardsView';

const VIEWS = [['charts', Percent], ['collection', ClipboardList], ['bills', Receipt], ['dispatch', Truck], ['products', Package], ['cards', CalendarDays]] as const;

export default function DairyDesk({ view, onDone }: { view?: string; onDone: Done }) {
  useT();
  const v = VIEWS.some(([id]) => id === view) ? view : 'collection';
  return (
    <section className={surface.card} data-dairy-desk={v}>
      <div className={surface.cardHead}>
        <span className={controls.segment}>
          {VIEWS.map(([id, Icon]) => <Link key={id} to={`/inventory?tab=dairy&view=${id}`} className={id === v ? `${controls.segmentBtn} ${controls.segmentBtnActive}` : controls.segmentBtn}><Icon size={14} aria-hidden="true" /> {bT(`view.${id}`)}</Link>)}
        </span>
      </div>
      <div className={surface.cardBody}>
        {v === 'charts' ? <RateChartsView onDone={onDone} /> : v === 'bills' ? <MilkBillsView onDone={onDone} /> : v === 'dispatch' ? <DispatchView onDone={onDone} />
          : v === 'products' ? <ProductsView onDone={onDone} /> : v === 'cards' ? <MilkCardsView onDone={onDone} /> : <CollectionView onDone={onDone} />}
        <p className={controls.hint}>{bT('workingPaper')}</p>
      </div>
    </section>
  );
}

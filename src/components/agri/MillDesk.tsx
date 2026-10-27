/**
 * AG-C Mill desk (Inventory → Mill, pack `mill`): views *Intake* (gate entry and weighbridge slips), *Milling batches*
 * (production orders with yield, starter BOMs), *Custom milling* (CMR account with the State agency, job milling) and
 * *Yield & stock* (monthly mill report, bank stock statement with the mill preset). One lazy chunk with its views (the
 * R9 desk pattern — a chunk per view would cost more of the round's total budget than it saves).
 * Working papers — verify with your CA (AG5, AG6, AG9, AG10, AG12, AG29, AG50–AG53).
 */
import { Link } from 'react-router-dom';
import { ClipboardList, FileText, Package, Scale } from 'lucide-react';
import { useT } from '../../i18n';
import { T, W, type Done } from './mill-kit';
import IntakeView from './IntakeView';
import MillBatchesView from './MillBatchesView';
import CmrView from './CmrView';
import YieldView from './YieldView';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';

const MILL_VIEWS = [['intake', Scale], ['batches', ClipboardList], ['cmr', FileText], ['yield', Package]] as const;

export default function MillDesk({ view, onDone }: { view?: string; onDone: Done }) {
  useT();
  const v = MILL_VIEWS.some(([id]) => id === view) ? view : 'intake';
  return (
    <section className={surface.card} data-mill-desk={v}>
      <div className={surface.cardHead}>
        <span className={controls.segment} role="group" aria-label={T('v.intake')}>
          {MILL_VIEWS.map(([id, Icon]) => (
            <Link key={id} to={`/inventory?tab=mill&view=${id}`} className={id === v ? controls.segmentBtnActive : controls.segmentBtn} aria-current={id === v ? 'page' : undefined}>
              <Icon size={14} aria-hidden="true" /> {T(`v.${id}`)}
            </Link>
          ))}
        </span>
      </div>
      {v === 'intake' && <IntakeView onDone={onDone} />}
      {v === 'batches' && <MillBatchesView onDone={onDone} />}
      {v === 'cmr' && <CmrView onDone={onDone} />}
      {v === 'yield' && <YieldView />}
      <p className={controls.hint}>{W('workingPaper')}</p>
    </section>
  );
}

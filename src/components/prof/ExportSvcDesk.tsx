/**
 * R14 PS-C export-of-services desk (Time → Exports of services, pack `svcexport`), one lazy chunk. Views: *checker*
 * (Sec 2(6) per export document, party and document facts), *edf* (EDF register and the month builder), *realisation*
 * (services clock from the invoice date, FIRA / e-BRC, charges abroad), *refund* (Rule 89(4) paper and statement) and
 * *platforms* (platform list, default purpose code, "Receive via platform"). Engines: `lib/prof/ps-*`. Working papers —
 * verify with your CA.
 */
import { Link } from 'react-router-dom';
import { useT } from '../../i18n';
import { pcT } from '../../i18n/areas/prof-r14c-export';
import ExportCheckView from './ExportCheckView';
import EdfView from './EdfView';
import RealisationSvcView from './RealisationSvcView';
import RefundSvcView from './RefundSvcView';
import PlatformsView from './PlatformsView';
import type { Notify } from './pc-run';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';

const VIEWS = ['checker', 'edf', 'realisation', 'refund', 'platforms'] as const;

export default function ExportSvcDesk({ view, notify }: { view?: string; notify: Notify }) {
  useT();
  const v = (VIEWS as readonly string[]).includes(view ?? '') ? (view as (typeof VIEWS)[number]) : 'checker';
  return (
    <section className={surface.card} data-ps-desk={v}>
      <div className={surface.cardHead}>
        <span className={controls.segment}>
          {VIEWS.map((id) => <Link key={id} to={`/time?tab=exportsvc&view=${id}`} className={id === v ? controls.segmentBtnActive : controls.segmentBtn}>{pcT(`v.${id}`)}</Link>)}
        </span>
      </div>
      <div className={surface.cardBody}>
        {v === 'edf' ? <EdfView notify={notify} /> : v === 'realisation' ? <RealisationSvcView notify={notify} /> : v === 'refund' ? <RefundSvcView notify={notify} /> : v === 'platforms' ? <PlatformsView notify={notify} /> : <ExportCheckView notify={notify} />}
        <p className={controls.hint}>{pcT('wp')}</p>
      </div>
    </section>
  );
}

/**
 * PS-D5 CA / CS / CMA desk (`/time?tab=cadesk&view=`, pack `cafirm`): the fee schedule and company links, the work to
 * bill (derived from the practice desk's read-only peek, DSC, checklist and UDINs) with "Bill from the board", and the
 * UDIN register. One lazy chunk; other companies are only read (`peekCompliance`, unchanged). Verify with your CA.
 */
import { useState } from 'react';
import { useT } from '../../i18n';
import { caT } from '../../i18n/areas/prof-r14d-ca';
import controls from '../../styles/controls.module.css';
import { Views } from './ps-ui';
import CaFeesView from './CaFeesView';
import CaEventsView from './CaEventsView';
import UdinView from './UdinView';
import type { PsDeskCtx } from './ps-desk';
import type { PsDeskProps } from './ps-run';

const VIEWS = ['events', 'fees', 'udin'] as const;

export default function CaDesk({ view, notify }: PsDeskProps) {
  useT();
  const [tick, setTick] = useState(0);
  const v = (VIEWS as readonly string[]).includes(view ?? '') ? view! : 'events';
  const ctx: PsDeskCtx = {
    tick,
    run: (fn, ok = caT('saved')) => {
      try {
        const m = fn();
        const msg = typeof m === 'string' ? m : ok;
        if (msg) notify(msg);
        setTick((n) => n + 1);
        return true;
      } catch (e) {
        notify((e as Error).message, 'error');
        return false;
      }
    },
  };
  return (
    <section data-ca-desk>
      <Views tab="cadesk" views={VIEWS} value={v as (typeof VIEWS)[number]} label={(k) => caT(`view.${k}`)} />
      {v === 'fees' && <CaFeesView ctx={ctx} />}
      {v === 'events' && <CaEventsView ctx={ctx} />}
      {v === 'udin' && <UdinView ctx={ctx} />}
      <p className={controls.hint}>{caT('wp')}</p>
    </section>
  );
}

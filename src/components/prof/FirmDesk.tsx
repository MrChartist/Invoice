/**
 * PS-D Firm desk (`/time?tab=firm&view=`, pack `partners`, also `practice`): partners and their accounts (D1), the
 * year-end appropriation (D1), 194T on partner payments (D2), the 44ADA / Sec 58 paper (D4) and 194J by client (D3).
 * One lazy chunk with its views (the R13 desk pattern); nothing is read until the tab opens. Working papers — verify
 * with your CA; nothing is filed.
 */
import { useState } from 'react';
import { useT } from '../../i18n';
import { fdT } from '../../i18n/areas/prof-r14d-firm';
import controls from '../../styles/controls.module.css';
import { Views } from '../mfg/mfd-ui';
import PartnersView from './PartnersView';
import AppropriationView from './AppropriationView';
import Tds194tView from './Tds194tView';
import PresumptiveView from './PresumptiveView';
import Tds194jView from './Tds194jView';
import type { PsDeskCtx, PsDeskProps } from './ps-desk';

const VIEWS = ['partners', 'appropriation', 'tds194t', 'presumptive', 'tds194j'] as const;

export default function FirmDesk({ view, notify }: PsDeskProps) {
  useT();
  const [tick, setTick] = useState(0);
  const v = (VIEWS as readonly string[]).includes(view ?? '') ? view! : 'partners';
  const ctx: PsDeskCtx = {
    tick,
    run: (fn, ok = fdT('saved')) => {
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
    <section data-firm-desk>
      <Views tab="firm" views={VIEWS} view={v} label={(k) => fdT(`view.${k}` as 'view.partners')} />
      {v === 'partners' && <PartnersView ctx={ctx} />}
      {v === 'appropriation' && <AppropriationView ctx={ctx} />}
      {v === 'tds194t' && <Tds194tView ctx={ctx} />}
      {v === 'presumptive' && <PresumptiveView />}
      {v === 'tds194j' && <Tds194jView ctx={ctx} />}
      <p className={controls.hint}>{fdT('wp')}</p>
    </section>
  );
}

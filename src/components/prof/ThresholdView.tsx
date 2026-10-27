/**
 * R14 PS-C5: the GST registration threshold card — Time → Firm → Threshold, and the Dashboard insight for a freelancer
 * profile (`compact`). Aggregate turnover of the FY against `REGISTRATION_THRESHOLD_RULES`, warnings at 80 % / 100 %,
 * the crossing checklist. Read-only; working paper — verify with your CA (PS13).
 */
import { useMemo } from 'react';
import { localDb } from '../../lib/localDb';
import { formatCurrency, todayInput } from '../../lib/utils';
import { thresholdCard } from '../../lib/prof/ps-threshold';
import { useT } from '../../i18n';
import { thT } from '../../i18n/areas/prof-r14c-threshold';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import css from './exportsvc.module.css';

export default function ThresholdView({ compact }: { compact?: boolean }) {
  useT();
  const c = useMemo(() => {
    const p = localDb.settings.activeProfile();
    return { card: thresholdCard(localDb.invoices.getAll(), todayInput(), p?.stateCode || p?.companyGstin?.slice(0, 2)), registered: !!p?.companyGstin?.trim() };
  }, []);
  const k = c.card;
  const m = (n: number) => formatCurrency(n, 'INR');
  return (
    <section className={surface.card} data-ps-threshold={k.level}>
      <div className={surface.cardHead}><span className={surface.cardHeadIcon}>{thT('title')}</span></div>
      <div className={surface.cardBody}>
        <p>{thT('of', { turnover: m(k.turnover), limit: m(k.limit), pct: k.pct, exports: m(k.exports) })}</p>
        <progress className={css.meter} max={100} value={Math.min(k.pct, 100)} />
        <p className={k.level === 'ok' ? css.ok : css.bad}>{k.level === 'over' ? thT('over', { date: k.crossedOn ?? '' }) : k.level === 'warn' ? thT('warn', { pct: k.pct }) : thT('ok')}</p>
        {k.level !== 'ok' && !c.registered && <p data-ps-threshold-steps>{thT('steps')}</p>}
        {!compact && <p className={controls.hint}>{thT('notes')}</p>}
      </div>
    </section>
  );
}

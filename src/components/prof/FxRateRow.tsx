/**
 * R14 PS-C4 row on the pre-bill (lazy): entries priced on a rate card in another currency than the fee note — "USD 55/h ≈
 * ₹4,620/h (ref. 31-10-2026)" — and "Convert at the master rate", which fills the rows' rates (the line then carries the
 * converted rate as today; nothing new is snapshotted). Rule 34(2) note. Nothing when every card is in the note's currency.
 */
import { useMemo } from 'react';
import { getTable } from '../../lib/storage';
import { loadRates } from '../../lib/currency-rates';
import { todayInput } from '../../lib/utils';
import { entryConversions } from '../../lib/prof/ps-fx-rates';
import { useT } from '../../i18n';
import { pcT } from '../../i18n/areas/prof-r14c-export';
import controls from '../../styles/controls.module.css';

export default function FxRateRow({ entries, currency, onApply }: { entries: readonly { id: string; hourly_rate: number; work_type_id?: string }[]; currency?: string; onApply: (rates: Record<string, number>) => void }) {
  useT();
  const conv = useMemo(() => entryConversions(entries, getTable<{ id: string; ps?: { currency?: string } }>('work_types'), currency || 'INR', todayInput(), loadRates()), [entries, currency]);
  if (!conv.length) return null;
  const ok = conv.filter((c) => !c.missing);
  const hints = [...new Set(conv.map((c) => (c.missing ? pcT('fxMissing', { from: c.from }) : pcT('fxHint', { from: c.from, rate: c.original, inr: c.inr ?? 0, to: c.to, conv: c.rate, date: c.refDate ?? '' }))))];
  return (
    <div className={controls.row} data-ps-fx>
      <span className={controls.hint}>{hints.join(' · ')}</span>
      {ok.length > 0 && <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => onApply(Object.fromEntries(ok.map((c) => [c.id, c.rate])))} data-ps-fx-apply>{pcT('fxApply')}</button>}
      <span className={controls.hint}>{pcT('rule342')}</span>
    </div>
  );
}

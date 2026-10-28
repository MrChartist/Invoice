/**
 * TR-A1 editor sub-row (trade discounts on): compound discount "18+4" and ₹ per unit. The line's own % cell keeps
 * the EFFECTIVE percent (what every reader uses); these are snapshots printed as "Disc 18 + 4 %". A % typed in the
 * line cell clears them; a rate change re-derives the %. Below-minimum-margin lines are flagged here (and held for a
 * clerk under credit policy Block — loading this module registers that check).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import type { InvoiceItem } from '../../types/invoice';
import { effectivePercent, parseChain, reconcileDiscount } from '../../lib/trade/tr-discounts';
import { liveMinMargin, marginShortfalls } from '../../lib/trade/tr-margin';
import { liveUnitCosts } from '../../lib/margin';
import { useT } from '../../i18n';
import { aT } from '../../i18n/areas/trade-r8a';
import controls from '../../styles/controls.module.css';
import own from './trade.module.css';

export default function LineDiscountCell({ item, index }: { item: InvoiceItem; index: number }) {
  useT();
  const last = useRef<number | undefined>(item.disc_chain || item.disc_per_unit ? item.discount_percent : undefined);
  const [text, setText] = useState(() => (item.disc_chain ?? []).join('+'));
  const floor = useMemo(() => {
    try {
      const minFor = liveMinMargin();
      return { minFor, costs: liveUnitCosts() };
    } catch {
      return null;
    }
  }, []);
  useEffect(() => {
    const fix = reconcileDiscount(item, last.current);
    if (!fix) {
      // A party rate (or an undo) may set the chain from outside: follow it.
      if (item.disc_chain?.length || item.disc_per_unit) last.current = item.discount_percent;
      const shown = parseChain(text);
      if ((shown || !text.trim()) && (shown ?? []).join('+') !== (item.disc_chain ?? []).join('+')) setText((item.disc_chain ?? []).join('+'));
      return;
    }
    if ('discount_percent' in fix) last.current = fix.discount_percent;
    else setText('');
    useInvoiceStore.getState().patchItem(item.id, fix);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);
  const apply = (chain: number[] | undefined, perUnit: number | undefined) => {
    const pct = chain?.length || perUnit ? effectivePercent(chain, perUnit, Number(item.rate) || 0) : 0;
    last.current = pct;
    useInvoiceStore.getState().patchItem(item.id, { disc_chain: chain?.length ? chain : undefined, disc_per_unit: perUnit || undefined, discount_percent: pct });
  };
  const bad = text.trim() !== '' && !parseChain(text);
  const low = floor && !item.free_of ? marginShortfalls([item], floor.costs, floor.minFor)[0] : undefined;
  return (
    <div className={own.inline} data-line-disc={index}>
      <label>
        {aT('chain')}{' '}
        <input
          className={controls.ghost} size={9} value={text} placeholder="18+4" aria-invalid={bad} data-disc-chain={index}
          onChange={(e) => {
            setText(e.target.value);
            const c = parseChain(e.target.value);
            if (c || !e.target.value.trim()) apply(c ?? undefined, item.disc_per_unit);
          }}
        />
      </label>
      <label>
        {aT('perUnit')}{' '}
        <input className={controls.ghost} type="number" min={0} step="0.01" size={6} value={item.disc_per_unit ?? ''} onChange={(e) => apply(item.disc_chain, Math.max(Number(e.target.value) || 0, 0))} data-disc-unit={index} />
      </label>
      {(item.disc_chain?.length || item.disc_per_unit) ? <span className={own.muted} data-disc-eff={index}>= {Math.round((item.discount_percent ?? 0) * 100) / 100}%</span> : null}
      {bad && <span className={own.bad}>{aT('chainBad')}</span>}
      {low && <span className={own.bad} data-margin-low={index}>{aT('marginLow', { pct: low.pct, min: low.min })}</span>}
    </div>
  );
}

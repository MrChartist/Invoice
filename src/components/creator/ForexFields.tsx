import { useEffect, useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { loadRates, rateOn } from '../../lib/currency-rates';
import { reachT } from '../../i18n/areas/reach';
import { NumberInput } from '../ui/NumberInput';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { formatCurrency } from '../../lib/utils';
import { inrValue } from '../../lib/fx';
import controls from '../../styles/controls.module.css';
import { useT } from '../../i18n';
import { edT } from '../../i18n/areas/editor';

/**
 * Exchange rate (shown when the document currency is not INR) and, for exports, the
 * shipping-bill details GSTR-1 (EXP) and the e-Invoice carry.
 */
export function ForexFields() {
  useT(); // re-render on a language switch (5.4)
  const s = useInvoiceStore(
    useShallow((st) => ({
      currency: st.currency,
      exchange_rate: st.exchange_rate,
      issue_date: st.issue_date,
      supply_type: st.supply_type,
      place_of_supply: st.place_of_supply,
      shipping_bill_no: st.shipping_bill_no,
      shipping_bill_date: st.shipping_bill_date,
      port_code: st.port_code,
      total: st.total,
      patch: st.patch,
    })),
  );
  const cur = (s.currency || 'INR').toUpperCase();
  const foreign = cur !== 'INR';
  // Currency master (8H): the reference rate dated on or before the document date.
  const ref = useMemo(() => (foreign && s.issue_date ? rateOn(loadRates(), cur, s.issue_date) : null), [foreign, cur, s.issue_date]);
  const { patch, exchange_rate } = s;
  useEffect(() => {
    if (ref && !exchange_rate) patch({ exchange_rate: ref.rate });
  }, [ref, exchange_rate, patch]);
  const exportSupply =
    s.supply_type === 'EXPORT_LUT' || s.supply_type === 'EXPORT_WITH_PAYMENT' || s.place_of_supply === '99' || s.place_of_supply === '96';
  if (!foreign && !exportSupply) return null;
  const rate = s.exchange_rate ?? 0;

  return (
    <>
      {foreign && (
        <div className={controls.field}>
          <label className={controls.label} htmlFor="fx-rate">{edT('fxRate', { currency: cur })}</label>
          <NumberInput
            id="fx-rate"
            className={`${controls.input} ${controls.inputNumeric}`}
            value={rate}
            onChange={(n) => s.patch({ exchange_rate: n > 0 ? n : undefined })}
            placeholder={edT('fxRatePh')}
          />
          <span className={controls.hint}>
            {rate > 0
              ? edT('fxTotal', { amount: formatCurrency(inrValue(s.total, { currency: cur, exchange_rate: rate })) })
              : edT('fxHint')}
            {ref && <> · {reachT('fxRef', { rate: ref.rate, date: ref.date, source: ref.source })}</>}
          </span>
        </div>
      )}
      {exportSupply && (
        <div className={controls.row3}>
          <label className={controls.field}>
            <span className={controls.label}>{edT('fxBill')}</span>
            <input className={controls.input} value={s.shipping_bill_no ?? ''} onChange={(e) => s.patch({ shipping_bill_no: e.target.value || undefined })} placeholder={edT('fxOptional')} />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{edT('fxBillDate')}</span>
            <input className={controls.input} type="date" value={s.shipping_bill_date ?? ''} onChange={(e) => s.patch({ shipping_bill_date: e.target.value || undefined })} />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{edT('fxPort')}</span>
            <input className={controls.input} maxLength={6} value={s.port_code ?? ''} onChange={(e) => s.patch({ port_code: e.target.value.toUpperCase() || undefined })} placeholder={edT('fxPortPh')} />
          </label>
        </div>
      )}
    </>
  );
}

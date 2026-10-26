/**
 * R4-C1 "Export details" fieldset in the editor, shown with the shipping-bill fields (lazy, export documents only):
 * Incoterms, ports, countries, pre-carriage, vessel / flight, marks & numbers, payment terms.
 */
import { useShallow } from 'zustand/react/shallow';
import type {} from '../../types/trade-r4';
import { COUNTRIES, INCOTERMS, cleanExportFields, countryCode, type ExportFieldKey } from '../../lib/trade/exporter';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { useT } from '../../i18n';
import { trT } from '../../i18n/areas/trade-trust-r4';
import controls from '../../styles/controls.module.css';
import styles from './trade.module.css';

export default function ExportDetailsFields() {
  useT();
  const s = useInvoiceStore(
    useShallow((st) => ({
      incoterm: st.incoterm,
      port_of_loading: st.port_of_loading,
      port_of_discharge: st.port_of_discharge,
      country_of_origin: st.country_of_origin,
      country_of_destination: st.country_of_destination,
      pre_carriage: st.pre_carriage,
      vessel_flight: st.vessel_flight,
      marks_numbers: st.marks_numbers,
      export_payment_terms: st.export_payment_terms,
      patch: st.patch,
    })),
  );
  const set = (k: ExportFieldKey, v: string) => s.patch(cleanExportFields({ [k]: v }));
  const text = (k: ExportFieldKey, label: string, ph?: string) => (
    <label className={`${controls.field} ${styles.grow}`}>
      <span className={controls.label}>{label}</span>
      <input className={controls.input} value={s[k] ?? ''} placeholder={ph} onChange={(e) => s.patch({ [k]: e.target.value || undefined })} onBlur={(e) => set(k, e.target.value)} />
    </label>
  );
  const country = (k: 'country_of_origin' | 'country_of_destination', label: string) => (
    <label className={`${controls.field} ${styles.grow}`}>
      <span className={controls.label}>{label}</span>
      <select className={controls.select} value={countryCode(s[k])} onChange={(e) => set(k, e.target.value)}>
        <option value="">{k === 'country_of_origin' ? 'IN — India' : trT('countryPick')}</option>
        {COUNTRIES.map((c) => <option key={c.code} value={c.code}>{c.code} — {c.name}</option>)}
      </select>
    </label>
  );
  return (
    <fieldset className={styles.panel} data-export-details>
      <legend className={controls.label}>{trT('exportDetails')}</legend>
      <div className={styles.inline}>
        <label className={`${controls.field} ${styles.narrow}`}>
          <span className={controls.label}>{trT('incoterm')}</span>
          <select className={controls.select} value={s.incoterm ?? ''} onChange={(e) => set('incoterm', e.target.value)}>
            <option value="">{trT('incotermNone')}</option>
            {INCOTERMS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        {text('pre_carriage', trT('preCarriage'))}
        {text('vessel_flight', trT('vessel'))}
      </div>
      <div className={styles.inline}>
        {text('port_of_loading', trT('portLoading'))}
        {text('port_of_discharge', trT('portDischarge'))}
      </div>
      <div className={styles.inline}>
        {country('country_of_origin', trT('origin'))}
        {country('country_of_destination', trT('destination'))}
      </div>
      <div className={styles.inline}>
        {text('marks_numbers', trT('marks'))}
        {text('export_payment_terms', trT('payTerms'), trT('payTermsPh'))}
      </div>
      <p className={styles.muted}>{trT('exportFieldsHint')}</p>
    </fieldset>
  );
}

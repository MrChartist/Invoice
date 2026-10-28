/**
 * PENDING 11 (MF-C3, ITC-04 5C): "Dispatched from a job worker" on the invoice e-Way dialog (lazy; mounted by
 * `EInvoiceModal` only with a manufacturing pack). Picking a job worker hands the dialog a transform built on
 * `dispatchFrom` (`mf-eway-jw.ts`): the bill keeps our GSTIN as supplier, the dispatch-from side becomes the job worker's
 * premises (transaction type 3 / 4). Blank = our own premises (the bill is unchanged).
 */
import { useMemo } from 'react';
import type { EwayBill } from '../../lib/eway';
import { dispatchFrom, JW_EWAY_CA } from '../../lib/mfg/mf-eway-jw';
import { vendorsDb } from '../../lib/vendors';
import { useT } from '../../i18n';
import { gT } from '../../i18n/areas/mfg-r13c';
import controls from '../../styles/controls.module.css';

export type BillFix = (b: EwayBill) => EwayBill;

export default function EwayDispatchFrom({ value, onChange }: { value: string; onChange: (id: string, fix: BillFix | null) => void }) {
  useT();
  const vendors = useMemo(() => vendorsDb.all().filter((v) => v.id && v.name), []);
  const pick = (id: string) => {
    const v = vendors.find((x) => x.id === id);
    onChange(v ? id : '', v ? (b) => dispatchFrom(b, v) : null);
  };
  return (
    <div data-eway-dispatch-from>
      <label className={controls.label} htmlFor="eway-dispatch-from">{gT('dispatchFromJw')}</label>
      <select id="eway-dispatch-from" className={controls.select} value={value} onChange={(e) => pick(e.target.value)}>
        <option value="">{gT('ourPremises')}</option>
        {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
      </select>
      {value && <p className={controls.hint}>{JW_EWAY_CA}</p>}
    </div>
  );
}

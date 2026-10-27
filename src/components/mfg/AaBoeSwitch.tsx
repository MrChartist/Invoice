/**
 * MF-D4 row in the R4-C BOE duty sheet (lazy, `shopfloor` pack only): "Under authorisation" — tag the saved import bill
 * to an open AA / EPCG and show the duty foregone (BCD + SWS + other + IGST + cess) as a memo; nothing is posted.
 */
import { useState } from 'react';
import { sdT } from '../../i18n/areas/mfg-r13d-stat';
import type { BoeDuty } from '../../types/trade-r4';
import type { PurchaseRecord } from '../../types/purchases';
import { purchasesDb } from '../../lib/purchases';
import { authorisationsDb, dutyForegone } from '../../lib/mfg/mf-authorisations';
import { rs, sm } from './mfd-util';
import controls from '../../styles/controls.module.css';

export default function AaBoeSwitch({ bill, duty }: { bill?: PurchaseRecord; duty: BoeDuty | null }) {
  const open = authorisationsDb.all().filter((a) => a.status === 'open');
  const [id, setId] = useState(bill?.mf?.authorisation_id ?? '');
  const [msg, setMsg] = useState('');
  if (!open.length && !id) return null;
  const memo = dutyForegone(duty ?? undefined);
  const tag = () => {
    if (!bill) return;
    try {
      purchasesDb.save({ ...bill, mf: { ...bill.mf, authorisation_id: id || undefined, duty_foregone: id ? memo.total : undefined } });
      setMsg(sdT('tagged'));
    } catch (e) {
      setMsg((e as Error).message);
    }
  };
  return (
    <div data-mfd-boe>
      <label className={controls.field}><span className={controls.label}>{sdT('underAa')}</span>
        <select className={controls.select} value={id} onChange={(e) => setId(e.target.value)} data-mfd="boe-aa">
          <option value="">—</option>
          {open.map((a) => <option key={a.id} value={a.id}>{a.kind === 'aa' ? 'AA' : 'EPCG'} {a.number}</option>)}
        </select>
      </label>
      {id && <p className={controls.hint}>{sdT('foregone', { v: rs(memo.total) })}</p>}
      {bill && <button type="button" className={sm} onClick={tag} data-mfd-b="boe-tag">{sdT('tagBill')}</button>}
      {msg && <span role="status"> {msg}</span>}
    </div>
  );
}

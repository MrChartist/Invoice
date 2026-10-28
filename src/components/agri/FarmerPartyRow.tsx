/**
 * PENDING #18 (AG-A2): the "Farmer" section of the vendor and client forms — lazy, shown when an agri pack is on or the
 * party already is a farmer. Edits the same `ag` fields as Farm → Farmers (code, village, member no., Aadhaar last four,
 * KCC, UPI); centre, bank, crops … stay on Farm → Farmers and are kept as they are.
 */
import { useState } from 'react';
import { useT } from '../../i18n';
import { agT } from '../../i18n/areas/agri-r12a';
import { farmerPatch, type FarmerFields, type FarmerPatch } from '../../lib/agri/ag-party-form';
import { nextFarmerCode } from '../../lib/agri/ag-farmers';
import { vendorsDb } from '../../lib/vendors';
import { localDb } from '../../lib/localDb';
import type { AgParty } from '../../types/agri-r12';
import type { PrincipalKind } from '../../types/trade-r8';
import controls from '../../styles/controls.module.css';

type Party = { ag?: AgParty; principal_kind?: PrincipalKind };

export default function FarmerPartyRow({ party, side, onChange, onProblem }: { party: Party; side: 'vendor' | 'client'; onChange: (p: FarmerPatch) => void; onProblem: (msg: string) => void }) {
  useT();
  const [prev] = useState<Party>(() => party);
  const [on, setOn] = useState(!!party.ag);
  const [f, setF] = useState<FarmerFields>(() => ({ code: party.ag?.code ?? '', village: party.ag?.village, member_no: party.ag?.member_no, aadhaar_last4: party.ag?.aadhaar_last4, kcc_no: party.ag?.kcc_no, upi: party.ag?.upi, member: party.ag?.member }));
  const [problem, setProblem] = useState('');
  const apply = (nextOn: boolean, next: FarmerFields) => {
    setOn(nextOn);
    setF(next);
    const r = farmerPatch(nextOn, next, prev, side);
    setProblem(r.problem);
    onProblem(r.problem);
    if (!r.problem) onChange(r.patch);
  };
  const tick = (checked: boolean) => {
    const code = f.code || (checked ? nextFarmerCode([...vendorsDb.all(), ...localDb.clients.getAll()].map((p) => p.ag?.code)) : '');
    apply(checked, { ...f, code });
  };
  const fld = (k: Exclude<keyof FarmerFields, 'member'>, label: string, extra?: { inputMode?: 'numeric'; maxLength?: number }) => (
    <label className={controls.field}>
      <span className={controls.label}>{label}</span>
      <input className={controls.input} value={f[k] ?? ''} onChange={(e) => apply(true, { ...f, [k]: e.target.value })} data-ag-party-field={k} {...extra} />
    </label>
  );
  return (
    <fieldset className={controls.field} data-ag-party-row={side}>
      <label className={controls.check}><input type="checkbox" checked={on} onChange={(e) => tick(e.target.checked)} data-ag-party-farmer /> {agT('partyIsFarmer')}</label>
      {on && (
        <>
          <div className={controls.row}>
            {fld('code', agT('code'))}
            {fld('village', agT('village'))}
            {fld('member_no', agT('memberNo'))}
          </div>
          <div className={controls.row}>
            {fld('aadhaar_last4', agT('aadhaar4'), { inputMode: 'numeric', maxLength: 4 })}
            {fld('kcc_no', agT('kccNo'))}
            {fld('upi', agT('upiId'))}
          </div>
          <label className={controls.check}><input type="checkbox" checked={!!f.member} onChange={(e) => apply(true, { ...f, member: e.target.checked })} /> {agT('member')}</label>
          <span className={controls.hint}>{agT('partyFarmerHint')}</span>
          {problem && <p className={controls.hint} role="alert">{problem}</p>}
        </>
      )}
    </fieldset>
  );
}

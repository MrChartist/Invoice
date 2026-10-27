/** AG-D4 licences (fertiliser / seed / insecticide / FSSAI …) with expiry notices; principal certificates (O-form) per manufacturer; bills missing one. */
import { useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { agdT, type AgdKey } from '../../i18n/areas/agri-r12d';
import { getTable } from '../../lib/storage';
import { todayInput } from '../../lib/utils';
import { LICENCE_KINDS, agriLicenceNotices, classIndex, principalWarnings } from '../../lib/agri/ag-licences';
import { readAgriSettings, saveAgriSettings } from '../../lib/agri/ag-settings';
import type { AgriLicence, AgriPrincipal } from '../../types/agri-r12d';
import { F, Sel, Tbl } from './agd-kit';
import { btn, useRun, wrap, type Done } from './agd-ui';
import controls from '../../styles/controls.module.css';

const kindOpts = () => LICENCE_KINDS.map((k) => [k, agdT(`lk.${k}` as AgdKey)] as const);
const PK = ['fertiliser', 'insecticide', 'seed'] as const;

export default function LicencesView({ onDone }: { onDone: Done }) {
  const { tick, run } = useRun(onDone);
  const day = todayInput();
  const s = useMemo(() => { void tick; return readAgriSettings(); }, [tick]);
  const lics = s.licences ?? [];
  const pcs = s.principals ?? [];
  const [l, setL] = useState<AgriLicence>({ kind: 'fertiliser_retail', number: '', issued_by: '', valid_from: '', valid_to: '' });
  const [p, setP] = useState<AgriPrincipal>({ vendor_id: '', kind: 'fertiliser', ref: '', valid_to: '' });
  const vendors = getTable<{ id: string; name: string }>('vendors').map((v) => [v.id, v.name] as const);
  const notices = new Map(agriLicenceNotices(lics, day).map((n) => [n.licence, n]));
  const idx = classIndex();
  const missing = principalWarnings(getTable('purchases'), pcs, (n) => idx.get(n));
  return (
    <>
      <div style={wrap}>
        <F label={agdT('kind')}><Sel value={l.kind} onChange={(v) => setL({ ...l, kind: v as AgriLicence['kind'] })} opts={kindOpts()} /></F>
        <F label={agdT('number')}><input className={controls.input} value={l.number} onChange={(e) => setL({ ...l, number: e.target.value })} data-agd="lic-no" /></F>
        <F label={agdT('issuedBy')}><input className={controls.input} value={l.issued_by} onChange={(e) => setL({ ...l, issued_by: e.target.value })} /></F>
        <F label={agdT('validFrom')}><input type="date" className={controls.input} value={l.valid_from} onChange={(e) => setL({ ...l, valid_from: e.target.value })} /></F>
        <F label={agdT('validTo')}><input type="date" className={controls.input} value={l.valid_to} onChange={(e) => setL({ ...l, valid_to: e.target.value })} data-agd="lic-to" /></F>
        <button type="button" className={controls.btnPrimary} onClick={() => run(() => {
          if (!l.number.trim()) throw new Error(agdT('numberNeed'));
          saveAgriSettings({ licences: [...lics, { ...l, number: l.number.trim(), issued_by: l.issued_by.trim(), ...(l.valid_from ? {} : { valid_from: undefined }), ...(l.valid_to ? {} : { valid_to: undefined }) }] });
          setL({ ...l, number: '' });
          return agdT('saved');
        })} data-agd-add-licence>{agdT('add')}</button>
      </div>
      <Tbl
        head={[agdT('kind'), agdT('number'), agdT('issuedBy'), agdT('validTo'), '', '']}
        flag={lics.map((x) => !!notices.get(x)?.expired)}
        rows={lics.map((x, i) => { const n = notices.get(x); return [agdT(`lk.${x.kind}` as AgdKey), x.number, x.issued_by, x.valid_to ?? '', n ? agdT(n.expired ? 'expired' : n.soon ? 'dueSoon' : 'due60') : '',
          <button key="d" type="button" className={btn} aria-label={agdT('delete')} onClick={() => run(() => { saveAgriSettings({ licences: lics.filter((_, j) => j !== i) }); return agdT('deleted'); })}><Trash2 size={14} aria-hidden="true" /></button>]; })}
      />
      <h3>{agdT('principals')}</h3>
      <div style={wrap}>
        <F label={agdT('manufacturer')}><Sel value={p.vendor_id} onChange={(v) => setP({ ...p, vendor_id: v })} opts={vendors} blank="—" /></F>
        <F label={agdT('kind')}><Sel value={p.kind} onChange={(v) => setP({ ...p, kind: v as AgriPrincipal['kind'] })} opts={PK.map((k) => [k, agdT(`pk.${k}`)] as const)} /></F>
        <F label={agdT('ref')}><input className={controls.input} value={p.ref} onChange={(e) => setP({ ...p, ref: e.target.value })} /></F>
        <F label={agdT('validTo')}><input type="date" className={controls.input} value={p.valid_to} onChange={(e) => setP({ ...p, valid_to: e.target.value })} /></F>
        <button type="button" className={btn} onClick={() => run(() => {
          if (!p.vendor_id || !p.ref.trim()) throw new Error(agdT('numberNeed'));
          saveAgriSettings({ principals: [...pcs, { ...p, vendor_name: vendors.find((v) => v[0] === p.vendor_id)?.[1], ref: p.ref.trim(), ...(p.valid_to ? {} : { valid_to: undefined }) }] });
          return agdT('saved');
        })}>{agdT('add')}</button>
      </div>
      <Tbl head={[agdT('manufacturer'), agdT('kind'), agdT('ref'), agdT('validTo'), '']} rows={pcs.map((x, i) => [x.vendor_name ?? x.vendor_id, agdT(`pk.${x.kind}`), x.ref, x.valid_to ?? '',
        <button key="d" type="button" className={btn} aria-label={agdT('delete')} onClick={() => run(() => { saveAgriSettings({ principals: pcs.filter((_, j) => j !== i) }); return agdT('deleted'); })}><Trash2 size={14} aria-hidden="true" /></button>])} />
      {!!missing.length && <><h3>{agdT('noPrincipal')}</h3><Tbl head={[agdT('bill'), agdT('date'), agdT('manufacturer'), agdT('kind')]} rows={missing.map((m) => [m.bill, m.date, m.vendor, agdT(`pk.${m.kind}`)])} /></>}
      <p className={controls.hint}>{agdT('licenceNote')}</p>
    </>
  );
}

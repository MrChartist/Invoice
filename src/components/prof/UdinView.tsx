/** PS-D5 UDIN register: add (format check marked verify), revoke, delete, and the UDINs not yet billed. */
import { useMemo, useState } from 'react';
import { caT } from '../../i18n/areas/prof-r14d-ca';
import { todayInput } from '../../lib/utils';
import { localDb } from '../../lib/localDb';
import { UDIN_KINDS, deleteUdin, loadUdins, revokeUdin, saveUdin, udinProblems, unbilledUdins } from '../../lib/prof/ps-udin';
import { readCaSettings } from '../../lib/prof/ps-d-settings';
import type { UdinRow } from '../../types/prof-r14d';
import { Fld, Tbl } from './ps-d-ui';
import { sm, type PsDeskCtx, row } from './ps-desk';
import controls from '../../styles/controls.module.css';

export default function UdinView({ ctx }: { ctx: PsDeskCtx }) {
  const today = todayInput();
  const d = useMemo(() => { void ctx.tick; return { rows: loadUdins(), clients: localDb.clients.getAll(), invoices: localDb.invoices.getAll() }; }, [ctx.tick]);
  const [f, setF] = useState({ udin: '', date: today, client_id: '', kind: 'certificate' as UdinRow['kind'], description: '', member_no: readCaSettings().member_no ?? '', fy: '', pan: '' });
  const [reason, setReason] = useState('');
  const problems = f.udin ? udinProblems(f.udin, f.member_no, f.date) : [];
  const unbilled = new Set(unbilledUdins(d.rows, d.invoices).map((r) => r.id));
  const name = (id: string) => d.clients.find((c) => c.id === id)?.name ?? '—';
  const inp = (k: 'udin' | 'description' | 'member_no' | 'fy' | 'pan', w = 150) => <input className={controls.input} style={{ maxWidth: w }} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-ps={`u-${k}`} />;
  return (
    <>
      <div style={row}>
        <Fld l={caT('udin')}>{inp('udin', 200)}</Fld>
        <Fld l={caT('date')}><input type="date" className={controls.input} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Fld>
        <Fld l={caT('client')}>
          <select className={controls.select} value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value })} data-ps="u-client"><option value="">—</option>{d.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </Fld>
        <Fld l={caT('kind')}>
          <select className={controls.select} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as UdinRow['kind'] })}>{UDIN_KINDS.map((k) => <option key={k} value={k}>{caT(`k.${k}`)}</option>)}</select>
        </Fld>
        <Fld l={caT('desc')}>{inp('description', 220)}</Fld>
        <Fld l={caT('member')}>{inp('member_no', 110)}</Fld>
        <Fld l={caT('fyPan')}>{inp('pan', 130)}</Fld>
        <button type="button" className={controls.btnPrimary} onClick={() => ctx.run(() => { saveUdin({ ...f, ...(f.pan ? {} : { pan: undefined }), ...(f.fy ? {} : { fy: undefined }), client_name: name(f.client_id) }); setF({ ...f, udin: '', description: '' }); })} data-ps-b="u-add">{caT('add')}</button>
      </div>
      {problems.length > 0 && <p role="status" className={controls.hint}>{caT('fmt', { problems: problems.join(' ') })}</p>}
      <div style={row}><Fld l={caT('reason')}><input className={controls.input} value={reason} onChange={(e) => setReason(e.target.value)} /></Fld></div>
      <Tbl empty={caT('none')} head={[caT('udin'), caT('date'), caT('client'), caT('kind'), caT('desc'), '']} rows={d.rows.map((r) => [
        `${r.udin}${unbilled.has(r.id) ? ` · ${caT('unbilled')}` : ''}`, r.date, name(r.client_id), caT(`k.${r.kind}`), r.revoked ? `${caT('revoked')} ${r.revoked.date}: ${r.revoked.reason}` : r.description,
        <span key="a">
          {!r.revoked && <button type="button" className={sm} disabled={!reason} onClick={() => ctx.run(() => revokeUdin(r.id, today, reason))}>{caT('revoke')}</button>}
          <button type="button" className={sm} onClick={() => ctx.run(() => deleteUdin(r.id, d.invoices))}>{caT('del')}</button>
        </span>,
      ])} />
    </>
  );
}

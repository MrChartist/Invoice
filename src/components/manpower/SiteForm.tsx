/**
 * R17-A2 site form: name, code (suggested `S-<seq>`), client, address / State, contract, status and the posts grid
 * (name, SAC suggested from the name and kind — a typed SAC wins —, heads, shift hours, basis, rate); the client's
 * regime flags (`Client.mp`; B4 / D2 add the TDS section). Saving writes the cost centre and the client flags.
 */
import { useState } from 'react';
import { useT } from '../../i18n';
import { mpList, mpT } from '../../i18n/areas/manpower-r17a';
import { generateId } from '../../lib/storage';
import { localDb } from '../../lib/localDb';
import { todayInput } from '../../lib/utils';
import type { Client } from '../../types/invoice';
import type { ClientMp, MpBasis, MpPost, SiteInfo, SiteStatus } from '../../types/manpower-r17';
import { MP_BASES, SITE_STATUSES, suggestSac, suggestSiteCode, type Site } from '../../lib/manpower/mp-sites';
import { saveClientMp, saveSite } from '../../lib/manpower/mp-sites-io';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Field as F, RegimeChip, type Notify } from './mp-ui';

const row = { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', marginBottom: '0.75rem' } as const;

export default function SiteForm({ site, sites, clients, entity, notify, onDone }: { site?: Site; sites: readonly Site[]; clients: readonly Client[]; entity: string; notify: Notify; onDone: () => void }) {
  useT();
  const kind = localDb.settings.get().manpower_kind;
  const shift = kind === 'security' ? 12 : 8;
  const [name, setName] = useState(site?.name ?? '');
  const [clientId, setClientId] = useState(site?.client_id ?? '');
  const [mp, setMp] = useState<SiteInfo>(() => site?.mp ?? { code: suggestSiteCode(sites), contract: { from: todayInput() }, posts: [], status: 'active' });
  const client = clients.find((c) => c.id === clientId);
  const [flags, setFlags] = useState<ClientMp>(() => client?.mp ?? {});
  const set = (p: Partial<SiteInfo>) => setMp((m) => ({ ...m, ...p }));
  const post = (i: number, p: Partial<MpPost>) => set({ posts: mp.posts.map((x, k) => (k === i ? { ...x, ...p, ...(p.name !== undefined && x.sac === suggestSac(x.name, kind) ? { sac: suggestSac(p.name, kind) } : {}) } : x)) });
  const run = (fn: () => void) => { try { fn(); } catch (e) { notify((e as Error).message, 'error'); } };
  const save = () => run(() => {
    saveSite({ id: site?.id, name, client_id: clientId || undefined, mp });
    if (clientId) saveClientMp(clientId, flags);
    notify(mpT('saved'));
    onDone();
  });
  const num = (v: string) => (v === '' ? 0 : Number(v));
  return (
    <section data-mp-site-form>
      <div style={row}>
        <F label={mpT('name')}><input className={controls.input} value={name} onChange={(e) => setName(e.target.value)} data-mp-site-name /></F>
        <F label={mpT('code')}><input className={controls.input} value={mp.code} onChange={(e) => set({ code: e.target.value })} data-mp-site-code /></F>
        <F label={mpT('client')}>
          <select className={controls.select} value={clientId} onChange={(e) => { setClientId(e.target.value); setFlags(clients.find((c) => c.id === e.target.value)?.mp ?? {}); }} data-mp-site-client>
            <option value="">—</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.gstin ? ` (${c.gstin})` : ''}</option>)}
          </select>
        </F>
        <F label={mpT('state')}><input className={controls.input} value={mp.state ?? ''} maxLength={2} onChange={(e) => set({ state: e.target.value })} /></F>
        <F label={mpT('address')}><input className={controls.input} value={mp.address ?? ''} onChange={(e) => set({ address: e.target.value })} /></F>
      </div>
      <div style={row}>
        <F label={mpT('from')}><input type="date" className={controls.input} value={mp.contract.from ?? ''} onChange={(e) => set({ contract: { ...mp.contract, from: e.target.value } })} /></F>
        <F label={mpT('to')}><input type="date" className={controls.input} value={mp.contract.to ?? ''} onChange={(e) => set({ contract: { ...mp.contract, to: e.target.value } })} data-mp-site-to /></F>
        <F label={mpT('ref')}><input className={controls.input} value={mp.contract.ref ?? ''} onChange={(e) => set({ contract: { ...mp.contract, ref: e.target.value } })} /></F>
        <F label={mpT('status')}>
          <select className={controls.select} value={mp.status} onChange={(e) => set({ status: e.target.value as SiteStatus })}>
            {SITE_STATUSES.map((s) => <option key={s} value={s}>{mpList('sts', SITE_STATUSES, s)}</option>)}
          </select>
        </F>
      </div>
      <div className={surface.tableWrap}>
        <table className={surface.table} data-mp-posts>
          <thead><tr><th>{mpT('post')}</th><th>{mpT('sac')}</th><th>{mpT('heads')}</th><th>{mpT('shift')}</th><th>{mpT('basis')}</th><th>{mpT('rate')}</th><th /></tr></thead>
          <tbody>
            {mp.posts.map((p, i) => (
              <tr key={p.id} data-mp-post={i}>
                <td><input className={controls.input} aria-label={mpT('post')} value={p.name} onChange={(e) => post(i, { name: e.target.value })} data-mp-post-name /></td>
                <td><input className={controls.input} aria-label={mpT('sac')} value={p.sac} maxLength={6} onChange={(e) => post(i, { sac: e.target.value })} data-mp-post-sac /></td>
                <td><input type="number" min={1} className={controls.input} aria-label={mpT('heads')} value={p.heads} onChange={(e) => post(i, { heads: num(e.target.value) })} data-mp-post-heads /></td>
                <td><input type="number" min={1} max={24} className={controls.input} aria-label={mpT('shift')} value={p.shift_hours} onChange={(e) => post(i, { shift_hours: num(e.target.value) })} /></td>
                <td>
                  <select className={controls.select} aria-label={mpT('basis')} value={p.basis} onChange={(e) => post(i, { basis: e.target.value as MpBasis })} data-mp-post-basis>
                    {MP_BASES.map((b) => <option key={b} value={b}>{mpList('bases', MP_BASES, b)}</option>)}
                  </select>
                </td>
                <td><input type="number" min={0} step="0.01" className={controls.input} aria-label={mpT('rate')} value={p.rate} onChange={(e) => post(i, { rate: num(e.target.value) })} data-mp-post-rate /></td>
                <td><button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => set({ posts: mp.posts.filter((_, k) => k !== i) })}>{mpT('remove')}</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={row}>
        <button type="button" className={controls.btnOutline} onClick={() => set({ posts: [...mp.posts, { id: generateId(), name: '', sac: suggestSac('', kind), heads: 1, shift_hours: shift, basis: 'duty', rate: 0 }] })} data-mp-add-post>{mpT('addPost')}</button>
        {client && <RegimeChip client={{ ...client, mp: flags }} sacs={mp.posts.map((p) => p.sac)} date={todayInput()} entity={entity} />}
      </div>
      {client && (
        <fieldset style={row} data-mp-client-flags>
          <legend className={controls.label}>{mpT('flags')}</legend>
          {(['gst_tds_only', 'composition', 'school'] as const).map((k) => (
            <label key={k} className={controls.check}><input type="checkbox" checked={!!flags[k]} onChange={(e) => setFlags({ ...flags, [k]: e.target.checked })} data-mp-flag={k} /> {mpT(k === 'gst_tds_only' ? 'tdsOnly' : k)}</label>
          ))}
        </fieldset>
      )}
      <div style={row}>
        <button type="button" className={controls.btnPrimary} onClick={save} data-mp-save-site>{mpT('save')}</button>
        <button type="button" className={controls.btnGhost} onClick={() => onDone()}>×</button>
      </div>
    </section>
  );
}

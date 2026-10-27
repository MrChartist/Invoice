/** R14 PS-B5: "Media buy for a client" rows of the bill and purchase-order forms (lazy; `media` pack). PS12. */
import { useMemo } from 'react';
import { useT } from '../../i18n';
import { psbT } from '../../i18n/areas/prof-r14b';
import { localDb } from '../../lib/localDb';
import { MEDIUMS, type MediaBuy, type Medium } from '../../lib/prof/ps-media';
import controls from '../../styles/controls.module.css';

/** `value` is the row's `ps`; `onChange` gets the next `ps` (media removed when no client is picked). */
export default function MediaRows({ ps, onChange }: { ps: unknown; onChange: (ps: Record<string, unknown> | undefined) => void }) {
  useT();
  const clients = useMemo(() => localDb.clients.getAll().filter((c) => c.id && c.name?.trim()), []);
  const base = (ps as Record<string, unknown> | undefined) ?? {};
  const m = base.media as MediaBuy | undefined;
  const set = (patch: Partial<MediaBuy>) => {
    const next = { ...(m ?? { client_id: '', medium: 'print', mode: 'principal' }), ...patch } as MediaBuy;
    const { media: _m, ...rest } = base;
    const out = next.client_id ? { ...rest, media: next } : rest;
    onChange(Object.keys(out).length ? out : undefined);
  };
  const txt = (k: 'publication' | 'ro_no' | 'client_ref', l: string) => <label className={controls.field}><span className={controls.label}>{l}</span><input className={controls.input} value={m?.[k] ?? ''} onChange={(e) => set({ [k]: e.target.value || undefined })} data-ps-media={k} /></label>;
  const day = (k: 'insert_from' | 'insert_to', l: string) => <label className={controls.field}><span className={controls.label}>{l}</span><input type="date" className={controls.input} value={m?.[k] ?? ''} onChange={(e) => set({ [k]: e.target.value || undefined })} /></label>;
  return (
    <fieldset className={controls.row} data-ps-media-rows>
      <legend className={controls.label}>{psbT('media')}</legend>
      <label className={controls.field}>
        <span className={controls.label}>{psbT('client')}</span>
        <select className={controls.select} value={m?.client_id ?? ''} onChange={(e) => set({ client_id: e.target.value })} data-ps-media="client">
          <option value="">—</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      {m && (
        <>
          <label className={controls.field}>
            <span className={controls.label}>{psbT('medium')}</span>
            <select className={controls.select} value={m.medium} onChange={(e) => set({ medium: e.target.value as Medium })}>{MEDIUMS.map((x) => <option key={x} value={x}>{psbT(`m.${x}`)}</option>)}</select>
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{psbT('mode')}</span>
            <select className={controls.select} value={m.mode} onChange={(e) => set({ mode: e.target.value as MediaBuy['mode'] })} data-ps-media="mode">
              <option value="principal">{psbT('mode.principal')}</option>
              <option value="agent">{psbT('mode.agent')}</option>
            </select>
          </label>
          {txt('publication', psbT('publication'))}
          {txt('ro_no', psbT('roNo'))}
          {txt('client_ref', psbT('clientRef'))}
          {day('insert_from', psbT('from'))}
          {day('insert_to', psbT('to'))}
          <label className={controls.field}><span className={controls.label}>{psbT('commission')}</span><input type="number" min={0} step="0.01" className={controls.input} value={m.commission_pct ?? ''} onChange={(e) => set({ commission_pct: Number(e.target.value) > 0 ? Number(e.target.value) : undefined })} /></label>
          <p className={controls.hint}>{psbT('mediaNote')}</p>
        </>
      )}
    </fieldset>
  );
}

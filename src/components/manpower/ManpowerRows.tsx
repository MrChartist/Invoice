/**
 * R17-A3 editor row (lazy, packs `manpower` / `security`): pick the site and the service month — the document takes
 * the site's cost centre and the `mp` snapshot (site, month, post summary) — and the GST regime: automatic from the
 * lines' SAC, the client's flags and our firm form (A3), or the user's override with a reason (stored in
 * `mp.regime_note`, audited with the document's save). The patch reuses the outward reverse-charge flag and the R10
 * line key `sv.exempt`. Other `mp` sub-objects (B–D) are kept; an issued document keeps what it was saved with.
 */
import { useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { useT } from '../../i18n';
import { mpList, mpT } from '../../i18n/areas/manpower-r17a';
import { localDb } from '../../lib/localDb';
import type { MpRegime } from '../../types/manpower-r17';
import { loadSites, siteLabel } from '../../lib/manpower/mp-sites';
import { firmForm, forcedRegime, mpRegime, mpRegimePatch } from '../../lib/manpower/mp-regime';
import controls from '../../styles/controls.module.css';

const REGS = ['', 'fwd', 'rcm', 'exempt66', 'manual_exempt'] as const;

export default function ManpowerRows() {
  useT();
  const s = useInvoiceStore(useShallow((st) => ({ items: st.items, date: st.issue_date, client: st.client, mp: st.mp, cc: st.cost_centre_id })));
  const sites = useMemo(() => loadSites(), []);
  const entity = useMemo(() => firmForm(), []);
  const [note, setNote] = useState(s.mp?.regime_note ?? '');
  const client = (s.client?.id && localDb.clients.getById(s.client.id)) || s.client;
  const siteId = s.mp?.site?.id ?? (sites.some((x) => x.id === s.cc) ? s.cc : '');
  const site = sites.find((x) => x.id === siteId);
  const sacs = () => {
    const l = s.items.map((i) => i.hsn ?? '').filter(Boolean);
    return l.length ? l : (site?.mp.posts.map((p) => p.sac) ?? []);
  };
  const apply = (regime: MpRegime | '', why = note, mp = s.mp) => {
    const st = useInvoiceStore.getState();
    const w = regime ? why.trim() || 'chosen in the editor' : '';
    const r = regime ? forcedRegime(regime, s.date, w) : mpRegime({ date: s.date, entityType: entity, client }, sacs());
    st.patch(mpRegimePatch({ items: st.items, mp }, r, w));
  };
  const pick = (id: string) => {
    const x = sites.find((y) => y.id === id);
    if (!x) return;
    const mp = { ...s.mp, site: { id: x.id, code: x.mp.code, name: x.name }, month: s.mp?.month ?? s.date.slice(0, 7), ...(s.mp?.posts ? {} : { posts: x.mp.posts.map((p) => ({ post: p.name, sac: p.sac, heads: p.heads, rate: p.rate, basis: p.basis })) }) };
    useInvoiceStore.getState().patch({ cost_centre_id: x.id, mp });
    apply('', note, mp);
  };
  if (!sites.length && !s.mp) return null;
  const forced = (s.mp?.regime_note ? s.mp.regime : '') as MpRegime | '';
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }} data-mp-rows>
      <select className={controls.select} aria-label={mpT('site')} value={siteId ?? ''} onChange={(e) => pick(e.target.value)} data-mp-pick-site>
        <option value="">{mpT('site')} —</option>
        {sites.map((x) => <option key={x.id} value={x.id}>{siteLabel(x)}</option>)}
      </select>
      {s.mp && (
        <>
          <input type="month" className={controls.input} aria-label={mpT('month')} value={s.mp.month ?? ''} onChange={(e) => useInvoiceStore.getState().patch({ mp: { ...s.mp, month: e.target.value || undefined } })} data-mp-month />
          <select className={controls.select} aria-label={mpT('regime')} value={forced} onChange={(e) => apply(e.target.value as MpRegime | '')} data-mp-pick-regime>
            {REGS.map((r) => <option key={r} value={r}>{mpList('regs', REGS, r)}</option>)}
          </select>
          {forced && <input className={controls.input} aria-label={mpT('note')} placeholder={mpT('note')} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => apply(forced, note)} data-mp-regime-note />}
          {!forced && ((r) => <span className={controls.hint} data-mp-regime={r.regime}>{mpT(`reg.${r.regime}`, { r: r.rate })}{r.split ? ` — ${mpT('split')}` : ''}</span>)(mpRegime({ date: s.date, entityType: entity, client }, sacs()))}
        </>
      )}
    </div>
  );
}

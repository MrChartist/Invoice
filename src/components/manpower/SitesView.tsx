/**
 * R17-A2 / A3 sites view: every site (a project cost centre with `mp`) with its client, posts, heads, value a month at
 * full duties, contract end (red within 30 days) and the GST regime chip (A3); "New site" and a site's own form
 * (posts, contract, client flags, deployed staff).
 */
import { useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { mpT } from '../../i18n/areas/manpower-r17a';
import { localDb } from '../../lib/localDb';
import { formatCurrency, todayInput } from '../../lib/utils';
import { endsSoon, monthValue } from '../../lib/manpower/mp-sites';
import { firmForm, loadSites, siteLabel, type SiteInput } from '../../lib/manpower/mp-sites-io';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import SiteForm from './SiteForm';
import { RegimeChip, type MpViewProps } from './mp-ui';

export default function SitesView({ notify }: MpViewProps) {
  useT();
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const today = todayInput();
  const data = useMemo(() => {
    void tick;
    return { sites: loadSites(), clients: localDb.clients.getAll(), entity: firmForm() };
  }, [tick]);
  const sel = open ? data.sites.find((s) => s.id === open) : undefined;
  const clientOf = (id?: string) => data.clients.find((c) => c.id === id);
  if (open !== null) {
    return <SiteForm key={open} site={sel} sites={data.sites} clients={data.clients} entity={data.entity} notify={notify} onDone={(s?: SiteInput) => { setTick((t) => t + 1); setOpen(s?.id ?? null); }} />;
  }
  return (
    <>
      <button type="button" className={controls.btnPrimary} onClick={() => setOpen('')} data-mp-new-site>{mpT('newSite')}</button>
      {data.sites.length ? (
        <div className={surface.tableWrap}>
          <table className={surface.table} data-mp-sites>
            <thead><tr><th>{mpT('site')}</th><th>{mpT('client')}</th><th>{mpT('posts')}</th><th className={surface.numeric}>{mpT('heads')}</th><th className={surface.numeric}>{mpT('value')}</th><th>{mpT('ends')}</th><th>{mpT('regime')}</th><th /></tr></thead>
            <tbody>
              {data.sites.map((s) => (
                <tr key={s.id} data-mp-site={s.mp.code}>
                  <td>{siteLabel(s)}</td>
                  <td>{clientOf(s.client_id)?.name ?? '—'}</td>
                  <td>{s.mp.posts.map((p) => p.name).join(', ')}</td>
                  <td className={surface.numeric}>{s.mp.posts.reduce((t, p) => t + p.heads, 0)}</td>
                  <td className={surface.numeric}>{formatCurrency(monthValue(s.mp, 30))}</td>
                  <td style={endsSoon(s.mp, today) ? { color: 'var(--destructive)' } : undefined}>{s.mp.contract.to ?? '—'}</td>
                  <td><RegimeChip client={clientOf(s.client_id)} sacs={s.mp.posts.map((p) => p.sac)} date={today} entity={data.entity} /></td>
                  <td className={surface.rowActions}><button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setOpen(s.id)} data-mp-open-site={s.mp.code}>{mpT('open')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className={controls.hint}>{mpT('none')}</p>}
    </>
  );
}

import { Suspense, lazy, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { deleteWorkType, loadWorkTypes, saveWorkType, type WorkType } from '../../lib/rate-cards';
import { can } from '../../lib/access';
import { cn } from '../../lib/utils';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './service-r3.module.css';
import { useT } from '../../i18n';
import { svcT } from '../../i18n/areas/service-r3';
import { localDb } from '../../lib/localDb';

// R14 (PS-B2): "bills per hour / appearance / item" — a `legal` company only, one lazy cell.
const WorkUnitSelect = lazy(() => import('../prof/PartyRows').then((m) => ({ default: m.WorkUnitSelect })));

type Notify = (message: string, tone?: 'success' | 'error') => void;

/** R3-B1: work types (name, rate, SAC) on the Time → Settings tab. */
export function WorkTypesCard({ notify }: { notify: Notify }) {
  useT();
  const editable = can('master.edit');
  const [rows, setRows] = useState<WorkType[]>(() => loadWorkTypes());
  const [draft, setDraft] = useState({ name: '', rate: '', sac: '' });
  const [legalOn] = useState(() => ((s: { industry_packs?: unknown }) => Array.isArray(s.industry_packs) && s.industry_packs.includes('legal'))(localDb.settings.get() as never));

  const run = (fn: () => void) => {
    try {
      fn();
      setRows(loadWorkTypes());
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  const add = () => run(() => {
    saveWorkType({ name: draft.name, rate: Number(draft.rate) || 0, sac: draft.sac.replace(/\D/g, '') || undefined });
    setDraft({ name: '', rate: '', sac: '' });
  });

  const update = (w: WorkType, patch: Partial<WorkType>) => run(() => { saveWorkType({ ...w, ...patch }); });

  return (
    <section className={surface.card} aria-label={svcT('workTypes')} data-work-types>
      <div className={styles.section}>
        <strong>{svcT('workTypes')}</strong>
        <p className={styles.muted}>{svcT('workTypesIntro')}</p>
        {rows.length ? (
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <thead><tr><th>{svcT('wtName')}</th><th className={surface.numeric}>{svcT('wtRate')}</th><th>{svcT('wtSac')}</th><th>{svcT('wtInactive')}</th>{legalOn && <th />}<th><span className={surface.srOnly}>{svcT('delete')}</span></th></tr></thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.id}>
                    <td>{w.name}</td>
                    <td className={surface.numeric}>
                      <input type="number" min={0} step="0.01" className={controls.input} defaultValue={w.rate || ''} disabled={!editable} aria-label={`${svcT('wtRate')} ${w.name}`}
                        onBlur={(e) => { const v = Math.max(Number(e.target.value) || 0, 0); if (v !== w.rate) update(w, { rate: v }); }} />
                    </td>
                    <td>
                      <input className={controls.input} inputMode="numeric" defaultValue={w.sac ?? ''} disabled={!editable} aria-label={`${svcT('wtSac')} ${w.name}`}
                        onBlur={(e) => { const v = e.target.value.replace(/\D/g, '').slice(0, 8); if (v !== (w.sac ?? '')) update(w, { sac: v || undefined }); }} />
                    </td>
                    <td>
                      <input type="checkbox" checked={!!w.inactive} disabled={!editable} aria-label={`${svcT('wtInactive')} ${w.name}`} onChange={(e) => update(w, { inactive: e.target.checked || undefined })} />
                    </td>
                    {legalOn && <td><Suspense fallback={null}><WorkUnitSelect value={w as { ps?: unknown }} label={w.name} disabled={!editable} onChange={(ps) => update(w, { ps } as Partial<WorkType>)} /></Suspense></td>}
                    <td className={surface.rowActions}>
                      <button type="button" className={cn(controls.btnGhost, controls.btnSm)} disabled={!editable} aria-label={`${svcT('delete')} ${w.name}`}
                        onClick={() => run(() => notify(deleteWorkType(w.id) === 'inactive' ? svcT('wtInactiveMsg') : svcT('wtDeleted')))}>
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className={styles.muted}>{svcT('wtNone')}</p>
        )}
        {editable && (
          <form className={styles.form} onSubmit={(e) => { e.preventDefault(); add(); }}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="wt-name">{svcT('wtName')}</label>
              <input id="wt-name" className={controls.input} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="wt-rate">{svcT('wtRate')}</label>
              <input id="wt-rate" type="number" min={0} step="0.01" className={controls.input} value={draft.rate} onChange={(e) => setDraft({ ...draft, rate: e.target.value })} />
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="wt-sac">{svcT('wtSac')}</label>
              <input id="wt-sac" className={controls.input} inputMode="numeric" value={draft.sac} onChange={(e) => setDraft({ ...draft, sac: e.target.value })} />
            </div>
            <button type="submit" className={controls.btnOutline} disabled={!draft.name.trim()}><Plus size={14} /> {svcT('wtAdd')}</button>
          </form>
        )}
      </div>
    </section>
  );
}

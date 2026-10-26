import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, SlidersHorizontal } from 'lucide-react';
import type { AppSettings } from '../../lib/localDb';
import { ALL_MODULES, type ModuleId } from '../../lib/shop-mode';
import { PACK_IDS, activePacks, type PackId } from '../../lib/industry-packs';
import { FEATURE_ROWS, featureState, type FeatureRow, type FeatureSection } from '../../lib/features-catalog';
import { featureText } from './feature-text';
import { can } from '../../lib/access';
import { useT } from '../../i18n';
import { discoverT } from '../../i18n/areas/discover-r6';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';

interface Props {
  settings: AppSettings;
  onChange: (patch: Partial<AppSettings>) => void;
}

type DKey = Parameters<typeof discoverT>[0];

const SECTIONS: { id: FeatureSection; title: DKey }[] = [
  { id: 'modules', title: 'featModules' },
  { id: 'packs', title: 'featPacks' },
  { id: 'advanced', title: 'featAdvanced' },
];

/**
 * Settings → Features (R6-B5): every module, industry pack and advanced option with who needs it, whether it is on,
 * and a switch (modules, packs — saved with the page's Save bar — and the pharma flag) or a link to where it is set.
 */
export default function FeaturesPanel({ settings, onChange }: Props) {
  useT();
  const owner = can('settings.manage');
  const [params] = useSearchParams();
  const [q, setQ] = useState(() => params.get('q') ?? ''); // Ctrl+K opens the tab filtered to one row
  const [tick, setTick] = useState(0);
  const [busy, setBusy] = useState('');

  const modulesOn = useMemo(() => new Set<ModuleId>(Array.isArray(settings.modules) ? settings.modules : ALL_MODULES), [settings.modules]);
  const packsOn = activePacks(settings);
  const toggleModule = (m: ModuleId) => onChange({ modules: ALL_MODULES.filter((x) => (x === m ? !modulesOn.has(m) : modulesOn.has(x))) });
  const togglePack = (p: PackId) => onChange({ industry_packs: PACK_IDS.filter((x) => (x === p ? !packsOn.includes(p) : packsOn.includes(x))) });

  const rows = useMemo(() => {
    void tick;
    const needle = q.trim().toLowerCase();
    return FEATURE_ROWS.map((row) => ({ row, ...featureText(row) })).filter((r) => !needle || `${r.title} ${r.who}`.toLowerCase().includes(needle));
  }, [q, tick]);

  const state = (row: FeatureRow): boolean | 'n/a' => featureState(row, settings);
  const action = (row: FeatureRow, on: boolean | 'n/a') => {
    const [kind, id] = row.id.split('.');
    if (owner && kind === 'mod') return <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => toggleModule(id as ModuleId)}>{discoverT(on ? 'featTurnOff' : 'featTurnOn')}</button>;
    if (owner && kind === 'pack') return <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => togglePack(id as PackId)}>{discoverT(on ? 'featTurnOff' : 'featTurnOn')}</button>;
    if (owner && row.toggle) {
      return (
        <button
          type="button"
          className={`${controls.btnOutline} ${controls.btnSm}`}
          disabled={busy === row.id}
          onClick={() => {
            setBusy(row.id);
            void row.toggle!(!on).catch(() => undefined).finally(() => {
              setBusy('');
              setTick((n) => n + 1);
            });
          }}
        >
          {discoverT(on ? 'featTurnOff' : 'featTurnOn')}
        </button>
      );
    }
    return <Link to={row.href} className={`${controls.btnGhost} ${controls.btnSm}`}>{discoverT('featOpen')}</Link>;
  };

  return (
    <section className={surface.card} aria-labelledby="features-title" data-features-panel>
      <div className={surface.cardHead}>
        <span className={surface.cardHeadIcon} id="features-title">
          <SlidersHorizontal size={16} aria-hidden="true" /> {discoverT('featTitle')}
        </span>
        {owner && Array.isArray(settings.modules) && (
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => onChange({ modules: undefined })}>
            {discoverT('featShowAll')}
          </button>
        )}
      </div>
      <div className={surface.cardBody}>
        <p className={surface.sectionNote}>{discoverT('featSub')}</p>
        {!owner && <p className={controls.hint} role="note">{discoverT('featReadOnly')}</p>}
        <label className={controls.field} style={{ maxWidth: 360 }}>
          <span className={controls.label}>
            <Search size={14} aria-hidden="true" /> {discoverT('featSearch')}
          </span>
          <input className={controls.input} type="search" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        {rows.length === 0 && <p className={controls.hint}>{discoverT('featNoMatch', { q: q.trim() })}</p>}
        {SECTIONS.map((sec) => {
          const list = rows.filter((r) => r.row.section === sec.id);
          if (!list.length) return null;
          return (
            <div key={sec.id} className={surface.tableWrap} style={{ marginTop: '1rem' }}>
              <table className={surface.table}>
                <caption style={{ textAlign: 'left', fontWeight: 600, padding: '0.5rem 0' }}>{discoverT(sec.title)}</caption>
                <tbody>
                  {list.map(({ row, title, who }) => {
                    const on = state(row);
                    return (
                      <tr key={row.id} data-feature={row.id}>
                        <td>
                          <strong>{title}</strong>
                          <br />
                          <small>{who}</small>
                        </td>
                        <td>
                          <span className={`${surface.badge} ${on === true ? surface.badgePaid : surface.badgeDraft}`}>
                            {on === 'n/a' ? discoverT('featNa') : on ? discoverT('featOn') : discoverT('featOff')}
                          </span>
                        </td>
                        <td style={{ textAlign: 'right' }}>{action(row, on)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
    </section>
  );
}

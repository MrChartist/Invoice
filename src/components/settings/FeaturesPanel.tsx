import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, SlidersHorizontal } from 'lucide-react';
import type { AppSettings } from '../../lib/localDb';
import { ALL_MODULES, type ModuleId } from '../../lib/shop-mode';
import { PACK_IDS, activePacks, type PackId } from '../../lib/industry-packs';
import { FEATURE_ROWS, featureState, type FeatureRow, type FeatureSection } from '../../lib/features-catalog';
import { featureText } from './feature-text';
import { TradeKindPicker } from '../trade/TradeKindPicker'; // R8-C (TR-C5)
import { applyConstructionKind, applyRetailKind, applyServiceKind, applyTradeKind } from '../../lib/shop-presets';
import { ServiceKindPicker } from '../services-r10/ServiceKindPicker'; // R10 (SV-A1)
import { AgriKindPicker } from '../agri/AgriKindPicker'; // R12 (AG-A1)
import { agPickT } from '../../i18n/areas/agri-r12-pick';
import { applyAgriKind, applyMfgKind } from '../../lib/shop-presets';
import { MfgKindPicker } from '../mfg/MfgKindPicker'; // R13 (MF-A1)
import { mfPickT } from '../../i18n/areas/mfg-r13a-pick';
import { svPickT } from '../../i18n/areas/services-r10-pick';
import { applyProfKind } from '../../lib/shop-presets';
import { ProfKindPicker } from '../prof/ProfKindPicker'; // R14 (PS-A1)
import { psPickT } from '../../i18n/areas/prof-r14a-pick';
import { applyTravelKind } from '../../lib/shop-presets';
import { TravelKindPicker } from '../travel/TravelKindPicker'; // R15-B1
import { tvT } from '../../i18n/areas/travel-r15b';
import { ConstructionKindPicker } from '../construction/ConstructionKindPicker'; // R11 (CN-A1)
import { DB_PREFIX, getJson } from '../../lib/storage';
import { cnPickT } from '../../i18n/areas/construction-r11-pick';
import { RetailKindPicker } from '../retail-r9/RetailKindPicker';
import { pickT } from '../../i18n/areas/retail-r9-pick'; // R9 (RT-A1)
import { trT } from '../../i18n/areas/trade-r8c';
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
  const [cnGov, setCnGov] = useState(() => getJson<{ government?: boolean } | null>(`${DB_PREFIX}construction_settings`, null)?.government === true); // R11
  const [busy, setBusy] = useState('');
  const [svPharmacy, setSvPharmacy] = useState(() => settings.service_kind === 'clinic' && activePacks(settings).includes('pharmacy')); // R10

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
        {settings.business_type === 'wholesale' && (
          <div className={controls.field} data-features-trade>
            <span className={controls.label}>{trT('tradeTitle')}</span>
            <TradeKindPicker value={settings.trade_kind} custom disabled={!owner} onPick={(k) => onChange(k ? applyTradeKind(k) : { trade_kind: undefined })} />
          </div>
        )}
        {settings.business_type === 'kirana' && (
          <div className={controls.field} data-features-retail>
            <span className={controls.label}>{pickT('retailTitle')}</span>
            <RetailKindPicker
              value={settings.retail_kind}
              custom
              disabled={!owner}
              onPick={(k) => {
                if (!k) return onChange({ retail_kind: undefined });
                const registered = Boolean(settings.profiles?.find((p) => p.id === settings.activeProfileId)?.companyGstin?.trim());
                onChange(applyRetailKind(k, { registered }));
                // The profile's switches (retail checks; pharma for a medical store) apply at once — they only turn checks on.
                void import('../../lib/retail/rt-profile').then((m) => m.applyRetailSwitches(k)).catch(() => undefined);
              }}
            />
          </div>
        )}
        {settings.business_type === 'contractor' && (
          <div className={controls.field} data-features-construction>
            <span className={controls.label}>{cnPickT('title')}</span>
            <ConstructionKindPicker
              value={settings.construction_kind}
              custom
              disabled={!owner}
              government={cnGov}
              onGovernment={(on) => {
                setCnGov(on);
                const k = settings.construction_kind;
                if (on && k) void import('../../lib/construction/cn-profile').then((m) => m.applyConstructionSwitches(k, { government: true })).catch(() => undefined);
              }}
              onPick={(k) => {
                if (!k) return onChange({ construction_kind: undefined });
                const registered = Boolean(settings.profiles?.find((p) => p.id === settings.activeProfileId)?.companyGstin?.trim());
                onChange(applyConstructionKind(k, { registered }));
                // The profile's switches only add Works views and paper options; changing the profile deletes nothing.
                void import('../../lib/construction/cn-profile').then((m) => m.applyConstructionSwitches(k, { government: cnGov })).catch(() => undefined);
              }}
            />
          </div>
        )}
        {settings.business_type === 'services' && (
          <div className={controls.field} data-features-service>
            <span className={controls.label}>{svPickT('title')}</span>
            <ServiceKindPicker
              value={settings.service_kind}
              custom
              disabled={!owner}
              pharmacy={svPharmacy}
              onPharmacy={(on) => {
                setSvPharmacy(on);
                const registered = Boolean(settings.profiles?.find((p) => p.id === settings.activeProfileId)?.companyGstin?.trim());
                if (settings.service_kind) onChange(applyServiceKind(settings.service_kind, { registered, pharmacy: on }));
              }}
              onPick={(k) => {
                if (!k) return onChange({ service_kind: undefined });
                const registered = Boolean(settings.profiles?.find((p) => p.id === settings.activeProfileId)?.companyGstin?.trim());
                onChange(applyServiceKind(k, { registered, pharmacy: svPharmacy }));
                // The profile's switches only fill unset ones; changing the profile deletes nothing.
                void import('../../lib/services/sv-profile').then((m) => m.applyServiceSwitches(k)).catch(() => undefined);
              }}
            />
          </div>
        )}
        {/* R14 (PS-A1): "Professional profile" for every services company (+ Custom); the firm form is set in the wizard / annual pack */}
        {settings.business_type === 'services' && (
          <div className={controls.field} data-features-prof>
            <span className={controls.label}>{psPickT('title')}</span>
            <ProfKindPicker
              value={settings.prof_kind}
              custom
              disabled={!owner}
              sub={settings.prof_sub}
              onSub={(x) => settings.prof_kind && onChange({ prof_sub: x })}
              onPick={(k) => {
                if (!k) return onChange({ prof_kind: undefined });
                const registered = Boolean(settings.profiles?.find((p) => p.id === settings.activeProfileId)?.companyGstin?.trim());
                onChange(applyProfKind(k, { registered, sub: settings.prof_sub, currentPacks: packsOn }) as Partial<typeof settings>);
                // The profile's switches only fill unset ones; changing the profile deletes nothing.
                void import('../../lib/prof/ps-profile').then((m) => m.applyProfSwitches(k, settings.prof_sub)).catch(() => undefined);
              }}
            />
          </div>
        )}
        {/* R15-B1: "Travel profile" for every services company (+ Custom); changing it deletes nothing */}
        {settings.business_type === 'services' && (
          <div className={controls.field} data-features-travel>
            <span className={controls.label}>{tvT('title')}</span>
            <TravelKindPicker
              value={settings.travel_kind}
              custom
              disabled={!owner}
              onPick={(k) => {
                if (!k) return onChange({ travel_kind: undefined });
                const registered = Boolean(settings.profiles?.find((p) => p.id === settings.activeProfileId)?.companyGstin?.trim());
                onChange(applyTravelKind(k, { registered, currentPacks: packsOn }) as Partial<typeof settings>);
                void import('../../lib/travel/tv-profile').then((m) => m.applyTravelSwitches(k)).catch(() => undefined);
              }}
            />
          </div>
        )}
        {/* R12 (AG-A1): "Agriculture profile" for every company (a trader may add cold storage, a kirana inputs) */}
        <div className={controls.field} data-features-agri>
          <span className={controls.label}>{agPickT('title')}</span>
          <AgriKindPicker
            value={settings.agri_kind}
            custom
            disabled={!owner}
            mill={settings.mill_kind}
            onMill={(m) => settings.agri_kind === 'mill' && onChange({ mill_kind: m as typeof settings.mill_kind })}
            onPick={(k) => {
              if (!k) return onChange({ agri_kind: undefined });
              const registered = Boolean(settings.profiles?.find((p) => p.id === settings.activeProfileId)?.companyGstin?.trim());
              onChange(applyAgriKind(k, { registered, mill_kind: settings.mill_kind, currentPacks: packsOn }) as Partial<typeof settings>);
              // The profile's switches only fill unset ones; changing the profile deletes nothing.
              void import('../../lib/agri/ag-profile').then((m) => m.applyAgriSwitches(k)).catch(() => undefined);
            }}
          />
        </div>
        {/* R13 (MF-A1): "Manufacturing profile" for every company (a trader who assembles may turn on the shop floor only) */}
        <div className={controls.field} data-features-mfg>
          <span className={controls.label}>{mfPickT('title')}</span>
          <MfgKindPicker
            value={settings.mfg_kind}
            custom
            disabled={!owner}
            sub={settings.mfg_sub}
            onSub={(x) => settings.mfg_kind && onChange({ mfg_sub: x as typeof settings.mfg_sub })}
            onPick={(k) => {
              if (!k) return onChange({ mfg_kind: undefined });
              const registered = Boolean(settings.profiles?.find((p) => p.id === settings.activeProfileId)?.companyGstin?.trim());
              onChange(applyMfgKind(k, { registered, sub: settings.mfg_sub, currentPacks: packsOn }) as Partial<typeof settings>);
              // The profile's switches only fill unset ones; changing the profile deletes nothing.
              void import('../../lib/mfg/mf-profile').then((m) => m.applyMfgSwitches(k, settings.mfg_sub)).catch(() => undefined);
            }}
          />
        </div>
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

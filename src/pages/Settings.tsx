import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Building2, Check, Copy, Database, Layers, ListPlus, Package, Plus, Save, ScrollText, ShieldCheck, SlidersHorizontal, Star, Trash2 } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Avatar } from '../components/ui/Avatar';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/useToast';
import { useT } from '../i18n';
import '../i18n/en-pages'; // page strings (5.4)
import { setT } from '../i18n/areas/settings';
import { discoverT } from '../i18n/areas/discover-r6';
import { SETTINGS_TABS, type SettingsTab } from './page-tabs'; // R6-B1
import { LanguageSwitch } from '../components/ui/LanguageSwitch';
import { ProfileEditor } from '../components/settings/ProfileEditor';
import { DefaultsPanel } from '../components/settings/DefaultsPanel';
import { CatalogPanel } from '../components/settings/CatalogPanel';
import { PricingPanel } from '../components/settings/PricingPanel';
import { LateFeeSettings } from '../components/interest';
import { DataPanel } from '../components/settings/DataPanel';
import { SecurityPanel } from '../components/security/SecurityPanel';
import { CompaniesPanel } from '../components/companies/CompaniesPanel';
import { AutoBackupPanel } from '../components/pwa/AutoBackupPanel';
import { can as canDo, type AccessAction } from '../lib/access';
import { blankProfile, localDb, type AppSettings } from '../lib/localDb';
import { SHOP_MODE_EVENT } from '../lib/shop-mode';
import { checkGstin } from '../lib/gstin';
import { isValidIfsc, isValidPan, isValidUpi } from '../lib/validators';
import type { SenderProfile } from '../types/invoice';
import controls from '../styles/controls.module.css';
import surface from '../styles/surface.module.css';
import styles from '../components/settings/Settings.module.css';
import tabs from '../styles/tabs.module.css';
import { errText } from '../i18n/lib-msg';

// The activity log is only needed on its own tab, so it stays out of the Settings chunk.
const CustomFieldsPanel = lazy(() => import('../components/custom-fields/CustomFieldsPanel').then((m) => ({ default: m.CustomFieldsPanel })));
// Folder sync (5.7): the panel brings the whole sync engine, so it loads only on the Data tab.
const SyncPanel = lazy(() => import('../components/sync/SyncPanel').then((m) => ({ default: m.SyncPanel })));
// Shop mode (8H) and the 8H masters (currency rates) load with the Defaults tab only.
const ShopModePanel = lazy(() => import('../components/settings/ShopModePanel').then((m) => ({ default: m.ShopModePanel })));
const CurrencyRatesPanel = lazy(() => import('../components/settings/CurrencyRatesPanel').then((m) => ({ default: m.CurrencyRatesPanel })));
const ActivityPanel = lazy(() => import('../components/audit/ActivityPanel').then((m) => ({ default: m.ActivityPanel })));
const DisplayPanel = lazy(() => import('../components/settings/DisplayPanel')); // R2-C6 (Security & device tab)
// R2-A: payment terms / settlement settings and the reminder schedule, loaded with the Defaults tab.
const PaymentTermsPanel = lazy(() => import('../components/settings/PaymentTermsPanel'));
const ReminderSchedulePanel = lazy(() => import('../components/settings/ReminderSchedulePanel'));

// R6-B5: Settings → Features (every module, pack and advanced option in one list) — its own chunk.
const FeaturesPanel = lazy(() => import('../components/settings/FeaturesPanel'));
const KeysSwitch = lazy(() => import('../components/keys/KeysHost').then((m) => ({ default: m.KeysSwitch }))); // R20-A1: the Tally keys switch (one row)
const RetailChecks = lazy(() => import('../components/retail-r9/rt-a-hub').then((m) => ({ default: m.RetailChecks }))); // R9 (RT-A2)

type Tab = SettingsTab;

// R6-B1: the ids, labels and roles live in settings-tabs.ts (Ctrl+K indexes them); the icons stay here.
const TAB_ICON: Record<Tab, typeof Building2> = {
  business: Building2,
  items: Package,
  fields: ListPlus,
  defaults: SlidersHorizontal,
  features: Layers,
  data: Database,
  activity: ScrollText,
  security: ShieldCheck,
};
const ALL_TABS: { id: Tab; label: () => string; icon: typeof Building2; need: AccessAction }[] = SETTINGS_TABS.map((t) => ({
  ...t,
  label: () => (t.id === 'features' ? discoverT('tabFeatures') : setT(t.label as Exclude<(typeof t)['label'], 'tabFeatures'>)),
  icon: TAB_ICON[t.id],
}));

/** The first problem that should block saving, or '' when the profile is fine. */
function profileProblem(p: SenderProfile): string {
  if (!p.companyName.trim()) return setT('errName');
  if (p.companyGstin && !checkGstin(p.companyGstin).valid) return setT('errGstin');
  if (p.pan && !isValidPan(p.pan)) return setT('errPan');
  if (p.ifsc && !isValidIfsc(p.ifsc)) return setT('errIfsc');
  if (p.upiId && !isValidUpi(p.upiId)) return setT('errUpi');
  return '';
}

export function Settings() {
  const { notify, toastNode } = useToast();
  const { t } = useT();
  const [params] = useSearchParams();
  // The signed-in user only changes at the PIN screen, which unmounts this page.
  const [TABS] = useState(() => ALL_TABS.filter((t) => canDo(t.need)));
  const [tab, setTab] = useState<Tab>(() => {
    const t = params.get('tab');
    return TABS.some((x) => x.id === t) ? (t as Tab) : TABS[0].id;
  });
  // R6-B2: a link to another tab while Settings is open (the sidebar's "N more features") switches the tab.
  const urlTab = params.get('tab');
  const [seenTab, setSeenTab] = useState(urlTab);
  if (urlTab !== seenTab) {
    setSeenTab(urlTab);
    if (TABS.some((x) => x.id === urlTab)) setTab(urlTab as Tab);
  }
  const [settings, setSettings] = useState<AppSettings>(() => localDb.settings.get());
  const [editingId, setEditingId] = useState(() => localDb.settings.get().activeProfileId);
  const [dirty, setDirty] = useState(false);
  const [deleting, setDeleting] = useState<SenderProfile | null>(null);

  const editing = useMemo(
    () => settings.profiles.find((p) => p.id === editingId) ?? settings.profiles[0],
    [settings.profiles, editingId],
  );

  // Warn before a refresh/close throws away unsaved edits.
  useEffect(() => {
    if (!dirty) return;
    const guard = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, [dirty]);

  const patchSettings = (patch: Partial<AppSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    setDirty(true);
  };

  const patchProfile = (patch: Partial<SenderProfile>) => {
    setSettings((s) => ({ ...s, profiles: s.profiles.map((p) => (p.id === editing.id ? { ...p, ...patch } : p)) }));
    setDirty(true);
  };

  const addProfile = () => {
    const fresh = blankProfile();
    setSettings((s) => ({ ...s, profiles: [...s.profiles, fresh] }));
    setEditingId(fresh.id!);
    setDirty(true);
  };

  const removeProfile = (id: string) => {
    setSettings((s) => {
      const profiles = s.profiles.filter((p) => p.id !== id);
      return { ...s, profiles, activeProfileId: s.activeProfileId === id ? profiles[0].id! : s.activeProfileId };
    });
    setEditingId((cur) => (cur === id ? settings.profiles.find((p) => p.id !== id)!.id! : cur));
    setDirty(true);
  };

  const onTabKey = (e: React.KeyboardEvent) => {
    const i = TABS.findIndex((t) => t.id === tab);
    let next = -1;
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length;
    else if (e.key === 'ArrowLeft') next = (i - 1 + TABS.length) % TABS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TABS.length - 1;
    if (next < 0) return;
    e.preventDefault();
    setTab(TABS[next].id);
    document.getElementById(`settings-tab-${TABS[next].id}`)?.focus();
  };

  const duplicateProfile = () => {
    const copy: SenderProfile = { ...blankProfile(), ...editing, id: blankProfile().id, companyName: setT('copySuffix', { name: editing.companyName || setT('untitled') }) };
    setSettings((s) => ({ ...s, profiles: [...s.profiles, copy] }));
    setEditingId(copy.id!);
    setDirty(true);
  };

  const save = () => {
    for (const p of settings.profiles) {
      const problem = profileProblem(p);
      if (problem) {
        setEditingId(p.id!);
        setTab('business');
        return notify(problem, 'error');
      }
    }
    try {
      localDb.settings.save({ ...settings, onboarded: true });
      setSettings((s) => ({ ...s, onboarded: true }));
      setDirty(false);
      window.dispatchEvent(new Event(SHOP_MODE_EVENT)); // 8H: the sidebar re-reads the shop mode
      notify(t('settings.saved'));
    } catch (err) {
      notify(errText(err), 'error');
    }
  };

  const discard = () => {
    const fresh = localDb.settings.get();
    setSettings(fresh);
    setEditingId(fresh.activeProfileId);
    setDirty(false);
  };

  return (
    <div className={surface.page}>
      <PageHeader
        title={t('settings.title')}
        subtitle={canDo('settings.manage') ? t('settings.subOwner') : t('settings.subOther')}
        actions={
          <div className={styles.langBox} title={t('settings.languageHint')}>
            <span className={styles.langLabel}>{t('common.language')}</span>
            <LanguageSwitch />
          </div>
        }
      />


      <div className={tabs.tabStrip} role="tablist" aria-label={setT('sections')} onKeyDown={onTabKey}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            id={`settings-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls="settings-panel"
            tabIndex={tab === id ? 0 : -1}
            className={tabs.tabItem}
            onClick={() => setTab(id)}
          >
            <Icon size={16} aria-hidden="true" /> {label()}
          </button>
        ))}
      </div>

      <div id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${tab}`} className={styles.panel}>
      {tab === 'business' && editing && (
        <div className={styles.layout}>
          <section className={surface.card}>
            <div className={surface.cardHead}>
              <span>{setT('profiles')}</span>
              <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={addProfile}>
                <Plus size={14} /> {setT('add')}
              </button>
            </div>
            <div className={styles.profileList}>
              {settings.profiles.map((p) => (
                <button key={p.id} type="button" className={styles.profileRow} aria-current={p.id === editing.id ? 'true' : undefined} onClick={() => setEditingId(p.id!)}>
                  <Avatar name={p.companyName || setT('newProfile')} size={29} square src={p.logo} />
                  <span className={styles.profileText}>
                    <strong>{p.companyName || setT('untitled')}</strong>
                    <span>{p.companyGstin || setT('noGstin')}</span>
                  </span>
                  {p.id === settings.activeProfileId && <Star size={14} fill="currentColor" color="var(--tint)" aria-label={setT('defaultProfile')} />}
                </button>
              ))}
            </div>
          </section>

          <section className={surface.card}>
            <div className={surface.cardHead}>
              <div className={styles.editorHead}>
                <span>{editing.companyName || setT('untitled')}</span>
                <div className={surface.pageActions}>
                  {editing.id === settings.activeProfileId ? (
                    <span className={styles.defaultTag}><Check size={12} aria-hidden="true" /> {setT('defaultProfile')}</span>
                  ) : (
                    <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => patchSettings({ activeProfileId: editing.id! })}>
                      <Star size={14} /> {setT('makeDefault')}
                    </button>
                  )}
                  <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={duplicateProfile}>
                    <Copy size={14} /> {setT('duplicate')}
                  </button>
                  {settings.profiles.length > 1 && (
                    <button type="button" className={controls.btnDanger} onClick={() => setDeleting(editing)} aria-label={setT('deleteProfile')}>
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className={surface.cardBody}>
              <p className={surface.sectionNote}>
                {setT('snapshotNote')}
              </p>
              <ProfileEditor profile={editing} onChange={patchProfile} onError={(m) => notify(m, 'error')} />
            </div>
          </section>
        </div>
      )}

      {tab === 'items' && (
        <>
          <CatalogPanel notify={notify} />
          <PricingPanel notify={notify} />
          <Suspense fallback={null}><RetailChecks notify={notify} /></Suspense>
        </>
      )}
      {tab === 'fields' && (
        <Suspense fallback={null}>
          <CustomFieldsPanel notify={notify} />
        </Suspense>
      )}
      {tab === 'defaults' && (
        <>
          <Suspense fallback={null}>
            <ShopModePanel settings={settings} onChange={patchSettings} />
          </Suspense>
          <DefaultsPanel settings={settings} onChange={patchSettings} />
          <Suspense fallback={null}>
            <section className={surface.card}>
              <div className={surface.cardBody}>
                <KeysSwitch hint />
              </div>
            </section>
          </Suspense>
          <Suspense fallback={null}>
            <CurrencyRatesPanel notify={notify} />
          </Suspense>
          <LateFeeSettings
            profileId={settings.activeProfileId}
            profileName={settings.profiles.find((p) => p.id === settings.activeProfileId)?.companyName}
          />
          {/* R2-A: payment terms master + settlement settings, reminder schedule & templates */}
          <Suspense fallback={null}>
            <PaymentTermsPanel notify={notify} />
            <ReminderSchedulePanel notify={notify} />
          </Suspense>
        </>
      )}
      {tab === 'features' && (
        <Suspense fallback={null}>
          <FeaturesPanel settings={settings} onChange={patchSettings} />
        </Suspense>
      )}
      {tab === 'data' && (
        <>
          <DataPanel notify={notify} />
          {/* Roles (6.21): full backups and folder sync are owner-only (the library checks too). */}
          {canDo('data.backup') && <AutoBackupPanel onNotify={notify} />}
          {canDo('settings.manage') && (
            <Suspense fallback={null}>
              <SyncPanel notify={notify} />
            </Suspense>
          )}
          <CompaniesPanel notify={notify} />
        </>
      )}
      {tab === 'activity' && (
        <Suspense fallback={<p className={surface.sectionNote}>{setT('loadingActivity')}</p>}>
          <ActivityPanel />
        </Suspense>
      )}
      {tab === 'security' && <SecurityPanel notify={notify} onLock={() => window.location.reload()} />}
      {tab === 'security' && <Suspense fallback={null}><DisplayPanel /></Suspense>}

      </div>

      {dirty && (
        <div className={styles.saveBar} role="region" aria-label={setT('unsavedRegion')}>
          <span>{t('settings.unsaved')}</span>
          <div className={styles.saveActions}>
            <button type="button" className={controls.btnOutline} onClick={discard}>{t('common.discard')}</button>
            <button type="button" className={controls.btnPrimary} onClick={save}>
              <Save size={16} /> {t('settings.save')}
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        destructive
        title={setT('deleteProfileTitle')}
        message={setT('deleteProfileMsg', { name: deleting?.companyName || setT('untitled') })}
        confirmLabel={setT('deleteProfileBtn')}
        onConfirm={() => deleting && removeProfile(deleting.id!)}
        onClose={() => setDeleting(null)}
      />
      {toastNode}
    </div>
  );
}

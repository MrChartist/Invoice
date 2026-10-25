import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Building2, Check, Copy, Database, ListPlus, Package, Plus, Save, ScrollText, ShieldCheck, SlidersHorizontal, Star, Trash2 } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Avatar } from '../components/ui/Avatar';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/useToast';
import { useT } from '../i18n';
import '../i18n/en-pages'; // page strings (5.4)
import { setT } from '../i18n/areas/settings';
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
import { checkGstin } from '../lib/gstin';
import { isValidIfsc, isValidPan, isValidUpi } from '../lib/validators';
import type { SenderProfile } from '../types/invoice';
import controls from '../styles/controls.module.css';
import surface from '../styles/surface.module.css';
import styles from '../components/settings/Settings.module.css';

// The activity log is only needed on its own tab, so it stays out of the Settings chunk.
const CustomFieldsPanel = lazy(() => import('../components/custom-fields/CustomFieldsPanel').then((m) => ({ default: m.CustomFieldsPanel })));
// Folder sync (5.7): the panel brings the whole sync engine, so it loads only on the Data tab.
const SyncPanel = lazy(() => import('../components/sync/SyncPanel').then((m) => ({ default: m.SyncPanel })));
const ActivityPanel = lazy(() => import('../components/audit/ActivityPanel').then((m) => ({ default: m.ActivityPanel })));
// R2-A: payment terms / settlement settings and the reminder schedule, loaded with the Defaults tab.
const PaymentTermsPanel = lazy(() => import('../components/settings/PaymentTermsPanel'));
const ReminderSchedulePanel = lazy(() => import('../components/settings/ReminderSchedulePanel'));

type Tab = 'business' | 'items' | 'fields' | 'defaults' | 'data' | 'activity' | 'security';

/** `need`: local roles (6.21) — a clerk or viewer sees only the tabs their role may use. */
const ALL_TABS: { id: Tab; label: Parameters<typeof setT>[0]; icon: typeof Building2; need: AccessAction }[] = [
  { id: 'business', label: 'tabBusiness', icon: Building2, need: 'settings.manage' },
  { id: 'items', label: 'tabItems', icon: Package, need: 'master.edit' },
  { id: 'fields', label: 'tabFields', icon: ListPlus, need: 'settings.manage' },
  { id: 'defaults', label: 'tabDefaults', icon: SlidersHorizontal, need: 'settings.manage' },
  { id: 'data', label: 'tabData', icon: Database, need: 'data.restore' },
  { id: 'activity', label: 'tabActivity', icon: ScrollText, need: 'view' },
  { id: 'security', label: 'tabSecurity', icon: ShieldCheck, need: 'view' },
];

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
      notify(t('settings.saved'));
    } catch (err) {
      notify((err as Error).message, 'error');
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


      <div className={controls.segment} role="tablist" aria-label={setT('sections')} style={{ alignSelf: 'flex-start', maxWidth: '100%', flexWrap: 'wrap' }} onKeyDown={onTabKey}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            id={`settings-tab-${id}`}
            type="button"
            role="tab"
            aria-selected={tab === id}
            aria-controls="settings-panel"
            tabIndex={tab === id ? 0 : -1}
            className={tab === id ? controls.segmentBtnActive : controls.segmentBtn}
            onClick={() => setTab(id)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem', whiteSpace: 'nowrap', minHeight: 40 }}
          >
            <Icon size={14} aria-hidden="true" /> {setT(label)}
          </button>
        ))}
      </div>

      <div id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${tab}`} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
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
                <button key={p.id} type="button" className={`${styles.profileBtn} ${p.id === editing.id ? styles.profileBtnActive : ''}`} onClick={() => setEditingId(p.id!)}>
                  <Avatar name={p.companyName || setT('newProfile')} size={32} square src={p.logo} />
                  <span className={styles.profileText}>
                    <strong>{p.companyName || setT('untitled')}</strong>
                    <span>{p.companyGstin || setT('noGstin')}</span>
                  </span>
                  {p.id === settings.activeProfileId && <Star size={13} fill="currentColor" color="var(--brand)" aria-label={setT('defaultProfile')} />}
                </button>
              ))}
            </div>
          </section>

          <section className={surface.card}>
            <div className={surface.cardHead}>
              <div className={styles.editorHead} style={{ width: '100%' }}>
                <span>{editing.companyName || setT('untitled')}</span>
                <div className={surface.pageActions}>
                  {editing.id === settings.activeProfileId ? (
                    <span className={styles.defaultTag}><Check size={12} /> {setT('defaultProfile')}</span>
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
        </>
      )}
      {tab === 'fields' && (
        <Suspense fallback={null}>
          <CustomFieldsPanel notify={notify} />
        </Suspense>
      )}
      {tab === 'defaults' && (
        <>
          <DefaultsPanel settings={settings} onChange={patchSettings} />
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

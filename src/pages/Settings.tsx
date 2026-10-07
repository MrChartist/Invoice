import { useEffect, useMemo, useState } from 'react';
import { Building2, Check, Database, Plus, Save, SlidersHorizontal, Star, Trash2 } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { Avatar } from '../components/ui/Avatar';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/useToast';
import { ProfileEditor } from '../components/settings/ProfileEditor';
import { DefaultsPanel } from '../components/settings/DefaultsPanel';
import { DataPanel } from '../components/settings/DataPanel';
import { blankProfile, localDb, type AppSettings } from '../lib/localDb';
import { checkGstin } from '../lib/gstin';
import { isValidIfsc, isValidPan, isValidUpi } from '../lib/validators';
import type { SenderProfile } from '../types/invoice';
import controls from '../styles/controls.module.css';
import surface from '../styles/surface.module.css';
import styles from '../components/settings/Settings.module.css';

type Tab = 'business' | 'defaults' | 'data';

const TABS: { id: Tab; label: string; icon: typeof Building2 }[] = [
  { id: 'business', label: 'Business profiles', icon: Building2 },
  { id: 'defaults', label: 'Defaults', icon: SlidersHorizontal },
  { id: 'data', label: 'Data & backup', icon: Database },
];

/** The first problem that should block saving, or '' when the profile is fine. */
function profileProblem(p: SenderProfile): string {
  if (!p.companyName.trim()) return 'Add a business name — it is printed at the top of every invoice.';
  if (p.companyGstin && !checkGstin(p.companyGstin).valid) return 'The GSTIN is not valid. Fix it or clear it.';
  if (p.pan && !isValidPan(p.pan)) return 'The PAN is not valid.';
  if (p.ifsc && !isValidIfsc(p.ifsc)) return 'The IFSC code is not valid.';
  if (p.upiId && !isValidUpi(p.upiId)) return 'The UPI ID is not valid.';
  return '';
}

export function Settings() {
  const { notify, toastNode } = useToast();
  const [tab, setTab] = useState<Tab>('business');
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
      notify('Settings saved');
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
      <PageHeader title="Settings" subtitle="Your business details, payment info and defaults. Saved only on this device." />

      <div className={controls.segment} role="tablist" aria-label="Settings sections" style={{ alignSelf: 'flex-start' }}>
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setTab(id)} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {tab === 'business' && editing && (
        <div className={styles.layout}>
          <section className={surface.card}>
            <div className={surface.cardHead}>
              <span>Profiles</span>
              <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={addProfile}>
                <Plus size={14} /> Add
              </button>
            </div>
            <div className={styles.profileList}>
              {settings.profiles.map((p) => (
                <button key={p.id} type="button" className={`${styles.profileBtn} ${p.id === editing.id ? styles.profileBtnActive : ''}`} onClick={() => setEditingId(p.id!)}>
                  <Avatar name={p.companyName || 'New'} size={32} square src={p.logo} />
                  <span className={styles.profileText}>
                    <strong>{p.companyName || 'Untitled profile'}</strong>
                    <span>{p.companyGstin || 'No GSTIN'}</span>
                  </span>
                  {p.id === settings.activeProfileId && <Star size={13} fill="currentColor" color="var(--brand)" aria-label="Default profile" />}
                </button>
              ))}
            </div>
          </section>

          <section className={surface.card}>
            <div className={surface.cardHead}>
              <div className={styles.editorHead} style={{ width: '100%' }}>
                <span>{editing.companyName || 'New profile'}</span>
                <div className={surface.pageActions}>
                  {editing.id === settings.activeProfileId ? (
                    <span className={styles.defaultTag}><Check size={12} style={{ verticalAlign: '-2px' }} /> Default profile</span>
                  ) : (
                    <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => patchSettings({ activeProfileId: editing.id! })}>
                      <Star size={14} /> Make default
                    </button>
                  )}
                  {settings.profiles.length > 1 && (
                    <button type="button" className={controls.btnDanger} onClick={() => setDeleting(editing)} aria-label="Delete this profile">
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className={surface.cardBody}>
              <p className={surface.sectionNote}>
                Each invoice stores its own copy of these details when you save it, so editing a profile later never
                changes invoices you have already issued.
              </p>
              <ProfileEditor profile={editing} onChange={patchProfile} onError={(m) => notify(m, 'error')} />
            </div>
          </section>
        </div>
      )}

      {tab === 'defaults' && <DefaultsPanel settings={settings} onChange={patchSettings} />}
      {tab === 'data' && <DataPanel notify={notify} />}

      {dirty && (
        <div className={styles.saveBar} role="region" aria-label="Unsaved changes">
          <span>You have unsaved changes</span>
          <div className={styles.saveActions}>
            <button type="button" className={controls.btnOutline} onClick={discard}>Discard</button>
            <button type="button" className={controls.btnPrimary} onClick={save}>
              <Save size={16} /> Save settings
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleting}
        destructive
        title="Delete this profile?"
        message={`“${deleting?.companyName || 'Untitled profile'}” will be removed after you save. Invoices already issued keep their own copy of these details.`}
        confirmLabel="Delete profile"
        onConfirm={() => deleting && removeProfile(deleting.id!)}
        onClose={() => setDeleting(null)}
      />
      {toastNode}
    </div>
  );
}

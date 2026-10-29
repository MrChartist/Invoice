import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Building, Plus } from 'lucide-react';
import { can } from '../../lib/access';
import {
  companiesSupported,
  createCompany,
  deleteCompany,
  readRegistry,
  renameCompany,
  switchCompany,
  type CompanyEntry,
} from '../../lib/companies';
import { DEFAULT_COMPANY_ID, activeCompanyId } from '../../lib/company-registry';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { useT } from '../../i18n';
import { syncT } from '../../i18n/areas/sync';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './companies.module.css';
import { errText } from '../../i18n/lib-msg';

type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void;

/** Settings → Data & backup → Companies (6.20): separate data sets on one device. */
export function CompaniesPanel({ notify }: { notify: Notify }) {
  const { t } = useT(); // re-render on a language switch (5.4)
  const [reg, setReg] = useState(readRegistry);
  const here = activeCompanyId(); // this tab's open company (QA7 G1), not another tab's switch
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<CompanyEntry | null>(null);
  const supported = companiesSupported();
  const refresh = () => setReg(readRegistry());

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const c = createCompany(name);
      setName('');
      refresh();
      notify(syncT('companyCreated', { name: c.name }));
    } catch (err) {
      notify(errText(err), 'error');
    }
  };

  const saveRename = (e: React.FormEvent) => {
    e.preventDefault();
    if (!renaming) return;
    try {
      renameCompany(renaming.id, renaming.name);
      setRenaming(null);
      refresh();
    } catch (err) {
      notify(errText(err), 'error');
    }
  };

  return (
    <section className={surface.card} aria-labelledby="companies-title">
      <div className={surface.cardHead}>
        <span className={surface.cardHeadIcon} id="companies-title">
          <Building size={16} /> {syncT('companiesTitle')}
        </span>
      </div>
      <div className={surface.cardBody}>
        <p className={surface.sectionNote} style={{ marginTop: 0 }}>
          {syncT('companiesNote')}
        </p>
        {!supported && <p className={surface.sectionNote}>{syncT('companiesUnsupported')}</p>}
        {/* R3-C6: every company's returns, DSC expiry and checklist on one board (owner only). */}
        {supported && can('settings.manage') && (
          <p className={surface.sectionNote}>
            <Link to="/practice" className={`${controls.btnOutline} ${controls.btnSm}`} data-practice-link><Building2 size={14} /> {t('nav.practice')}</Link>
          </p>
        )}
        <ul className={styles.list}>
          {reg.list.map((c) => (
            <li key={c.id} className={styles.row}>
              {renaming?.id === c.id ? (
                <form className={styles.form} style={{ marginTop: 0, flex: 1 }} onSubmit={saveRename}>
                  <input className={controls.input} aria-label={syncT('companyName')} value={renaming.name} autoFocus
                    onChange={(e) => setRenaming({ id: c.id, name: e.target.value })} />
                  <button type="submit" className={controls.btnPrimary}>{syncT('save')}</button>
                  <button type="button" className={controls.btnOutline} onClick={() => setRenaming(null)}>{syncT('cancel')}</button>
                </form>
              ) : (
                <>
                  <span className={styles.name}>
                    {c.name}
                    {c.id === here && <span className={styles.active}>{syncT('open')}</span>}
                  </span>
                  <span className={styles.actions}>
                    {c.id !== here && (
                      <button type="button" className={controls.btnOutline} onClick={() => switchCompany(c.id)}>{syncT('switch')}</button>
                    )}
                    <button type="button" className={controls.btnOutline} onClick={() => setRenaming({ id: c.id, name: c.name })}>{syncT('rename')}</button>
                    {c.id !== here && c.id !== DEFAULT_COMPANY_ID && (
                      <button type="button" className={controls.btnOutline} onClick={() => setDeleting(c)}>{syncT('delete')}</button>
                    )}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
        {supported && (
          <form className={styles.form} onSubmit={add}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="company-new">{syncT('newCompany')}</label>
              <input id="company-new" className={controls.input} value={name} onChange={(e) => setName(e.target.value)} placeholder={syncT('newCompanyPh')} />
            </div>
            <button type="submit" className={controls.btnPrimary} disabled={!name.trim()}>
              <Plus size={16} /> {syncT('addCompany')}
            </button>
          </form>
        )}
      </div>
      <ConfirmDialog
        open={!!deleting}
        title={syncT('deleteCompanyTitle', { name: deleting?.name ?? '' })}
        message={syncT('deleteCompanyMsg')}
        confirmLabel={syncT('deleteCompany')}
        requireText={deleting?.name}
        destructive
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          const c = deleting;
          setDeleting(null);
          if (!c) return;
          deleteCompany(c.id).then(
            (ok) => {
              refresh();
              notify(ok ? syncT('companyDeleted', { name: c.name }) : syncT('companyKeptOpen'), ok ? 'success' : 'error');
            },
            (err: unknown) => notify(errText(err), 'error'),
          );
        }}
      />
    </section>
  );
}

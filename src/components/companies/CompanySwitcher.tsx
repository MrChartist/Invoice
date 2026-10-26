import { useState } from 'react';
import { activeCompanyId, labelMainCompany, readRegistry, switchCompany } from '../../lib/companies';
import { localDb } from '../../lib/localDb';
import { useT } from '../../i18n';
import { pwaT } from '../../i18n/areas/pwa';
import controls from '../../styles/controls.module.css';
import styles from './companies.module.css';

/** Sidebar switcher (6.20); renders nothing until a second company exists. */
export function CompanySwitcher() {
  useT(); // re-render on a language switch (5.4)
  // F27: the main company shows its profile name, not the "Main business" placeholder.
  const [reg] = useState(() => {
    labelMainCompany(localDb.settings.activeProfile()?.companyName);
    return readRegistry();
  });
  if (reg.list.length < 2) return null;
  return (
    <div className={styles.switcher}>
      <label className={styles.switcherLabel} htmlFor="company-switch">{pwaT('company')}</label>
      <select id="company-switch" className={controls.select} value={activeCompanyId()} onChange={(e) => switchCompany(e.target.value)}>
        {reg.list.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    </div>
  );
}

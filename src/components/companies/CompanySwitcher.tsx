import { useState } from 'react';
import { readRegistry, switchCompany } from '../../lib/companies';
import { useT } from '../../i18n';
import { pwaT } from '../../i18n/areas/pwa';
import controls from '../../styles/controls.module.css';
import styles from './companies.module.css';

/** Sidebar switcher (6.20); renders nothing until a second company exists. */
export function CompanySwitcher() {
  useT(); // re-render on a language switch (5.4)
  const [reg] = useState(readRegistry);
  if (reg.list.length < 2) return null;
  return (
    <div className={styles.switcher}>
      <label className={styles.switcherLabel} htmlFor="company-switch">{pwaT('company')}</label>
      <select id="company-switch" className={controls.select} value={reg.active} onChange={(e) => switchCompany(e.target.value)}>
        {reg.list.map((c) => (
          <option key={c.id} value={c.id}>{c.name}</option>
        ))}
      </select>
    </div>
  );
}

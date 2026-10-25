/**
 * Settings → Activity: per-FY auditor export of the audit trail (ROADMAP 7.49) — the year's rows with
 * the chain head and verification, as CSV and JSON. The builder (`audit-export.ts`) loads on click.
 */
import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { audit } from '../../lib/audit';
import { downloadText } from '../../lib/download';
import { getIndianFY } from '../../lib/invoice-number';
import { localDb } from '../../lib/localDb';
import { useT } from '../../i18n';
import { vtT } from '../../i18n/areas/voucher-types';
import controls from '../../styles/controls.module.css';
import styles from './audit.module.css';

export function AuditorExport() {
  useT();
  const fys = useMemo(() => {
    const set = new Set<string>([getIndianFY().label]);
    for (const r of audit.fullRows()) {
      const d = new Date(r.at);
      if (!Number.isNaN(d.getTime())) set.add(getIndianFY(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`).label);
    }
    return [...set].sort().reverse();
  }, []);
  const [fy, setFy] = useState(fys[0]);
  const [status, setStatus] = useState('');

  const run = async (kind: 'csv' | 'json') => {
    const m = await import('../../lib/audit-export');
    const x = m.auditorExport(audit.fullRows(), fy);
    const company = localDb.settings.activeProfile()?.companyName ?? '';
    if (kind === 'csv') downloadText(m.auditorFileName(fy, 'csv'), m.auditorCsv(x), 'text/csv;charset=utf-8');
    else downloadText(m.auditorFileName(fy, 'json'), m.auditorJson(x, company), 'application/json');
    setStatus(vtT('auditorRows', { n: x.rows.length, state: x.chain.verified ? vtT('chainOk') : vtT('chainBroken') }));
  };

  return (
    <div className={styles.integrity}>
      <div className={styles.integrityHead}>
        <strong>{vtT('auditorExport')}</strong>
      </div>
      <p className={styles.integrityNote}>{vtT('auditorExportHint')}</p>
      <div className={styles.headRow}>
        <label className={controls.field}>
          <span className={controls.label}>{vtT('fy')}</span>
          <select className={controls.select} value={fy} onChange={(e) => setFy(e.target.value)} data-testid="auditor-fy">
            {fys.map((f) => <option key={f} value={f}>FY {f}</option>)}
          </select>
        </label>
        <span className={styles.headActions}>
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => void run('csv')} data-testid="auditor-csv">
            <Download size={14} aria-hidden="true" /> {vtT('auditorCsv')}
          </button>
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => void run('json')}>
            <Download size={14} aria-hidden="true" /> {vtT('auditorJson')}
          </button>
        </span>
      </div>
      {status && <p className={styles.integrityNote} role="status">{status}</p>}
    </div>
  );
}

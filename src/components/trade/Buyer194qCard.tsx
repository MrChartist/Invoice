/** TR-C2 statutory prompt (one lazy chunk per mount, so each host page preloads only what it needs). Working paper — verify with your CA. */
import { useState } from 'react';
import { useT } from '../../i18n';
import { trT } from '../../i18n/areas/trade-r8c';
import { requireAccess } from '../../lib/access';
import { setJson } from '../../lib/storage';
import { TDS_SETTINGS_KEY, readTdsSettings } from '../../lib/tds-payables';
import { buyer194q, precedingFy } from '../../lib/trade/tr-statutory';
import controls from '../../styles/controls.module.css';
import own from '../distribution/dist.module.css';

export default function Buyer194qCard({ today }: { today: string }) {
  useT();
  const fy = precedingFy(today);
  const [value, setValue] = useState(() => readTdsSettings().turnover_by_fy?.[fy]);
  const status = buyer194q(today, value === undefined ? {} : { [fy]: value }).status;
  const save = (v: number | undefined) => {
    setValue(v);
    try {
      requireAccess('settings.manage');
      const s = readTdsSettings();
      const by = { ...(s.turnover_by_fy ?? {}) };
      if (v === undefined) delete by[fy];
      else by[fy] = v;
      setJson(TDS_SETTINGS_KEY, { ...s, turnover_by_fy: by });
    } catch {
      /* a clerk / viewer sees the figure but cannot change it */
    }
  };
  return (
    <div className={own.stack} data-194q-card>
      <label className={controls.field}>
        <span className={controls.label}>{trT('q194Title')} : {trT('q194Text', { fy })}</span>
        <input type="number" min={0} className={controls.input} style={{ maxWidth: 240 }} value={value ?? ''} onChange={(e) => save(e.target.value === '' ? undefined : Math.max(Number(e.target.value) || 0, 0))} />
      </label>
      <p className={own.muted}>{trT(status === 'applies' ? 'q194Applies' : status === 'below' ? 'q194Below' : 'q194Unknown')} {trT('workingPaper')}</p>
    </div>
  );
}

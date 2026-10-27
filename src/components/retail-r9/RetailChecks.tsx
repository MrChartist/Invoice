/**
 * RT-A2: Settings → Items → "Retail checks" (not pack-gated): the MRP guard, home deliveries, the short book and free
 * quantity on supplier bills. Owner only (`settings.manage`); each change is saved at once and audited.
 */
import { useState } from 'react';
import { Store } from 'lucide-react';
import { useT } from '../../i18n';
import { rtaT } from '../../i18n/areas/retail-r9a';
import { can } from '../../lib/access';
import { readRetailSettings, saveRetailSettings } from '../../lib/retail/rt-settings';
import type { GuardMode, RetailSettings } from '../../types/retail-r9';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';

export default function RetailChecks({ notify }: { notify: (msg: string, kind?: 'error') => void }) {
  useT();
  const owner = can('settings.manage');
  const [s, setS] = useState<RetailSettings>(readRetailSettings);
  const save = (patch: Partial<RetailSettings>) => {
    try {
      setS(saveRetailSettings(patch));
      notify(rtaT('saved'));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  const check = (label: string, on: boolean, patch: (v: boolean) => Partial<RetailSettings>, key: string) => (
    <label className={controls.check}>
      <input type="checkbox" checked={on} disabled={!owner} onChange={(e) => save(patch(e.target.checked))} data-retail-check={key} /> {label}
    </label>
  );
  return (
    <section className={surface.card} aria-labelledby="retail-checks" data-retail-checks>
      <div className={surface.cardHead}>
        <span className={surface.cardHeadIcon} id="retail-checks"><Store size={16} aria-hidden="true" /> {rtaT('checksTitle')}</span>
      </div>
      <div className={surface.cardBody}>
        <p className={surface.sectionNote}>{rtaT('checksSub')}</p>
        <label className={controls.field} style={{ maxWidth: 320 }}>
          <span className={controls.label}>{rtaT('mrpGuard')}</span>
          <select className={controls.select} value={s.mrp_guard ?? 'off'} disabled={!owner} onChange={(e) => save({ mrp_guard: e.target.value as GuardMode })} data-retail-mrp-guard>
            {(['off', 'warn', 'block'] as const).map((m) => <option key={m} value={m}>{rtaT(`mrp.${m}`)}</option>)}
          </select>
        </label>
        {check(rtaT('deliveriesOn'), !!s.delivery?.enabled, (v) => ({ delivery: v ? { enabled: true } : undefined }), 'delivery')}
        {check(rtaT('shortBookOn'), !!s.short_book?.enabled, (v) => ({ short_book: v ? { enabled: true } : undefined }), 'shortbook')}
        {check(rtaT('freeQtyOn'), !!s.free_qty, (v) => ({ free_qty: v || undefined }), 'freeqty')}
        <p className={controls.hint}>{rtaT('workingPaper')}</p>
      </div>
    </section>
  );
}

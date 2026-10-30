import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { cn } from '../../lib/utils';
import { localDb } from '../../lib/localDb';
import { downloadText } from '../../lib/download';
import { vendorsDb } from '../../lib/vendors';
import { stringifyEway, type EwayTransMode } from '../../lib/eway';
import { buildJobWorkEway } from '../../lib/eway-job-work';
import type { MaterialOut } from '../../types/job-work';
import type { StockItem } from '../../lib/inventory';
import type { UnitMaster } from '../../lib/units';
import { s7T } from '../../i18n/areas/inventory-7s';
import controls from '../../styles/controls.module.css';
import styles from './job-work.module.css';
import { SelectField } from '../ui/SelectField';

const MODES: EwayTransMode[] = ['ROAD', 'RAIL', 'AIR', 'SHIP'];

/** 7S (7.73): e-Way bill JSON for a Material Out challan (sub-type Job Work, document CHL). */
export function JobWorkEwayDialog({ challan, items, units, onClose }: { challan: MaterialOut; items: readonly StockItem[]; units: readonly UnitMaster[]; onClose: () => void }) {
  const [mode, setMode] = useState<EwayTransMode>('ROAD');
  const build = useMemo(() => {
    const p = localDb.settings.activeProfile();
    const vendor = challan.vendor_id ? vendorsDb.all().find((v) => v.id === challan.vendor_id) : vendorsDb.all().find((v) => v.name.trim().toLowerCase() === challan.party_name.trim().toLowerCase());
    return buildJobWorkEway(challan, {
      sender: { name: p?.companyName ?? '', gstin: p?.companyGstin, address: p?.companyAddress, stateCode: p?.stateCode },
      vendor, items, units, mode,
    });
  }, [challan, items, units, mode]);
  const download = () => downloadText(`eway-${challan.number.replace(/[^\w-]+/g, '-')}.json`, stringifyEway(build.payload), 'application/json');

  return (
    <Modal open onClose={onClose} size="lg" title={s7T('ewayTitle', { number: challan.number })}
      footer={<>
        <button type="button" className={controls.btnOutline} onClick={onClose}>{s7T('close')}</button>
        <button type="button" className={controls.btnPrimary} onClick={download} data-testid="jw-eway-download"><Download size={16} aria-hidden="true" /> {s7T('downloadJson')}</button>
      </>}>
      <div className={styles.form}>
        <p className={cn(styles.notice, build.required ? undefined : styles.info)} role="status">{build.required ? s7T('ewayRequired') : s7T('ewayOptional')}</p>
        <p className={styles.muted}>{s7T('ewayCa')}</p>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="jwe-mode">{s7T('mode')}</label>
          <SelectField id="jwe-mode" className={controls.select} value={mode} onChange={(e) => setMode(e.target.value as EwayTransMode)}>
            {MODES.map((m) => <option key={m} value={m}>{s7T(`mode${m}`)}</option>)}
          </SelectField>
        </div>
        {build.notes.length > 0 && (
          <div className={styles.notice}>
            <strong>{s7T('ewayNotes')}</strong>
            <ul>{build.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          </div>
        )}
      </div>
    </Modal>
  );
}

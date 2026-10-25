import { useId } from 'react';
import type { ClockStatus } from '../../lib/job-work';
import type { JwData, PartyValue } from './lines';
import { jwT } from '../../i18n/areas/job-work';
import controls from '../../styles/controls.module.css';
import styles from './job-work.module.css';

/** Name with a datalist of known parties; picking one fills its id, GSTIN and state code. */
export function PartyField({ label, value, onChange, parties, kind = 'vendor', hint }: {
  label: string;
  value: PartyValue;
  onChange: (v: PartyValue) => void;
  parties: JwData['parties'];
  kind?: 'vendor' | 'client';
  hint?: string;
}) {
  const id = useId();
  const pick = (name: string) => {
    const p = parties.find((x) => x.name.trim().toLowerCase() === name.trim().toLowerCase());
    const idKey = kind === 'vendor' ? 'vendor_id' : 'client_id';
    onChange(p
      ? { ...value, party_name: name, [idKey]: p.id, party_gstin: p.gstin || value.party_gstin, party_state_code: p.state_code || (p.gstin ?? '').slice(0, 2) || value.party_state_code }
      : { ...value, party_name: name, [idKey]: undefined });
  };
  return (
    <>
      <div className={controls.field}>
        <label className={controls.label} htmlFor={`${id}-n`}>{label}</label>
        <input id={`${id}-n`} className={controls.input} list={`${id}-l`} value={value.party_name} onChange={(e) => pick(e.target.value)} autoComplete="off" />
        <datalist id={`${id}-l`}>{parties.map((p) => <option key={p.id} value={p.name} />)}</datalist>
        {hint && <span className={styles.muted}>{hint}</span>}
      </div>
      <div className={controls.field}>
        <label className={controls.label} htmlFor={`${id}-g`}>{jwT('gstin')}</label>
        <input id={`${id}-g`} className={controls.input} value={value.party_gstin ?? ''} onChange={(e) => onChange({ ...value, party_gstin: e.target.value.trim().toUpperCase() || undefined })} />
      </div>
    </>
  );
}

const STATUS: Record<ClockStatus, { key: 'stSettled' | 'stOpen' | 'stDueSoon' | 'stExpired' | 'stNoLimit'; cls: string }> = {
  settled: { key: 'stSettled', cls: styles.badgeOk },
  open: { key: 'stOpen', cls: '' },
  due_soon: { key: 'stDueSoon', cls: styles.badgeWarn },
  expired: { key: 'stExpired', cls: styles.badgeDanger },
  no_limit: { key: 'stNoLimit', cls: '' },
};

export function ClockBadge({ status }: { status: ClockStatus }) {
  const s = STATUS[status];
  return <span className={`${styles.badge} ${s.cls}`}>{jwT(s.key)}</span>;
}

import { useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import type { TableOrder } from '../../types/restaurant';
import { kotRegister, registerSheet } from '../../lib/restaurant/kot';
import { toCsv } from '../../lib/csv';
import { downloadText } from '../../lib/download';
import { formatCurrency } from '../../lib/utils';
import { useT } from '../../i18n';
import { rT } from '../../i18n/areas/restaurant';
import controls from '../../styles/controls.module.css';
import styles from './restaurant.module.css';
import { DateField } from '../ui/DateField';
import { SelectField } from '../ui/SelectField';

export interface KotRegisterProps {
  orders: readonly TableOrder[];
  day: string;
  whereOf: (o: TableOrder) => string;
  onClose: () => void;
}

/** KOT register + leakage view (R3-A2). Source: `table_orders` only. Exports CSV / XLSX. */
export function KotRegisterModal({ orders, day, whereOf, onClose }: KotRegisterProps) {
  useT();
  const [from, setFrom] = useState(day);
  const [to, setTo] = useState(day);
  const [station, setStation] = useState('');
  const [captain, setCaptain] = useState('');
  const full = useMemo(() => kotRegister(orders, { from, to }, whereOf), [orders, from, to, whereOf]);
  const reg = useMemo(() => kotRegister(orders, { from, to, station: station || undefined, captain: captain || undefined }, whereOf), [orders, from, to, station, captain, whereOf]);
  const sheet = () => registerSheet(reg).map((r) => r.map((c) => (c === undefined || c === null ? '' : (c as string | number))));
  const stem = `kot-register-${from}${to !== from ? `-${to}` : ''}`;
  const xlsx = async () => {
    const { downloadXlsx } = await import('../../lib/xlsx');
    await downloadXlsx(`${stem}.xlsx`, [{ name: 'KOT register', rows: sheet() }]);
  };

  return (
    <Modal
      open
      size="xl"
      onClose={onClose}
      title={rT('register')}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={() => downloadText(`${stem}.csv`, toCsv(sheet()), 'text/csv')}>{rT('exportCsv')}</button>
          <button type="button" className={controls.btnOutline} onClick={() => void xlsx()}>{rT('exportXlsx')}</button>
          <button type="button" className={controls.btnPrimary} onClick={onClose}>{rT('close')}</button>
        </>
      }
    >
      <div className={styles.panel}>
        <div className={styles.editRow}>
          <label className={controls.field}><span className={controls.label}>{rT('regFrom')}</span><DateField className={controls.input} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className={controls.field}><span className={controls.label}>{rT('regTo')}</span><DateField className={controls.input} value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <label className={controls.field}>
            <span className={controls.label}>{rT('regStation')}</span>
            <SelectField className={controls.select} value={station} onChange={(e) => setStation(e.target.value)}>
              <option value="">{rT('regAll')}</option>
              {Object.keys(full.byStation).map((s) => <option key={s} value={s}>{s}</option>)}
            </SelectField>
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{rT('regCaptain')}</span>
            <SelectField className={controls.select} value={captain} onChange={(e) => setCaptain(e.target.value)}>
              <option value="">{rT('regAll')}</option>
              {Object.keys(full.byCaptain).map((s) => <option key={s} value={s}>{s}</option>)}
            </SelectField>
          </label>
        </div>
        <p className={styles.muted} data-kot-totals>{rT('regTotals', { kots: reg.totals.kots, cancels: reg.totals.cancels, value: formatCurrency(reg.totals.cancelValue), moves: reg.totals.moves })}</p>
        <strong>{rT('regKots')}</strong>
        <div className={styles.regWrap}>
          <table className={styles.regTable}>
            <thead><tr><th>{rT('regFrom')}</th><th>KOT</th><th>{rT('regStation')}</th><th>{rT('regCaptain')}</th><th>{rT('regWhere')}</th><th>{rT('regKind')}</th><th>{rT('regItems')}</th><th>{rT('regQty')}</th></tr></thead>
            <tbody>
              {reg.rows.map((r) => (
                <tr key={`${r.day}-${r.number}-${r.where}`}><td>{r.day}</td><td>{r.number}</td><td>{r.station}</td><td>{r.captain}</td><td>{r.where}</td><td>{r.kind === 'cancel' ? `${rT('cancelTicket')}${r.reason ? ` · ${rT(`r.${r.reason}` as 'r.other')}` : ''}` : 'KOT'}</td><td>{r.items}</td><td>{r.qty}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <strong>{rT('regLeak')}</strong>
        <div className={styles.regWrap}>
          <table className={styles.regTable} data-leakage>
            <thead><tr><th>{rT('regFrom')}</th><th>{rT('regKind')}</th><th>{rT('regBy')}</th><th>{rT('regWhere')}</th><th>{rT('regItems')}</th><th>{rT('regQty')}</th><th>{rT('regValue')}</th><th>{rT('reason')}</th></tr></thead>
            <tbody>
              {reg.leakage.map((r, i) => (
                <tr key={`${r.at}-${i}`}><td>{new Date(r.at).toLocaleString('en-IN')}</td><td>{r.kind}</td><td>{r.by}</td><td>{r.where}</td><td>{r.line ?? ''}</td><td>{r.qty ?? ''}</td><td>{r.value !== undefined ? formatCurrency(r.value) : ''}</td><td>{r.reason ?? ''}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}

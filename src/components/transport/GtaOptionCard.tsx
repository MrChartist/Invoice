/** R5-B1: GTA tax option per financial year (Annexure V / VI), with the rate each option means on a date. */
import { useMemo, useState } from 'react';
import { Scale } from 'lucide-react';
import { twT } from '../../i18n/areas/packs-transport-works-r5';
import type { GtaOption } from '../../types/transport-works-r5';
import { GTA_OPTIONS, fyOf, loadGtaOptions, nextFy, optionLine, saveGtaOption } from '../../lib/transport/gta-option';
import { inGtaWindow } from '../../lib/transport-works-rules';
import { B, errText, today, type PanelProps } from './shared';
import { F } from './Field';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './transport.module.css';

export function GtaOptionCard({ notify, refresh, tick }: PanelProps) {
  const rows = useMemo(() => [...loadGtaOptions()].sort((a, b) => b.fy.localeCompare(a.fy)), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const day = today();
  const [f, setF] = useState({ fy: inGtaWindow(day) ? nextFy(fyOf(day)) : fyOf(day), option: 'rcm' as GtaOption, filed: '', arn: '', note: '' });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = () => {
    try {
      saveGtaOption({ fy: f.fy, option: f.option, filed_on: f.filed || undefined, arn: f.arn, note: f.note });
      notify(twT('optionSaved', { fy: f.fy }));
      refresh();
    } catch (e) {
      notify(errText(e), 'error');
    }
  };
  return (
    <div className={styles.stack}>
      <h3 className={styles.toolbar}><Scale size={16} aria-hidden="true" /> {twT('gtaTitle')}</h3>
      <p className={styles.note}>{twT('gtaHint')}</p>
      {inGtaWindow(day) && <p className={styles.warn}>{twT('gtaWindow', { fy: nextFy(fyOf(day)) })}</p>}
      <div className={styles.grid}>
        <F l={twT('fy')}><input className={controls.input} value={f.fy} onChange={set('fy')} placeholder="26-27" /></F>
        <F l={twT('option')}>
          <select className={controls.select} value={f.option} onChange={set('option')}>{GTA_OPTIONS.map((o) => <option key={o} value={o}>{twT(`opt.${o}`)}</option>)}</select></F>
        <F l={twT('filedOn')}><input className={controls.input} type="date" value={f.filed} onChange={set('filed')} /></F>
        <F l={"ARN"}><input className={controls.input} value={f.arn} onChange={set('arn')} /></F>
        <F l={twT('note')}><input className={controls.input} value={f.note} onChange={set('note')} /></F>
      </div>
      <div className={styles.toolbar}><button type="button" className={B.p} onClick={save}>{twT('save')}</button></div>
      {rows.length > 0 && (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th>{twT('fy')}</th><th>{twT('option')}</th><th>{twT('filedOn')}</th><th>ARN</th></tr></thead>
            <tbody>{rows.map((r) => <tr key={r.id}><td>{r.fy}</td><td>{optionLine(r.option, `20${r.fy.slice(0, 2)}-04-01`)}</td><td>{r.filed_on ?? '—'}</td><td>{r.arn ?? '—'}</td></tr>)}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

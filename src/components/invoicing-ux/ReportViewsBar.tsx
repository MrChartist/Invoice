import { useEffect, useState } from 'react';
import { History, Download, Package, Trash2 } from 'lucide-react';
import { deleteView, loadPackSchedule, loadViews, previousMonth, savePackSchedule, saveView, type PackSchedule, type SavedView } from '../../lib/report-views';
import type { Period, PeriodPreset } from '../../lib/books';
import type { ReportPrefs } from '../../lib/report-prefs';
import { localDayOf } from '../../lib/dates';
import { downloadBlob } from '../../lib/download';
import { cn } from '../../lib/utils';
import { useT } from '../../i18n';
import { uxT } from '../../i18n/areas/invoicing-ux';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import ux from './ux.module.css';

const isFolderBackupSupported = () => typeof window !== 'undefined' && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';

export interface ViewState {
  route: string;
  tab: string;
  preset: PeriodPreset;
  period: Period;
  prefs?: Record<string, ReportPrefs>;
}

/**
 * 8.109 saved report views (name + tab + period + F12 options, device-local) and month-end packs
 * (one ZIP of P&L, balance sheet, ageing and GSTR-1 / 3B papers; optional monthly schedule that the
 * bell offers — and writes to the backup folder — on the first open after the chosen day).
 */
export function ReportViewsBar({ current, onApply, initialViewId, openPacks, initialMonth }: { current: ViewState; onApply: (v: SavedView) => void; initialViewId?: string | null; openPacks?: boolean; initialMonth?: string | null }) {
  useT();
  const [views, setViews] = useState<SavedView[]>(() => loadViews());
  const [name, setName] = useState('');
  const [packs, setPacks] = useState(!!openPacks);
  const [month, setMonth] = useState(() => initialMonth && /^\d{4}-\d{2}$/.test(initialMonth) ? initialMonth : previousMonth(localDayOf(new Date())));
  const [sched, setSched] = useState<PackSchedule>(() => loadPackSchedule());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!initialViewId) return;
    const v = loadViews().find((x) => x.id === initialViewId);
    if (v) onApply(v);
    // Apply a linked view once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialViewId]);

  const mine = views.filter((v) => v.route === current.route);
  const save = () => {
    try {
      setViews(saveView({ name, route: current.route, tab: current.tab, preset: current.preset, period: current.preset === 'custom' ? current.period : undefined, prefs: current.prefs }));
      setName('');
      setMsg(uxT('rvSaved'));
    } catch (err) {
      setMsg((err as Error).message);
    }
  };
  const download = async () => {
    setBusy(true);
    setMsg('');
    try {
      const { buildPackZip } = await import('../../lib/report-pack');
      const { name: file, blob } = await buildPackZip(month);
      downloadBlob(file, blob);
      if (month === previousMonth(localDayOf(new Date())) && sched.day) {
        const next = { ...sched, lastMonth: month };
        savePackSchedule(next);
        setSched(next);
      }
      setMsg(uxT('rvPackDone', { file }));
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const setSchedule = (patch: Partial<PackSchedule>) => {
    const next = { ...sched, ...patch };
    savePackSchedule(next);
    setSched(next);
  };

  return (
    <section className={surface.card} aria-label={uxT('rvTitle')} data-report-views>
      <div className={ux.box}>
        <div className={ux.row}>
          <History size={16} aria-hidden="true" />
          <strong>{uxT('rvTitle')}</strong>
          {mine.map((v) => (
            <span key={v.id} className={ux.chip}>
              <button type="button" className={ux.linkBtn} onClick={() => onApply(v)} title={v.preset === 'custom' && v.period ? `${v.period.start} – ${v.period.end}` : v.preset}>{v.name}</button>
              <button type="button" className={controls.btnIcon} aria-label={uxT('rvDelete', { name: v.name })} onClick={() => setViews(deleteView(v.id))}><Trash2 size={12} /></button>
            </span>
          ))}
          <input className={cn(controls.input, ux.narrow)} value={name} onChange={(e) => setName(e.target.value)} placeholder={uxT('rvName')} aria-label={uxT('rvName')} onKeyDown={(e) => e.key === 'Enter' && name.trim() && save()} />
          <button type="button" className={cn(controls.btnOutline, controls.btnSm)} disabled={!name.trim()} onClick={save}>{uxT('rvSave')}</button>
          <button type="button" className={cn(controls.btnGhost, controls.btnSm)} aria-expanded={packs} onClick={() => setPacks((p) => !p)}><Package size={14} /> {uxT('rvPacks')}</button>
        </div>
        {packs && (
          <div className={ux.row} data-report-packs>
            <label className={controls.field}>
              <span className={controls.label}>{uxT('rvMonth')}</span>
              <input type="month" className={controls.input} value={month} max={localDayOf(new Date()).slice(0, 7)} onChange={(e) => e.target.value && setMonth(e.target.value)} />
            </label>
            <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} disabled={busy} onClick={download} data-pack-download>
              <Download size={14} /> {busy ? uxT('rvBuilding') : uxT('rvDownload')}
            </button>
            <label className={controls.field}>
              <span className={controls.label}>{uxT('rvSchedule')}</span>
              <select className={controls.select} value={sched.day} onChange={(e) => setSchedule({ day: Number(e.target.value) })}>
                <option value={0}>{uxT('rvOff')}</option>
                {[1, 2, 3, 5, 7, 10].map((d) => <option key={d} value={d}>{uxT('rvDay', { n: d })}</option>)}
              </select>
            </label>
            {sched.day > 0 && isFolderBackupSupported() && (
              <label className={controls.check}>
                <input type="checkbox" checked={sched.autoFolder} onChange={(e) => setSchedule({ autoFolder: e.target.checked })} /> {uxT('rvAutoFolder')}
              </label>
            )}
            <p className={ux.muted}>{uxT('rvPackHint')}</p>
          </div>
        )}
        {msg && <p className={ux.muted} role="status">{msg}</p>}
      </div>
    </section>
  );
}

export default ReportViewsBar;

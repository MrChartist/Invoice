/**
 * R20-C: the report keys' UI, one lazy chunk — the "what you see" strip (filter chip, ticks, hidden rows, totals of the
 * rows shown, one polite live region), the Ctrl+F filter sheet, the Ctrl+J exceptions sheet (default export, mounted
 * by `ReportStrip`, lib/keys/report-keys.ts) and the Ctrl+H / Ctrl+L saved-views sheet (`ViewsSheet`, mounted by PeriodBar).
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n';
import { repKeysT } from '../../i18n/areas/keys-r20c';
import { formatDate, formatMoney } from '../../lib/utils';
import { emptyFilter, filterRows, shownRows, totalsOf, type ReportFilter } from '../../lib/keys/report-actions';
import { deleteView, loadViews, saveView, setDefaultView, viewHref, type SavedView } from '../../lib/report-views';
import { getAllReportPrefs } from '../../lib/report-prefs';
import type { LiveReport } from '../../lib/keys/report-keys';
import { Modal } from '../ui/Modal';
import controls from '../../styles/controls.module.css';
import lg from '../books/ledger/ledger.module.css';

// Inline styles: no stylesheet of its own (a new CSS file would join every report route's preload list).
const s = {
  strip: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.375rem 0.75rem', marginTop: '0.5rem', padding: '0.5rem 0.75rem', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--card)', fontSize: 'var(--text-sm)' },
  chip: { display: 'inline-flex', alignItems: 'center', gap: '0.375rem' },
  totals: { marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' },
  form: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: '0.75rem' },
  list: { display: 'grid', gap: '0.375rem', margin: 0, padding: 0, listStyle: 'none' },
  item: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.5rem' },
} as const satisfies Record<string, CSSProperties>;

const money = (p: number) => formatMoney(p / 100);
const T = repKeysT;

export default function ReportPanel({ live }: { live: LiveReport }) {
  useT();
  const { tools, count } = live;
  const facts = useMemo(() => live.facts(), [live]);
  const shown = shownRows(count, tools);
  const ticked = [...tools.sel].sort((a, b) => a - b);
  const tot = totalsOf(facts, ticked.length ? ticked : shown);
  const hidden = tools.hid.flat().length;
  const btn = (label: string, on: () => void) => (
    <button type="button" className={`${controls.btnGhost} ${controls.btnSm} no-print`} onClick={on}>{label}</button>
  );
  return (
    <>
      {(tools.filter || ticked.length > 0 || hidden > 0) && (
        <div style={s.strip} role="status" aria-live="polite" data-report-strip>
          {tools.filter && (
            <span style={s.chip}>
              {T('filtered', { n: shown.length, total: count })}
              {btn(T('clear'), () => live.set((t) => ({ ...t, filter: null, match: null })))}
            </span>
          )}
          {ticked.length > 0 && (
            <span style={s.chip}>
              {T('selected', { n: ticked.length })}
              {btn(T('untick'), () => live.set((t) => ({ ...t, sel: [] })))}
            </span>
          )}
          {hidden > 0 && (
            <span style={s.chip} data-hidden-count={hidden}>
              {T('hidden', { n: hidden })}
              {btn(T('showAll'), () => live.set((t) => ({ ...t, hid: [] })))}
            </span>
          )}
          <span style={s.totals} data-shown-totals>
            {ticked.length ? T('selected', { n: ticked.length }) : T('shownTotals')}: Dr {money(tot.dr)} · Cr {money(tot.cr)} · {T('net')}{' '}
            {money(Math.abs(tot.net))} {tot.net < 0 ? 'Cr' : 'Dr'}
          </span>
          {hidden > 0 && <span className={lg.printTitle}>{T('hideNote')}</span>}
        </div>
      )}
      {live.sheet === 'filter' && <FilterSheet live={live} />}
      {live.sheet === 'except' && <ExceptSheet live={live} />}
    </>
  );
}

const rupees = (v: string) => (v.trim() === '' || !Number.isFinite(Number(v)) ? undefined : Math.round(Number(v) * 100));

function FilterSheet({ live }: { live: LiveReport }) {
  useT();
  const f0 = live.tools.filter ?? {};
  const [f, setF] = useState({
    min: f0.min === undefined ? '' : String(f0.min / 100),
    max: f0.max === undefined ? '' : String(f0.max / 100),
    from: f0.from ?? '',
    to: f0.to ?? '',
    text: f0.text ?? '',
    narr: f0.narr ?? '',
    side: f0.side ?? '',
  });
  const close = () => live.setSheet('');
  const apply = (clear?: boolean) => {
    const flt: ReportFilter = { min: rupees(f.min), max: rupees(f.max), from: f.from || undefined, to: f.to || undefined, text: f.text || undefined, narr: f.narr || undefined, side: (f.side || undefined) as ReportFilter['side'] };
    live.set((t) => (clear || emptyFilter(flt) ? { ...t, filter: null, match: null } : { ...t, filter: flt, match: filterRows(live.facts(), flt) }));
    close();
  };
  const box = (k: keyof typeof f, label: string, type = 'text') => (
    <label className={controls.field}>
      <span className={controls.label}>{label}</span>
      <input className={controls.input} type={type} inputMode={type === 'number' ? 'decimal' : undefined} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-filter={k} />
    </label>
  );
  return (
    <Modal
      open
      onClose={close}
      title={T('filterTitle')}
      subtitle={T('filterSub')}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={() => apply(true)}>{T('clear')}</button>
          <button type="button" className={controls.btnPrimary} onClick={() => apply()} data-filter-apply>{T('apply')}</button>
        </>
      }
    >
      <form style={s.form} onSubmit={(e) => (e.preventDefault(), apply())}>
        {box('min', T('amtFrom'), 'number')}
        {box('max', T('amtTo'), 'number')}
        {box('text', T('text'))}
        {live.dated && box('from', T('dateFrom'), 'date')}
        {live.dated && box('to', T('dateTo'), 'date')}
        {live.dated && box('narr', T('narr'))}
        <label className={controls.field}>
          <span className={controls.label}>{T('side')}</span>
          <select className={controls.select} value={f.side} onChange={(e) => setF({ ...f, side: e.target.value })}>
            <option value="">{T('any')}</option>
            <option value="dr">{T('dr')}</option>
            <option value="cr">{T('cr')}</option>
          </select>
        </label>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

function ExceptSheet({ live }: { live: LiveReport }) {
  useT();
  const navigate = useNavigate();
  const rows = useMemo(() => live.except?.() ?? [], [live]);
  return (
    <Modal open onClose={() => live.setSheet('')} title={T('exceptTitle')}>
      {rows.length === 0 ? (
        <p>{T('exceptNone')}</p>
      ) : (
        <ul style={s.list} data-except-list>
          {rows.map((r, i) => (
            <li key={i} style={s.item}>
              <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => navigate(`/books?tab=ledger&acct=${encodeURIComponent(r.accountId)}${r.party ? `&party=${encodeURIComponent(r.party)}` : ''}`)}>
                {r.party ? `${r.label} — ${r.party}` : r.label}
              </button>
              <span>{T(`r_${r.reason}`)} · {money(Math.abs(r.balance))} {r.balance < 0 ? 'Cr' : 'Dr'}{r.firstDate ? ` · ${formatDate(r.firstDate)}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/**
 * Ctrl+H saved views of this screen (open, delete, open by default) and Ctrl+L "Save this view" (same sheet, the name
 * box focused). 8G storage (`mrchartist_report_views`, device-local); opening a view goes through `?view=` as the
 * views bar does.
 */
export function ViewsSheet({ route, tab, preset, period, onClose }: {
  route: string;
  tab: string;
  preset: SavedView['preset'];
  period: { start: string; end: string };
  onClose: () => void;
}) {
  useT();
  const navigate = useNavigate();
  const [views, setViews] = useState(() => loadViews());
  const [name, setName] = useState('');
  const [msg, setMsg] = useState('');
  const mine = views.filter((v) => v.route === route);
  const save = () => {
    try {
      setViews(saveView({ name, route, tab, preset, period: preset === 'custom' ? period : undefined, prefs: getAllReportPrefs() }));
      setName('');
      setMsg(T('saved'));
    } catch (err) {
      setMsg((err as Error).message);
    }
  };
  const open = (v: SavedView) => {
    onClose();
    navigate(viewHref(v));
  };
  return (
    <Modal open onClose={onClose} title={T('viewsTitle')} subtitle={T('viewsSub')}>
      <form style={s.form} onSubmit={(e) => (e.preventDefault(), name.trim() && save())}>
        <label className={controls.field}>
          <span className={controls.label}>{T('viewName')}</span>
          <input className={controls.input} value={name} onChange={(e) => setName(e.target.value)} data-autofocus data-view-name />
        </label>
        <button type="submit" className={controls.btnPrimary} disabled={!name.trim()}>{T('save')}</button>
      </form>
      {msg && <p role="status">{msg}</p>}
      {mine.length === 0 ? (
        <p>{T('noViews')}</p>
      ) : (
        <ul style={s.list} data-views-list>
          {mine.map((v) => (
            <li key={v.id} style={s.item}>
              <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => open(v)}>{v.name}</button>
              {v.default ? (
                <span>{T('isDefault')}</span>
              ) : (
                <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setViews(setDefaultView(v.id))}>{T('makeDefault')}</button>
              )}
              <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setViews(deleteView(v.id))}>{T('remove')}</button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

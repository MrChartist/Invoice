import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Car, ChevronLeft, ChevronRight, Clock, Download, FileSpreadsheet, IndianRupee, Pencil, Plus, ReceiptText, Timer, Trash2 } from 'lucide-react';
import type { MileageEntry, TimeEntry, TimePrefs } from '../types/time';
import {
  clientKey,
  entryAmount,
  expenseLine,
  formatMinutes,
  isBilled,
  liveInvoiceIds,
  mileageAmount,
  mileageDb,
  mileageToRows,
  mileageTotals,
  readTimePrefs,
  saveTimePrefs,
  timeDb,
  timeEntriesToRows,
  unbilledExpenses,
  unbilledMileage,
  unbilledTime,
  weekGrid,
  weekStart,
} from '../lib/timesheets';
import { localDb } from '../lib/localDb';
import { purchasesDb } from '../lib/purchases';
import { shiftDay } from '../lib/dates';
import { downloadText, toCsv } from '../lib/download';
import { round2 } from '../lib/invoice-calc';
import { cn, formatCurrency, formatDate, todayInput } from '../lib/utils';
import { PageHeader } from '../components/ui/PageHeader';
import { StatCard } from '../components/ui/StatCard';
import { EmptyState } from '../components/ui/EmptyState';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/useToast';
import { TimerCard } from '../components/time/TimerCard';
import { EntryModal, MileageModal } from '../components/time/TimeForms';
import { BillClientModal } from '../components/time/BillClientModal';
import surface from '../styles/surface.module.css';
import controls from '../styles/controls.module.css';
import styles from '../components/time/time.module.css';
import { dateLocale, useT } from '../i18n';
import { timeT } from '../i18n/areas/time';
import { areaNodes } from '../i18n/areas/nodes';

type Tab = 'timesheet' | 'mileage' | 'billing' | 'settings';
const TABS: { id: Tab; label: () => string }[] = [
  { id: 'timesheet', label: () => timeT('tabTimesheet') },
  { id: 'mileage', label: () => timeT('tabMileage') },
  { id: 'billing', label: () => timeT('tabUnbilled') },
  { id: 'settings', label: () => timeT('tabSettings') },
];
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** Weekday column head: English as before, Hindi weekday names for a Hindi interface. */
const dayName = (ymd: string, i: number, lang: string) =>
  lang === 'hi' ? new Intl.DateTimeFormat(dateLocale(), { weekday: 'short' }).format(new Date(`${ymd}T12:00:00`)) : DAY_NAMES[i];
const hrs = (m: number) => (m ? (m / 60).toFixed(2) : '–');

interface Unbilled {
  key: string;
  name: string;
  minutes: number;
  time: number;
  expenses: number;
  expenseCount: number;
  km: number;
  mileage: number;
}

export function Time() {
  const navigate = useNavigate();
  const { lang } = useT(); // re-render on a language switch (5.4)
  const [params, setParams] = useSearchParams();
  const tab = (TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'timesheet') as Tab;
  const { notify, toastNode } = useToast();

  const [entries, setEntries] = useState<TimeEntry[]>(() => timeDb.all());
  const [trips, setTrips] = useState<MileageEntry[]>(() => mileageDb.all());
  const [prefs, setPrefs] = useState<TimePrefs>(() => readTimePrefs());
  const [tick, setTick] = useState(0);
  const [week, setWeek] = useState(() => weekStart(todayInput()));
  const [editEntry, setEditEntry] = useState<TimeEntry | null | undefined>(undefined);
  const [editTrip, setEditTrip] = useState<MileageEntry | null | undefined>(undefined);
  const [confirm, setConfirm] = useState<{ kind: 'entry' | 'trip'; id: string } | null>(null);
  const [billTarget, setBillTarget] = useState<{ key: string; name: string } | null>(null);

  const reload = useCallback(() => {
    setEntries(timeDb.all());
    setTrips(mileageDb.all());
    setTick((t) => t + 1);
  }, []);
  useEffect(() => {
    window.addEventListener('focus', reload);
    return () => window.removeEventListener('focus', reload);
  }, [reload]);
  const saved = useCallback((message: string) => { notify(message); reload(); }, [notify, reload]);

  const clients = useMemo(() => localDb.clients.getAll().filter((c) => c.id && c.name?.trim()).sort((a, b) => a.name.localeCompare(b.name)), []);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const invoices = useMemo(() => localDb.invoices.getAll(), [tick]);
  const live = useMemo(() => liveInvoiceIds(invoices), [invoices]);
  const numbers = useMemo(() => new Map(invoices.map((i) => [i.id, i.invoice_number])), [invoices]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const purchases = useMemo(() => purchasesDb.all(), [tick]);

  const grid = useMemo(() => weekGrid(entries, week), [entries, week]);
  const weekEntries = useMemo(
    () => entries.filter((e) => e.date >= week && e.date <= shiftDay(week, 6)).sort((a, b) => b.date.localeCompare(a.date)),
    [entries, week],
  );

  const unbilled = useMemo<Unbilled[]>(() => {
    const map = new Map<string, Unbilled>();
    const row = (key: string, name: string) => {
      const r = map.get(key) ?? { key, name, minutes: 0, time: 0, expenses: 0, expenseCount: 0, km: 0, mileage: 0 };
      map.set(key, r);
      return r;
    };
    for (const e of unbilledTime(entries, live)) {
      const r = row(clientKey(e), e.client_name);
      r.minutes += e.minutes;
      r.time = round2(r.time + entryAmount(e, prefs));
    }
    for (const t of unbilledMileage(trips, live)) {
      const r = row(clientKey(t), t.client_name);
      r.km = round2(r.km + t.km);
      r.mileage = round2(r.mileage + mileageAmount(t));
    }
    for (const p of unbilledExpenses(purchases, live)) {
      const key = p.billable_to_client_id!;
      const r = row(key, map.get(key)?.name || localDb.clients.getById(key)?.name || timeT('client'));
      r.expenseCount += 1;
      r.expenses = round2(r.expenses + expenseLine(p, prefs).amount);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [entries, trips, purchases, live, prefs]);

  const stats = useMemo(() => {
    const amount = unbilled.reduce((s, u) => s + u.time + u.expenses + u.mileage, 0);
    const month = todayInput().slice(0, 7);
    return {
      week: grid.total,
      unbilledMinutes: unbilled.reduce((s, u) => s + u.minutes, 0),
      amount: round2(amount),
      km: mileageTotals(trips.filter((t) => t.date.startsWith(month))).km,
    };
  }, [grid, unbilled, trips]);

  const status = (ref: string | undefined, billable = true) => {
    if (!billable) return <span className={surface.badge}>{timeT('nonBillable')}</span>;
    if (isBilled(ref, live)) {
      return <Link to={`/invoice/${ref}`} className={cn(surface.badge, surface.badgePaid)}>{timeT('billed', { number: numbers.get(ref!) ?? '' })}</Link>;
    }
    return <span className={cn(surface.badge, surface.badgeDraft)}>{timeT('unbilled')}</span>;
  };

  const exportFile = async (what: 'time' | 'mileage', format: 'csv' | 'xlsx') => {
    const rows = what === 'time' ? timeEntriesToRows(entries, prefs, live, numbers) : mileageToRows(trips, live);
    const base = `${what === 'time' ? 'timesheet' : 'mileage'}-${todayInput()}`;
    if (format === 'csv') return downloadText(`${base}.csv`, '﻿' + toCsv(rows), 'text/csv');
    const { downloadXlsx } = await import('../lib/xlsx');
    await downloadXlsx(`${base}.xlsx`, [{ name: what === 'time' ? 'Timesheet' : 'Mileage', rows }]);
  };

  const exportButtons = (what: 'time' | 'mileage') => (
    <>
      <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => void exportFile(what, 'csv')}><Download size={14} /> CSV</button>
      <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => void exportFile(what, 'xlsx')}><FileSpreadsheet size={14} /> Excel</button>
    </>
  );

  const doDelete = () => {
    if (!confirm) return;
    if (confirm.kind === 'entry') timeDb.remove(confirm.id);
    else mileageDb.remove(confirm.id);
    setConfirm(null);
    saved(confirm.kind === 'entry' ? timeT('entryDeleted') : timeT('tripDeleted'));
  };

  const updatePrefs = (patch: Partial<TimePrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveTimePrefs(next);
  };

  return (
    <div className={surface.page}>
      <PageHeader
        title={timeT('title')}
        subtitle={timeT('subtitle')}
        actions={
          <>
            <button type="button" className={controls.btnOutline} onClick={() => setEditTrip(null)}><Car size={16} /> {timeT('logTrip')}</button>
            <button type="button" className={controls.btnPrimary} onClick={() => setEditEntry(null)}><Plus size={16} /> {timeT('addTime')}</button>
          </>
        }
      />

      {!clients.length && (
        <p className={surface.sectionNote}>{areaNodes(timeT('needClient'), { link: <Link to="/clients?new=1">{timeT('addClient')}</Link> })}</p>
      )}

      <TimerCard clients={clients} prefs={prefs} onLogged={saved} />

      <div className={surface.statGrid}>
        <StatCard label={timeT('thisWeek')} value={formatMinutes(stats.week)} icon={Clock} />
        <StatCard label={timeT('unbilledTime')} value={formatMinutes(stats.unbilledMinutes)} icon={Timer} />
        <StatCard label={timeT('readyToBill')} value={formatCurrency(stats.amount)} hint={timeT('readyHint')} icon={IndianRupee} />
        <StatCard label={timeT('kmMonth')} value={String(stats.km)} icon={Car} />
      </div>

      <div className={controls.segment} role="tablist" aria-label={timeT('sections')}>
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
            className={tab === t.id ? controls.segmentBtnActive : controls.segmentBtn}
            onClick={() => setParams(t.id === 'timesheet' ? {} : { tab: t.id }, { replace: true })}>
            {t.label()}
          </button>
        ))}
      </div>

      {tab === 'timesheet' && (
        <section className={surface.card}>
          <div className={styles.toolbar}>
            <div className={styles.weekNav}>
              <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setWeek(shiftDay(week, -7))} aria-label={timeT('prevWeek')}><ChevronLeft size={16} /></button>
              <strong>{formatDate(week)} – {formatDate(shiftDay(week, 6))}</strong>
              <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setWeek(shiftDay(week, 7))} aria-label={timeT('nextWeek')}><ChevronRight size={16} /></button>
              <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => setWeek(weekStart(todayInput()))}>{timeT('thisWeek')}</button>
            </div>
            <div className={styles.toolbarActions}>{exportButtons('time')}</div>
          </div>
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>{timeT('hoursCaption')}</caption>
              <thead>
                <tr>
                  <th>{timeT('clientProject')}</th>
                  {grid.days.map((d, i) => <th key={d} className={surface.numeric}>{dayName(d, i, lang)} {d.slice(8)}</th>)}
                  <th className={surface.numeric}>{timeT('total')}</th>
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((r) => (
                  <tr key={r.key}>
                    <td>{r.client_name}{r.project && <span className={styles.muted}> · {r.project}</span>}</td>
                    {r.minutes.map((m, i) => <td key={i} className={surface.numeric}>{hrs(m)}</td>)}
                    <td className={surface.numeric}><strong>{hrs(r.total)}</strong></td>
                  </tr>
                ))}
                {!grid.rows.length && (
                  <tr><td colSpan={9} className={styles.muted}>{timeT('noTime')}</td></tr>
                )}
              </tbody>
              {grid.rows.length > 0 && (
                <tfoot>
                  <tr>
                    <th>{timeT('totalHours')}</th>
                    {grid.dayTotals.map((m, i) => <th key={i} className={surface.numeric}>{hrs(m)}</th>)}
                    <th className={surface.numeric}>{hrs(grid.total)}</th>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>

          {weekEntries.length > 0 && (
            <div className={surface.tableWrap}>
              <table className={surface.table}>
                <thead>
                  <tr><th>{timeT('date')}</th><th>{timeT('client')}</th><th>{timeT('work')}</th><th className={surface.numeric}>{timeT('time')}</th><th className={surface.numeric}>{timeT('amount')}</th><th>{timeT('status')}</th><th><span className={surface.srOnly}>{timeT('actions')}</span></th></tr>
                </thead>
                <tbody>
                  {weekEntries.map((e) => (
                    <tr key={e.id}>
                      <td>{formatDate(e.date)}</td>
                      <td>{e.client_name}</td>
                      <td>{[e.project, e.description].filter(Boolean).join(' — ') || '–'}</td>
                      <td className={surface.numeric}>{formatMinutes(e.minutes)}</td>
                      <td className={surface.numeric}>{formatCurrency(entryAmount(e, prefs))}</td>
                      <td>{status(e.invoiced_in, e.billable)}</td>
                      <td className={surface.rowActions}>
                        <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setEditEntry(e)} aria-label={timeT('editEntry')}><Pencil size={14} /></button>
                        <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setConfirm({ kind: 'entry', id: e.id })} aria-label={timeT('deleteEntry')}><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {tab === 'mileage' && (
        <section className={surface.card}>
          <div className={styles.toolbar}>
            <strong>{trips.length === 1 ? timeT('tripsOne') : timeT('tripsMany', { n: trips.length })} · {mileageTotals(trips).km} km · {formatCurrency(mileageTotals(trips).amount)}</strong>
            <div className={styles.toolbarActions}>{exportButtons('mileage')}</div>
          </div>
          {trips.length ? (
            <div className={surface.tableWrap}>
              <table className={surface.table}>
                <thead>
                  <tr><th>{timeT('date')}</th><th>{timeT('client')}</th><th>{timeT('route')}</th><th>{timeT('purpose')}</th><th className={surface.numeric}>{timeT('km')}</th><th className={surface.numeric}>{timeT('amount')}</th><th>{timeT('status')}</th><th><span className={surface.srOnly}>{timeT('actions')}</span></th></tr>
                </thead>
                <tbody>
                  {[...trips].sort((a, b) => b.date.localeCompare(a.date)).map((t) => (
                    <tr key={t.id}>
                      <td>{formatDate(t.date)}</td>
                      <td>{t.client_name}</td>
                      <td>{[t.from, t.to].filter(Boolean).join(' → ') || '–'}</td>
                      <td>{t.purpose || '–'}</td>
                      <td className={surface.numeric}>{t.km}</td>
                      <td className={surface.numeric}>{formatCurrency(mileageAmount(t))}</td>
                      <td>{status(t.invoiced_in)}</td>
                      <td className={surface.rowActions}>
                        <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setEditTrip(t)} aria-label={timeT('editTrip')}><Pencil size={14} /></button>
                        <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setConfirm({ kind: 'trip', id: t.id })} aria-label={timeT('deleteTrip')}><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={Car} title={timeT('noTrips')} text={timeT('noTripsText')} />
          )}
        </section>
      )}

      {tab === 'billing' && (
        <section className={surface.card}>
          {unbilled.length ? (
            <div className={surface.tableWrap}>
              <table className={surface.table}>
                <thead>
                  <tr><th>{timeT('client')}</th><th className={surface.numeric}>{timeT('time')}</th><th className={surface.numeric}>{timeT('expenses')}</th><th className={surface.numeric}>{timeT('mileage')}</th><th className={surface.numeric}>{timeT('total')}</th><th><span className={surface.srOnly}>{timeT('bill')}</span></th></tr>
                </thead>
                <tbody>
                  {unbilled.map((u) => (
                    <tr key={u.key}>
                      <td>{u.name}</td>
                      <td className={surface.numeric}>{u.minutes ? `${formatMinutes(u.minutes)} · ${formatCurrency(u.time)}` : '–'}</td>
                      <td className={surface.numeric}>{u.expenseCount ? `${u.expenseCount} · ${formatCurrency(u.expenses)}` : '–'}</td>
                      <td className={surface.numeric}>{u.km ? `${u.km} km · ${formatCurrency(u.mileage)}` : '–'}</td>
                      <td className={surface.numeric}><strong>{formatCurrency(round2(u.time + u.expenses + u.mileage))}</strong></td>
                      <td className={surface.rowActions}>
                        <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={() => setBillTarget({ key: u.key, name: u.name })}>
                          <ReceiptText size={14} /> {timeT('bill')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={ReceiptText} title={timeT('nothing')} text={timeT('nothingText')} />
          )}
        </section>
      )}

      {tab === 'settings' && (
        <section className={cn(surface.card, styles.prefs)}>
          <div className={controls.row}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="tp-round">{timeT('roundTo')}</label>
              <select id="tp-round" className={controls.select} value={prefs.round_increment}
                onChange={(e) => updatePrefs({ round_increment: Number(e.target.value), round_mode: Number(e.target.value) ? (prefs.round_mode === 'none' ? 'nearest' : prefs.round_mode) : 'none' })}>
                {[0, 6, 10, 15, 30].map((n) => <option key={n} value={n}>{n ? timeT('nMinutes', { n }) : timeT('exact')}</option>)}
              </select>
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="tp-mode">{timeT('rounding')}</label>
              <select id="tp-mode" className={controls.select} value={prefs.round_mode} disabled={!prefs.round_increment}
                onChange={(e) => updatePrefs({ round_mode: e.target.value as TimePrefs['round_mode'] })}>
                <option value="nearest">{timeT('nearest')}</option>
                <option value="up">{timeT('up')}</option>
                <option value="none">{timeT('none')}</option>
              </select>
            </div>
          </div>
          <div className={controls.row}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="tp-rate">{timeT('defaultRate')}</label>
              <input id="tp-rate" type="number" min={0} step="0.01" className={controls.input} value={prefs.default_rate || ''} onChange={(e) => updatePrefs({ default_rate: Math.max(Number(e.target.value) || 0, 0) })} />
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="tp-km">{timeT('kmRate')}</label>
              <input id="tp-km" type="number" min={0} step="0.01" className={controls.input} value={prefs.mileage_rate || ''} onChange={(e) => updatePrefs({ mileage_rate: Math.max(Number(e.target.value) || 0, 0) })} />
            </div>
          </div>
          <div className={controls.row}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="tp-sac">{timeT('sac')}</label>
              <input id="tp-sac" className={controls.input} inputMode="numeric" value={prefs.sac} onChange={(e) => updatePrefs({ sac: e.target.value.replace(/\D/g, '').slice(0, 8) })} />
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="tp-gst">{timeT('gstRate')}</label>
              <input id="tp-gst" type="number" min={0} max={28} step="0.01" className={controls.input} value={prefs.gst_rate} onChange={(e) => updatePrefs({ gst_rate: Math.max(Number(e.target.value) || 0, 0) })} />
            </div>
          </div>
          <p className={styles.muted}>
            {timeT('prefsNote')}
          </p>
        </section>
      )}

      <EntryModal open={editEntry !== undefined} entry={editEntry} clients={clients} prefs={prefs} onClose={() => setEditEntry(undefined)} onSaved={saved} />
      <MileageModal open={editTrip !== undefined} trip={editTrip} clients={clients} prefs={prefs} onClose={() => setEditTrip(undefined)} onSaved={saved} />
      <BillClientModal
        target={billTarget}
        prefs={prefs}
        onClose={() => setBillTarget(null)}
        onCreated={(id, number) => {
          setBillTarget(null);
          notify(timeT('draftCreated', { number }));
          navigate(`/invoice/${id}`);
        }}
      />
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.kind === 'trip' ? timeT('delTripTitle') : timeT('delEntryTitle')}
        message={timeT('delMsg')}
        confirmLabel={timeT('delete')}
        destructive
        onConfirm={doDelete}
        onClose={() => setConfirm(null)}
      />
      {toastNode}
    </div>
  );
}

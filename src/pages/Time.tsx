import { Suspense, createElement, lazy, useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Car, ChevronLeft, ChevronRight, Clock, Download, FileSpreadsheet, IndianRupee, Pencil, Plus, ReceiptText, Timer, Trash2 } from 'lucide-react';
import type { MileageEntry, TimeEntry, TimePrefs } from '../types/time';
import {
  clientKey,
  entryAmount,
  expenseLine,
  formatMinutes,
  billedBy,
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
  currentCover,
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
import { can } from '../lib/access';
import { TimerCard } from '../components/time/TimerCard';
import { EntryModal, MileageModal } from '../components/time/TimeForms';
import { BillClientModal } from '../components/time/BillClientModal';
import surface from '../styles/surface.module.css';
import controls from '../styles/controls.module.css';
import styles from '../components/time/time.module.css';
import { dateLocale, useT } from '../i18n';
import { timeT } from '../i18n/areas/time';
import { areaNodes } from '../i18n/areas/nodes';
import { svcT } from '../i18n/areas/service-r3'; // R3-B
import { WorkTypesCard } from '../components/time/WorkTypesCard';
import { visiblePackTabs, type PackId } from '../lib/industry-packs'; // R5-B; R10: tabs shared by packs (`alsoPacks`)
import { defineArea } from '../i18n/area';
import { TIME_TABS, type TimeTab } from './page-tabs'; // R6-B1

// R3-B2 / B3: the projects board and retainers are their own lazy tab chunks.
const ProjectsBoard = lazy(() => import('../components/time/ProjectsBoard'));
const RetainersTab = lazy(() => import('../components/time/RetainersTab'));
// R5-B: works-contract pack (BOQ, RA bills, retention, sites, GST TDS credit) — listed only with the pack on.
const WorksTab = lazy(() => import('../components/works/WorksTab'));
const wkT = defineArea({ tab: 'Works' } as const, { tab: 'वर्क्स' });
// R10: service desks — each a lazy chunk; a package that has not merged yet shows `R10Stub` (one line, replaced by it).
const FrontDesk = lazy(() => import('../components/services-r10/FrontDesk')); // SV-A2 / A3 (appointments, commission)
const WorkshopDesk = lazy(() => import('../components/services-r10/WorkshopDesk')); // SV-D (mounts SV-A5's claims view)
const ClinicDesk = lazy(() => import('../components/services-r10/ClinicDesk')); // SV-B clinic desk
const MembersDesk = lazy(() => import('../components/services-r10/MembersDesk')); // SV-C members, packages, check-in, classes, recipes
const r10T = defineArea(
  { appointments: 'Appointments', commission: 'Staff & commission', clinic: 'Clinic', members: 'Members', workshop: 'Workshop' } as const,
  { appointments: 'अपॉइंटमेंट', commission: 'स्टाफ और कमीशन', clinic: 'क्लिनिक', members: 'सदस्य', workshop: 'वर्कशॉप' },
);

// R14: the six professional desks (PS-A matters / wip, PS-B clientmoney, PS-C exportsvc, PS-D firm / cadesk), one lazy chunk
// each. A desk whose package has not merged has no file and no TIME_TABS row, so it is never mounted (no stubs).
const PS_DESK_FILES = import.meta.glob<{ default: ComponentType<{ view?: string; notify: (m: string, tone?: 'success' | 'error' | 'info') => void }> }>('../components/prof/*Desk.tsx');
const PS_DESK_OF: Record<string, string> = { matters: 'MattersDesk', wip: 'WipDesk', clientmoney: 'ClientMoneyDesk', exportsvc: 'ExportSvcDesk', firm: 'FirmDesk', cadesk: 'CaDesk' };
const PS_DESKS = new Map(Object.entries(PS_DESK_OF).flatMap(([tab, file]) => {
  const load = PS_DESK_FILES[`../components/prof/${file}.tsx`];
  return load ? [[tab, lazy(load)] as const] : [];
}));
const r14T = defineArea({ matters: 'Matters', wip: 'WIP & billing', firm: 'Firm', cadesk: 'CA desk', exportsvc: 'Exports of services' } as const, { matters: 'मामले', wip: 'अबिल्ड कार्य और बिलिंग', firm: 'फ़र्म', cadesk: 'CA डेस्क', exportsvc: 'सेवाओं का निर्यात' });

type Tab = TimeTab;
// R6-B1: the ids (and packs) live in time-tabs.ts; the labels stay here.
const TAB_LABEL: Record<Tab, () => string> = {
  timesheet: () => timeT('tabTimesheet'),
  mileage: () => timeT('tabMileage'),
  billing: () => timeT('tabUnbilled'),
  projects: () => svcT('tabProjects'),
  retainers: () => svcT('tabRetainers'),
  settings: () => timeT('tabSettings'),
  works: () => wkT('tab'), // R5-B
  appointments: () => r10T('appointments'), commission: () => r10T('commission'), clinic: () => r10T('clinic'), members: () => r10T('members'), workshop: () => r10T('workshop'), // R10
  matters: () => r14T('matters'), wip: () => r14T('wip'), // R14 (PS-A); B / C / D add their labels
  firm: () => r14T('firm'), cadesk: () => r14T('cadesk'), // R14 (PS-D)
  exportsvc: () => r14T('exportsvc'), // R14 (PS-C)
};
const TABS: { id: Tab; label: () => string; pack?: PackId; alsoPacks?: readonly PackId[] }[] = TIME_TABS.map((t) => ({ ...t, label: TAB_LABEL[t.id] }));
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
  const [billTarget, setBillTarget] = useState<{ key: string; name: string; projectId?: string } | null>(null);

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
  // R3-B3: minutes covered by a retainer are not unbilled.
  const cover = useMemo(() => currentCover(prefs, entries, invoices), [prefs, entries, invoices]);

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
    for (const e of unbilledTime(entries, live, cover, prefs)) {
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
  }, [entries, trips, purchases, live, prefs, cover]);

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

  const status = (row: { id: string; invoiced_in?: string }, billable = true) => {
    if (!billable) return <span className={surface.badge}>{timeT('nonBillable')}</span>;
    const by = billedBy(row.invoiced_in, live, row.id);
    if (by) {
      return <Link to={`/invoice/${by}`} className={cn(surface.badge, surface.badgePaid)}>{timeT('billed', { number: numbers.get(by) ?? '' })}</Link>;
    }
    if (cover?.covered.has(row.id)) return <span className={cn(surface.badge, surface.badgeSent)}>{svcT('coveredBadge')}</span>;
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

  // Time preferences change every bill's rates / SAC / GST: same role gate as the time books (6.21).
  const canPrefs = can('books.edit');
  const updatePrefs = (patch: Partial<TimePrefs>) => {
    const next = { ...prefs, ...patch };
    try {
      saveTimePrefs(next);
      setPrefs(next);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
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
        {visiblePackTabs(TABS, localDb.settings.get(), tab).map((t) => (
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
                      <td>{status(e, e.billable)}</td>
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
                      <td>{status(t)}</td>
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

      {tab === 'projects' && (
        <Suspense fallback={null}>
          <ProjectsBoard
            clients={clients}
            prefs={prefs}
            entries={entries}
            invoices={invoices}
            projectId={params.get('project') ?? undefined}
            onSelect={(id) => setParams(id ? { tab: 'projects', project: id } : { tab: 'projects' }, { replace: true })}
            onBill={(target) => setBillTarget(target)}
            notify={notify}
            onChanged={reload}
          />
        </Suspense>
      )}

      {tab === 'retainers' && (
        <Suspense fallback={null}>
          <RetainersTab clients={clients} prefs={prefs} entries={entries} invoices={invoices} notify={notify} onChanged={reload} />
        </Suspense>
      )}

      {tab === 'settings' && <WorkTypesCard notify={notify} />}
      {tab === 'works' && <Suspense fallback={null}><WorksTab notify={notify} /></Suspense>}
      {/* R10: service desks (lazy) */}
      {(tab === 'appointments' || tab === 'commission') && <Suspense fallback={null}><FrontDesk tab={tab} view={params.get('view') ?? undefined} notify={notify} /></Suspense>}
      {tab === 'workshop' && <Suspense fallback={null}><WorkshopDesk view={params.get('view') ?? undefined} notify={notify} /></Suspense>}
      {tab === 'clinic' && <Suspense fallback={null}><ClinicDesk view={params.get('view') ?? undefined} notify={notify} /></Suspense>}
      {tab === 'members' && <Suspense fallback={null}><MembersDesk notify={notify} /></Suspense>}
      {PS_DESKS.has(tab) && <Suspense fallback={null}><PsDesk tab={tab} view={params.get('view') ?? undefined} notify={notify} /></Suspense>}

      {tab === 'settings' && (
        <section className={cn(surface.card, styles.prefs)}>
          <fieldset disabled={!canPrefs} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
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
          </fieldset>
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

/** R14: mounts the professional desk of `tab` (lazy). */
function PsDesk({ tab, view, notify }: { tab: string; view?: string; notify: (m: string, tone?: 'success' | 'error' | 'info') => void }) {
  const Desk = PS_DESKS.get(tab);
  return Desk ? createElement(Desk, { view, notify }) : null;
}

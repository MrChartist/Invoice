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

type Tab = 'timesheet' | 'mileage' | 'billing' | 'settings';
const TABS: { id: Tab; label: string }[] = [
  { id: 'timesheet', label: 'Timesheet' },
  { id: 'mileage', label: 'Mileage' },
  { id: 'billing', label: 'Unbilled' },
  { id: 'settings', label: 'Settings' },
];
const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
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
      const r = row(key, map.get(key)?.name || localDb.clients.getById(key)?.name || 'Client');
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
    if (!billable) return <span className={surface.badge}>Non-billable</span>;
    if (isBilled(ref, live)) {
      return <Link to={`/invoice/${ref}`} className={cn(surface.badge, surface.badgePaid)}>Billed · {numbers.get(ref!)}</Link>;
    }
    return <span className={cn(surface.badge, surface.badgeDraft)}>Unbilled</span>;
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
    saved(confirm.kind === 'entry' ? 'Time entry deleted' : 'Trip deleted');
  };

  const updatePrefs = (patch: Partial<TimePrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    saveTimePrefs(next);
  };

  return (
    <div className={surface.page}>
      <PageHeader
        title="Time & billable costs"
        subtitle="Track hours, trips and re-billable expenses, then bill them on a new invoice."
        actions={
          <>
            <button type="button" className={controls.btnOutline} onClick={() => setEditTrip(null)}><Car size={16} /> Log trip</button>
            <button type="button" className={controls.btnPrimary} onClick={() => setEditEntry(null)}><Plus size={16} /> Add time</button>
          </>
        }
      />

      {!clients.length && (
        <p className={surface.sectionNote}>Time and trips are billed to clients. <Link to="/clients?new=1">Add a client</Link> first.</p>
      )}

      <TimerCard clients={clients} prefs={prefs} onLogged={saved} />

      <div className={surface.statGrid}>
        <StatCard label="This week" value={formatMinutes(stats.week)} icon={Clock} />
        <StatCard label="Unbilled time" value={formatMinutes(stats.unbilledMinutes)} icon={Timer} />
        <StatCard label="Ready to bill" value={formatCurrency(stats.amount)} hint="time + costs + mileage, before GST" icon={IndianRupee} />
        <StatCard label="Km this month" value={String(stats.km)} icon={Car} />
      </div>

      <div className={controls.segment} role="tablist" aria-label="Time sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id}
            className={tab === t.id ? controls.segmentBtnActive : controls.segmentBtn}
            onClick={() => setParams(t.id === 'timesheet' ? {} : { tab: t.id }, { replace: true })}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'timesheet' && (
        <section className={surface.card}>
          <div className={styles.toolbar}>
            <div className={styles.weekNav}>
              <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setWeek(shiftDay(week, -7))} aria-label="Previous week"><ChevronLeft size={16} /></button>
              <strong>{formatDate(week)} – {formatDate(shiftDay(week, 6))}</strong>
              <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setWeek(shiftDay(week, 7))} aria-label="Next week"><ChevronRight size={16} /></button>
              <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => setWeek(weekStart(todayInput()))}>This week</button>
            </div>
            <div className={styles.toolbarActions}>{exportButtons('time')}</div>
          </div>
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>Hours per day for the week</caption>
              <thead>
                <tr>
                  <th>Client · project</th>
                  {grid.days.map((d, i) => <th key={d} className={surface.numeric}>{DAY_NAMES[i]} {d.slice(8)}</th>)}
                  <th className={surface.numeric}>Total</th>
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
                  <tr><td colSpan={9} className={styles.muted}>No time logged this week.</td></tr>
                )}
              </tbody>
              {grid.rows.length > 0 && (
                <tfoot>
                  <tr>
                    <th>Total (hours)</th>
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
                  <tr><th>Date</th><th>Client</th><th>Work</th><th className={surface.numeric}>Time</th><th className={surface.numeric}>Amount</th><th>Status</th><th><span className={surface.srOnly}>Actions</span></th></tr>
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
                        <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setEditEntry(e)} aria-label="Edit entry"><Pencil size={14} /></button>
                        <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setConfirm({ kind: 'entry', id: e.id })} aria-label="Delete entry"><Trash2 size={14} /></button>
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
            <strong>{trips.length} {trips.length === 1 ? 'trip' : 'trips'} · {mileageTotals(trips).km} km · {formatCurrency(mileageTotals(trips).amount)}</strong>
            <div className={styles.toolbarActions}>{exportButtons('mileage')}</div>
          </div>
          {trips.length ? (
            <div className={surface.tableWrap}>
              <table className={surface.table}>
                <thead>
                  <tr><th>Date</th><th>Client</th><th>Route</th><th>Purpose</th><th className={surface.numeric}>Km</th><th className={surface.numeric}>Amount</th><th>Status</th><th><span className={surface.srOnly}>Actions</span></th></tr>
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
                        <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setEditTrip(t)} aria-label="Edit trip"><Pencil size={14} /></button>
                        <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setConfirm({ kind: 'trip', id: t.id })} aria-label="Delete trip"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={Car} title="No trips yet" text="Log client trips to bill mileage at your per-km rate." />
          )}
        </section>
      )}

      {tab === 'billing' && (
        <section className={surface.card}>
          {unbilled.length ? (
            <div className={surface.tableWrap}>
              <table className={surface.table}>
                <thead>
                  <tr><th>Client</th><th className={surface.numeric}>Time</th><th className={surface.numeric}>Expenses</th><th className={surface.numeric}>Mileage</th><th className={surface.numeric}>Total</th><th><span className={surface.srOnly}>Bill</span></th></tr>
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
                          <ReceiptText size={14} /> Bill
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState icon={ReceiptText} title="Nothing unbilled" text="Billable time, trips and expenses marked for a client (Expenses → Bill this cost to a client) show up here." />
          )}
        </section>
      )}

      {tab === 'settings' && (
        <section className={cn(surface.card, styles.prefs)}>
          <div className={controls.row}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="tp-round">Round each entry to</label>
              <select id="tp-round" className={controls.select} value={prefs.round_increment}
                onChange={(e) => updatePrefs({ round_increment: Number(e.target.value), round_mode: Number(e.target.value) ? (prefs.round_mode === 'none' ? 'nearest' : prefs.round_mode) : 'none' })}>
                {[0, 6, 10, 15, 30].map((n) => <option key={n} value={n}>{n ? `${n} minutes` : 'Exact minutes'}</option>)}
              </select>
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="tp-mode">Rounding</label>
              <select id="tp-mode" className={controls.select} value={prefs.round_mode} disabled={!prefs.round_increment}
                onChange={(e) => updatePrefs({ round_mode: e.target.value as TimePrefs['round_mode'] })}>
                <option value="nearest">Nearest</option>
                <option value="up">Always up</option>
                <option value="none">None</option>
              </select>
            </div>
          </div>
          <div className={controls.row}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="tp-rate">Default hourly rate (₹)</label>
              <input id="tp-rate" type="number" min={0} step="0.01" className={controls.input} value={prefs.default_rate || ''} onChange={(e) => updatePrefs({ default_rate: Math.max(Number(e.target.value) || 0, 0) })} />
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="tp-km">Mileage rate per km (₹)</label>
              <input id="tp-km" type="number" min={0} step="0.01" className={controls.input} value={prefs.mileage_rate || ''} onChange={(e) => updatePrefs({ mileage_rate: Math.max(Number(e.target.value) || 0, 0) })} />
            </div>
          </div>
          <div className={controls.row}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="tp-sac">SAC on billed lines</label>
              <input id="tp-sac" className={controls.input} inputMode="numeric" value={prefs.sac} onChange={(e) => updatePrefs({ sac: e.target.value.replace(/\D/g, '').slice(0, 8) })} />
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="tp-gst">GST rate on billed lines (%)</label>
              <input id="tp-gst" type="number" min={0} max={28} step="0.01" className={controls.input} value={prefs.gst_rate} onChange={(e) => updatePrefs({ gst_rate: Math.max(Number(e.target.value) || 0, 0) })} />
            </div>
          </div>
          <p className={styles.muted}>
            998311 is management consulting; use the SAC of the service you actually supply. Rounding applies per entry when
            billing; logged minutes stay exact. Verify the GST treatment with your CA.
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
          notify(`Draft ${number} created`);
          navigate(`/invoice/${id}`);
        }}
      />
      <ConfirmDialog
        open={!!confirm}
        title={confirm?.kind === 'trip' ? 'Delete this trip?' : 'Delete this time entry?'}
        message="It is removed from this device. An invoice it was already billed on is not changed."
        confirmLabel="Delete"
        destructive
        onConfirm={doDelete}
        onClose={() => setConfirm(null)}
      />
      {toastNode}
    </div>
  );
}

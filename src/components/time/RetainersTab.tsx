import { useMemo, useState } from 'react';
import { CalendarClock, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Client, InvoiceRecord } from '../../types/invoice';
import type { TimeEntry, TimePrefs } from '../../types/time';
import {
  commitClose, deleteRetainer, drawdown, loadRetainers, periodLabel, periodsToClose, retainerReport, saveRetainer,
  type Retainer, type RetainerPeriodKind,
} from '../../lib/retainers';
import { billableMinutes, clientKey, entryAmount, liveInvoiceIds, isBilled } from '../../lib/timesheets';
import { loadCostCentres } from '../../lib/cost-centres';
import { getTable } from '../../lib/storage';
import { localDb } from '../../lib/localDb';
import { can } from '../../lib/access';
import { round2 } from '../../lib/invoice-calc';
import { isPeriodLockedError } from '../../lib/period-lock';
import { cn, formatCurrency, todayInput } from '../../lib/utils';
import { EmptyState } from '../ui/EmptyState';
import { Modal } from '../ui/Modal';
import { RetainerReport } from './RetainerReport';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './service-r3.module.css';
import { useT } from '../../i18n';
import { svcT } from '../../i18n/areas/service-r3';
import { SelectField } from '../ui/SelectField';
import { DateField } from '../ui/DateField';

type Notify = (message: string, tone?: 'success' | 'error') => void;

interface Props {
  clients: Client[];
  prefs: TimePrefs;
  entries: TimeEntry[];
  invoices: InvoiceRecord[];
  notify: Notify;
  onChanged: () => void;
}

interface Draft {
  id?: string;
  client_key: string;
  hours: string;
  period: RetainerPeriodKind;
  fee: string;
  start: string;
  cap: string;
  overage: string;
  recurring_id: string;
  cost_centre_ids: string[];
}

const h = (m: number) => round2(m / 60);

const draftOf = (r?: Retainer): Draft => ({
  id: r?.id,
  client_key: r?.client_key ?? '',
  hours: r ? String(r.hours_per_period) : '',
  period: r?.period ?? 'month',
  fee: r ? String(r.fee) : '',
  start: r?.start ?? todayInput().slice(0, 8) + '01',
  cap: r ? String(r.rollover_cap) : '0',
  overage: r?.overage_rate ? String(r.overage_rate) : '',
  recurring_id: r?.recurring_id ?? '',
  cost_centre_ids: r?.cost_centre_ids ?? [],
});

/** R3-B3: prepaid retainer hours, drawdown per period, close with rollover / forfeiture, report. */
export default function RetainersTab({ clients, prefs, entries, invoices, notify, onChanged }: Props) {
  useT();
  const editable = can('books.edit');
  const [version, setVersion] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const retainers = useMemo(() => loadRetainers(), [version]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [report, setReport] = useState(false);
  const recurring = useMemo(() => getTable<{ id: string; name?: string }>('recurring'), []);
  const projects = useMemo(() => loadCostCentres().filter((c) => c.kind === 'project' && c.active), []);
  const live = useMemo(() => liveInvoiceIds(invoices), [invoices]);
  const numbers = useMemo(() => new Map(invoices.map((i) => [i.id, i.invoice_number])), [invoices]);
  const today = todayInput();
  const billable = (e: TimeEntry) => billableMinutes(e, prefs);
  const selected = retainers.find((r) => r.id === selectedId) ?? retainers.find((r) => !r.inactive) ?? retainers[0];
  const periods = useMemo(() => (selected ? drawdown(selected, entries, (e) => billableMinutes(e, prefs), invoices, today) : []), [selected, entries, prefs, invoices, today]);
  const due = periodsToClose(periods);

  const refresh = () => {
    setVersion((v) => v + 1);
    onChanged();
  };
  const run = (fn: () => string | void) => {
    try {
      const msg = fn();
      if (msg) notify(msg);
      refresh();
    } catch (err) {
      notify(isPeriodLockedError(err) ? err.message : (err as Error).message, 'error');
    }
  };

  const save = () => {
    if (!draft) return;
    run(() => {
      const client = clients.find((c) => c.id === draft.client_key);
      const prev = draft.id ? retainers.find((r) => r.id === draft.id) : undefined;
      const row = saveRetainer({
        ...(prev ?? {}),
        id: draft.id,
        client_key: draft.client_key,
        client_name: client?.name ?? prev?.client_name,
        hours_per_period: Number(draft.hours) || 0,
        period: draft.period,
        fee: Number(draft.fee) || 0,
        start: draft.start,
        rollover_cap: Number(draft.cap) || 0,
        overage_rate: Number(draft.overage) > 0 ? Number(draft.overage) : undefined,
        recurring_id: draft.recurring_id || undefined,
        cost_centre_ids: draft.cost_centre_ids.length ? draft.cost_centre_ids : undefined,
      });
      setSelectedId(row.id);
      setDraft(null);
      return svcT('retainerSaved');
    });
  };

  const close = (period: string) => {
    if (!selected) return;
    run(() => {
      const row = commitClose(selected.id, period, billable, invoices, today);
      return svcT('closedMsg', { period: periodLabel(period, selected.period), used: h(row.used), rolled: h(row.rolled), forfeited: h(row.forfeited) });
    });
  };

  const linkFee = (period: string, invoiceId: string) => {
    if (!selected || !invoiceId) return;
    run(() => { saveRetainer({ ...selected, fee_invoices: { ...(selected.fee_invoices ?? {}), [period]: invoiceId } }); });
  };

  const clientInvoices = selected
    ? invoices.filter((i) => i.status !== 'Draft' && i.status !== 'Cancelled' && clientKey({ client_id: i.client?.id, client_name: i.client?.name }) === selected.client_key)
    : [];

  const reportRows = selected
    ? retainerReport(periods, numbers, (id, m) => {
      const e = entries.find((x) => x.id === id);
      return e ? round2(entryAmount({ ...e, minutes: m, hourly_rate: selected.overage_rate || e.hourly_rate }, { ...prefs, round_increment: 0, round_mode: 'none' })) : 0;
    }, new Set(entries.filter((e) => isBilled(e.invoiced_in, live, e.id)).map((e) => e.id)))
    : [];
  const sender = localDb.settings.activeProfile();

  return (
    <section className={surface.card} data-retainers>
      <div className={styles.section}>
        <div className={styles.spread}>
          <strong>{svcT('retainers')}</strong>
          {editable && (
            <button type="button" className={controls.btnOutline} onClick={() => setDraft(draftOf())} disabled={!clients.length} data-new-retainer>
              <Plus size={16} /> {svcT('newRetainer')}
            </button>
          )}
        </div>
        <p className={styles.muted}>{svcT('retainersIntro')}</p>
        <p className={styles.note}>{svcT('gstHelp')}</p>
      </div>

      {!retainers.length ? (
        <EmptyState icon={CalendarClock} title={svcT('noRetainers')} text={svcT('noRetainersText')} />
      ) : (
        <div className={styles.section}>
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <thead><tr><th>{svcT('client')}</th><th className={surface.numeric}>{svcT('hoursPerPeriod')}</th><th>{svcT('period')}</th><th className={surface.numeric}>{svcT('fee')}</th><th><span className={surface.srOnly}>{svcT('edit')}</span></th></tr></thead>
              <tbody>
                {retainers.map((r) => (
                  <tr key={r.id} aria-selected={r.id === selected?.id} onClick={() => setSelectedId(r.id)} style={{ cursor: 'pointer' }}>
                    <td>{r.client_name ?? r.client_key}{r.inactive ? ` · ${svcT('wtInactive')}` : ''}</td>
                    <td className={surface.numeric}>{r.hours_per_period}</td>
                    <td>{r.period === 'month' ? svcT('month') : svcT('quarter')}</td>
                    <td className={surface.numeric}>{formatCurrency(r.fee)}</td>
                    <td className={surface.rowActions}>
                      {editable && (
                        <>
                          <button type="button" className={cn(controls.btnGhost, controls.btnSm)} aria-label={`${svcT('edit')} ${r.client_name ?? ''}`} onClick={(e) => { e.stopPropagation(); setDraft(draftOf(r)); }}><Pencil size={14} /></button>
                          <button type="button" className={cn(controls.btnGhost, controls.btnSm)} aria-label={`${svcT('delete')} ${r.client_name ?? ''}`}
                            onClick={(e) => { e.stopPropagation(); run(() => (deleteRetainer(r.id) === 'inactive' ? svcT('retainerInactive') : svcT('retainerDeleted'))); }}><Trash2 size={14} /></button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {selected && (
            <>
              {due.map((p) => (
                <div key={p.period} className={styles.banner} role="status">
                  <span>{svcT('closeDue', { period: p.label })}</span>
                  {editable && <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={() => close(p.period)} data-close-period>{svcT('closePeriod')}</button>}
                </div>
              ))}
              <div className={styles.spread}>
                <strong>{svcT('usage')} · {selected.client_name}</strong>
                <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => setReport(true)}><FileText size={14} /> {svcT('report')}</button>
              </div>
              <div className={surface.tableWrap}>
                <table className={surface.table} data-retainer-usage>
                  <thead>
                    <tr>
                      <th>{svcT('period')}</th><th className={surface.numeric}>{svcT('allowance')}</th><th className={surface.numeric}>{svcT('used')}</th>
                      <th className={surface.numeric}>{svcT('remaining')}</th><th className={surface.numeric}>{svcT('overage')}</th><th className={surface.numeric}>{svcT('rolledOut')}</th>
                      <th className={surface.numeric}>{svcT('forfeited')}</th><th>{svcT('feeInvoice')}</th><th>{svcT('status')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...periods].reverse().map((p) => (
                      <tr key={p.period}>
                        <td>{p.label}</td>
                        <td className={surface.numeric}>{h(p.allowance)}{p.rolled_in ? ` (+${h(p.rolled_in)})` : ''}</td>
                        <td className={surface.numeric}>{h(p.used)}</td>
                        <td className={surface.numeric}>{h(p.remaining)}</td>
                        <td className={surface.numeric}>{h(p.overage_minutes)}</td>
                        <td className={surface.numeric}>{h(p.rolled_out)}</td>
                        <td className={surface.numeric}>{h(p.forfeited)}</td>
                        <td>
                          {p.fee_invoice_id
                            ? <>{numbers.get(p.fee_invoice_id) ?? ''}{p.fee_state === 'cancelled' ? ` · ${svcT('feeCancelled')}` : ''}</>
                            : editable && clientInvoices.length && !p.closed
                              ? (
                                <SelectField className={controls.select} value="" onChange={(e) => linkFee(p.period, e.target.value)} aria-label={`${svcT('linkFee')} ${p.label}`}>
                                  <option value="">{svcT('feePending')} · {svcT('linkFee')}</option>
                                  {clientInvoices.map((i) => <option key={i.id} value={i.id}>{i.invoice_number} · {i.issue_date}</option>)}
                                </SelectField>
                              )
                              : svcT('feePending')}
                        </td>
                        <td>{p.closed ? svcT('closed') : p.ended ? svcT('endedOpen') : svcT('open')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      <Modal open={!!draft} onClose={() => setDraft(null)} size="lg" title={draft?.id ? svcT('edit') : svcT('newRetainer')}>
        {draft && (
          <form className={styles.section} onSubmit={(e) => { e.preventDefault(); save(); }}>
            <div className={styles.form}>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="rt-client">{svcT('client')}</label>
                <SelectField id="rt-client" className={controls.select} value={draft.client_key} onChange={(e) => setDraft({ ...draft, client_key: e.target.value })} disabled={!!draft.id}>
                  <option value="">{svcT('none')}</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </SelectField>
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="rt-hours">{svcT('hoursPerPeriod')}</label>
                <input id="rt-hours" type="number" min={0} step="0.25" className={controls.input} value={draft.hours} onChange={(e) => setDraft({ ...draft, hours: e.target.value })} />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="rt-period">{svcT('period')}</label>
                <SelectField id="rt-period" className={controls.select} value={draft.period} onChange={(e) => setDraft({ ...draft, period: e.target.value as RetainerPeriodKind })}>
                  <option value="month">{svcT('month')}</option>
                  <option value="quarter">{svcT('quarter')}</option>
                </SelectField>
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="rt-fee">{svcT('fee')}</label>
                <input id="rt-fee" type="number" min={0} step="1" className={controls.input} value={draft.fee} onChange={(e) => setDraft({ ...draft, fee: e.target.value })} />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="rt-start">{svcT('start')}</label>
                <DateField id="rt-start" className={controls.input} value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="rt-cap">{svcT('rolloverCap')}</label>
                <input id="rt-cap" type="number" min={0} step="0.25" className={controls.input} value={draft.cap} onChange={(e) => setDraft({ ...draft, cap: e.target.value })} />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="rt-over">{svcT('overageRate')}</label>
                <input id="rt-over" type="number" min={0} step="0.01" className={controls.input} value={draft.overage} onChange={(e) => setDraft({ ...draft, overage: e.target.value })} />
              </div>
              <div className={controls.field}>
                <label className={controls.label} htmlFor="rt-rec">{svcT('recurringTpl')}</label>
                <SelectField id="rt-rec" className={controls.select} value={draft.recurring_id} onChange={(e) => setDraft({ ...draft, recurring_id: e.target.value })}>
                  <option value="">{svcT('noRecurring')}</option>
                  {recurring.map((r) => <option key={r.id} value={r.id}>{r.name || r.id}</option>)}
                </SelectField>
              </div>
            </div>
            {projects.length > 0 && (
              <fieldset className={styles.checks} style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className={controls.label}>{svcT('onlyProjects')}</legend>
                {projects.map((p) => (
                  <label key={p.id} className={controls.check}>
                    <input type="checkbox" checked={draft.cost_centre_ids.includes(p.id)}
                      onChange={(e) => setDraft({ ...draft, cost_centre_ids: e.target.checked ? [...draft.cost_centre_ids, p.id] : draft.cost_centre_ids.filter((x) => x !== p.id) })} />
                    {p.name}
                  </label>
                ))}
              </fieldset>
            )}
            <p className={styles.note}>{svcT('gstHelp')}</p>
            <div className={styles.row}>
              <button type="button" className={controls.btnOutline} onClick={() => setDraft(null)}>{svcT('cancel')}</button>
              <button type="submit" className={controls.btnPrimary} disabled={!draft.client_key || !(Number(draft.hours) > 0)} data-save-retainer>{svcT('save')}</button>
            </div>
          </form>
        )}
      </Modal>

      <Modal open={report && !!selected} onClose={() => setReport(false)} size="lg" title={`${svcT('report')} · ${selected?.client_name ?? ''}`}>
        {selected && <RetainerReport retainer={selected} rows={reportRows} company={{ name: sender?.companyName ?? '', address: sender?.companyAddress, gstin: sender?.companyGstin }} />}
      </Modal>
    </section>
  );
}

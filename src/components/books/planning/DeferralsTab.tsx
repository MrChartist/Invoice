/**
 * Books → Deferrals (R2-C2): schedules that spread an invoice line (deferred revenue) or a bill line
 * (prepaid expense) over its service months, the monthly journals, and the deferral register.
 * Lazy-loaded by Books.tsx. Postings: `src/lib/deferrals.ts`.
 */
import { useEffect, useMemo, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import {
  cancelledSources,
  createDeferral,
  deferralRegister,
  deleteDeferral,
  invoiceSourceLines,
  loadDeferrals,
  monthsBetween,
  postDue,
  purchaseSourceLines,
  scheduleRows,
  stopDeferral,
  type PostResult,
  type SourceLine,
} from '../../../lib/deferrals';
import type { Deferral, DeferralMethod } from '../../../types/books-r2';
import type { Period } from '../../../lib/books';
import { localDb } from '../../../lib/localDb';
import { getTable } from '../../../lib/storage';
import { todayIso } from '../../../lib/tax-rules';
import { formatDate, formatMoney } from '../../../lib/utils';
import { useCan } from '../../../hooks/useCan';
import { useT } from '../../../i18n';
import { br2T } from '../../../i18n/areas/books-r2';
import surface from '../../../styles/surface.module.css';
import controls from '../../../styles/controls.module.css';
import books from '../books.module.css';

type Notify = (msg: string, tone?: 'success' | 'error') => void;
const rs = (paise: number) => formatMoney(paise / 100);

export default function DeferralsTab({ period, notify }: { period: Period; notify: Notify }) {
  useT();
  const { can } = useCan();
  const editable = can('books.edit');
  const today = todayIso();
  const [rev, setRev] = useState(0);
  const [kind, setKind] = useState<'invoice' | 'purchase'>('invoice');
  const [docId, setDocId] = useState('');
  const [lineIdx, setLineIdx] = useState(0);
  const [amount, setAmount] = useState('');
  const [start, setStart] = useState('');
  const [months, setMonths] = useState(12);
  const [method, setMethod] = useState<DeferralMethod>('months');
  const [upTo, setUpTo] = useState(today);

  const report = (r: PostResult) => {
    if (r.posted) notify(br2T('postedN', { n: r.posted }));
    if (r.locked) notify(br2T('lockedN', { n: r.locked }), 'error');
    if (r.errors.length) notify(r.errors[0], 'error');
  };

  // Due journals are written when the tab opens (idempotent; a locked period is skipped).
  useEffect(() => {
    if (!editable || !loadDeferrals().length) return;
    try {
      const r = postDue(today);
      if (r.posted || r.locked) report(r);
    } catch {
      /* shown on the next explicit post */
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRev((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sources = useMemo(() => {
    void rev;
    const out = new Map<string, SourceLine[]>();
    if (kind === 'invoice') for (const inv of localDb.invoices.getAll()) {
      const ls = invoiceSourceLines(inv).filter((l) => !l.cancelled);
      if (ls.length) out.set(inv.id, ls);
    }
    else for (const p of getTable<unknown>('purchases')) {
      const ls = purchaseSourceLines(p).filter((l) => !l.cancelled);
      if (ls.length) out.set(ls[0].id, ls);
    }
    return out;
  }, [kind, rev]);
  const docs = useMemo(() => [...sources.values()].map((ls) => ls[0]).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 300), [sources]);
  const lines = sources.get(docId) ?? [];
  const line = lines.find((l) => l.line_index === lineIdx) ?? lines[0];

  const pickDoc = (id: string) => {
    setDocId(id);
    const first = sources.get(id)?.[0];
    setLineIdx(first?.line_index ?? 0);
    setAmount(first ? String(first.amount) : '');
    setStart(first?.date ?? '');
  };
  const pickLine = (idx: number) => {
    setLineIdx(idx);
    const l = lines.find((x) => x.line_index === idx);
    if (l) setAmount(String(l.amount));
  };

  const paise = Math.round((Number(amount) || 0) * 100);
  const preview = useMemo(() => (start && paise > 0 ? scheduleRows(paise, start, months, method) : []), [paise, start, months, method]);

  const create = () => {
    if (!line) return;
    try {
      const raw = kind === 'purchase' ? getTable<{ id?: string }>('purchases').find((p) => p?.id === line.id) : undefined;
      createDeferral({ source: line, amount_paise: paise, start, months, method }, raw);
      notify(br2T('created', { number: line.number }));
      report(postDue(today));
      setDocId('');
      setRev((n) => n + 1);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  const rows = useMemo(() => (rev >= 0 ? loadDeferrals() : []), [rev]);
  const cancelled = useMemo(() => (rev >= 0 ? cancelledSources(rows, localDb.invoices.getAll(), getTable('purchases')) : []), [rows, rev]);
  const register = useMemo(() => (rev >= 0 ? deferralRegister(period, rows) : null), [period, rows, rev]);

  const stop = (d: Deferral) => {
    try {
      const r = stopDeferral(d.id, today);
      notify(br2T('stopped', { amount: rs(d.amount_paise - releasedOf(d)) }));
      report(r);
      setRev((n) => n + 1);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  const remove = (d: Deferral) => {
    try {
      deleteDeferral(d.id);
      notify(br2T('deleted'));
      setRev((n) => n + 1);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  const postNow = () => {
    try {
      const r = postDue(upTo);
      if (!r.posted && !r.locked && !r.errors.length) notify(br2T('nothingDue'));
      report(r);
      setRev((n) => n + 1);
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  const statusLabel = (s: Deferral['status']) => (s === 'active' ? br2T('stActive') : s === 'stopped' ? br2T('stStopped') : br2T('stCompleted'));

  return (
    <div className={books.stack} data-deferrals>
      <section className={surface.card}>
        <div className={surface.cardHead}>
          <span className={surface.cardHeadIcon}><CalendarClock size={16} aria-hidden /> {br2T('deferTitle')}</span>
        </div>
        <div className={surface.cardBody}>
          <p className={controls.hint}>{br2T('deferIntro')}</p>
          {!editable && <p className={books.muted}>{br2T('readOnly')}</p>}
          {cancelled.map((d) => (
            <div key={d.id} className={`${books.notice} ${books.noticeWarn}`} role="status">
              <strong>{br2T('cancelledHead')}</strong> {br2T('cancelledText', { number: d.source.number ?? '' })}
              {editable && (
                <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => stop(d)}>{br2T('stop')}</button>
              )}
            </div>
          ))}

          {editable && (
            <fieldset className={books.stack}>
              <legend className={controls.label}>{br2T('newSchedule')}</legend>
              <div className={books.toolbar}>
                <label className={controls.field}>
                  <span className={controls.label}>{br2T('sourceKind')}</span>
                  <select className={controls.select} value={kind} onChange={(e) => { setKind(e.target.value as 'invoice' | 'purchase'); setDocId(''); }}>
                    <option value="invoice">{br2T('fromInvoice')}</option>
                    <option value="purchase">{br2T('fromBill')}</option>
                  </select>
                </label>
                <label className={controls.field}>
                  <span className={controls.label}>{br2T('document')}</span>
                  <select className={controls.select} value={docId} onChange={(e) => pickDoc(e.target.value)} data-defer-doc>
                    <option value="">{docs.length ? br2T('chooseDoc') : br2T('noDocs')}</option>
                    {docs.map((d) => <option key={d.id} value={d.id}>{d.number || '—'} · {d.party} · {formatDate(d.date)}</option>)}
                  </select>
                </label>
                {lines.length > 1 && (
                  <label className={controls.field}>
                    <span className={controls.label}>{br2T('line')}</span>
                    <select className={controls.select} value={line?.line_index ?? 0} onChange={(e) => pickLine(Number(e.target.value))}>
                      {lines.map((l) => <option key={l.line_index} value={l.line_index}>{l.name} · ₹{formatMoney(l.amount)}</option>)}
                    </select>
                  </label>
                )}
              </div>
              {line && (
                <>
                  <div className={books.toolbar}>
                    <label className={controls.field}>
                      <span className={controls.label}>{br2T('amount')}</span>
                      <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} data-defer-amount />
                    </label>
                    <label className={controls.field}>
                      <span className={controls.label}>{br2T('start')}</span>
                      <input type="date" className={controls.input} value={start} onChange={(e) => setStart(e.target.value)} />
                    </label>
                    <label className={controls.field}>
                      <span className={controls.label}>{br2T('months')}</span>
                      <input className={`${controls.input} ${books.numInput}`} inputMode="numeric" value={months} onChange={(e) => setMonths(Math.min(120, Math.max(1, Math.floor(Number(e.target.value)) || 1)))} />
                    </label>
                    <label className={controls.field}>
                      <span className={controls.label}>{br2T('endDate')}</span>
                      <input type="date" className={controls.input} min={start} onChange={(e) => e.target.value && start && setMonths(monthsBetween(start, e.target.value))} />
                    </label>
                    <label className={controls.field}>
                      <span className={controls.label}>{br2T('method')}</span>
                      <select className={controls.select} value={method} onChange={(e) => setMethod(e.target.value as DeferralMethod)}>
                        <option value="months">{br2T('byMonths')}</option>
                        <option value="days">{br2T('byDays')}</option>
                      </select>
                    </label>
                  </div>
                  {preview.length > 0 && (
                    <div className={surface.tableWrap}>
                      <table className={surface.table}>
                        <caption className={surface.srOnly}>{br2T('preview')}</caption>
                        <thead><tr><th scope="col">{br2T('share')}</th><th scope="col">{br2T('releaseOn')}</th><th scope="col" className={surface.numeric}>{br2T('colAmount')}</th></tr></thead>
                        <tbody>
                          {preview.slice(0, 24).map((r) => (
                            <tr key={r.n}><td>{r.n}</td><td>{formatDate(r.date)}</td><td className={surface.numeric}>{rs(r.amount)}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div>
                    <button type="button" className={controls.btnPrimary} onClick={create} disabled={!(paise > 0) || !start} data-defer-create>{br2T('create')}</button>
                  </div>
                </>
              )}
            </fieldset>
          )}
        </div>
      </section>

      <section className={surface.card} aria-label={br2T('schedules')}>
        <div className={surface.cardHead}>
          <span className={surface.cardHeadIcon}>{br2T('schedules')}</span>
          {editable && rows.length > 0 && (
            <div className={books.toolbarGroup}>
              <label className={controls.field}>
                <span className={controls.label}>{br2T('postUpTo')}</span>
                <input type="date" className={controls.input} value={upTo} onChange={(e) => setUpTo(e.target.value)} />
              </label>
              <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={postNow}>{br2T('postNow')}</button>
            </div>
          )}
        </div>
        {rows.length === 0 ? (
          <p className={`${surface.cardBody} ${books.muted}`}>{br2T('noSchedules')}</p>
        ) : (
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <thead>
                <tr>
                  <th scope="col">{br2T('colSource')}</th>
                  <th scope="col" className={surface.numeric}>{br2T('colAmount')}</th>
                  <th scope="col">{br2T('colPeriod')}</th>
                  <th scope="col">{br2T('colStatus')}</th>
                  <th scope="col" className={surface.numeric}>{br2T('colReleased')}</th>
                  <th scope="col"><span className={surface.srOnly}>{br2T('stop')}</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <span className={surface.mono}>{d.source.number || '—'}</span> {d.source.name}
                      <div className={books.muted}>{d.kind === 'revenue' ? br2T('fromInvoice') : br2T('fromBill')} · {d.source.party}</div>
                    </td>
                    <td className={surface.numeric}>{rs(d.amount_paise)}</td>
                    <td>{formatDate(d.start)} · {d.months} · {d.method === 'days' ? br2T('byDays') : br2T('byMonths')}</td>
                    <td>{statusLabel(d.status)}{d.stopped_on ? ` (${formatDate(d.stopped_on)})` : ''}</td>
                    <td className={surface.numeric}>{rs(releasedOf(d))}</td>
                    <td>
                      {editable && d.status === 'active' && (
                        <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => stop(d)} aria-label={br2T('stopAria', { number: d.source.number ?? '' })}>{br2T('stop')}</button>
                      )}
                      {editable && (
                        <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => remove(d)} aria-label={br2T('deleteAria', { number: d.source.number ?? '' })}>{br2T('delete')}</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {register && register.rows.length > 0 && (
        <section className={surface.card} aria-label={br2T('register', { start: formatDate(period.start), end: formatDate(period.end) })}>
          <div className={surface.cardHead}>
            <span className={surface.cardHeadIcon}>{br2T('register', { start: formatDate(period.start), end: formatDate(period.end) })}</span>
          </div>
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <thead>
                <tr>
                  <th scope="col">{br2T('colSource')}</th>
                  <th scope="col" className={surface.numeric}>{br2T('colOpening')}</th>
                  <th scope="col" className={surface.numeric}>{br2T('colDeferred')}</th>
                  <th scope="col" className={surface.numeric}>{br2T('colReleased')}</th>
                  <th scope="col" className={surface.numeric}>{br2T('colClosing')}</th>
                </tr>
              </thead>
              <tbody>
                {register.rows.map((r) => (
                  <tr key={r.deferral.id}>
                    <td>{r.deferral.source.number} {r.deferral.source.name}</td>
                    <td className={surface.numeric}>{rs(r.opening)}</td>
                    <td className={surface.numeric}>{rs(r.deferred)}</td>
                    <td className={surface.numeric}>{rs(r.released)}</td>
                    <td className={surface.numeric}>{rs(r.closing)}</td>
                  </tr>
                ))}
                <tr className={books.totalRow}>
                  <td>{br2T('total')}</td>
                  <td className={surface.numeric}>{rs(register.totals.opening)}</td>
                  <td className={surface.numeric}>{rs(register.totals.deferred)}</td>
                  <td className={surface.numeric}>{rs(register.totals.released)}</td>
                  <td className={surface.numeric} data-defer-closing>{rs(register.totals.closing)}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className={`${surface.cardBody} ${books.muted}`}>{br2T('tiesNote')}</p>
        </section>
      )}
    </div>
  );
}

/** Amount released so far (posted release / stop journals), paise. */
function releasedOf(d: Deferral): number {
  const posted = d.posted ?? {};
  return scheduleRows(d.amount_paise, d.start, d.months, d.method)
    .filter((r) => posted[`r${r.n}`])
    .reduce((s, r) => s + r.amount, 0) + (posted.stop ? d.amount_paise - scheduleRows(d.amount_paise, d.start, d.months, d.method).filter((r) => posted[`r${r.n}`]).reduce((s, r) => s + r.amount, 0) : 0);
}

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarX, Clock, FileDiff, Lock, Snowflake } from 'lucide-react';
import type { InvoiceRecord } from '../../types/invoice';
import type { Gstr1Report, Gstr3bReport, ReportPeriod } from '../../lib/gst-reports';
import { periodFp, periodRange } from '../../lib/gst-reports';
import {
  aatoFor,
  deleteSnapshot,
  gstExceptions,
  gstr1aAvailable,
  gstr1aDiff,
  irnWindowList,
  saveSnapshot,
  snapshotFor,
  snapshotFromReport,
  table32Diff,
  table32Locked,
  timeBarList,
  type GstException,
  type Gstr1aDocRow,
  type T32Row,
  type TimeBarRow,
} from '../../lib/gst-guards';
import { pushedItc } from '../../lib/gst-followup';
import { FORM_LABELS, filedFor, loadFiled, type FiledReturn, type FilerFrequency, type ReturnDue } from '../../lib/compliance';
import { getAllEInvoiceMeta } from '../../lib/einvoice';
import { localDb } from '../../lib/localDb';
import { todayIso } from '../../lib/tax-rules';
import { formatDate } from '../../lib/utils';
import { AatoField } from '../einvoice/IrpWindowNote';
import { DataTable, Money } from './DataTable';
import { useT } from '../../i18n';
import { ggT } from '../../i18n/areas/gst-guards';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './gst-guards.module.css';

type Notify = (msg: string, tone?: 'success' | 'error' | 'info') => void;

export type Gst8dProps =
  | { view: 'guards'; period: ReportPeriod; gstin: string; g1: Gstr1Report; g3: Gstr3bReport; invoices: InvoiceRecord[]; notify: Notify }
  | { view: '3b'; period: ReportPeriod; gstin: string; g1: Gstr1Report; g3: Gstr3bReport }
  | { view: 'timebar'; frequency: FilerFrequency; stateCode: string; since: string; gstin: string; filed: FiledReturn[]; onMark: (r: ReturnDue, filedOn: string | null) => void };

const EX_KEY = {
  IRN_MISSING: 'exIrnMissing',
  IRP_WINDOW_CLOSED: 'exIrpClosed',
  B2B_NO_HSN: 'exNoHsn',
  POS_STATE_MISMATCH: 'exPos',
  RATE_NOT_IN_SLABS: 'exRate',
  B2CL_EDGE: 'exB2cl',
  OWN_GSTIN: 'exOwnGstin',
  BAND_RATE: 'exBandRate', // R9 (RT-C1)
  BAND_EDGE: 'exBandEdge',
  BAND_DISCOUNT: 'exBandDiscount',
  SV_RATE_OLD: 'exSvRateOld', // R10 (SV-A4)
  SV_NIL_NOT_EXEMPT: 'exSvNil',
  AG_CLASS_RATE: 'exAgClass', // R12 (AG-A3)
} as const;

/** Return-period key used by the compliance calendar for a report period. */
function periodKey(p: ReportPeriod): string {
  const { from } = periodRange(p);
  return p.kind === 'quarter' ? `${p.fyStart}-Q${p.quarter}` : from.slice(0, 7);
}

function useMemoIrnIds() {
  return useMemo(() => new Set(getAllEInvoiceMeta().filter((m) => m.irn).map((m) => m.invoice_id)), []);
}

/** 8D GST guards (lazy): guards tab, extras under GSTR-3B, and the time-bar list on the Compliance tab. */
export function Gst8dPanel(props: Gst8dProps) {
  useT();
  if (props.view === 'timebar') return <TimeBarTable {...props} />;
  if (props.view === '3b') return <ThreeBExtras {...props} />;
  return <Guards {...props} />;
}

function Guards({ period, gstin, g1, g3, invoices, notify }: Extract<Gst8dProps, { view: 'guards' }>) {
  const today = todayIso();
  const [rev, setRev] = useState(0);
  const irnIds = useMemoIrnIds();
  const range = useMemo(() => periodRange(period), [period]);
  const aato = useMemo(() => {
    const s = rev >= 0 ? localDb.settings.get() : null;
    const active = s?.profiles.find((p) => p.id === s.activeProfileId) ?? null;
    return (inv: InvoiceRecord | null) => aatoFor(inv, s?.profiles ?? [], active);
  }, [rev]);
  const pending = useMemo(() => irnWindowList(invoices, irnIds, aato, today, 60), [invoices, irnIds, aato, today]);
  // R9 (RT-C1): the price-band check is loaded by the page, which remounts this view once it is ready.
  const exceptions = useMemo(() => gstExceptions(invoices, { ...range, irnIds, aato, today, gstin }), [invoices, range, irnIds, aato, today, gstin]);
  const known = aato(null) !== undefined || invoices.some((i) => aato(i) !== undefined);

  return (
    <div className={styles.stack}>
      <section className={styles.section} aria-label={ggT('irpTitle')}>
        <h3 className={styles.head}><Clock size={15} aria-hidden /> {ggT('irpTitle')}</h3>
        <AatoField profileGstin={gstin} onSaved={() => setRev((n) => n + 1)} />
        {!known ? null : pending.length === 0 ? (
          <p className={styles.muted}>{ggT('irpNone')}</p>
        ) : (
          <DataTable
            caption={ggT('irpTitle')}
            emptyText=""
            rows={pending}
            rowKey={(x) => x.invoice.id}
            columns={[
              { key: 'n', label: ggT('colDoc'), render: (x) => <Link to={`/invoice/${x.invoice.id}`}>{x.invoice.invoice_number || '—'}</Link> },
              { key: 'd', label: ggT('colDate'), render: (x) => formatDate(x.invoice.issue_date) },
              { key: 'c', label: ggT('colParty'), render: (x) => x.invoice.client?.company || x.invoice.client?.name || '—' },
              { key: 'l', label: ggT('colLastDay'), render: (x) => formatDate(x.window.deadline) },
              {
                key: 's', label: ggT('colStatus'), render: (x) => (
                  <span className={x.window.stage === 'closed' || x.window.stage === 'day27' ? styles.pillBad : x.window.stage === 'day20' ? styles.pillWarn : styles.pill}>
                    {x.window.stage === 'closed' ? ggT('irpPillClosed') : ggT('irpPillLeft', { n: x.window.daysLeft + 1 })}
                  </span>
                ),
              },
            ]}
          />
        )}
      </section>

      <section className={styles.section} aria-label={ggT('exTitle')}>
        <h3 className={styles.head}><AlertTriangle size={15} aria-hidden /> {ggT('exTitle')}</h3>
        <p className={controls.hint} style={{ margin: 0 }}>{ggT('exHint')}</p>
        <DataTable<GstException>
          caption={ggT('exTitle')}
          emptyText={ggT('exNone')}
          rows={exceptions}
          rowKey={(e, i) => `${e.invoiceId}-${e.code}-${i}`}
          columns={[
            { key: 's', label: ggT('colSeverity'), render: (e) => <span className={e.severity === 'error' ? styles.pillBad : styles.pillWarn}>{e.severity === 'error' ? ggT('sevError') : ggT('sevReview')}</span> },
            { key: 'n', label: ggT('colDoc'), render: (e) => <Link to={`/invoice/${e.invoiceId}`}>{e.number}</Link> },
            { key: 'd', label: ggT('colDate'), render: (e) => formatDate(e.date) },
            { key: 'm', label: ggT('colIssue'), render: (e) => ggT(EX_KEY[e.code], { ...e.vars, deadline: e.vars.deadline ? formatDate(String(e.vars.deadline)) : '—' }) },
          ]}
        />
      </section>

      <Gstr1aSection key={`${periodFp(period)}|${gstin}`} period={period} gstin={gstin} g1={g1} g3={g3} notify={notify} />
    </div>
  );
}

function Gstr1aSection({ period, gstin, g1, g3, notify }: { period: ReportPeriod; gstin: string; g1: Gstr1Report; g3: Gstr3bReport; notify: Notify }) {
  const fp = periodFp(period);
  const [snap, setSnap] = useState(() => snapshotFor(fp, gstin));
  const { from } = periodRange(period);
  const available = gstr1aAvailable(from);
  const filed = loadFiled();
  const key = periodKey(period);
  const g1Filed = filedFor(filed, { form: 'GSTR1', periodKey: key } as ReturnDue, gstin);
  const b3Filed = filedFor(filed, { form: 'GSTR3B', periodKey: key } as ReturnDue, gstin);
  const paper = useMemo(() => (snap ? gstr1aDiff(snap, g1) : null), [snap, g1]);

  const freeze = () => {
    try {
      const s = snapshotFromReport(g1, g3.interStateUnreg, gstin);
      saveSnapshot(s);
      setSnap(s);
      notify(ggT('snapSaved'));
    } catch {
      notify(ggT('saveFailed'), 'error');
    }
  };
  const drop = () => {
    if (!snap || !window.confirm(ggT('snapDropConfirm'))) return;
    deleteSnapshot(snap.id);
    setSnap(null);
  };
  const kindLabel = (r: Gstr1aDocRow) => (r.kind === 'added' ? ggT('kAdded') : r.kind === 'changed' ? ggT('kChanged') : ggT('kRemoved'));

  return (
    <section className={styles.section} aria-label={ggT('g1aTitle')}>
      <h3 className={styles.head}><FileDiff size={15} aria-hidden /> {ggT('g1aTitle')}</h3>
      <p className={controls.hint} style={{ margin: 0 }}>{ggT('g1aHint')}</p>
      {!available && <p className={styles.noteInfo}>{ggT('g1aNotAvailable')}</p>}
      {available && b3Filed && <p className={styles.note}>{ggT('g1aClosed', { date: formatDate(b3Filed.filed_on) })}</p>}
      <div className={styles.row}>
        <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={freeze}>
          <Snowflake size={14} aria-hidden /> {snap ? ggT('snapRefreeze') : ggT('snapFreeze')}
        </button>
        {snap && <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={drop}>{ggT('snapDrop')}</button>}
        <span className={styles.muted}>
          {snap ? ggT('snapOn', { date: formatDate(snap.frozen_at.slice(0, 10)) }) : g1Filed ? ggT('snapNoneFiled', { date: formatDate(g1Filed.filed_on) }) : ggT('snapNone')}
        </span>
      </div>
      {paper && (
        paper.docs.length === 0 && paper.b2cs.length === 0 ? (
          <p className={styles.muted}>{ggT('g1aNoChange')}</p>
        ) : (
          <>
            <DataTable<Gstr1aDocRow>
              caption={ggT('g1aTitle')}
              emptyText={ggT('g1aNoDocChange')}
              rows={paper.docs}
              rowKey={(r) => `${r.kind}-${r.id}`}
              columns={[
                { key: 'k', label: ggT('colChange'), render: (r) => <span className={r.kind === 'removed' ? styles.pillBad : r.kind === 'added' ? styles.pillWarn : styles.pill}>{kindLabel(r)}</span> },
                { key: 's', label: ggT('colTable'), render: (r) => r.section.toUpperCase() },
                { key: 'n', label: ggT('colDoc'), render: (r) => (r.kind === 'removed' ? r.number : <Link to={`/invoice/${r.id}`}>{r.number}</Link>) },
                { key: 'f', label: ggT('colFields'), render: (r) => r.fields.join(', ') || '—' },
                { key: 'b', label: ggT('colFiled'), numeric: true, render: (r) => (r.before ? <Money value={r.before.taxable} /> : '—') },
                { key: 'a', label: ggT('colNow'), numeric: true, render: (r) => (r.after ? <Money value={r.after.taxable} /> : '—') },
              ]}
            />
            {paper.b2cs.length > 0 && (
              <DataTable
                caption="B2CS"
                emptyText=""
                rows={paper.b2cs}
                rowKey={(r) => `${r.kind}-${r.key}`}
                columns={[
                  { key: 'k', label: ggT('colChange'), render: (r) => (r.kind === 'added' ? ggT('kAdded') : r.kind === 'changed' ? ggT('kChanged') : ggT('kRemoved')) },
                  { key: 'p', label: 'B2CS', render: (r) => { const x = r.after ?? r.before!; return `${x.supply} · POS ${x.pos} · ${x.rate}%`; } },
                  { key: 'b', label: ggT('colFiled'), numeric: true, render: (r) => (r.before ? <Money value={r.before.txval} /> : '—') },
                  { key: 'a', label: ggT('colNow'), numeric: true, render: (r) => (r.after ? <Money value={r.after.txval} /> : '—') },
                ]}
              />
            )}
            {paper.docs.some((r) => r.kind === 'removed') && <p className={styles.note}>{ggT('g1aRemovedNote')}</p>}
          </>
        )
      )}
    </section>
  );
}

function ThreeBExtras({ period, gstin, g3 }: Extract<Gst8dProps, { view: '3b' }>) {
  const fp = periodFp(period);
  const today = todayIso();
  const { from } = periodRange(period);
  const snap = useMemo(() => snapshotFor(fp, gstin), [fp, gstin]);
  const rows = useMemo(() => table32Diff(snap, g3.interStateUnreg), [snap, g3]);
  const locked = table32Locked(from, today);
  const pushed = useMemo(() => pushedItc(fp, gstin), [fp, gstin]);
  const diff = rows.some((r) => Math.abs(r.diffTaxable) > 1 || Math.abs(r.diffIgst) > 1);
  const books = g3.itc.availableOther;
  const t = (h: { igst: number; cgst: number; sgst: number }) => h.igst + h.cgst + h.sgst;

  return (
    <div className={styles.stack} style={{ marginTop: '1rem' }}>
      <section className={styles.section} aria-label={ggT('t32Title')}>
        <h3 className={styles.head}>{locked ? <Lock size={15} aria-hidden /> : null} {ggT('t32Title')}</h3>
        <p className={locked ? styles.noteBad : styles.noteInfo}>{locked ? ggT('t32Locked') : ggT('t32Editable')}</p>
        {!snap && <p className={styles.muted}>{ggT('t32NoSnap')}</p>}
        <DataTable<T32Row>
          caption={ggT('t32Title')}
          emptyText={ggT('t32Empty')}
          rows={rows}
          rowKey={(r) => r.pos}
          columns={[
            { key: 'p', label: ggT('colPos'), render: (r) => r.pos },
            { key: 'g', label: ggT('colPerG1'), numeric: true, render: (r) => (r.gstr1Taxable === null ? '—' : <Money value={r.gstr1Taxable} />), total: (r) => r.gstr1Taxable ?? 0 },
            { key: 'b', label: ggT('colBooks'), numeric: true, render: (r) => <Money value={r.booksTaxable} />, total: (r) => r.booksTaxable },
            { key: 'd', label: ggT('colDiff'), numeric: true, render: (r) => <Money value={r.diffTaxable} />, total: (r) => r.diffTaxable },
            { key: 'gi', label: ggT('colIgstG1'), numeric: true, render: (r) => (r.gstr1Igst === null ? '—' : <Money value={r.gstr1Igst} />) },
            { key: 'bi', label: ggT('colIgstBooks'), numeric: true, render: (r) => <Money value={r.booksIgst} /> },
          ]}
        />
        {diff && <p className={styles.note}>{ggT('t32Fix')}</p>}
      </section>
      <section className={styles.section} aria-label={ggT('itcTitle')}>
        <h3 className={styles.head}>{ggT('itcTitle')}</h3>
        {!pushed ? (
          <p className={styles.muted}>{ggT('itcNone')}</p>
        ) : (
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>{ggT('itcTitle')}</caption>
              <thead>
                <tr><th scope="col">{ggT('colFigure')}</th><th scope="col" style={{ textAlign: 'right' }}>IGST</th><th scope="col" style={{ textAlign: 'right' }}>CGST</th><th scope="col" style={{ textAlign: 'right' }}>SGST</th><th scope="col" style={{ textAlign: 'right' }}>{ggT('colTotal')}</th></tr>
              </thead>
              <tbody>
                {([[ggT('itcBooksNow'), books], [ggT('itcRestricted'), pushed.restricted], [ggT('itcPer2b'), pushed.per2b], [ggT('itcAtRisk'), pushed.atRisk]] as [string, { igst: number; cgst: number; sgst: number }][]).map(([l, h]) => (
                  <tr key={l}>
                    <th scope="row" style={{ fontWeight: 500 }}>{l}</th>
                    <td className={surface.numeric}><Money value={h.igst} /></td>
                    <td className={surface.numeric}><Money value={h.cgst} /></td>
                    <td className={surface.numeric}><Money value={h.sgst} /></td>
                    <td className={surface.numeric}><Money value={t(h)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={styles.muted}>{ggT('itcPushedOn', { date: formatDate(pushed.pushed_at.slice(0, 10)) })}</p>
          </div>
        )}
      </section>
    </div>
  );
}

function TimeBarTable({ frequency, stateCode, since, gstin, filed, onMark }: Extract<Gst8dProps, { view: 'timebar' }>) {
  const today = todayIso();
  const rows = useMemo(() => (since ? timeBarList({ frequency, stateCode, today, since }, filed, gstin) : []), [frequency, stateCode, today, since, filed, gstin]);
  if (!rows.length) return null;
  return (
    <section className={styles.section} aria-label={ggT('tbTitle')} style={{ marginTop: '1rem' }}>
      <h3 className={styles.head}><CalendarX size={15} aria-hidden /> {ggT('tbTitle')}</h3>
      <p className={controls.hint} style={{ margin: 0 }}>{ggT('tbHint')}</p>
      <DataTable<TimeBarRow>
        caption={ggT('tbTitle')}
        emptyText=""
        rows={rows}
        rowKey={(x) => x.r.id}
        columns={[
          { key: 'f', label: ggT('colReturn'), render: (x) => FORM_LABELS[x.r.form] },
          { key: 'p', label: ggT('colPeriod'), render: (x) => x.r.label },
          { key: 'd', label: ggT('colDue'), render: (x) => formatDate(x.r.due) },
          {
            key: 'b', label: ggT('colBarred'), render: (x) => (
              <span className={x.bar.barred ? styles.pillBad : x.bar.daysLeft <= 90 ? styles.pillWarn : styles.pill}>
                {x.bar.barred ? ggT('tbBarred', { date: formatDate(x.bar.barredOn) }) : ggT('tbBecomes', { date: formatDate(x.bar.barredOn), n: x.bar.daysLeft })}
              </span>
            ),
          },
          {
            key: 'm', label: ggT('colFiled'), render: (x) => (
              <label className={controls.check}>
                <input type="checkbox" checked={false} onChange={(e) => e.target.checked && onMark(x.r, today)} aria-label={ggT('tbMark', { form: FORM_LABELS[x.r.form], period: x.r.label })} />
              </label>
            ),
          },
        ]}
      />
    </section>
  );
}

export default Gst8dPanel;

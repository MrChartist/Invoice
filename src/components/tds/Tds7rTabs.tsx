/**
 * 7R (7.120) tabs of the TDS & TCS page, loaded on demand: Form 27Q working paper (non-residents, DTAA vs Act rate)
 * and the TRACES justification report import (defaults matched to our deductions).
 */
import { useMemo, useRef, useState } from 'react';
import { Download, RefreshCw, Trash2, Upload } from 'lucide-react';
import type { TdsQuarter } from '../../lib/tds-payables';
import { setReturnFiled } from '../../lib/tds-payables';
import { form27Q, form27QCsv, form27QSheets, nr27qRows, FORM27Q_NOTE } from '../../lib/tds-27q';
import {
  deleteJustification,
  flagsByKey,
  importJustification,
  justificationCsv,
  justificationSummary,
  loadJustifications,
  rematchJustifications,
  setFindingResolved,
  JUSTIFICATION_KINDS,
  JUSTIFICATION_NOTE,
  MAX_JUSTIFICATION_CHARS,
  type JustificationImport,
  type JustificationKind,
} from '../../lib/traces-justification';
import { vendorsDb } from '../../lib/vendors';
import { downloadText } from '../../lib/download';
import { formatDate, formatMoney, todayInput } from '../../lib/utils';
import type { TdsData } from './TdsTabs';
import { useT } from '../../i18n';
import { tdsT } from '../../i18n/areas/tds';
import { r7T } from '../../i18n/areas/gst-tds-7r';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import books from '../books/books.module.css';

type Notify = (m: string, tone?: 'success' | 'error') => void;
const inr = (n: number) => `₹${formatMoney(n)}`;

const KIND_KEY: Record<JustificationKind, Parameters<typeof r7T>[0]> = {
  SHORT_DEDUCTION: 'jkShortDeduction',
  SHORT_PAYMENT: 'jkShortPayment',
  LATE_DEDUCTION: 'jkLateDeduction',
  LATE_PAYMENT: 'jkLatePayment',
  LATE_FILING: 'jkLateFiling',
  PAN_ERROR: 'jkPanError',
  OTHER: 'jkOther',
};

/* ── Form 27Q ─────────────────────────────────────────────────── */

export function Form27qTab({ data, fy, quarter, canEdit, onChanged, notify }: { data: TdsData; fy: number; quarter: TdsQuarter; canEdit: boolean; onChanged: () => void; notify: Notify }) {
  useT();
  const vendors = useMemo(() => vendorsDb.all(), []);
  const paper = useMemo(() => form27Q(data.rows, vendors, data.challans, fy, quarter), [data, vendors, fy, quarter]);
  const checks = useMemo(() => nr27qRows(data.rows.filter((r) => r.fy === fy && r.quarter === quarter), vendors), [data, vendors, fy, quarter]);
  const mark = data.marks.find((m) => m.id === `27Q:${fy}-Q${quarter}`);
  const [filedOn, setFiledOn] = useState(todayInput());
  const [token, setToken] = useState('');
  const base = `form-27Q-${fy}-Q${quarter}`;
  const xlsx = async () => {
    const { downloadXlsx } = await import('../../lib/xlsx');
    await downloadXlsx(`${base}.xlsx`, form27QSheets(paper));
  };
  const setMark = (day: string | null) => {
    try {
      setReturnFiled('27Q', fy, quarter, day, token);
      onChanged();
      notify(tdsT('saved'));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  return (
    <div className={books.stack} data-tds-27q>
      <div className={`${books.toolbar} no-print`}>
        <p className={books.muted}>{r7T('q27Intro')}</p>
        <div className={books.toolbarGroup}>
          <button type="button" className={controls.btnOutline} onClick={() => downloadText(`${base}.csv`, form27QCsv(paper), 'text/csv')}><Download size={16} /> {tdsT('csv')}</button>
          <button type="button" className={controls.btnOutline} onClick={() => void xlsx()}><Download size={16} /> {tdsT('xlsx')}</button>
        </div>
      </div>
      <p className={books.notice}>{FORM27Q_NOTE}</p>
      <p className={books.muted}>
        FY {fy}-{String(fy + 1).slice(2)} · Q{quarter} · {tdsT('deducted')} {inr(paper.totals.deducted)} · {tdsT('deposited')} {inr(paper.totals.deposited)}
        {paper.totals.shortBy > 0 ? ` · ${r7T('q27Short', { amount: inr(paper.totals.shortBy) })}` : ''}
      </p>
      <div className={surface.card}>
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <caption className={surface.srOnly}>{r7T('q27Title')}</caption>
            <thead>
              <tr>
                <th scope="col">{r7T('q27Payee')}</th>
                <th scope="col">{r7T('q27Country')}</th>
                <th scope="col">{tdsT('sectionShort')}</th>
                <th scope="col" className={surface.numeric}>{tdsT('paid')}</th>
                <th scope="col" className={surface.numeric}>{r7T('q27Applied')}</th>
                <th scope="col" className={surface.numeric}>{r7T('q27Act')}</th>
                <th scope="col" className={surface.numeric}>{r7T('q27Dtaa')}</th>
                <th scope="col" className={surface.numeric}>{r7T('q27Required')}</th>
                <th scope="col" className={surface.numeric}>{r7T('q27ShortCol')}</th>
                <th scope="col">{r7T('q27Docs')}</th>
              </tr>
            </thead>
            <tbody>
              {checks.length === 0 && <tr><td colSpan={10} className={books.muted}>{r7T('q27None')}</td></tr>}
              {checks.map((x) => (
                <tr key={x.row.key} data-27q-row>
                  <td>{x.row.payee}<br /><span className={books.muted}>{x.row.pan || 'PANNOTAVBL'} · {formatDate(x.row.creditedOn)}</span></td>
                  <td>{x.payee.country || '—'}</td>
                  <td>{x.row.code}</td>
                  <td className={surface.numeric}>{formatMoney(x.row.base)}</td>
                  <td className={surface.numeric}>{x.row.rate}% · {formatMoney(x.row.amount)}</td>
                  <td className={surface.numeric}>{x.check.actRate}%</td>
                  <td className={surface.numeric}>{x.check.dtaaRate === null ? '—' : `${x.check.dtaaRate}%${x.check.dtaaBlocked ? ' ✕' : ''}`}</td>
                  <td className={surface.numeric}>{x.check.required}% ({x.check.basis === 'DTAA' ? 'DTAA' : x.check.basis === 'NO_PAN' ? '206AA' : r7T('q27BasisAct')})</td>
                  <td className={surface.numeric}>{x.shortBy > 0 ? <strong>{formatMoney(x.shortBy)}</strong> : '—'}</td>
                  <td>{x.payee.trcNo ? `TRC ✓${x.payee.trcTo ? ` (${formatDate(x.payee.trcTo)})` : ''}` : 'TRC ✕'} · {x.payee.form10f ? '10F ✓' : '10F ✕'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {paper.warnings.length > 0 && (
        <div className={books.noticeWarn} role="note">
          <strong>{tdsT('warnings')}</strong>
          <ul>{paper.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}
      <p className={books.muted}>{r7T('q27Rules')}</p>
      {canEdit && (
        <div className={books.toolbar}>
          {mark ? (
            <>
              <span>{tdsT('filedOn', { date: formatDate(mark.filed_on) })}{mark.token ? ` · ${mark.token}` : ''}</span>
              <button type="button" className={controls.btnGhost} onClick={() => setMark(null)}>{tdsT('clearFiled')}</button>
            </>
          ) : (
            <div className={books.toolbarGroup}>
              <input aria-label={tdsT('date')} type="date" className={controls.input} value={filedOn} onChange={(e) => setFiledOn(e.target.value)} />
              <input aria-label={tdsT('token')} placeholder={tdsT('token')} className={controls.input} value={token} onChange={(e) => setToken(e.target.value)} />
              <button type="button" className={controls.btnOutline} onClick={() => setMark(filedOn)}>{tdsT('markFiled')}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── TRACES justification report ──────────────────────────────── */

export function TracesTab({ data, canEdit, notify }: { data: TdsData; canEdit: boolean; notify: Notify }) {
  useT();
  const [imports, setImports] = useState<JustificationImport[]>(() => loadJustifications());
  const [openId, setOpenId] = useState<string>(() => loadJustifications()[0]?.id ?? '');
  const fileRef = useRef<HTMLInputElement | null>(null);
  const flags = useMemo(() => flagsByKey(imports), [imports]);
  const open = imports.find((x) => x.id === openId) ?? imports[0];
  const rowsByKey = useMemo(() => new Map(data.rows.map((r) => [r.key, r])), [data.rows]);
  const reload = () => setImports(loadJustifications());

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    // Untrusted file: size cap before reading.
    if (file.size > MAX_JUSTIFICATION_CHARS * 2) return notify(r7T('jTooLarge'), 'error');
    try {
      const text = await file.text();
      const imp = importJustification(file.name, text, data.rows, todayInput());
      reload();
      setOpenId(imp.id);
      notify(r7T('jImported', { rows: imp.findings.length, matched: imp.findings.filter((f) => f.key).length }));
    } catch (err) {
      notify((err as Error).message, 'error');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };
  const act = (fn: () => void) => {
    try {
      fn();
      reload();
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  const summary = open ? justificationSummary(open.findings) : null;

  return (
    <div className={books.stack} data-tds-traces>
      <p className={books.muted}>{r7T('jIntro')}</p>
      <p className={books.notice}>{JUSTIFICATION_NOTE}</p>
      {canEdit && (
        <div className={`${books.toolbar} no-print`}>
          <label className={controls.btnOutline}>
            <Upload size={16} /> {r7T('jLoad')}
            <input ref={fileRef} type="file" accept=".txt,.csv,.tsv,text/plain,text/csv" className={surface.srOnly} onChange={(e) => void onFile(e.target.files?.[0])} />
          </label>
          {imports.length > 0 && (
            <button type="button" className={controls.btnGhost} onClick={() => act(() => rematchJustifications(data.rows))}><RefreshCw size={16} /> {r7T('jRematch')}</button>
          )}
        </div>
      )}
      {imports.length === 0 && <p className={books.muted}>{r7T('jNone')}</p>}
      {imports.length > 1 && (
        <label className={controls.field}>
          <span className={controls.label}>{r7T('jImport')}</span>
          <select className={controls.select} value={open?.id ?? ''} onChange={(e) => setOpenId(e.target.value)}>
            {imports.map((x) => <option key={x.id} value={x.id}>{x.file_name} · {formatDate(x.imported_on)}{x.meta.form ? ` · ${x.meta.form}` : ''}</option>)}
          </select>
        </label>
      )}
      {open && summary && (
        <>
          <div className={books.toolbar}>
            <span className={books.muted}>
              {open.file_name} · {r7T('jMeta', { tan: open.meta.tan || '—', fy: open.meta.fy ? `${open.meta.fy}-${String(open.meta.fy + 1).slice(2)}` : '—', q: open.meta.quarter ? `Q${open.meta.quarter}` : '—' })}
              {open.skipped ? ` · ${r7T('jSkipped', { n: open.skipped })}` : ''}{open.truncated ? ` · ${r7T('jTruncated')}` : ''}
            </span>
            <div className={books.toolbarGroup}>
              <button type="button" className={controls.btnOutline} onClick={() => downloadText(`traces-justification-${open.imported_on}.csv`, justificationCsv(open), 'text/csv')}><Download size={16} /> {tdsT('csv')}</button>
              {canEdit && <button type="button" className={controls.btnGhost} aria-label={r7T('jDelete')} onClick={() => act(() => deleteJustification(open.id))}><Trash2 size={16} /></button>}
            </div>
          </div>
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>{r7T('jSummary')}</caption>
              <thead>
                <tr>
                  <th scope="col">{r7T('jDefault')}</th>
                  <th scope="col" className={surface.numeric}>{r7T('jRows')}</th>
                  <th scope="col" className={surface.numeric}>{r7T('jMatched')}</th>
                  <th scope="col" className={surface.numeric}>{r7T('jDemand')}</th>
                </tr>
              </thead>
              <tbody>
                {JUSTIFICATION_KINDS.filter((k) => summary[k].count > 0).map((k) => (
                  <tr key={k}>
                    <td>{r7T(KIND_KEY[k])}</td>
                    <td className={surface.numeric}>{summary[k].count}</td>
                    <td className={surface.numeric}>{summary[k].matched}</td>
                    <td className={surface.numeric}>{formatMoney(summary[k].demand)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={surface.card}>
            <div className={surface.tableWrap}>
              <table className={surface.table}>
                <caption className={surface.srOnly}>{r7T('jFindings')}</caption>
                <thead>
                  <tr>
                    <th scope="col">{r7T('jDefault')}</th>
                    <th scope="col">PAN</th>
                    <th scope="col">{r7T('q27Payee')}</th>
                    <th scope="col">{tdsT('sectionShort')}</th>
                    <th scope="col">{tdsT('creditedOn')}</th>
                    <th scope="col" className={surface.numeric}>{tdsT('paid')}</th>
                    <th scope="col" className={surface.numeric}>{tdsT('amount')}</th>
                    <th scope="col" className={surface.numeric}>{r7T('jDemand')}</th>
                    <th scope="col">{r7T('jMatchedTo')}</th>
                    <th scope="col">{r7T('jResolved')}</th>
                  </tr>
                </thead>
                <tbody>
                  {open.findings.map((f, i) => {
                    const row = f.key ? rowsByKey.get(f.key) : undefined;
                    return (
                      <tr key={i} data-traces-finding={f.kind}>
                        <td>{r7T(KIND_KEY[f.kind])}</td>
                        <td>{f.pan || '—'}</td>
                        <td>{f.name || '—'}</td>
                        <td>{f.section || '—'}</td>
                        <td>{f.date ? formatDate(f.date) : '—'}</td>
                        <td className={surface.numeric}>{formatMoney(f.base)}</td>
                        <td className={surface.numeric}>{formatMoney(f.tds)}</td>
                        <td className={surface.numeric}>{formatMoney(f.demand)}</td>
                        <td>{row ? `${row.payee} · ${row.billNumber || row.key} · ${formatDate(row.deductedOn)}${(flags.get(row.key)?.length ?? 0) > 1 ? ` (${flags.get(row.key)!.length})` : ''}` : f.key ? f.key : r7T('jUnmatched')}</td>
                        <td>
                          <input
                            type="checkbox"
                            aria-label={r7T('jResolved')}
                            checked={!!f.resolved}
                            disabled={!canEdit}
                            onChange={(e) => act(() => setFindingResolved(open.id, i, e.target.checked))}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * R15-C2 statements view (`&view=statements`, lazy): import a BSP / consolidator / bed-bank file (columns guessed
 * from the preset, the user's fix remembered), the statements with their match counts and totals, one open statement
 * filtered by status (ADM: record or dispute; refunds to pass on) and "Make bill" (the only posting). C4 commission
 * income: cut 1 (PRD §3, size cap). Working papers — verify with your CA.
 */
import { useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { tvT } from '../../i18n/areas/travel-r15b';
import { cvList, cvT } from '../../i18n/areas/travel-r15c';
import { r16cT } from '../../i18n/areas/travel-r16c'; // R16-C3 bed-bank columns
import type { StatementRow } from '../../types/travel-r15';
import { getTable } from '../../lib/storage';
import { formatCurrency, todayInput } from '../../lib/utils';
import { guessColumns, type ColumnMap, type FileTable } from '../../lib/marketplace/file-map';
import { readFileTables } from '../marketplace/file-read';
import { REQUIRED, STATEMENT_KINDS, STATEMENT_PRESETS, importStatement, loadStatements, readStatementRows, removeStatement, updateStatement, type StatementKind } from '../../lib/travel/tv-statements';
import { makeStatementBill } from '../../lib/travel/tv-statement-bill';
import { readTravelSettings } from '../../lib/travel/tv-settings';
import { statementDiffRows } from '../../lib/travel/tv-annexure';
import { downloadText, toCsv } from '../../lib/download';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Field } from './tv-ui';
import { runWith, type TvViewProps } from './tv-run';

const STS = ['matched', 'diff', 'missing', 'ours_only'] as const;
const sm = `${controls.btnOutline} ${controls.btnSm}`;
const row = { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', marginBottom: '0.75rem' } as const;
const money = (n: number) => formatCurrency(n);

export default function StatementsView({ notify }: TvViewProps) {
  useT();
  const run = runWith(notify);
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState('');
  const [filter, setFilter] = useState('');
  const d = useMemo(() => { void tick; return { sts: loadStatements(), vendors: getTable<{ id: string; name: string }>('vendors') }; }, [tick]);
  const refresh = () => setTick((t) => t + 1);
  const vname = (id: string) => d.vendors.find((v) => v.id === id)?.name ?? '—';
  const sel = d.sts.find((s) => s.id === open);
  const flag = (r: StatementRow) => (r.flag === 'adm' ? cvT('adm') : r.flag === 'refund' ? cvT('refundFlag') : '');
  return (
    <>
      <ImportForm vendors={d.vendors} notify={notify} onDone={refresh} />
      <div className={surface.tableWrap}>
        <table className={surface.table} data-tv-statements>
          <thead><tr><th>{tvT('from')}</th><th>{tvT('to')}</th><th>{tvT('supplier')}</th><th>{cvT('ref')}</th>{STS.slice(1).map((k) => <th key={k} className={surface.numeric}>{cvList('sts', STS, k)}</th>)}<th className={surface.numeric}>{tvT('commission')}</th><th className={surface.numeric}>{cvT('net')}</th><th /></tr></thead>
          <tbody>
            {d.sts.map((s) => (
              <tr key={s.id} data-tv-statement={s.ref}>
                <td>{s.period_start}</td><td>{s.period_end}</td><td>{vname(s.vendor_id)} · {cvList('kinds', STATEMENT_KINDS, s.kind)}</td><td>{s.ref}</td>
                {STS.slice(1).map((k) => <td key={k} className={surface.numeric} data-tv-count={k}>{s.rows.filter((r) => r.status === k).length}</td>)}
                <td className={surface.numeric}>{money(s.totals.commission)}</td><td className={surface.numeric}>{money(s.totals.net)}</td>
                <td className={surface.rowActions}>
                  <button type="button" className={sm} onClick={() => setOpen(open === s.id ? '' : s.id)}>{tvT('open')}</button>
                  <button type="button" className={sm} onClick={() => { if (run(() => updateStatement(s.id, (x) => x, true))) refresh(); }}>{cvT('again')}</button>
                  {s.bill_id ? <span>{cvT('billMade')}</span> : <button type="button" className={`${controls.btnPrimary} ${controls.btnSm}`} data-tv-make-bill onClick={() => { if (run(() => makeStatementBill(s.id), cvT('billMade'))) refresh(); }}>{cvT('makeBill')}</button>}
                  <button type="button" className={sm} onClick={() => { if (run(() => { removeStatement(s.id); return true; })) refresh(); }}>{tvT('remove')}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {sel && (
        <section data-tv-statement-open>
          <div style={row}><Field label={tvT('status')}><select className={controls.select} value={filter} onChange={(e) => setFilter(e.target.value)}><option value="">—</option>{STS.map((k) => <option key={k} value={k}>{cvList('sts', STS, k)}</option>)}</select></Field>
            {/* PENDING 13 (R15-C cut 3): CSV of the rows not plainly matched (diff, missing, ours only, ADM, refund). */}
            <button type="button" className={sm} onClick={() => downloadText(`statement-differences-${sel.ref.replace(/[^\w-]+/g, '-')}.csv`, '\ufeff' + toCsv(statementDiffRows(sel)), 'text/csv')} data-tv-diff-csv>{cvT('diffCsv')}</button></div>
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <thead><tr><th>{cvT('doc')}</th><th>{cvT('type')}</th><th>{tvT('from')}</th><th>{tvT('pax')}</th><th className={surface.numeric}>{cvT('gross')}</th><th className={surface.numeric}>{tvT('commission')}</th><th className={surface.numeric}>{cvT('net')}</th><th>{tvT('status')}</th><th /></tr></thead>
              <tbody>
                {sel.rows.map((r, i) => (!filter || r.status === filter) && (
                  <tr key={i} data-tv-row={r.status} data-tv-flag={r.flag ?? ''}>
                    <td>{r.doc_no}</td><td>{r.type}</td><td>{r.date ?? ''}</td><td>{r.pax ?? ''}</td>
                    <td className={surface.numeric}>{money(r.gross + r.taxes)}</td><td className={surface.numeric}>{money(r.commission)}</td><td className={surface.numeric}>{money(r.net)}</td>
                    <td>{cvList('sts', STS, r.status ?? '')}{r.diff ? ` ${money(r.diff)}` : ''} {flag(r)}{r.disputed ? ` · ${cvT('dispute')}` : ''}</td>
                    <td>{r.flag === 'adm' && !sel.bill_id && <button type="button" className={sm} onClick={() => { if (run(() => updateStatement(sel.id, (x) => ({ ...x, rows: x.rows.map((y, j) => (j === i ? { ...y, disputed: !y.disputed } : y)) })))) refresh(); }}>{r.disputed ? cvT('record') : cvT('dispute')}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </>
  );
}

function ImportForm({ vendors, notify, onDone }: { vendors: { id: string; name: string }[]; notify: TvViewProps['notify']; onDone: () => void }) {
  const [kind, setKind] = useState<StatementKind>('bsp');
  const [f, setF] = useState({ vendor_id: '', ref: '', from: '', to: '' });
  const [file, setFile] = useState<{ name: string; t: FileTable; cols: ColumnMap } | null>(null);
  const guess = (t: FileTable, k: StatementKind): ColumnMap => {
    const saved = readTravelSettings().statement_maps?.[k];
    return guessColumns(t.headers, STATEMENT_PRESETS[k]!, saved ? { preset: k, columns: Object.entries(saved).map(([field, header]) => ({ field, header })) } : undefined);
  };
  const pick = async (fl?: File) => {
    if (!fl) return;
    try {
      const t = (await readFileTables(fl))[0]?.table;
      if (!t) throw new Error('No table with a header row was found in the file.');
      setFile({ name: fl.name, t, cols: guess(t, kind) });
    } catch (e) { notify((e as Error).message, 'error'); }
  };
  const go = () => {
    if (!file) return;
    const missing = REQUIRED.filter((x) => !file.cols.has(x));
    if (missing.length) return notify(`Map the columns: ${missing.join(', ')}.`, 'error');
    const rows = readStatementRows(file.t, file.cols);
    const days = rows.map((r) => r.date).filter((x): x is string => !!x).sort();
    const made = runWith(notify)(() => importStatement({ vendor_id: f.vendor_id, kind, ref: f.ref.trim() || file.name, period_start: f.from || days[0] || todayInput(), period_end: f.to || days[days.length - 1] || todayInput(), rows, file_name: file.name, map: Object.fromEntries([...file.cols].map(([k, i]) => [k, file.t.headers[i]])) }), cvT('imported', { n: rows.length }));
    if (made) { setFile(null); onDone(); }
  };
  return (
    <div style={row} data-tv-import>
      <Field label={cvT('type')}><select className={controls.select} value={kind} onChange={(e) => { const k = e.target.value as StatementKind; setKind(k); if (file) setFile({ ...file, cols: guess(file.t, k) }); }} data-tv-st-kind>{STATEMENT_KINDS.map((k) => <option key={k} value={k}>{cvList('kinds', STATEMENT_KINDS, k)}</option>)}</select></Field>
      <Field label={tvT('supplier')}><select className={controls.select} value={f.vendor_id} onChange={(e) => setF({ ...f, vendor_id: e.target.value })} data-tv-st-vendor><option value="">—</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
      <Field label={cvT('ref')}><input className={controls.input} value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} data-tv-st-ref /></Field>
      <Field label={tvT('from')}><input type="date" className={controls.input} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
      <Field label={tvT('to')}><input type="date" className={controls.input} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
      <Field label={cvT('file')}><input type="file" accept=".csv,.xlsx,.xlsm,.txt" onChange={(e) => void pick(e.target.files?.[0])} data-tv-st-file /></Field>
      {file && Object.keys(STATEMENT_PRESETS[kind]!).map((k) => (
        <Field key={k} label={({ doc_no: cvT('doc'), type: cvT('type'), date: tvT('from'), pax: tvT('pax'), gross: cvT('gross'), taxes: cvT('taxes'), commission: tvT('commission'), net: cvT('net'), hotel: r16cT('hotel'), nights: r16cT('nights') } as Record<string, string>)[k] ?? k}>
          <select className={controls.select} value={file.cols.get(k) ?? ''} onChange={(e) => { const cols = new Map(file.cols); if (e.target.value === '') cols.delete(k); else cols.set(k, Number(e.target.value)); setFile({ ...file, cols }); }}>
            <option value="">—</option>{file.t.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
          </select>
        </Field>
      ))}
      {file && <button type="button" className={controls.btnPrimary} onClick={go} data-tv-st-import>{cvT('import')}</button>}
    </div>
  );
}

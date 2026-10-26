/**
 * R5-A3 / A6: import a marketplace sales / returns report (documents) or a returns report (desk rows). Preview first:
 * documents per kind, totals by head, rows refused (unmapped SKU, locked period…), the "file total = documents total"
 * line; then one all-or-nothing import, undone by cancelling its documents.
 */
import { useMemo, useState, type ChangeEvent } from 'react';
import { FileSpreadsheet, RotateCcw } from 'lucide-react';
import { mT } from '../../i18n/areas/packs-marketplace-r5';
import { SALES_FIELDS, SALES_PRESETS, SUMMARY_SUGGEST_ROWS, applySalesImport, liveSalesContext, loadImports, planSalesImport, undoSalesImport, type SalesPresetId } from '../../lib/marketplace/sales-import';
import { RETURNS_PRESETS, addReturns, loadReturns, planReturnsImport } from '../../lib/marketplace/returns-desk';
import { guessColumns, toSavedMapping, type ColumnMap } from '../../lib/marketplace/file-map';
import { patchChannel } from '../../lib/marketplace/channels';
import { peekTable } from '../../lib/storage';
import type { InvoiceRecord } from '../../types/invoice';
import { ChannelPicker } from './ChannelsPanel';
import { errText, fmtMoney, readFileTables, type NamedTable, type PanelProps } from './file-read';
import type { Unmapped } from './MarketplaceTab';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './marketplace.module.css';

const SHOW = 12;

function Notes({ rows, tone }: { rows: { line: number; message: string }[]; tone: string }) {
  if (!rows.length) return null;
  return (
    <ul className={`${styles.list} ${tone}`}>
      {rows.slice(0, SHOW).map((r, i) => <li key={`${r.line}-${i}`}>{mT('rowsLine', { line: r.line, message: r.message })}</li>)}
      {rows.length > SHOW && <li>{mT('moreRows', { n: rows.length - SHOW })}</li>}
    </ul>
  );
}

export function ImportPanel(props: PanelProps & { onUnmapped: (u: Unmapped) => void }) {
  const { channel, notify, refresh, onUnmapped } = props;
  const [kind, setKind] = useState<'sales' | 'returns'>('sales');
  const [preset, setPreset] = useState<string>('amazon_mtr_b2c');
  const [tables, setTables] = useState<NamedTable[]>([]);
  const [sheet, setSheet] = useState(0);
  const [fileName, setFileName] = useState('');
  const [cols, setCols] = useState<ColumnMap>(new Map());
  const [summary, setSummary] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const table = tables[sheet]?.table;

  const plan = useMemo(() => {
    if (!channel || !table || kind !== 'sales') return null;
    try {
      return planSalesImport(table, cols, preset, liveSalesContext(channel, fileName), { summary });
    } catch {
      return null;
    }
  }, [channel, table, cols, preset, summary, kind, fileName, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const retPlan = useMemo(() => (channel && table && kind === 'returns' ? planReturnsImport(table, channel, loadReturns(channel.id), peekTable<InvoiceRecord>('invoices')) : null), [channel, table, kind, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const history = useMemo(() => (channel ? loadImports(channel.id).filter((i) => i.kind === 'sales').slice(-10).reverse() : []), [channel, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!channel) return <ChannelPicker {...props} />;

  const pickTable = (list: NamedTable[], idx: number) => {
    setSheet(idx);
    const t = list[idx]?.table;
    if (t) setCols(guessColumns(t.headers, SALES_FIELDS, channel.presets?.sales?.preset === preset ? channel.presets.sales : undefined));
  };
  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBusy(true);
    try {
      const list = await readFileTables(file);
      setTables(list);
      setFileName(file.name);
      pickTable(list, 0);
      const rows = list[0]?.table.rows.length ?? 0;
      setSummary(rows > SUMMARY_SUGGEST_ROWS);
    } catch (err) {
      notify(errText(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  const doImport = () => {
    if (!table) return;
    try {
      if (kind === 'returns' && retPlan) {
        addReturns(retPlan.rows);
        notify(mT('deskAdded', { n: retPlan.rows.length, already: retPlan.already }));
      } else if (plan) {
        const res = applySalesImport(channel, plan, fileName);
        patchChannel(channel.id, { presets: { ...(channel.presets ?? {}), sales: toSavedMapping(preset, table.headers, cols) } });
        onUnmapped(plan.unmapped);
        notify(mT('imported', { n: res.saved.length }));
      }
      setTables([]);
      setTick((n) => n + 1);
      refresh();
    } catch (err) {
      notify(errText(err), 'error');
    }
  };
  const undo = (id: string) => {
    if (!window.confirm(mT('undoConfirm'))) return;
    try {
      undoSalesImport(id);
      setTick((n) => n + 1);
      notify(mT('done'));
    } catch (err) {
      notify(errText(err), 'error');
    }
  };
  const presets: readonly string[] = kind === 'sales' ? SALES_PRESETS.map((p) => p.id) : RETURNS_PRESETS;

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <ChannelPicker {...props} />
        <label className={controls.field}><span className={controls.label}>{mT('impKind')}</span>
          <select className={controls.select} value={kind} onChange={(e) => { const k = e.target.value as 'sales' | 'returns'; setKind(k); setPreset(k === 'sales' ? 'amazon_mtr_b2c' : 'amazon_returns'); }}>
            <option value="sales">{mT('impKind.sales')}</option>
            <option value="returns">{mT('impKind.returns')}</option>
          </select></label>
        <label className={controls.field}><span className={controls.label}>{mT('preset')}</span>
          <select className={controls.select} value={preset} onChange={(e) => setPreset(e.target.value as SalesPresetId)} data-mkt-preset>
            {presets.map((p) => <option key={p} value={p}>{mT(`preset.${p}` as Parameters<typeof mT>[0])}</option>)}
          </select></label>
        <label className={`${controls.btn} ${controls.btnOutline}`}>
          <FileSpreadsheet size={16} aria-hidden="true" /> {mT('file')}
          <input type="file" accept=".csv,.txt,.xlsx,.xlsm" hidden onChange={onFile} disabled={busy} data-mkt-sales-file />
        </label>
        {tables.length > 1 && (
          <label className={controls.field}><span className={controls.label}>{mT('sheet')}</span>
            <select className={controls.select} value={sheet} onChange={(e) => pickTable(tables, Number(e.target.value))}>
              {tables.map((t, i) => <option key={t.name} value={i}>{t.name}</option>)}
            </select></label>
        )}
      </div>

      {table && kind === 'sales' && (
        <details>
          <summary>{mT('mapping')}</summary>
          <div className={styles.grid}>
            {Object.keys(SALES_FIELDS).map((f) => (
              <label key={f} className={controls.field}><span className={controls.label}>{f}</span>
                <select className={controls.select} value={cols.get(f) ?? ''} onChange={(e) => { const next = new Map(cols); if (e.target.value === '') next.delete(f); else next.set(f, Number(e.target.value)); setCols(next); }}>
                  <option value="">{mT('notInFile')}</option>
                  {table.headers.map((h, i) => <option key={i} value={i}>{h}</option>)}
                </select></label>
            ))}
          </div>
        </details>
      )}

      {plan && (
        <section aria-label={mT('preview')}>
          <label className={controls.check}><input type="checkbox" checked={summary} onChange={(e) => setSummary(e.target.checked)} /> {mT('summaryMode')}</label>
          {plan.rows.length > SUMMARY_SUGGEST_ROWS && <p className={styles.warn}>{mT('summaryHint', { n: plan.rows.length })}</p>}
          <p data-mkt-preview><strong>{mT('impDocs', { inv: plan.counts.invoices, cn: plan.counts.creditNotes })}</strong> · {mT('impAlready', { n: plan.counts.already })} · {mT('impCancelled', { n: plan.counts.cancelled })} · <span className={plan.counts.errors ? styles.bad : ''}>{mT('impErrors', { n: plan.counts.errors })}</span></p>
          <p className={styles.note}>{mT('impTotals', { taxable: fmtMoney(plan.totals.taxable), igst: fmtMoney(plan.totals.igst), cgst: fmtMoney(plan.totals.cgst), sgst: fmtMoney(plan.totals.sgst), total: fmtMoney(plan.totals.total) })}</p>
          <p className={plan.reconciled ? styles.good : styles.bad}>{mT(plan.reconciled ? 'reconOk' : 'reconBad', { file: fmtMoney(plan.fileTotal), docs: fmtMoney(plan.docsTotal) })}</p>
          <Notes rows={plan.errors} tone={styles.bad} />
          <Notes rows={plan.warnings} tone={styles.warn} />
          <Notes rows={plan.skipped} tone={styles.note} />
          <p className={styles.note}>{mT('einvNote')}</p>
          <button type="button" className={`${controls.btn} ${controls.btnPrimary}`} onClick={doImport} disabled={!plan.docs.length} data-mkt-sales-import>{mT('importNow')}</button>
        </section>
      )}
      {retPlan && (
        <section>
          <p>{mT('deskAdded', { n: retPlan.rows.length, already: retPlan.already })}</p>
          <button type="button" className={`${controls.btn} ${controls.btnPrimary}`} onClick={doImport} disabled={!retPlan.rows.length}>{mT('importNow')}</button>
        </section>
      )}

      {history.length > 0 && (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <caption>{mT('history')}</caption>
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>{h.imported_at.slice(0, 10)}</td>
                  <td>{h.file_name}</td>
                  <td>{h.period_from ?? ''} – {h.period_to ?? ''}</td>
                  <td className={surface.numeric}>{h.doc_ids?.length ?? 0}</td>
                  <td>{h.undone_at ? mT('undone') : (
                    <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={() => undo(h.id)}><RotateCcw size={14} aria-hidden="true" /> {mT('undo')}</button>
                  )}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

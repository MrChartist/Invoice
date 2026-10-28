import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardCheck } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { cn, formatDate, todayInput } from '../../lib/utils';
import { num } from '../../lib/invoice-calc';
import { getTable } from '../../lib/storage';
import { can, currentActor } from '../../lib/access';
import { collectEvents } from '../../lib/inventory';
import { transfersDb } from '../../lib/godowns';
import { withTablesRollback } from '../../lib/table-txn';
import { receiptNotesDb, rejectionLinesFromGrn } from '../../lib/receipt-notes';
import { saveConsumeOnlyJournal } from '../../lib/manufacturing';
import { loadQcSettings, qcGodowns, qcResultsDb, qcStock, rejectionFromQc, releaseLines, saveQcSettings, type QcRow } from '../../lib/production/qc';
import type { PurchaseRecord } from '../../types/purchases';
import { debitNotePrefillHref } from '../../lib/purchases';
import { useT } from '../../i18n';
import { pT } from '../../i18n/areas/production-r4';
import { qtyText, type MfgContext } from '../manufacturing/context';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import mfg from '../manufacturing/manufacturing.module.css';
import styles from './production.module.css';

/** /manufacturing?tab=qc — the QC desk (R4-A4): stock in QC godowns with age; release or reject per lot. */
export function QcTab({ ctx }: { ctx: MfgContext }) {
  useT();
  const [acting, setActing] = useState<{ row: QcRow; mode: 'release' | 'reject' } | null>(null);
  const [settings, setSettings] = useState(loadQcSettings);
  const qcIds = useMemo(() => new Set(qcGodowns(ctx.godowns).map((g) => g.id)), [ctx.godowns]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => qcStock(collectEvents({ ...ctx.inputs, includeTransfers: true }), qcIds, todayInput()), [ctx.inputs, qcIds, ctx.version]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const results = useMemo(() => qcResultsDb.all().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 25), [ctx.version]);
  const name = (id: string) => ctx.items.find((i) => i.id === id)?.name ?? '?';
  const owner = can('settings.manage');

  const saveSettings = (next: typeof settings) => {
    try {
      saveQcSettings(next);
      setSettings(loadQcSettings());
      ctx.changed(pT('qcSettingsSaved'));
    } catch (e) {
      ctx.error((e as Error).message);
    }
  };

  return (
    <>
      <p className={mfg.muted} style={{ margin: '0 0 0.75rem' }}>{pT('qcIntro')}</p>
      <section className={styles.panel} aria-label={pT('qcSettings')}>
        <div className={styles.inline}>
          <label className={controls.check}><input type="checkbox" disabled={!owner} checked={settings.hold_all} onChange={(e) => saveSettings({ ...settings, hold_all: e.target.checked })} /> {pT('holdAll')}</label>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="qc-days">{pT('alertDays')}</label>
            <input id="qc-days" className={cn(controls.input, controls.inputNumeric)} inputMode="numeric" disabled={!owner} defaultValue={String(settings.alert_days)} onBlur={(e) => num(e.target.value) > 0 && num(e.target.value) !== settings.alert_days && saveSettings({ ...settings, alert_days: num(e.target.value) })} />
          </div>
        </div>
        <span className={mfg.muted}>{pT('qcItemHint')}</span>
      </section>
      {qcIds.size === 0 ? <p className={mfg.muted} style={{ marginTop: '0.75rem' }}>{pT('noQcGodown')}</p> : (
        <div className={surface.tableWrap} style={{ marginTop: '0.75rem' }}>
          <table className={surface.table} data-testid="qc-table">
            <thead><tr><th>{pT('item')}</th><th>{pT('batch')}</th><th>{pT('godown')}</th><th>{pT('source')}</th><th>{pT('since')}</th><th className={mfg.num}>{pT('age')}</th><th className={mfg.num}>{pT('qty')}</th><th><span className={surface.srOnly}>{pT('actionsCol')}</span></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>{name(r.itemId)}</td>
                  <td>{r.batch || '—'}</td>
                  <td>{ctx.godowns.find((g) => g.id === r.godownId)?.name ?? ''}</td>
                  <td>{pT(`srcKind_${r.source.kind}` as 'srcKind_grn')} {r.source.number ?? ''}{r.source.party ? ` · ${r.source.party}` : ''}</td>
                  <td>{formatDate(r.since)}</td>
                  <td className={cn(mfg.num, r.ageDays > settings.alert_days && styles.adverse)}>{r.ageDays}</td>
                  <td className={mfg.num}>{qtyText(r.qty)}</td>
                  <td className={surface.rowActions}>
                    {ctx.canBooks && (
                      <>
                        <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={() => setActing({ row: r, mode: 'release' })}>{pT('release')}</button>
                        <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => setActing({ row: r, mode: 'reject' })}>{pT('reject')}</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className={mfg.muted}>{pT('qcEmpty')}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {results.length > 0 && (
        <>
          <p className={mfg.section} style={{ margin: '1.25rem 0 0.5rem' }}>{pT('qcResults')}</p>
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <thead><tr><th>{pT('date')}</th><th>{pT('item')}</th><th>{pT('batch')}</th><th className={mfg.num}>{pT('qty')}</th><th>{pT('result')}</th><th>{pT('inspector')}</th><th>{pT('note')}</th></tr></thead>
              <tbody>{results.map((r) => <tr key={r.id}><td>{formatDate(r.date)}</td><td>{name(r.item_id)}</td><td>{r.batch_no ?? '—'}</td><td className={mfg.num}>{qtyText(r.qty)}</td><td className={r.result === 'pass' ? styles.favourable : styles.adverse}>{pT(r.result === 'pass' ? 'pass' : 'fail')}</td><td>{r.inspector ?? '—'}</td><td>{r.note ?? ''}</td></tr>)}</tbody>
            </table>
          </div>
        </>
      )}
      {acting && <QcDecision ctx={ctx} row={acting.row} mode={acting.mode} onClose={() => setActing(null)} />}
    </>
  );
}

function QcDecision({ ctx, row, mode, onClose }: { ctx: MfgContext; row: QcRow; mode: 'release' | 'reject'; onClose: () => void }) {
  const [date, setDate] = useState(todayInput());
  const [qty, setQty] = useState(String(row.qty));
  const [target, setTarget] = useState(ctx.godowns.find((g) => !g.kind)?.id ?? 'main');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const item = ctx.items.find((i) => i.id === row.itemId);
  const inspector = currentActor()?.name;
  // R6-C1: a lot received on a bill (no GRN) → "Debit note to supplier" with the rejected lines filled in.
  const dnHref = useMemo(() => {
    if (mode !== 'reject' || row.source.kind !== 'purchase' || !row.source.id) return '/expenses?tab=returns&new=dn';
    const bill = getTable<PurchaseRecord>('purchases').find((p) => p.id === row.source.id);
    if (!bill) return '/expenses?tab=returns&new=dn';
    return debitNotePrefillHref(bill.id, rejectionFromQc(bill.lines ?? [], row, num(qty), item?.name ?? ''));
  }, [mode, row, qty, item?.name]);
  const base = { date, item_id: row.itemId, ...(row.batch ? { batch_no: row.batch } : {}), godown_id: row.godownId, source: { kind: row.source.kind, ...(row.source.id ? { id: row.source.id } : {}), ...(row.source.number ? { number: row.source.number } : {}) }, qty: num(qty), ...(note.trim() ? { note: note.trim() } : {}), ...(inspector ? { inspector } : {}) };

  const submit = () => {
    try {
      if (!(num(qty) > 0) || num(qty) > row.qty + 1e-9) throw new Error(pT('qtyRange', { max: qtyText(row.qty) }));
      if (mode === 'release') {
        const t = withTablesRollback(['stock_transfers', 'series_counters', 'qc_results'], () => {
          const tr = transfersDb.save({ date, from_godown: row.godownId, to_godown: target, lines: releaseLines(row, num(qty)), notes: pT('releaseNote') });
          qcResultsDb.save({ ...base, result: 'pass', transfer_id: tr.id });
          return tr;
        });
        onClose();
        return ctx.changed(pT('releasedMsg', { number: t.transfer_number }));
      }
      if (row.source.kind === 'grn' && row.source.id) {
        const grn = receiptNotesDb.get(row.source.id);
        if (!grn) throw new Error(pT('sourceGone'));
        const purchases = getTable<PurchaseRecord>('purchases');
        const lines = rejectionFromQc(rejectionLinesFromGrn(grn, purchases, receiptNotesDb.all()), row, num(qty), item?.name ?? '');
        if (!lines.length) throw new Error(pT('nothingRejectable'));
        const rjo = withTablesRollback(['receipt_notes', 'series_counters', 'qc_results'], () => {
          const r = receiptNotesDb.save({ kind: 'REJECTION_OUT', grn_id: grn.id, vendor_id: grn.vendor_id, vendor_name: grn.vendor_name, vendor_gstin: grn.vendor_gstin, date, lines, notes: pT('rejectNote') }, purchases);
          qcResultsDb.save({ ...base, result: 'fail', return_id: r.id });
          return r;
        });
        onClose();
        return ctx.changed(pT('rejectedMsg', { number: rjo.number }));
      }
      if (row.source.kind === 'manufacturing' || row.source.kind === 'transfer' || row.source.kind === 'other') {
        const j = withTablesRollback(['stock_journals', 'series_counters', 'qc_results'], () => {
          const sj = saveConsumeOnlyJournal({ date, consume: releaseLines(row, num(qty)).map((l) => ({ ...l, godown_id: row.godownId })), narration: `${pT('scrapNote')}${note.trim() ? ` — ${note.trim()}` : ''}` }, ctx.items, ctx.inputs);
          qcResultsDb.save({ ...base, result: 'fail', return_id: sj.id });
          return sj;
        });
        onClose();
        return ctx.changed(pT('scrappedMsg', { number: j.number }));
      }
      qcResultsDb.save({ ...base, result: 'fail' });
      onClose();
      ctx.changed(pT('failLogged'));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal open onClose={onClose} size="md" title={`${pT(mode === 'release' ? 'release' : 'reject')} · ${item?.name ?? ''}${row.batch ? ` (${row.batch})` : ''}`}
      footer={<><button type="button" className={controls.btnOutline} onClick={onClose}>{pT('cancel')}</button><button type="button" className={controls.btnPrimary} onClick={submit}><ClipboardCheck size={16} aria-hidden="true" /> {pT(mode === 'release' ? 'release' : 'reject')}</button></>}>
      <div className={mfg.form}>
        <div className={controls.row}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="qc-date">{pT('date')}</label>
            <input id="qc-date" type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="qc-qty">{pT('qty')} ({item?.unit ?? ''})</label>
            <input id="qc-qty" className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>
        </div>
        {mode === 'release' && (
          <div className={controls.field}>
            <label className={controls.label} htmlFor="qc-target">{pT('releaseTo')}</label>
            <select id="qc-target" className={controls.select} value={target} onChange={(e) => setTarget(e.target.value)}>
              {ctx.godowns.filter((g) => g.kind !== 'qc' && g.kind !== 'transit' && g.kind !== 'wip').map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
        )}
        {mode === 'reject' && (
          <p className={mfg.muted}>
            {row.source.kind === 'grn' ? pT('rejectGrnHint') : row.source.kind === 'purchase' ? <>{pT('rejectBillHint')} <Link to={dnHref} data-testid="qc-debit-note">{pT('openDebitNote')}</Link></> : pT('rejectScrapHint')}
          </p>
        )}
        <div className={controls.field}>
          <label className={controls.label} htmlFor="qc-note">{pT('note')}</label>
          <input id="qc-note" className={controls.input} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && <p className={cn(mfg.notice, mfg.danger)} role="alert">{error}</p>}
      </div>
    </Modal>
  );
}

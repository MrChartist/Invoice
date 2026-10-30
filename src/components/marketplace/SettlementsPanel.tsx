/**
 * R5-A4: settlement import (sheets read together; unknown descriptions mapped once), the list with Post / Unpost /
 * fee invoice, the clearing balance per settlement and in total, and the per-order reconciliation with a CSV export.
 */
import { useMemo, useState, type ChangeEvent } from 'react';
import { Download, FileUp, Scale } from 'lucide-react';
import { mT } from '../../i18n/areas/packs-marketplace-r5';
import { BUCKETS, SETTLEMENT_PRESETS, deleteSettlement, importSettlement, loadSettlements, parseSettlement, rebucket, type SettlementPresetId } from '../../lib/marketplace/settlement-import';
import { clearingBalance, deleteFeeInvoice, postSettlement, recordFeeInvoice, settlementClearing, unpostSettlement } from '../../lib/marketplace/settlement-post';
import { ORDER_STATUSES, orderReconCsv, reconcileOrders, statusCounts, type OrderStatus } from '../../lib/marketplace/settlement-recon';
import { patchChannel } from '../../lib/marketplace/channels';
import { DEFAULT_BANK_ID, pickableBankAccounts } from '../../lib/bank-accounts';
import { peekTable } from '../../lib/storage';
import { sectionText } from '../../lib/ita2025';
import type { InvoiceRecord } from '../../types/invoice';
import type { BucketRule, SettlementBucket } from '../../types/marketplace-r5';
import { downloadTextFile } from '../receivables/exportUtils';
import { ChannelPicker } from './ChannelsPanel';
import { errText, fmtMoney, readFileTables, today, type NamedTable, type PanelProps } from './file-read';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './marketplace.module.css';

export function SettlementsPanel(props: PanelProps) {
  const { channel, notify, refresh } = props;
  const [preset, setPreset] = useState<SettlementPresetId>('amazon_v2');
  const [tables, setTables] = useState<NamedTable[]>([]);
  // File text (sheet names, descriptions) is never used as a plain-object key: Maps only.
  const [picked, setPicked] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [fileName, setFileName] = useState('');
  const [typed, setTyped] = useState({ id: '', date: '', payout: '' });
  const [teach, setTeach] = useState<ReadonlyMap<string, SettlementBucket>>(new Map());
  const [tick, setTick] = useState(0);
  const [feeInv, setFeeInv] = useState(false);
  const banks = useMemo(() => pickableBankAccounts('payout'), []); // QA17 R5: never a client-money account
  const [bankId, setBankId] = useState(DEFAULT_BANK_ID);
  const [filter, setFilter] = useState<OrderStatus | 'all'>('all');
  const [feeBill, setFeeBill] = useState<{ id: string; no: string; date: string; sac: string } | null>(null);

  const parsed = useMemo(() => {
    if (!channel || !tables.length) return null;
    const sheets = tables.filter((t) => picked.get(t.name) !== false).map((t) => ({ name: t.name, table: t.table }));
    return parseSettlement(sheets, preset, {
      rules: channel.bucket_map ?? [],
      ...(typed.payout.trim() ? { payout: Number(typed.payout) } : {}),
      ...(typed.date ? { deposit_date: typed.date } : {}),
      ...(typed.id.trim() ? { settlement_id: typed.id.trim() } : {}),
    });
  }, [channel, tables, picked, preset, typed]);
  const list = useMemo(() => (channel ? [...loadSettlements(channel.id)].sort((a, b) => b.deposit_date.localeCompare(a.deposit_date)) : []), [channel, tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const orders = useMemo(() => (channel ? reconcileOrders(channel, peekTable<InvoiceRecord>('invoices'), list, { today: today() }) : []), [channel, list]);
  const counts = useMemo(() => statusCounts(orders), [orders]);
  if (!channel) return <ChannelPicker {...props} />;
  const bump = () => { setTick((n) => n + 1); refresh(); };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      setTables(await readFileTables(file));
      setFileName(file.name);
      setPicked(new Map());
    } catch (err) {
      notify(errText(err), 'error');
    }
  };
  const saveRules = () => {
    const rules: BucketRule[] = [...(channel.bucket_map ?? []), ...[...teach].filter(([, b]) => b !== 'other').map(([match, bucket]) => ({ match, bucket }))];
    try {
      patchChannel(channel.id, { bucket_map: rules });
      setTeach(new Map());
      refresh();
    } catch (err) {
      notify(errText(err), 'error');
    }
  };
  const doImport = () => {
    if (!parsed) return;
    try {
      const fixed = rebucket(parsed, channel.bucket_map ?? []);
      const s = importSettlement(channel, fixed, fileName);
      notify(mT('stImported', { id: s.settlement_id }));
      setTables([]);
      setTyped({ id: '', date: '', payout: '' });
      bump();
    } catch (err) {
      notify(errText(err), 'error');
    }
  };
  const act = (fn: () => unknown) => {
    try {
      fn();
      notify(mT('done'));
      bump();
    } catch (err) {
      notify(errText(err), 'error');
    }
  };
  const shown = filter === 'all' ? orders : orders.filter((o) => o.status === filter);

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <ChannelPicker {...props} />
        <label className={controls.field}><span className={controls.label}>{mT('preset')}</span>
          <select className={controls.select} value={preset} onChange={(e) => setPreset(e.target.value as SettlementPresetId)}>
            {SETTLEMENT_PRESETS.map((p) => <option key={p.id} value={p.id}>{mT(`preset.${p.id}`)}</option>)}
          </select></label>
        <label className={`${controls.btn} ${controls.btnOutline}`}>
          <FileUp size={16} aria-hidden="true" /> {mT('stImport')}
          <input type="file" accept=".csv,.txt,.tsv,.xlsx,.xlsm" hidden onChange={onFile} data-mkt-settlement-file />
        </label>
      </div>

      {parsed && (
        <section>
          {tables.length > 1 && (
            <fieldset className={styles.toolbar}><legend className={controls.label}>{mT('sheets')}</legend>
              {tables.map((t) => <label key={t.name} className={controls.check}><input type="checkbox" checked={picked.get(t.name) !== false} onChange={(e) => setPicked(new Map(picked).set(t.name, e.target.checked))} /> {t.name}</label>)}
            </fieldset>
          )}
          <div className={styles.grid}>
            <label className={controls.field}><span className={controls.label}>{mT('stId')}</span>
              <input className={controls.input} value={typed.id || parsed.settlement_id} onChange={(e) => setTyped({ ...typed, id: e.target.value })} /></label>
            <label className={controls.field}><span className={controls.label}>{mT('stDeposit')}</span>
              <input type="date" className={controls.input} value={typed.date || parsed.deposit_date} onChange={(e) => setTyped({ ...typed, date: e.target.value })} /></label>
            <label className={controls.field}><span className={controls.label}>{mT('stPayout')}</span>
              <input className={controls.input} inputMode="decimal" value={typed.payout || String(parsed.payout)} onChange={(e) => setTyped({ ...typed, payout: e.target.value })} /></label>
          </div>
          <p className={Math.abs(parsed.difference) < 0.005 ? styles.good : styles.bad} data-mkt-settlement-check>
            {mT('stLines')} {fmtMoney(parsed.lines.reduce((s, l) => s + l.amount, 0))} · {mT('stPayout')} {fmtMoney(parsed.payout)} · {mT('stDiff')} {fmtMoney(parsed.difference)}
          </p>
          {parsed.problems.map((p) => <p key={p} className={styles.warn}>{p}</p>)}
          {parsed.unknown.length > 0 && (
            <div>
              <h4>{mT('stUnknown')}</h4>
              {parsed.unknown.slice(0, 20).map((d) => (
                <label key={d} className={styles.inline}>{d}
                  <select className={controls.select} value={teach.get(d) ?? 'other'} onChange={(e) => setTeach(new Map(teach).set(d, e.target.value as SettlementBucket))}>
                    {BUCKETS.map((b) => <option key={b} value={b}>{mT(`bucket.${b}`)}</option>)}
                  </select></label>
              ))}
              <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={saveRules}>{mT('stApplyRules')}</button>
            </div>
          )}
          <button type="button" className={`${controls.btn} ${controls.btnPrimary}`} onClick={doImport} disabled={parsed.problems.length > 0} data-mkt-settlement-import>{mT('importNow')}</button>
        </section>
      )}

      <div className={styles.toolbar}>
        <label className={controls.check}><input type="checkbox" checked={feeInv} onChange={(e) => setFeeInv(e.target.checked)} /> {mT('stFeeInv')}</label>
        <label className={controls.field}><span className={controls.label}>{mT('stBank')}</span>
          <select className={controls.select} value={bankId} onChange={(e) => setBankId(e.target.value)}>
            {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select></label>
        <span data-mkt-clearing-total><Scale size={14} aria-hidden="true" /> {mT('stClearingTotal')}: <strong>{fmtMoney(clearingBalance(channel.clearing_bank_id))}</strong></span>
      </div>
      {list.length === 0 ? <p className={styles.note}>{mT('stEmpty')}</p> : (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th>{mT('stId')}</th><th>{mT('stDeposit')}</th><th className={surface.numeric}>{mT('stPayout')}</th><th>{mT('status')}</th><th className={surface.numeric}>{mT('stClearingAfter')}</th><th /></tr></thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id}>
                  <td className={surface.mono}>{s.settlement_id}</td>
                  <td>{s.deposit_date}</td>
                  <td className={surface.numeric}>{fmtMoney(s.payout)}</td>
                  <td>{s.posted ? mT('stPosted') : mT('stNotPosted')}</td>
                  <td className={surface.numeric}>{s.posted ? fmtMoney(settlementClearing(s)) : '-'}</td>
                  <td className={surface.rowActions}>
                    {!s.posted && <button type="button" className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`} onClick={() => act(() => postSettlement(s.id, { feeInvoiceReceived: feeInv, bankAccountId: bankId }))} data-mkt-post>{mT('stPost')}</button>}
                    {!s.posted && <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={() => act(() => deleteSettlement(s.id))}>{mT('stDelete')}</button>}
                    {s.posted && !s.fee_invoice_id && <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={() => act(() => unpostSettlement(s.id))}>{mT('stUnpost')}</button>}
                    {s.posted && !s.posted.fee_invoice_received && !s.fee_invoice_id && <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={() => setFeeBill({ id: s.id, no: '', date: s.deposit_date, sac: '9985' })}>{mT('stFeeBill')}</button>}
                    {s.fee_invoice_id && <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={() => act(() => deleteFeeInvoice(s.id))}>{mT('remove')} · {mT('stFeeBill')}</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {feeBill && (
        <div className={styles.toolbar}>
          <label className={controls.field}><span className={controls.label}>{mT('stFeeBillNo')}</span><input className={controls.input} value={feeBill.no} onChange={(e) => setFeeBill({ ...feeBill, no: e.target.value })} /></label>
          <label className={controls.field}><span className={controls.label}>{mT('date')}</span><input type="date" className={controls.input} value={feeBill.date} onChange={(e) => setFeeBill({ ...feeBill, date: e.target.value })} /></label>
          <label className={controls.field}><span className={controls.label}>{mT('stFeeSac')}</span>
            <select className={controls.select} value={feeBill.sac} onChange={(e) => setFeeBill({ ...feeBill, sac: e.target.value })}><option value="9985">9985</option><option value="9967">9967</option></select></label>
          <button type="button" className={`${controls.btn} ${controls.btnPrimary}`} onClick={() => act(() => { recordFeeInvoice(feeBill.id, { bill_number: feeBill.no, date: feeBill.date, hsn: feeBill.sac }); setFeeBill(null); })}>{mT('save')}</button>
          <button type="button" className={`${controls.btn} ${controls.btnOutline}`} onClick={() => setFeeBill(null)}>{mT('cancel')}</button>
        </div>
      )}

      <section>
        <div className={styles.toolbar}>
          <h4>{mT('stOrders')}</h4>
          <label className={controls.field}><span className={controls.label}>{mT('stFilter')}</span>
            <select className={controls.select} value={filter} onChange={(e) => setFilter(e.target.value as OrderStatus | 'all')}>
              <option value="all">{mT('all')} ({orders.length})</option>
              {ORDER_STATUSES.map((s) => <option key={s} value={s}>{mT(`os.${s}`)} ({counts[s]})</option>)}
            </select></label>
          <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => downloadTextFile(`marketplace_orders_${channel.name}_${today()}.csv`, orderReconCsv(shown))}><Download size={14} aria-hidden="true" /> {mT('exportCsv')}</button>
        </div>
        {shown.length > 0 && (
          <div className={surface.tableWrap}>
            <table className={surface.table}>
              <thead><tr><th>{mT('orderId')}</th><th>{mT('date')}</th><th className={surface.numeric}>{mT('colInvoice')}</th><th className={surface.numeric}>{mT('colSale')}</th><th className={surface.numeric}>{mT('colFees')}</th><th className={surface.numeric}>{mT('colTcs')}</th><th className={surface.numeric}>{mT('colTds')} {sectionText('194O', today())}</th><th className={surface.numeric}>{mT('colNet')}</th><th className={surface.numeric}>{mT('colPct')}</th><th>{mT('status')}</th></tr></thead>
              <tbody>
                {shown.slice(0, 300).map((o) => (
                  <tr key={o.order_id}>
                    <td className={surface.mono}>{o.order_id}</td><td>{o.date}</td>
                    <td className={surface.numeric}>{fmtMoney(o.invoice_value)}</td><td className={surface.numeric}>{fmtMoney(o.sale)}</td>
                    <td className={surface.numeric}>{fmtMoney(o.fees + o.gst_on_fees)}</td><td className={surface.numeric}>{fmtMoney(o.tcs)}</td>
                    <td className={surface.numeric}>{fmtMoney(o.tds)}</td><td className={surface.numeric}>{fmtMoney(o.net)}</td>
                    <td className={surface.numeric}>{o.settled_pct ?? '-'}</td><td>{mT(`os.${o.status}`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

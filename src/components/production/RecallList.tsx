import { useMemo, useRef, useState } from 'react';
import { Download, Printer, ShieldAlert } from 'lucide-react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { cn, formatDate, todayInput } from '../../lib/utils';
import { generateId, getTable } from '../../lib/storage';
import { toCsv } from '../../lib/csv';
import { downloadText } from '../../lib/download';
import { computeTracking } from '../../lib/stock-tracking';
import { nonSaleableGodowns, transfersDb } from '../../lib/godowns';
import { withTablesRollback } from '../../lib/table-txn';
import { blockBatchTransfers, recallCsvRows, recallList, recallMessageLinks, recallNoticesDb, type ForwardResult } from '../../lib/production/genealogy';
import { ensureQcGodown } from '../../lib/production/qc';
import type { InvoiceRecord } from '../../types/invoice';
import type { Client } from '../../types/invoice';
import { pT } from '../../i18n/areas/production-r4';
import { qtyText, type MfgContext } from '../manufacturing/context';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import mfg from '../manufacturing/manufacturing.module.css';
import styles from './production.module.css';

/**
 * Recall list of a forward trace: customers with documents, quantities, returns and contact details; CSV, a printable
 * A4 notice (html-to-image + jspdf, the existing PDF path), "Message all" links opened one by one (nothing is sent from
 * the app), "Block batch" (move the batches into the QC hold godown) and a log of who was told.
 */
export function RecallList({ ctx, forward }: { ctx: MfgContext; forward: ForwardResult }) {
  const paper = useRef<HTMLDivElement>(null);
  const [note, setNote] = useState('');
  const [told, setTold] = useState<Set<string>>(new Set());
  const [blocking, setBlocking] = useState(false);
  const rows = useMemo(() => {
    const invoices = new Map(getTable<InvoiceRecord>('invoices').map((d) => [d.id, d]));
    const clients = getTable<Client>('clients');
    return recallList(forward, (party, refId) => {
      const c = invoices.get(refId)?.client;
      const master = clients.find((x) => (x.name ?? '').trim().toLowerCase() === party.trim().toLowerCase());
      const phone = c?.phone || master?.phone;
      const email = c?.email || master?.email;
      return { ...(phone ? { phone } : {}), ...(email ? { email } : {}) };
    });
  }, [forward]);
  const name = (id: string) => ctx.items.find((i) => i.id === id)?.name ?? '?';
  const start = forward.batches[0];
  const message = pT('recallText', { item: start ? name(start.itemId) : '', batch: start?.batch ?? '', note: note.trim() });
  if (!forward.batches.length) return null;

  const pdf = async () => {
    if (!paper.current) return;
    try {
      const { exportNodeToPdf } = await import('../receivables/exportUtils');
      await exportNodeToPdf(paper.current, `recall-notice-${todayInput()}.pdf`);
    } catch (e) {
      ctx.error((e as Error).message);
    }
  };
  const log = () => {
    try {
      recallNoticesDb.save({ date: todayInput(), batch_keys: forward.batches.map((b) => `${b.itemId}|${b.batch.toUpperCase()}`), note: note.trim() || undefined, notified: [...told].map((party) => ({ party, at: new Date().toISOString() })) });
      ctx.changed(pT('recallLogged', { n: told.size }));
    } catch (e) {
      ctx.error((e as Error).message);
    }
  };
  const block = () => {
    try {
      const qc = ensureQcGodown();
      const godowns = [...ctx.godowns, qc];
      const drafts = blockBatchTransfers(computeTracking(ctx.inputs), forward.batches, nonSaleableGodowns(godowns), qc.id, generateId);
      if (!drafts.length) return ctx.error(pT('nothingToBlock'));
      const saved = withTablesRollback(['stock_transfers', 'series_counters'], () => drafts.map((d) => transfersDb.save({ date: todayInput(), ...d, notes: pT('blockNote') })));
      ctx.changed(pT('blocked', { numbers: saved.map((t) => t.transfer_number).join(', ') }));
    } catch (e) {
      ctx.error((e as Error).message);
    }
  };

  return (
    <section className={styles.detail} aria-label={pT('recallList')} data-testid="recall-list">
      <div className={styles.detailHead}>
        <h3 className={styles.detailTitle}>{pT('recallList')} · {rows.length}</h3>
        <span className={styles.actions}>
          <button type="button" className={cn(controls.btnOutline, controls.btnSm)} disabled={!rows.length} onClick={() => downloadText(`recall-${todayInput()}.csv`, toCsv(recallCsvRows(rows, name)), 'text/csv')}><Download size={14} aria-hidden="true" /> CSV</button>
          <button type="button" className={cn(controls.btnOutline, controls.btnSm)} disabled={!rows.length} onClick={() => void pdf()}><Printer size={14} aria-hidden="true" /> {pT('printNotice')}</button>
          {ctx.canBooks && <button type="button" className={cn(controls.btnDanger, controls.btnSm)} onClick={() => setBlocking(true)}><ShieldAlert size={14} aria-hidden="true" /> {pT('blockBatch')}</button>}
        </span>
      </div>
      <div className={controls.field}>
        <label className={controls.label} htmlFor="recall-note">{pT('recallNote')}</label>
        <input id="recall-note" className={controls.input} value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead><tr><th>{pT('customer')}</th><th>{pT('contact')}</th><th>{pT('documents')}</th><th className={mfg.num}>{pT('qty')}</th><th className={mfg.num}>{pT('returnedQty')}</th><th>{pT('messageAll')}</th></tr></thead>
          <tbody>
            {rows.map((r) => {
              const links = recallMessageLinks(r, message);
              const mark = () => setTold((s) => new Set(s).add(r.party));
              return (
                <tr key={r.party}>
                  <td>{r.party}{told.has(r.party) ? ` ✓` : ''}</td>
                  <td>{[r.phone, r.email].filter(Boolean).join(' · ') || '-'}</td>
                  <td>{r.docs.map((d) => `${d.refNumber} (${formatDate(d.date)}, ${d.batch} × ${qtyText(d.qty)})`).join('; ')}</td>
                  <td className={mfg.num}>{qtyText(r.qty)}</td>
                  <td className={mfg.num}>{qtyText(r.returned)}</td>
                  <td>
                    <span className={styles.links}>
                      {links.whatsapp && <a className={cn(controls.btnGhost, controls.btnSm)} href={links.whatsapp} target="_blank" rel="noreferrer" onClick={mark}>WhatsApp</a>}
                      {links.mail && <a className={cn(controls.btnGhost, controls.btnSm)} href={links.mail} onClick={mark}>{pT('email')}</a>}
                      {!links.whatsapp && !links.mail && <span className={mfg.muted}>-</span>}
                    </span>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={6} className={mfg.muted}>{pT('noCustomers')}</td></tr>}
          </tbody>
        </table>
      </div>
      {ctx.canBooks && rows.length > 0 && <div><button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={log}>{pT('logRecall')}</button></div>}
      <p className={mfg.muted}>{pT('recallCa')}</p>

      <div ref={paper} className={styles.paper} aria-hidden="true">
        <h2>{pT('noticeTitle')}</h2>
        <p>{pT('date')}: {formatDate(todayInput())}</p>
        <p>{message}</p>
        <table>
          <thead><tr><th>{pT('item')}</th><th>{pT('batch')}</th></tr></thead>
          <tbody>{forward.batches.map((b) => <tr key={`${b.itemId}|${b.batch}`}><td>{name(b.itemId)}</td><td>{b.batch}</td></tr>)}</tbody>
        </table>
        <table>
          <thead><tr><th>{pT('customer')}</th><th>{pT('documents')}</th><th>{pT('qty')}</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.party}><td>{r.party}</td><td>{r.docs.map((d) => d.refNumber).join(', ')}</td><td>{qtyText(r.qty)}</td></tr>)}</tbody>
        </table>
      </div>
      <ConfirmDialog open={blocking} destructive title={pT('blockBatch')} message={pT('confirmBlock', { n: forward.batches.length })} confirmLabel={pT('blockBatch')}
        onClose={() => setBlocking(false)} onConfirm={() => { setBlocking(false); block(); }} />
    </section>
  );
}

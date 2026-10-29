/**
 * R20-B5: the entry side sheets, one lazy chunk — stock query of a line (Alt+S), party facts (Ctrl+O), tax break-up
 * (Alt+A), edit log (Alt+Q), and the Y / N and cancel-reason asks of Alt+D / Alt+X / PgUp. Each is a `Modal` (modal
 * stack; Esc closes and focus returns to the field that opened it). Reads existing rows only.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Modal } from '../ui/Modal';
import { EditLog } from '../audit/EditLog';
import { useT } from '../../i18n';
import { kbT } from '../../i18n/areas/keys-r20b';
import { keysT } from '../../i18n/areas/keys-r20a';
import { localDb } from '../../lib/localDb';
import { isRevenueDoc } from '../../lib/stats';
import { receivableBalance } from '../../lib/rcm';
import { buildItemIndex, stockDb } from '../../lib/inventory';
import { loadStockQuery } from '../../lib/stock-query';
import { formatCurrency, formatDate, todayInput } from '../../lib/utils';
import type { TaxSlabRow } from '../../lib/invoice-calc';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';

export type EntrySheet =
  | { kind: 'stock'; name: string; hsn?: string; itemId?: string }
  | { kind: 'party'; name: string; id?: string }
  | { kind: 'tax'; slabs: readonly TaxSlabRow[]; cess: number; total: number }
  | { kind: 'log'; id: string; name?: string }
  | { kind: 'ask'; text: string; onYes: () => void }
  | { kind: 'cancel'; label: string; paid: boolean; onDone: (reason: string, ack: boolean) => void };

const m = (n: number) => formatCurrency(n);
const Table = ({ head, rows }: { head: ReactNode[]; rows: ReactNode[][] }) => (
  <div className={surface.tableWrap}>
    <table className={surface.table}>
      <thead><tr>{head.map((h, i) => <th key={i} scope="col">{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
    </table>
  </div>
);

function Stock({ s }: { s: Extract<EntrySheet, { kind: 'stock' }> }) {
  const q = useMemo(() => {
    const id = s.itemId ?? buildItemIndex(stockDb.items()).find(s.name, s.hsn)?.id;
    return id ? loadStockQuery(id, todayInput()) : null;
  }, [s]);
  if (!q) return <p>{kbT('notTracked', { name: s.name })}</p>;
  const rows = (list: typeof q.lastSales) => list.map((r) => [formatDate(r.date), r.ref, r.party, r.qty, m(r.rate)]);
  return (
    <>
      <p data-entry-stock>
        <strong>{kbT('inHand')}: {q.compound || `${q.qty} ${q.item.unit ?? ''}`}</strong> · {kbT('value')} {m(q.value)} · {kbT('avg')} {m(q.avgCost)}
      </p>
      {q.byGodown.length > 1 && <p className={controls.hint}>{q.byGodown.map((g) => `${g.name}: ${g.qty}`).join(' · ')}</p>}
      {(q.pendingSo > 0 || q.pendingPo > 0) && <p className={controls.hint}>{kbT('pending', { so: q.pendingSo, po: q.pendingPo })}</p>}
      {[['lastBuy', q.lastPurchases], ['lastSale', q.lastSales]].map(([k, list]) =>
        (list as typeof q.lastSales).length ? (
          <section key={k as string}>
            <h3 className={controls.label}>{kbT(k as 'lastBuy')}</h3>
            <Table head={['', '', '', '', '']} rows={rows(list as typeof q.lastSales)} />
          </section>
        ) : null,
      )}
    </>
  );
}

function Party({ s }: { s: Extract<EntrySheet, { kind: 'party' }> }) {
  const { docs, due } = useMemo(() => {
    const key = s.name.trim().toLowerCase();
    const mine = localDb.invoices.getAll().filter((d) => (s.id && d.client?.id ? d.client.id === s.id : (d.client?.name ?? '').trim().toLowerCase() === key));
    return {
      docs: [...mine].sort((a, b) => b.issue_date.localeCompare(a.issue_date)).slice(0, 5),
      due: mine.filter(isRevenueDoc).reduce((t, d) => t + receivableBalance(d), 0),
    };
  }, [s]);
  return (
    <>
      <p data-entry-party><strong>{kbT('outstanding')}: {m(due)}</strong></p>
      <h3 className={controls.label}>{kbT('lastBills')}</h3>
      {docs.length ? (
        <Table head={['', '', '', '']} rows={docs.map((d) => [<Link key="l" to={`/invoice/${d.id}`}>{d.invoice_number || '—'}</Link>, formatDate(d.issue_date), d.status, m(d.total)])} />
      ) : <p>{kbT('none')}</p>}
    </>
  );
}

function Cancel({ s, onClose }: { s: Extract<EntrySheet, { kind: 'cancel' }>; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [ack, setAck] = useState(false);
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (reason.trim() && (!s.paid || ack)) { onClose(); s.onDone(reason.trim(), ack); } }}>
      <label className={controls.field}>
        <span className={controls.label}>{kbT('reason')}</span>
        <input className={controls.input} value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus required data-entry-reason />
      </label>
      {s.paid && <label className={controls.check}><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} /> {kbT('paidAck')}</label>}
      <p><button type="submit" className={controls.btnDanger} disabled={!reason.trim() || (s.paid && !ack)}>{keysT('cancel')}</button></p>
    </form>
  );
}

export default function EntrySheets({ sheet, onClose }: { sheet: EntrySheet; onClose: () => void }) {
  useT();
  if (sheet.kind === 'log') return <EditLog open recordId={sheet.id} name={sheet.name} onClose={onClose} />;
  if (sheet.kind === 'ask') {
    const yes = () => { onClose(); sheet.onYes(); };
    return (
      <Modal open onClose={onClose} title={sheet.text} size="sm">
        <div
          className={controls.row}
          onKeyDown={(e) => {
            const k = e.key.toLowerCase();
            if (k === 'y') yes();
            else if (k === 'n') onClose();
            else return;
            e.preventDefault();
          }}
        >
          <button type="button" className={controls.btnDanger} onClick={yes} data-autofocus data-entry-yes>{kbT('yes')}</button>
          <button type="button" className={controls.btnOutline} onClick={onClose}>{kbT('no')}</button>
        </div>
      </Modal>
    );
  }
  const title = sheet.kind === 'stock' ? kbT('stockTitle', { name: sheet.name }) : sheet.kind === 'party' ? kbT('partyTitle', { name: sheet.name }) : sheet.kind === 'cancel' ? kbT('cancelTitle', { label: sheet.label }) : kbT('taxTitle');
  return (
    <Modal open onClose={onClose} title={title} size="md">
      {sheet.kind === 'stock' && <Stock s={sheet} />}
      {sheet.kind === 'party' && <Party s={sheet} />}
      {sheet.kind === 'cancel' && <Cancel s={sheet} onClose={onClose} />}
      {sheet.kind === 'tax' && (sheet.slabs.length ? (
        <>
          <Table
            head={[kbT('rate'), kbT('taxable'), 'CGST', 'SGST', 'IGST', kbT('tax')]}
            rows={sheet.slabs.map((r) => [`${r.rate}%`, m(r.taxable), m(r.cgst), m(r.sgst), m(r.igst), m(r.tax)])}
          />
          <p data-entry-tax>{sheet.cess > 0 && `Cess ${m(sheet.cess)} · `}<strong>{kbT('total')} {m(sheet.total)}</strong></p>
        </>
      ) : <p>{kbT('noTax')}</p>)}
    </Modal>
  );
}

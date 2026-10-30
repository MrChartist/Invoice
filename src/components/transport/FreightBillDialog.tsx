/**
 * R5-B2: "Create freight bill" — to-be-billed LRs (and delivered to-pay LRs) by billing party and person liable,
 * one bill per group; the freight bills already raised with their LR annexure (print / CSV).
 */
import { useMemo, useState } from 'react';
import { Download, ReceiptText } from 'lucide-react';
import { twT } from '../../i18n/areas/packs-transport-works-r5';
import { loadLrs } from '../../lib/transport/consignment-notes';
import { annexureRows, createFreightBills, groupForBills, pickableLrs } from '../../lib/transport/freight-bill';
import { localDb } from '../../lib/localDb';
import { esc } from '../../lib/voucher-print';
import { B, csvDownload, errText, fmtMoney, printHtml, today, type PanelProps } from './shared';
import { F } from './Field';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './transport.module.css';
import { PRINT_FONT, PRINT_FONT_FACE } from '../../lib/print-fonts';
import { DateField } from '../ui/DateField';

export default function FreightBillDialog({ notify, refresh, tick }: PanelProps) {
  const [range, setRange] = useState({ from: '', to: '' });
  const [date, setDate] = useState(today());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const lrs = useMemo(() => loadLrs(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const invoices = useMemo(() => localDb.invoices.getAll(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const clients = useMemo(() => localDb.clients.getAll(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const pickable = pickableLrs(lrs, invoices, range);
  // The preview groups as the bills will be made: liable person for the bill date, origin state for unregistered payers.
  const groups = groupForBills(pickable.filter((l) => picked.has(l.id)), { date, partyOf: (id) => clients.find((c) => c.id === id) });
  const bills = invoices.filter((i) => i.lr_ids?.length && i.status !== 'Cancelled');
  const name = (id: string) => clients.find((c) => c.id === id)?.name ?? '-';
  const toggle = (id: string) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const create = () => {
    try {
      const saved = createFreightBills([...picked], date);
      notify(twT('billsCreated', { n: saved.length, list: saved.map((b) => b.invoice_number).join(', ') }));
      setPicked(new Set());
      refresh();
    } catch (e) {
      notify(errText(e), 'error');
    }
  };
  const annexure = (id: string, kind: 'csv' | 'print') => {
    const bill = bills.find((b) => b.id === id);
    if (!bill) return;
    const rows = annexureRows(lrs.filter((l) => bill.lr_ids!.includes(l.id)));
    if (kind === 'csv') return csvDownload(`${bill.invoice_number.replace(/\//g, '-')}-annexure.csv`, rows);
    const [head, ...body] = rows;
    printHtml(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(bill.invoice_number)}</title><style>${PRINT_FONT_FACE}body{font-family:${PRINT_FONT};font-size:12px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:4px}</style></head><body><h3>Annexure to ${esc(bill.invoice_number)}: consignment notes</h3><table><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table><p>Working paper: verify with your CA.</p></body></html>`, bill.invoice_number);
  };
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <F l={twT('from')}><DateField className={controls.input} value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} /></F>
        <F l={twT('to')}><DateField className={controls.input} value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} /></F>
        <F l={twT('billDate')}><DateField className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} /></F>
      </div>
      {pickable.length === 0 ? <p className={styles.note}>{twT('nothingToBill')}</p> : (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th /><th>{twT('lrNo')}</th><th>{twT('date')}</th><th>{twT('billingParty')}</th><th>{twT('liable')}</th><th>{twT('payBasis')}</th></tr></thead>
            <tbody>
              {pickable.map((l) => (
                <tr key={l.id}>
                  <td><input type="checkbox" checked={picked.has(l.id)} onChange={() => toggle(l.id)} aria-label={l.number} data-fb-pick={l.number} /></td>
                  <td className={surface.mono}>{l.number}</td><td>{l.date}</td>
                  <td>{name(l.billing_party_id || (l.payment_basis === 'to_pay' ? l.consignee_id : l.consignor_id))}</td>
                  <td>{twT(`liable.${l.liable}`)}</td><td>{twT(`pay.${l.payment_basis}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {groups.length > 0 && (
        <div className={styles.box}>
          <ul className={styles.note}>
            {groups.map((g) => <li key={g.key}>{name(g.partyId)} · {twT(`liable.${g.liable}`)} · {g.lrs.length} LR · {fmtMoney(g.amount)}</li>)}
          </ul>
          {groups.length > 1 && <p className={styles.warn}>{twT('splitNote', { n: groups.length })}</p>}
          <div className={styles.toolbar}><button type="button" className={B.p} onClick={create} data-fb-create><ReceiptText size={16} aria-hidden="true" /> {twT('createBills')}</button></div>
        </div>
      )}
      {bills.length > 0 && (
        <section>
          <h4>{twT('freightBills')}</h4>
          <ul className={styles.note}>
            {bills.map((b) => (
              <li key={b.id}>{b.invoice_number} · {b.issue_date} · {b.client?.name} · {fmtMoney(b.total)}{b.reverse_charge ? ` · ${twT('rcm')}` : ''}{' '}
                <button type="button" className={B.gs} onClick={() => annexure(b.id, 'print')}>{twT('annexure')}</button>
                <button type="button" className={B.gs} onClick={() => annexure(b.id, 'csv')}><Download size={14} aria-hidden="true" /> CSV</button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

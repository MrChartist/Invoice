/**
 * RT-A3 Receivables → Deliveries: the board of delivery orders by status, rider and slot; move an order along
 * (delivered + COD records the rider's cash receipt), a returned order's credit note, a printable run sheet per rider,
 * the `wa.me` "out for delivery" link (the user taps it), the riders master and the rider cash settlement.
 */
import { useMemo, useState } from 'react';
import { Printer, Truck } from 'lucide-react';
import { useT } from '../../i18n';
import { rtaT } from '../../i18n/areas/retail-r9a';
import { localDb } from '../../lib/localDb';
import { getTable } from '../../lib/storage';
import { formatCurrency, todayInput } from '../../lib/utils';
import { chartOf, loadUserAccounts } from '../../lib/ledger/accounts';
import {
  NEXT_STATUS, cashWithRiders, deliveryRows, loadRiders, loadSettlements, moveDelivery, returnedCreditNote, riderOpenReceipts, saveRider, settleRider,
} from '../../lib/retail/rt-delivery';
import type { Payment } from '../../types/invoice';
import type { DeliveryStatus } from '../../types/retail-r9';
import { NumberInput } from '../ui/NumberInput';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';

const STATUSES: DeliveryStatus[] = ['new', 'packed', 'out', 'delivered', 'returned', 'cancelled'];
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export default function DeliveriesTab({ onDone }: { onDone: (msg: string, error?: boolean) => void }) {
  useT();
  const day = todayInput();
  const [tick, setTick] = useState(0);
  const [riderFilter, setRiderFilter] = useState('');
  const [newRider, setNewRider] = useState({ name: '', phone: '' });
  const [settle, setSettle] = useState({ rider: '', counted: 0, account: '' });
  /* eslint-disable react-hooks/exhaustive-deps */
  const rows = useMemo(() => deliveryRows(localDb.invoices.getAll()), [tick]);
  const riders = useMemo(() => loadRiders(), [tick]);
  const settlements = useMemo(() => loadSettlements(), [tick]);
  const payments = useMemo(() => getTable<Payment>('transactions'), [tick]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const ledgers = useMemo(() => chartOf(loadUserAccounts()).filter((a) => a.group === 'INDIRECT_EXPENSES' || a.group === 'OTHER_INCOME' || a.group === 'OTHER_CL' || a.group === 'OTHER_CA' || a.group === 'LOANS_ADV_ST'), []);
  const riderName = (id?: string) => riders.find((r) => r.id === id)?.name ?? rtaT('noRider');
  const shown = rows.filter((r) => !riderFilter || r.delivery.rider_id === riderFilter);
  const shop = localDb.settings.activeProfile()?.companyName ?? '';
  const open = settle.rider ? riderOpenReceipts(payments, settlements, settle.rider, day) : [];
  const expected = open.reduce((s, p) => s + p.amount, 0);
  const run = (fn: () => string | Promise<string>) => {
    Promise.resolve().then(fn).then((m) => { setTick((t) => t + 1); onDone(m); }).catch((e: Error) => onDone(e.message, true));
  };
  const status = (s: DeliveryStatus) => rtaT(`st.${s}`);
  const printRun = (riderId: string) => {
    const list = rows.filter((r) => r.delivery.rider_id === riderId && (r.delivery.status === 'packed' || r.delivery.status === 'out'));
    const html = `<!doctype html><meta charset="utf-8"><title>${esc(rtaT('runSheet'))}</title><style>body{font:14px sans-serif}td,th{border:1px solid #999;padding:4px}table{border-collapse:collapse;width:100%}</style><h2>${esc(rtaT('runSheet'))} — ${esc(riderName(riderId))} · ${day}</h2><table><tr><th>#</th><th>${esc(rtaT('address'))}</th><th>${esc(rtaT('phone'))}</th><th>${esc(rtaT('slot'))}</th><th>${esc(rtaT('toCollect'))}</th></tr>${list
      .map((r) => `<tr><td>${esc(r.invoice.invoice_number)}</td><td>${esc(r.delivery.address)}</td><td>${esc(r.delivery.phone ?? '')}</td><td>${esc(r.delivery.slot ?? '')}</td><td>${r.delivery.cod ? esc(formatCurrency(r.toCollect)) : '—'}</td></tr>`)
      .join('')}</table>`;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(html);
    w.document.close();
    w.print();
  };
  const waLink = (r: (typeof rows)[number]) => {
    const digits = String(r.delivery.phone ?? r.invoice.client?.phone ?? '').replace(/\D/g, '');
    if (digits.length < 10) return undefined;
    const msg = rtaT('waOutMsg', { number: r.invoice.invoice_number, shop, amount: formatCurrency(r.invoice.total) });
    return `https://wa.me/${digits.length === 10 ? `91${digits}` : digits}?text=${encodeURIComponent(msg)}`;
  };
  return (
    <div className={surface.card} data-deliveries>
      <div className={surface.cardHead}>
        <span className={surface.cardHeadIcon}><Truck size={16} aria-hidden="true" /> {rtaT('tab.deliveries')}</span>
        <span className={controls.hint} data-riders-cash>{rtaT('withRiders')}: {formatCurrency(cashWithRiders(payments, settlements, day))}</span>
      </div>
      <div className={surface.cardBody}>
        <div className={controls.row} style={{ gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className={controls.field}><span className={controls.label}>{rtaT('rider')}</span>
            <select className={controls.select} value={riderFilter} onChange={(e) => setRiderFilter(e.target.value)}>
              <option value="">—</option>
              {riders.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
          {riderFilter && <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => printRun(riderFilter)}><Printer size={14} aria-hidden="true" /> {rtaT('printRun')}</button>}
        </div>
        {shown.length === 0 ? <p className={controls.hint}>{rtaT('noOrders')}</p> : STATUSES.map((st) => {
          const list = shown.filter((r) => r.delivery.status === st);
          if (!list.length) return null;
          return (
            <div key={st} className={surface.tableWrap} data-delivery-col={st}>
              <table className={surface.table}>
                <caption style={{ textAlign: 'left', fontWeight: 600 }}>{status(st)} ({list.length})</caption>
                <tbody>
                  {list.map((r) => {
                    const next = NEXT_STATUS[r.delivery.status];
                    const wa = r.delivery.status === 'out' ? waLink(r) : undefined;
                    return (
                      <tr key={r.invoice.id} data-delivery-order={r.invoice.invoice_number}>
                        <td><strong>{r.invoice.invoice_number}</strong> · {r.invoice.client?.name}<br /><small>{r.delivery.address}{r.delivery.slot ? ` · ${r.delivery.slot}` : ''}</small></td>
                        <td>{riderName(r.delivery.rider_id)}</td>
                        <td className={surface.numeric}>{r.delivery.cod ? `${rtaT('toCollect')} ${formatCurrency(r.toCollect)}` : formatCurrency(r.invoice.total)}</td>
                        <td style={{ textAlign: 'right' }}>
                          {next && <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => run(() => { moveDelivery(r.invoice.id, next, day); return rtaT('statusDone', { number: r.invoice.invoice_number, status: status(next) }); })} data-delivery-next={next}>{rtaT('next', { status: status(next) })}</button>}
                          {(r.delivery.status === 'out' || r.delivery.status === 'delivered') && <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => run(() => { moveDelivery(r.invoice.id, 'returned', day); return rtaT('statusDone', { number: r.invoice.invoice_number, status: status('returned') }); })}>{rtaT('markReturned')}</button>}
                          {r.delivery.status === 'returned' && !r.delivery.credit_note_id && <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => run(async () => rtaT('creditMade', { number: (await returnedCreditNote(r.invoice.id)).invoice_number }))}>{rtaT('creditNote')}</button>}
                          {wa && <a className={`${controls.btnGhost} ${controls.btnSm}`} href={wa} target="_blank" rel="noopener noreferrer">{rtaT('waOut')}</a>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          );
        })}

        <details style={{ marginTop: '1rem' }} data-riders>
          <summary>{rtaT('riders')} ({riders.length})</summary>
          <div className={controls.row} style={{ gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <input className={controls.input} placeholder={rtaT('riderName')} aria-label={rtaT('riderName')} value={newRider.name} onChange={(e) => setNewRider({ ...newRider, name: e.target.value })} data-rider-name />
            <input className={controls.input} placeholder={rtaT('phone')} aria-label={rtaT('phone')} inputMode="tel" value={newRider.phone} onChange={(e) => setNewRider({ ...newRider, phone: e.target.value })} />
            <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={!newRider.name.trim()} onClick={() => run(() => { const r = saveRider(newRider); setNewRider({ name: '', phone: '' }); return r.name; })} data-rider-add>{rtaT('addRider')}</button>
          </div>
        </details>

        <details style={{ marginTop: '1rem' }} open={!!settle.rider} data-settle>
          <summary>{rtaT('settleTitle')}</summary>
          <div className={controls.row} style={{ gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <label className={controls.field}><span className={controls.label}>{rtaT('settleRider')}</span>
              <select className={controls.select} value={settle.rider} onChange={(e) => setSettle({ rider: e.target.value, counted: riderOpenReceipts(payments, settlements, e.target.value, day).reduce((s, p) => s + p.amount, 0), account: '' })} data-settle-rider>
                <option value="">—</option>
                {riders.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </label>
            {settle.rider && (open.length === 0 ? <p className={controls.hint}>{rtaT('nothingToSettle')}</p> : (
              <>
                <span>{rtaT('expected')}: <strong data-settle-expected>{formatCurrency(expected)}</strong></span>
                <label className={controls.field} style={{ maxWidth: 140 }}><span className={controls.label}>{rtaT('counted')}</span>
                  <NumberInput className={controls.input} value={settle.counted} onChange={(counted) => setSettle({ ...settle, counted })} data-settle-counted />
                </label>
                <span>{rtaT('difference')}: {formatCurrency(settle.counted - expected)}</span>
                {Math.abs(settle.counted - expected) > 0.004 && (
                  <label className={controls.field}><span className={controls.label}>{rtaT('diffLedger')}</span>
                    <select className={controls.select} value={settle.account} onChange={(e) => setSettle({ ...settle, account: e.target.value })}>
                      <option value="">{rtaT('pickLedger')}</option>
                      {ledgers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                    </select>
                  </label>
                )}
                <button type="button" className={controls.btnPrimary} onClick={() => run(() => { const s = settleRider({ riderId: settle.rider, day, counted: settle.counted, differenceAccountId: settle.account || undefined }); setSettle({ rider: '', counted: 0, account: '' }); return rtaT('settled', { amount: formatCurrency(s.counted), rider: s.rider_name }); })} data-settle-save>{rtaT('settle')}</button>
              </>
            ))}
          </div>
          <p className={controls.hint}>{rtaT('workingPaper')}</p>
        </details>
      </div>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Modal } from '../ui/Modal';
import { localDb } from '../../lib/localDb';
import { purchasesDb } from '../../lib/purchases';
import { vendorsDb } from '../../lib/vendors';
import { round2 } from '../../lib/invoice-calc';
import { formatCurrency, formatDate, todayInput } from '../../lib/utils';
import { clientOfVendor, nettingParties, nettings, openBills, openInvoices, postNetting, reverseNetting, type OpenItem } from '../../lib/netting';
import type { Vendor } from '../../types/purchases';
import { useT } from '../../i18n';
import { netT } from '../../i18n/areas/netting-r15a';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';

/** R15-A3 vendor form row: link the supplier to the client it also is, and open Netting for that party. */
export function NettingLinkRow({ vendor, onChange }: { vendor: Vendor; onChange: (clientId: string | undefined) => void }) {
  useT();
  const clients = useMemo(() => localDb.clients.getAll().filter((c) => c.id), []);
  const match = clientOfVendor(vendor, clients);
  return (
    <div className={controls.field}>
      <label className={controls.label} htmlFor="v-netting">{netT('link')}</label>
        <select id="v-netting" className={controls.select} value={vendor.client_id ?? ''} onChange={(e) => onChange(e.target.value || undefined)} data-netting-link>
          <option value="">{netT('linkNone')}{!vendor.client_id && match ? ` ${match.name}` : ''}</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      {match && vendor.id && <Link className={controls.btnGhost} to={`/receivables?netting=${encodeURIComponent(match.id ?? '')}`}>{netT('title')}</Link>}
    </div>
  );
}

/**
 * R15-A3 Netting: pick a customer who is also a supplier, tick their open invoices and your open bills (oldest first),
 * set off up to the smaller side in one step. Lists the party's nettings with Reverse and a WhatsApp statement.
 */
export default function NettingDialog({ clientId, vendorId, onClose, onDone }: { clientId?: string; vendorId?: string; onClose: () => void; onDone: (msg: string) => void }) {
  useT();
  const [tick, setTick] = useState(0);
  const pairs = useMemo(() => nettingParties(localDb.clients.getAll(), vendorsDb.all()), []);
  const [pick, setPick] = useState(() => Math.max(pairs.findIndex((p) => (clientId && p.client.id === clientId) || (vendorId && p.vendor.id === vendorId)), 0));
  const pair = pairs[pick];
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `tick` re-reads after a post / reverse
  const invs = useMemo(() => (pair ? openInvoices(pair.client, localDb.invoices.getAll()) : []), [pair, tick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const bills = useMemo(() => (pair ? openBills(pair.vendor, purchasesDb.all()) : []), [pair, tick]);
  const [inv, setInv] = useState<Set<string>>(new Set());
  const [bil, setBil] = useState<Set<string>>(new Set());
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayInput());
  const [rcmPaid, setRcmPaid] = useState(false);
  const [error, setError] = useState('');
  const sum = (rows: OpenItem[], s: Set<string>) => round2(rows.filter((r) => s.has(r.id)).reduce((t, r) => t + r.open, 0));
  const max = Math.min(sum(invs, inv), sum(bills, bil));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const all = useMemo(() => (pair ? nettings().filter((n) => n.rows.some((r) => localDb.invoices.getById(r.invoice_id)?.client?.id === pair.client.id)) : []), [pair, tick]);
  const toggle = (s: Set<string>, set: (x: Set<string>) => void, id: string) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); set(n); setAmount(''); };
  const run = (fn: () => string) => {
    try {
      onDone(fn());
      setError('');
      setInv(new Set());
      setBil(new Set());
      setTick((t) => t + 1);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const post = () => run(() => {
    const a = Number(amount) || max;
    postNetting({ clientId: pair!.client.id ?? '', vendorId: pair!.vendor.id, invoiceIds: invs.filter((i) => inv.has(i.id)).map((i) => i.id), billIds: bills.filter((b) => bil.has(b.id)).map((b) => b.id), amount: a, date, rcmPaid });
    return netT('done', { amount: formatCurrency(a) });
  });
  const list = (rows: OpenItem[], s: Set<string>, set: (x: Set<string>) => void, label: string, attr: string) => (
    <fieldset className={controls.field} data-netting-side={attr}>
      <legend className={controls.label}>{label}</legend>
      {rows.map((r) => (
        <label key={r.id} className={controls.check}>
          <input type="checkbox" checked={s.has(r.id)} onChange={() => toggle(s, set, r.id)} />
          {r.number} · {formatDate(r.date)} · {formatCurrency(r.open, r.currency)}
        </label>
      ))}
    </fieldset>
  );

  return (
    <Modal open onClose={onClose} size="md" title={pair ? netT('open', { name: pair.client.name }) : netT('title')}
      footer={<>
        <button type="button" className={controls.btnPrimary} disabled={!pair || !(max > 0)} onClick={post} data-netting-post>{netT('post')}</button>
      </>}>
      <div data-netting-dialog>
        {!pair && <p className={controls.hint}>{netT('none')}</p>}
        {pairs.length > 1 && (
          <label className={controls.field}>
            <select className={controls.select} aria-label={netT('title')} value={pick} onChange={(e) => { setPick(Number(e.target.value)); setInv(new Set()); setBil(new Set()); }}>
              {pairs.map((p, i) => <option key={p.vendor.id} value={i}>{p.client.name}{p.vendor.name !== p.client.name ? ` / ${p.vendor.name}` : ''}</option>)}
            </select>
          </label>
        )}
        {pair && (
          <>
            {list(invs, inv, setInv, netT('receivable'), 'in')}
            {list(bills, bil, setBil, netT('payable'), 'out')}
            <div className={controls.row}>
              <label className={controls.field}>
                <span className={controls.label}>{netT('amount')}</span>
                <input className={controls.input} type="number" min={0} step="0.01" value={amount} placeholder={max ? String(max) : ''} onChange={(e) => setAmount(e.target.value)} data-netting-amount />
              </label>
              <label className={controls.field}>
                <span className={controls.label}>{netT('date')}</span>
                <input className={controls.input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
            </div>
            {bills.some((b) => bil.has(b.id) && b.rcm) && (
              <label className={controls.check}><input type="checkbox" checked={rcmPaid} onChange={(e) => setRcmPaid(e.target.checked)} />{netT('rcm')}</label>
            )}
            <p className={controls.hint}>{netT('note')}</p>
            {error && <p className={controls.error} role="alert">{error}</p>}
            {all.length > 0 && (
              <table className={surface.table}>
                <tbody>
                  {all.map((n) => (
                    <tr key={n.id} data-netting-row>
                      <td>{formatDate(n.date)}</td>
                      <td className={surface.numeric}>{formatCurrency(n.amount)}</td>
                      <td>
                        <button type="button" className={controls.btnGhost} onClick={() => run(() => { reverseNetting(n.id); return netT('reversed'); })} data-netting-reverse>{netT('reverse')}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

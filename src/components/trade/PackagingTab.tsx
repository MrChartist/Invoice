/**
 * Distribution → Packaging (TR-A5; distributor / commodity / agency packs or Settings → Returnable packaging):
 * crate / bag types, movements with deposits, balances per party as on a date with ageing, and the charge for
 * units not returned. Deposits carry no GST; a charge is a taxable sale of the packaging (TR8 — verify with your CA).
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useT } from '../../i18n';
import { aT } from '../../i18n/areas/trade-r8a';
import { localDb } from '../../lib/localDb';
import { vendorsDb } from '../../lib/vendors';
import { chartOf, loadUserAccounts } from '../../lib/ledger/accounts';
import { isCashOrBankLedger } from '../../lib/bank-ledgers';
import { formatCurrency, todayInput } from '../../lib/utils';
import type { PackagingMove, PackagingType } from '../../types/trade-r8';
import type { InvoiceRecord } from '../../types/invoice';
import { peekTable } from '../../lib/storage';
import { activeMoves, chargeUnreturned, loadPackMoves, orphanCharge, loadPackTypes, packBalances, recordPackMove, removePackMove, savePackType, type MoveInput } from '../../lib/trade/tr-packaging';
import controls from '../../styles/controls.module.css';
import own from '../distribution/dist.module.css';
import { DateField } from '../ui/DateField';
import { SelectField } from '../ui/SelectField';

const F = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className={controls.field}>
    <span className={controls.label}>{label}</span>
    {children}
  </label>
);
const n = (v: string) => Number(v) || 0;

export default function PackagingTab({ onDone }: { onDone: (msg: string, error?: boolean) => void }) {
  useT();
  const navigate = useNavigate();
  const [tick, setTick] = useState(0);
  const run = (fn: () => string) => {
    try {
      onDone(fn());
      setTick((x) => x + 1);
    } catch (err) {
      onDone((err as Error).message, true);
    }
  };
  const types = useMemo(() => (void tick, loadPackTypes()), [tick]);
  const moves = useMemo(() => (void tick, loadPackMoves()), [tick]);
  const [asOf, setAsOf] = useState(todayInput);
  const [age, setAge] = useState(60);
  const balances = useMemo(() => packBalances(activeMoves(moves), asOf, age).filter((b) => b.balance || b.deposit), [moves, asOf, age]);
  const parties = useMemo(() => [...localDb.clients.getAll().map((c) => ({ kind: 'client' as const, id: c.id!, name: c.name })), ...vendorsDb.all().map((v) => ({ kind: 'vendor' as const, id: v.id, name: v.name }))], []);
  const cash = useMemo(() => chartOf(loadUserAccounts()).filter(isCashOrBankLedger), []);
  const [t, setT] = useState<Omit<PackagingType, 'id'>>({ name: '', unit: 'NOS', deposit: 0, charge_rate: 0, tax_rate: 18, returnable: true });
  const [m, setM] = useState({ date: todayInput(), party: '', type: '', out: '', in: '', deposit: '', cash: '' });
  const typeName = (id: string) => types.find((x) => x.id === id)?.name ?? '';
  const record = () => run(() => {
    const p = parties.find((x) => `${x.kind}:${x.id}` === m.party);
    const input: MoveInput = { date: m.date, party_kind: p?.kind ?? 'client', party_id: p?.id, party_name: p?.name ?? '', type_id: m.type || types[0]?.id || '', out: n(m.out), in: n(m.in), deposit: n(m.deposit) || undefined, cash_account: m.cash || undefined };
    recordPackMove(input);
    setM({ ...m, out: '', in: '', deposit: '' });
    return aT('recorded');
  });
  return (
    <div className={own.stack} data-packaging-tab>
      <details className={own.stack}>
        <summary>{aT('types')} ({types.length})</summary>
        <div className={own.row}>
          <F label={aT('name')}><input className={controls.input} value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} data-pack-type-name /></F>
          <F label={aT('deposit')}><input type="number" min={0} className={controls.input} value={t.deposit || ''} onChange={(e) => setT({ ...t, deposit: n(e.target.value) })} /></F>
          <F label={aT('chargeRate')}><input type="number" min={0} className={controls.input} value={t.charge_rate || ''} onChange={(e) => setT({ ...t, charge_rate: n(e.target.value) })} data-pack-type-charge /></F>
          <F label="HSN"><input className={controls.input} value={t.hsn ?? ''} onChange={(e) => setT({ ...t, hsn: e.target.value.replace(/\D/g, '') })} /></F>
          <F label="GST %"><input type="number" min={0} className={controls.input} value={t.tax_rate ?? 0} onChange={(e) => setT({ ...t, tax_rate: n(e.target.value) })} /></F>
          <div><button type="button" className={controls.btnPrimary} onClick={() => run(() => { savePackType(t); setT({ ...t, name: '' }); return aT('saved'); })} data-pack-type-save>{aT('save')}</button></div>
        </div>
        <p className={own.muted}>{types.map((x) => `${x.name}: ${aT('deposit')} ${formatCurrency(x.deposit ?? 0)}, ${aT('chargeRate')} ${formatCurrency(x.charge_rate ?? 0)}`).join(' · ')}</p>
      </details>
      {types.length > 0 && (
        <div className={own.row} data-pack-move-form>
          <F label={aT('date')}><DateField className={controls.input} value={m.date} onChange={(e) => setM({ ...m, date: e.target.value })} /></F>
          <F label={aT('party')}>
            <SelectField className={controls.select} value={m.party} onChange={(e) => setM({ ...m, party: e.target.value })} data-pack-party>
              <option value="">-</option>
              {parties.map((p) => <option key={`${p.kind}:${p.id}`} value={`${p.kind}:${p.id}`}>{p.name}</option>)}
            </SelectField>
          </F>
          <F label={aT('crates')}>
            <SelectField className={controls.select} value={m.type} onChange={(e) => setM({ ...m, type: e.target.value })}>
              {types.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </SelectField>
          </F>
          <F label={aT('out')}><input type="number" min={0} className={controls.input} value={m.out} onChange={(e) => setM({ ...m, out: e.target.value })} data-pack-move-out /></F>
          <F label={aT('in')}><input type="number" min={0} className={controls.input} value={m.in} onChange={(e) => setM({ ...m, in: e.target.value })} data-pack-move-in /></F>
          <F label={aT('depositMove')}><input type="number" className={controls.input} value={m.deposit} onChange={(e) => setM({ ...m, deposit: e.target.value })} /></F>
          {n(m.deposit) !== 0 && (
            <F label={aT('cashBank')}>
              <SelectField className={controls.select} value={m.cash} onChange={(e) => setM({ ...m, cash: e.target.value })}>
                {cash.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </SelectField>
            </F>
          )}
          <div><button type="button" className={controls.btnPrimary} onClick={record} data-pack-move-save>{aT('record')}</button></div>
        </div>
      )}
      <div className={own.row}>
        <F label={aT('asOf')}><DateField className={controls.input} value={asOf} onChange={(e) => setAsOf(e.target.value)} /></F>
        <F label={aT('ageDays')}><input type="number" min={1} className={controls.input} value={age} onChange={(e) => setAge(Math.max(n(e.target.value), 1))} /></F>
      </div>
      <div className={own.tableWrap}>
        <table className={own.table} data-pack-balances>
          <thead><tr><th>{aT('party')}</th><th>{aT('crates')}</th><th className={own.num}>{aT('out')}</th><th className={own.num}>{aT('in')}</th><th className={own.num}>{aT('balance')}</th><th className={own.num}>{aT('aged')}</th><th className={own.num}>{aT('deposit')}</th><th /></tr></thead>
          <tbody>
            {balances.map((b) => (
              <tr key={b.key} data-pack-balance={b.party}>
                <td>{b.party}</td><td>{typeName(b.type_id)}</td><td className={own.num}>{b.out}</td><td className={own.num}>{b.in}</td><td className={own.num}>{b.balance}</td>
                <td className={own.num}>{b.aged}{b.oldest ? ` (${b.oldest})` : ''}</td><td className={own.num}>{formatCurrency(b.deposit)}</td>
                <td>
                  {b.party_kind === 'client' && b.balance > 0 && (
                    <button type="button" className={controls.btnGhost} onClick={() => {
                      const q = Number(window.prompt(aT('chargeAsk', { n: b.balance }), String(b.aged || b.balance)));
                      if (q > 0) run(() => { const r = chargeUnreturned(b, q, todayInput()); navigate(`/invoice/${r.invoice.id}`); return aT('charged', { no: r.invoice.invoice_number || aT('draft') }); });
                    }}>{aT('charge')}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!balances.length && <p className={own.muted}>{aT('none')}</p>}
      </div>
      <details>
        <summary>{aT('moves')} ({moves.length})</summary>
        <div className={own.tableWrap}>
          <table className={own.table}>
            <tbody>
              {[...moves].reverse().slice(0, 100).map((x: PackagingMove) => (
                <tr key={x.id}>
                  <td>{x.date}</td><td>{x.party_name}</td><td>{typeName(x.type_id)}</td><td className={own.num}>{x.out ? `−${x.out}` : ''}{x.in ? ` +${x.in}` : ''}</td><td>{x.doc_no ?? ''}</td><td className={own.num}>{x.deposit ? formatCurrency(x.deposit) : ''}</td>
                  <td>{(!x.charge_invoice_id || orphanCharge(x, peekTable<InvoiceRecord>('invoices'))) && <button type="button" className={controls.btnGhost} onClick={() => window.confirm(aT('deleteAsk')) && run(() => { removePackMove(x.id); return aT('deleted'); })}>{aT('delete')}</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
      <p className={own.muted}>{aT('packNote')}</p>
    </div>
  );
}

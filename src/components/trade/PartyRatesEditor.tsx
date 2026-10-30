/**
 * TR-A1 trade terms (Settings → Items and Distribution → Masters): the Trade discounts / Returnable packaging
 * switches, minimum margins (company default and per stock group), and party-item special rates for a customer or a
 * supplier — one at a time or pasted in bulk ("item, rate, 18+4") — plus the customer's default cash-discount term.
 */
import { useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { aT } from '../../i18n/areas/trade-r8a';
import { localDb } from '../../lib/localDb';
import { vendorsDb } from '../../lib/vendors';
import { peekTable } from '../../lib/storage';
import { stockGroupsDb } from '../../lib/stock-groups';
import { formatCurrency, todayInput } from '../../lib/utils';
import type { PartyRate } from '../../types/trade-r8';
import { loadPartyRates, parseBulkRates, removePartyRate, savePartyRate } from '../../lib/trade/tr-party-rates';
import { discountLabel, parseChain } from '../../lib/trade/tr-discounts';
import controls from '../../styles/controls.module.css';
import own from '../distribution/dist.module.css';
import { SelectField } from '../ui/SelectField';
import { DateField } from '../ui/DateField';

export default function PartyRatesEditor({ onDone }: { onDone: (msg: string, error?: boolean) => void }) {
  useT();
  const [tick, setTick] = useState(0);
  const run = (fn: () => string) => {
    try {
      onDone(fn());
      setTick((x) => x + 1);
    } catch (e) {
      onDone((e as Error).message, true);
    }
  };
  const settings = useMemo(() => (void tick, localDb.settings.get()), [tick]);
  const groups = useMemo(() => (void tick, stockGroupsDb.all()), [tick]);
  const [side, setSide] = useState<PartyRate['side']>('sale');
  const parties = useMemo(() => (side === 'sale' ? localDb.clients.getAll().map((c) => ({ id: c.id!, name: c.name })) : vendorsDb.all()), [side]);
  const [party, setParty] = useState('');
  const items = useMemo(() => [...new Set([...localDb.items.getAll(), ...peekTable<{ name: string }>('stock_items')].map((i) => i.name))].sort(), []);
  const rows = useMemo(() => (void tick, loadPartyRates().filter((r) => r.side === side && r.party_id === party)), [tick, side, party]);
  const [f, setF] = useState({ item: '', rate: '', chain: '', unit: '', from: todayInput(), to: '' });
  const [bulk, setBulk] = useState('');
  const name = parties.find((p) => p.id === party)?.name ?? '';
  const client = side === 'sale' && party ? localDb.clients.getById(party) : undefined;
  const flag = (k: 'trade_discounts' | 'returnable_packaging', v: boolean) => run(() => { localDb.settings.save({ ...localDb.settings.get(), [k]: v }); return aT('saved'); });
  const add = () => run(() => {
    const chain = f.chain.trim() ? parseChain(f.chain) : undefined;
    if (chain === null) throw new Error(aT('chainBad'));
    savePartyRate({ side, party_id: party, party_name: name, item_name: f.item, ...(Number(f.rate) > 0 ? { rate: Number(f.rate) } : {}), ...(chain ? { disc_chain: chain } : {}), ...(Number(f.unit) > 0 ? { disc_per_unit: Number(f.unit) } : {}), valid_from: f.from, ...(f.to ? { valid_to: f.to } : {}) });
    setF({ ...f, item: '', rate: '', chain: '', unit: '' });
    return aT('saved');
  });
  const paste = () => run(() => {
    const { rows: got, bad } = parseBulkRates(bulk);
    for (const r of got) savePartyRate({ side, party_id: party, party_name: name, ...r, valid_from: f.from });
    setBulk('');
    return aT('pasted', { n: got.length }) + (bad.length ? ` · ${aT('badLines', { list: bad.join(', ') })}` : '');
  });
  return (
    <div className={own.stack} data-party-rates>
      <div className={own.row}>
        <label className={controls.check}><input type="checkbox" checked={!!settings.trade_discounts} onChange={(e) => flag('trade_discounts', e.target.checked)} data-trade-discounts /> {aT('tradeDiscounts')}</label>
        <label className={controls.check}><input type="checkbox" checked={!!settings.returnable_packaging} onChange={(e) => flag('returnable_packaging', e.target.checked)} /> {aT('returnable')}</label>
        <label className={controls.field}>
          <span className={controls.label}>{aT('minMargin')}</span>
          <input type="number" min={0} max={100} className={controls.input} defaultValue={settings.trade_min_margin ?? ''} onBlur={(e) => run(() => { localDb.settings.save({ ...localDb.settings.get(), trade_min_margin: Number(e.target.value) || undefined }); return aT('saved'); })} />
        </label>
      </div>
      {groups.length > 0 && (
        <details>
          <summary>{aT('groupMargins')}</summary>
          <div className={own.row}>
            {groups.map((g) => (
              <label key={g.id} className={controls.field}>
                <span className={controls.label}>{g.name} %</span>
                <input type="number" min={0} max={100} className={controls.input} defaultValue={g.min_margin_percent ?? ''} onBlur={(e) => run(() => { stockGroupsDb.setMinMargin(g.id, Number(e.target.value) || 0); return aT('saved'); })} />
              </label>
            ))}
          </div>
        </details>
      )}
      <div className={own.row}>
        <SelectField className={controls.select} value={side} onChange={(e) => { setSide(e.target.value as PartyRate['side']); setParty(''); }} aria-label={aT('side')}>
          <option value="sale">{aT('side.sale')}</option>
          <option value="purchase">{aT('side.purchase')}</option>
        </SelectField>
        <SelectField className={controls.select} value={party} onChange={(e) => setParty(e.target.value)} aria-label={aT('party')} data-party-rate-party>
          <option value="">{aT('party')}: -</option>
          {parties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </SelectField>
        {client && (
          <label className={controls.field}>
            <span className={controls.label}>{aT('cdDefault')}</span>
            <input className={controls.input} placeholder="2/7" defaultValue={client.cash_discount ? `${client.cash_discount.percent}/${client.cash_discount.days}` : ''} onBlur={(e) => run(() => {
              const [p, d] = e.target.value.split('/').map(Number);
              localDb.clients.upsert({ ...client, cash_discount: p > 0 ? { percent: p, days: Math.max(Math.round(d) || 0, 0) } : undefined });
              return aT('saved');
            })} />
          </label>
        )}
      </div>
      {party && (
        <>
          <div className={own.row} data-party-rate-form>
            <input className={controls.input} list="pr-items" placeholder={aT('item')} value={f.item} onChange={(e) => setF({ ...f, item: e.target.value })} data-party-rate-item />
            <datalist id="pr-items">{items.map((i) => <option key={i} value={i} />)}</datalist>
            <input className={controls.input} type="number" min={0} placeholder={aT('rate')} value={f.rate} onChange={(e) => setF({ ...f, rate: e.target.value })} data-party-rate-rate />
            <input className={controls.input} placeholder={aT('chain')} value={f.chain} onChange={(e) => setF({ ...f, chain: e.target.value })} />
            <input className={controls.input} type="number" min={0} placeholder={aT('perUnit')} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} />
            <DateField className={controls.input} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label={aT('from')} />
            <DateField className={controls.input} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label={aT('to')} />
            <button type="button" className={controls.btnPrimary} onClick={add} data-party-rate-save>{aT('save')}</button>
          </div>
          <div className={own.tableWrap}>
            <table className={own.table}>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.item_name}</td><td className={own.num}>{r.rate ? formatCurrency(r.rate) : ''}</td><td>{discountLabel(r)}</td><td>{r.valid_from}{r.valid_to ? ` – ${r.valid_to}` : ''}</td>
                    <td><button type="button" className={controls.btnGhost} onClick={() => run(() => { removePartyRate(r.id); return aT('deleted'); })}>{aT('delete')}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={own.row}>
            <textarea className={controls.input} rows={3} placeholder={aT('bulkPh')} value={bulk} onChange={(e) => setBulk(e.target.value)} />
            <button type="button" className={controls.btnOutline} disabled={!bulk.trim()} onClick={paste}>{aT('paste')}</button>
          </div>
        </>
      )}
    </div>
  );
}

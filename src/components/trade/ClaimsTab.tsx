/**
 * Distribution → Claims (TR-A2 / A3, distributor pack): `?view=` schemes (scope v2, free slabs, the principal who
 * pays), pricedrop (price-drop note runs + price-protection claims) and claims (scheme claims, settlement).
 * Working papers — verify with your CA.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../i18n';
import { aT } from '../../i18n/areas/trade-r8a';
import { localDb } from '../../lib/localDb';
import { isPackOn } from '../../lib/industry-packs';
import { getTable, peekTable } from '../../lib/storage';
import { vendorsDb } from '../../lib/vendors';
import { schemeLabel, schemesDb, type Scheme } from '../../lib/pricing';
import { liveUnitCosts } from '../../lib/margin';
import { shiftDay } from '../../lib/dates';
import { formatCurrency, todayInput } from '../../lib/utils';
import type { InvoiceRecord } from '../../types/invoice';
import type { ClaimBasis, TradeClaim } from '../../types/trade-r8';
import { claimCsv, claimedKeys, deleteClaim, loadClaims, markClaim, saveClaim, schemeClaimRows, settleClaim, unsettleClaim } from '../../lib/trade/tr-claims';
import { claimPriceDrop, coveredPairs, dropRows, issuePriceDrop, liveStockBefore, loadPriceDrops, undoPriceDrop } from '../../lib/trade/tr-price-drop';
import { lineForScheme, liveScopeItems } from '../../lib/trade/tr-schemes';
import { downloadCsv } from './desk-shared';
import controls from '../../styles/controls.module.css';
import own from '../distribution/dist.module.css';

const VIEWS = ['schemes', 'pricedrop', 'claims'] as const;
type View = (typeof VIEWS)[number];
type Done = (msg: string, error?: boolean) => void;
type Run = (fn: () => string) => void;
const BASES: ClaimBasis[] = ['free_goods_at_cost', 'free_goods_at_rate', 'discount_given', 'fixed_per_unit'];
const money = (n: number) => formatCurrency(n);
const F = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className={controls.field}>
    <span className={controls.label}>{label}</span>
    {children}
  </label>
);

export default function ClaimsTab({ onDone }: { onDone: Done }) {
  useT();
  const [params, setParams] = useSearchParams();
  const view: View = (VIEWS as readonly string[]).includes(params.get('view') ?? '') ? (params.get('view') as View) : 'schemes';
  const [tick, setTick] = useState(0);
  const run: Run = (fn) => {
    try {
      onDone(fn());
      setTick((n) => n + 1);
    } catch (err) {
      onDone((err as Error).message, true);
    }
  };
  const go = (v: View) => {
    const next = new URLSearchParams(params);
    next.set('view', v);
    setParams(next, { replace: true });
  };
  const vendors = useMemo(() => vendorsDb.all(), []);
  return (
    <div className={own.stack} data-claims-tab>
      {!isPackOn(localDb.settings.get(), 'distributor') && <p className={own.notice}>{aT('packOff')}</p>}
      <div className={controls.segment} role="tablist" aria-label={aT('claims')}>
        {VIEWS.map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => go(v)} data-claims-view={v}>
            {aT(`view.${v}`)}
          </button>
        ))}
      </div>
      {view === 'schemes' && <Schemes key={tick} run={run} vendors={vendors} />}
      {view === 'pricedrop' && <PriceDrop key={tick} run={run} vendors={vendors} />}
      {view === 'claims' && <Claims key={tick} run={run} vendors={vendors} />}
      <p className={own.muted}>{aT('workingPaper')}</p>
    </div>
  );
}

type Vendors = { id: string; name: string }[];
const VendorSelect = ({ value, onChange, vendors, data }: { value: string; onChange: (v: string) => void; vendors: Vendors; data?: string }) => (
  <select className={controls.select} value={value} onChange={(e) => onChange(e.target.value)} data-principal={data}>
    <option value="">{aT('principal')}: -</option>
    {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
  </select>
);

const blank = (): Scheme => ({ id: '', item_id: '', item_name: '', buy_qty: 10, free_qty: 1, scope: {}, claim_basis: 'free_goods_at_cost' });
const slabsText = (s: Scheme) => (s.free_slabs ?? []).map((x) => `${x.min_qty}:${x.free_qty}`).join(', ');
const parseSlabs = (t: string) => t.split(',').map((p) => p.split(':').map(Number)).filter(([a, b]) => a > 0 && b > 0).map(([min_qty, free_qty]) => ({ min_qty, free_qty }));

function Schemes({ run, vendors }: { run: Run; vendors: Vendors }) {
  const schemes = schemesDb.all().filter((s) => s.kind !== 'bill_value');
  const groups = peekTable<{ id: string; name: string }>('stock_groups');
  const clients = localDb.clients.getAll();
  const [f, setF] = useState<Scheme>(blank);
  const [slabs, setSlabs] = useState('');
  const set = (p: Partial<Scheme>) => setF((x) => ({ ...x, ...p }));
  const scope = (p: Partial<NonNullable<Scheme['scope']>>) => set({ scope: { ...f.scope, ...p } });
  const save = (s: Scheme) => run(() => {
    const free_slabs = s === f ? parseSlabs(slabs) : s.free_slabs;
    const sc: NonNullable<Scheme['scope']> = Object.fromEntries(Object.entries(s.scope ?? {}).filter(([, v]) => (Array.isArray(v) ? v.length : v)));
    if (!s.item_name && !sc.group_ids && !sc.item_ids && !sc.brand) throw new Error(aT('scopeNeeded'));
    schemesDb.save({ ...s, item_name: s.item_name || '', ...(free_slabs?.length ? { free_slabs } : { free_slabs: undefined }), scope: Object.keys(sc).length ? sc : undefined });
    if (s === f) setF(blank());
    return aT('saved');
  });
  return (
    <>
      <details className={own.stack} data-scheme-form>
        <summary>{aT('newScheme')}</summary>
        <div className={own.row}>
          <F label={aT('group')}>
            <select className={controls.select} value={f.scope?.group_ids?.[0] ?? ''} onChange={(e) => scope({ group_ids: e.target.value ? [e.target.value] : [] })} data-scheme-group>
              <option value="">-</option>
              {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </F>
          <F label={aT('brand')}><input className={controls.input} value={f.scope?.brand ?? ''} onChange={(e) => scope({ brand: e.target.value })} data-scheme-brand /></F>
          <F label={aT('party')}>
            <select className={controls.select} value={f.scope?.client_ids?.[0] ?? ''} onChange={(e) => scope({ client_ids: e.target.value ? [e.target.value] : [] })}>
              <option value="">{aT('everyone')}</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </F>
          <F label={aT('buyFree')}>
            <span className={own.row}>
              <input className={controls.input} type="number" min={1} value={f.buy_qty} onChange={(e) => set({ buy_qty: Number(e.target.value) })} data-scheme-buy />
              <input className={controls.input} type="number" min={1} value={f.free_qty} onChange={(e) => set({ free_qty: Number(e.target.value) })} data-scheme-free />
            </span>
          </F>
          <F label={aT('slabs')}><input className={controls.input} value={slabs} placeholder="10:1, 25:3" onChange={(e) => setSlabs(e.target.value)} /></F>
          <F label={aT('from')}><input type="date" className={controls.input} value={f.valid_from ?? ''} onChange={(e) => set({ valid_from: e.target.value || undefined })} /></F>
          <F label={aT('to')}><input type="date" className={controls.input} value={f.valid_to ?? ''} onChange={(e) => set({ valid_to: e.target.value || undefined })} /></F>
          <F label={aT('principal')}><VendorSelect vendors={vendors} value={f.principal_vendor_id ?? ''} onChange={(v) => set({ principal_vendor_id: v || undefined })} /></F>
          <F label={aT('basis')}>
            <select className={controls.select} value={f.claim_basis} onChange={(e) => set({ claim_basis: e.target.value as ClaimBasis })}>
              {BASES.map((b) => <option key={b} value={b}>{aT(`basis.${b}`)}</option>)}
            </select>
          </F>
          <F label={aT('claimRate')}><input className={controls.input} type="number" min={0} value={f.claim_rate ?? ''} onChange={(e) => set({ claim_rate: Number(e.target.value) || undefined })} /></F>
        </div>
        <div><button type="button" className={controls.btnPrimary} onClick={() => save(f)} data-scheme-save>{aT('save')}</button></div>
      </details>
      <div className={own.tableWrap}>
        <table className={own.table} data-schemes>
          <thead><tr><th>{aT('scheme')}</th><th>{aT('scope')}</th><th>{aT('principal')}</th><th>{aT('basis')}</th></tr></thead>
          <tbody>
            {schemes.map((s) => (
              <tr key={s.id}>
                <td>{s.scope ? `${s.free_slabs?.length ? slabsText(s) : `${s.buy_qty} + ${s.free_qty}`}` : schemeLabel(s)} {s.valid_to ? `(→ ${s.valid_to})` : ''}</td>
                <td>{[s.item_name, s.scope?.group_ids?.map((g) => groups.find((x) => x.id === g)?.name).join(', '), s.scope?.brand, s.scope?.client_ids?.length ? clients.find((c) => c.id === s.scope!.client_ids![0])?.name : ''].filter(Boolean).join(' · ')}</td>
                <td><VendorSelect vendors={vendors} value={s.principal_vendor_id ?? ''} onChange={(v) => save({ ...s, principal_vendor_id: v || undefined, claim_basis: s.claim_basis ?? 'free_goods_at_cost' })} /></td>
                <td>
                  <select className={controls.select} value={s.claim_basis ?? 'free_goods_at_cost'} disabled={!s.principal_vendor_id} onChange={(e) => save({ ...s, claim_basis: e.target.value as ClaimBasis })}>
                    {BASES.map((b) => <option key={b} value={b}>{aT(`basis.${b}`)}</option>)}
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!schemes.length && <p className={own.muted}>{aT('none')}</p>}
      </div>
    </>
  );
}

function PriceDrop({ run, vendors }: { run: Run; vendors: Vendors }) {
  const [date, setDate] = useState(todayInput);
  const [days, setDays] = useState(30);
  const [items, setItems] = useState('');
  const [mode, setMode] = useState<'financial' | 'gst'>('financial');
  const [agreed, setAgreed] = useState(false);
  const [principal, setPrincipal] = useState('');
  const spec = useMemo(() => ({
    items: items.split(/\r?\n/).map((l) => l.split(/,|\t/)).filter((p) => p[0]?.trim() && Number(p[1]) > 0).map((p) => ({ name: p[0].trim(), drop: Number(p[1]) })),
    from: shiftDay(date, -days), to: shiftDay(date, -1),
  }), [items, date, days]);
  const rows = useMemo(() => (spec.items.length ? dropRows(getTable<InvoiceRecord>('invoices'), getTable('doc_links'), spec, coveredPairs(loadPriceDrops(), { invoices: getTable<InvoiceRecord>('invoices'), links: getTable('doc_links') })) : []), [spec]);
  const runs = loadPriceDrops();
  const issue = () => run(() => issuePriceDrop({ ...spec, date, mode, agreed, own_stock: liveStockBefore(spec.items.map((i) => i.name), date) }).number);
  return (
    <>
      <div className={own.row}>
        <F label={aT('effective')}><input type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} /></F>
        <F label={aT('lookBack')}><input type="number" min={1} className={controls.input} value={days} onChange={(e) => setDays(Math.max(Number(e.target.value) || 1, 1))} /></F>
        <F label={aT('dropItems')}><textarea className={controls.input} rows={2} value={items} placeholder="Ceiling fan 1200mm, 150" onChange={(e) => setItems(e.target.value)} data-drop-items /></F>
        <F label={aT('mode')}>
          <select className={controls.select} value={mode} onChange={(e) => setMode(e.target.value as 'financial' | 'gst')} data-drop-mode>
            <option value="financial">{aT('mode.financial')}</option>
            <option value="gst">{aT('mode.gst')}</option>
          </select>
        </F>
        {mode === 'gst' && <label className={controls.check}><input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} /> {aT('agreed')}</label>}
      </div>
      {rows.length > 0 && (
        <div className={own.tableWrap}>
          <table className={own.table} data-drop-rows>
            <thead><tr><th>{aT('party')}</th><th>{aT('bill')}</th><th>{aT('item')}</th><th className={own.num}>{aT('qty')}</th><th className={own.num}>{aT('value')}</th></tr></thead>
            <tbody>{rows.map((r, i) => <tr key={i}><td>{r.client_name}</td><td>{r.invoice_number}</td><td>{r.item}</td><td className={own.num}>{r.qty}</td><td className={own.num}>{money(r.value)}</td></tr>)}</tbody>
          </table>
        </div>
      )}
      <div><button type="button" className={controls.btnPrimary} disabled={!rows.length} onClick={issue} data-drop-issue>{aT('issueNotes', { n: new Set(rows.map((r) => (mode === 'gst' ? r.invoice_id : r.client_name))).size })}</button></div>
      <div className={own.tableWrap}>
        <table className={own.table} data-drop-runs>
          <thead><tr><th>{aT('number')}</th><th>{aT('date')}</th><th className={own.num}>{aT('value')}</th><th>{aT('notes')}</th><th>{aT('status')}</th><th /></tr></thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id} data-drop-run={r.number}>
                <td>{r.number}</td><td>{r.date}</td><td className={own.num}>{money(r.total)}</td><td>{r.note_ids.length} · {aT(`mode.${r.mode}`)}</td><td>{aT(`st.${r.status}`)}</td>
                <td>
                  {r.status === 'issued' && !r.claim_id && (
                    <span className={own.row}>
                      <VendorSelect vendors={vendors} value={principal} onChange={setPrincipal} />
                      <button type="button" className={controls.btnGhost} disabled={!principal} onClick={() => run(() => claimPriceDrop(r.id, vendors.find((v) => v.id === principal)!, todayInput()).number)}>{aT('claim')}</button>
                      <button type="button" className={controls.btnGhost} onClick={() => window.confirm(aT('undoAsk')) && run(() => `${undoPriceDrop(r.id).number}: ${aT('st.undone')}`)}>{aT('undo')}</button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Claims({ run, vendors }: { run: Run; vendors: Vendors }) {
  const [principal, setPrincipal] = useState('');
  const [from, setFrom] = useState(() => shiftDay(todayInput(), -30));
  const [to, setTo] = useState(todayInput);
  const [settle, setSettle] = useState<{ id: string; mode: 'financial' | 'gst'; note_no: string; date: string; amount: string; gst_rate: string } | null>(null);
  const [shown, setShown] = useState('');
  const claims = loadClaims();
  const rows = useMemo(() => {
    if (!principal) return [];
    const costs = liveUnitCosts();
    const ctx = { ...liveScopeItems() };
    return schemeClaimRows(getTable<InvoiceRecord>('invoices'), schemesDb.all(), principal, from, to, { cost: (n) => costs.get(n.trim().toLowerCase())?.cost ?? 0, inScheme: (s, l) => lineForScheme(s, l, ctx), claimed: claimedKeys(loadClaims()) });
  }, [principal, from, to]);
  const make = () => run(() => saveClaim({ date: todayInput(), kind: 'scheme', principal_id: principal, principal_name: vendors.find((v) => v.id === principal)?.name ?? '', from, to, rows }).number);
  const open = claims.find((c) => c.id === shown);
  return (
    <>
      <div className={own.row}>
        <F label={aT('principal')}><VendorSelect vendors={vendors} value={principal} onChange={setPrincipal} data="claim" /></F>
        <F label={aT('from')}><input type="date" className={controls.input} value={from} onChange={(e) => setFrom(e.target.value)} /></F>
        <F label={aT('to')}><input type="date" className={controls.input} value={to} onChange={(e) => setTo(e.target.value)} /></F>
        <div><button type="button" className={controls.btnPrimary} disabled={!rows.length} onClick={make} data-claim-make>{aT('makeClaim', { n: rows.length, amount: money(rows.reduce((t, r) => t + r.value, 0)) })}</button></div>
      </div>
      <div className={own.tableWrap}>
        <table className={own.table} data-claims>
          <thead><tr><th>{aT('number')}</th><th>{aT('principal')}</th><th>{aT('period')}</th><th className={own.num}>{aT('value')}</th><th>{aT('status')}</th><th /></tr></thead>
          <tbody>
            {claims.map((c) => (
              <tr key={c.id} data-claim={c.number}>
                <td>{c.number}{c.kind === 'price_drop' ? ` · ${aT('view.pricedrop')}` : ''}</td><td>{c.principal_name}</td><td>{c.from} – {c.to}</td>
                <td className={own.num}>{money(c.amount)}{c.settlement ? ` / ${money(c.settlement.amount)}` : ''}</td><td>{aT(`st.${c.status}`)}</td>
                <td className={own.row}>
                  <button type="button" className={controls.btnGhost} onClick={() => setShown(shown === c.id ? '' : c.id)}>{aT('view')}</button>
                  <button type="button" className={controls.btnGhost} onClick={() => downloadCsv(`${c.number.replace(/\//g, '-')}.csv`, claimCsv(c))}>CSV</button>
                  {c.status === 'draft' && <button type="button" className={controls.btnGhost} onClick={() => run(() => `${markClaim(c.id, 'sent').number}: ${aT('st.sent')}`)}>{aT('markSent')}</button>}
                  {(c.status === 'draft' || c.status === 'sent') && <button type="button" className={controls.btnGhost} onClick={() => setSettle({ id: c.id, mode: 'financial', note_no: '', date: todayInput(), amount: String(c.amount), gst_rate: '18' })} data-claim-settle>{aT('settle')}</button>}
                  {(c.status === 'draft' || c.status === 'sent') && <button type="button" className={controls.btnGhost} onClick={() => run(() => `${markClaim(c.id, 'rejected').number}: ${aT('st.rejected')}`)}>{aT('reject')}</button>}
                  {(c.status === 'draft' || c.status === 'rejected') && <button type="button" className={controls.btnGhost} onClick={() => run(() => { deleteClaim(c.id); return aT('deleted'); })}>{aT('delete')}</button>}
                  {c.settlement && <button type="button" className={controls.btnGhost} onClick={() => run(() => `${unsettleClaim(c.id).number}: ${aT('st.sent')}`)}>{aT('undo')}</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!claims.length && <p className={own.muted}>{aT('none')}</p>}
      </div>
      {settle && (
        <div className={own.row} data-settle-form>
          <F label={aT('mode')}>
            <select className={controls.select} value={settle.mode} onChange={(e) => setSettle({ ...settle, mode: e.target.value as 'financial' | 'gst' })}>
              <option value="financial">{aT('settle.financial')}</option>
              <option value="gst">{aT('settle.gst')}</option>
            </select>
          </F>
          <F label={aT('noteNo')}><input className={controls.input} value={settle.note_no} onChange={(e) => setSettle({ ...settle, note_no: e.target.value })} /></F>
          <F label={aT('date')}><input type="date" className={controls.input} value={settle.date} onChange={(e) => setSettle({ ...settle, date: e.target.value })} /></F>
          <F label={aT('amount')}><input type="number" className={controls.input} value={settle.amount} onChange={(e) => setSettle({ ...settle, amount: e.target.value })} /></F>
          {settle.mode === 'gst' && <F label="GST %"><input type="number" className={controls.input} value={settle.gst_rate} onChange={(e) => setSettle({ ...settle, gst_rate: e.target.value })} /></F>}
          <div><button type="button" className={controls.btnPrimary} onClick={() => run(() => { const c = settleClaim(settle.id, { ...settle, amount: Number(settle.amount), gst_rate: Number(settle.gst_rate) }); setSettle(null); return `${c.number}: ${aT(`st.${c.status}`)}`; })}>{aT('save')}</button></div>
        </div>
      )}
      {open && <ClaimPrint c={open} />}
    </>
  );
}

const ClaimPrint = ({ c }: { c: TradeClaim }) => (
  <div className={own.tableWrap} data-claim-print>
    <p><strong>{aT('claimTitle', { n: c.number, to: c.principal_name })}</strong> · {c.from} – {c.to}</p>
    <table className={own.table}>
      <tbody>{claimCsv(c).map((r, i) => <tr key={i}>{r.map((x, j) => (i ? <td key={j}>{typeof x === 'number' && j === 6 ? money(x) : x}</td> : <th key={j}>{x}</th>))}</tr>)}</tbody>
    </table>
    <button type="button" className={controls.btnGhost} onClick={() => window.print()}>{aT('print')}</button>
  </div>
);

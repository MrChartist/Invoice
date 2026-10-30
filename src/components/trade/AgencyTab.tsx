/**
 * Distribution → Agency (TR-C1, agency pack): arrivals of principals' goods, bikri pattis and the indent register.
 * Sub-view in `?view=` (arrivals · pattis · indents). Listed only with the agency pack on; the URL still opens it.
 * Agency sales themselves are ordinary invoices whose lines pick a lot (the editor's lot picker).
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useT } from '../../i18n';
import { trT } from '../../i18n/areas/trade-r8c';
import { isPackOn } from '../../lib/industry-packs';
import { localDb } from '../../lib/localDb';
import { formatCurrency, todayInput } from '../../lib/utils';
import { getTable } from '../../lib/storage';
import { vendorsDb } from '../../lib/vendors';
import { A, chartOf, loadUserAccounts } from '../../lib/ledger/accounts';
import { isCashOrBankLedger } from '../../lib/bank-ledgers';
import type { InvoiceRecord } from '../../types/invoice';
import type { Arrival, Indent, PrincipalKind } from '../../types/trade-r8';
import { agencySales, cancelArrival, loadArrivals, lotBalances, saveArrival, PRINCIPAL_KINDS, type ArrivalInput } from '../../lib/trade/tr-arrivals';
import { cancelPatti, loadPattis, pattiText, postPatti, savePatti, unsettledLots, type DeductionInput } from '../../lib/trade/tr-patti';
import { billCommission, commissionOf, indentStatus, indentSummary, loadIndents, markIndent, saveIndent, type IndentInput } from '../../lib/trade/tr-indents';
import controls from '../../styles/controls.module.css';
import own from '../distribution/dist.module.css';
import { DateField } from '../ui/DateField';
import { SelectField } from '../ui/SelectField';

const VIEWS = ['arrivals', 'pattis', 'indents'] as const;
type View = (typeof VIEWS)[number];
type Done = (msg: string, error?: boolean) => void;

const F = ({ label, children }: { label: string; children: ReactNode }) => (
  <label className={controls.field}>
    <span className={controls.label}>{label}</span>
    {children}
  </label>
);
const money = (n: number) => formatCurrency(n);
const numIn = (v: string) => (v === '' ? 0 : Number(v));

export default function AgencyTab({ onDone }: { onDone: Done }) {
  useT();
  const [params, setParams] = useSearchParams();
  const view: View = (VIEWS as readonly string[]).includes(params.get('view') ?? '') ? (params.get('view') as View) : 'arrivals';
  const [tick, setTick] = useState(0);
  const run = (fn: () => string) => {
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
  const data = useMemo(() => {
    void tick;
    const invoices = getTable<InvoiceRecord>('invoices');
    const arrivals = loadArrivals();
    const sales = agencySales(invoices);
    return { invoices, arrivals, sales, pattis: loadPattis(), indents: loadIndents(), lots: lotBalances(arrivals, sales) };
  }, [tick]);
  const unsettled = unsettledLots(data.arrivals, data.sales, data.pattis).length;
  return (
    <div className={own.stack} data-agency-tab>
      {!isPackOn(localDb.settings.get(), 'agency') && <p className={own.notice}>{trT('packOff')}</p>}
      <div className={controls.segment} role="tablist" aria-label={trT('tab.agency')}>
        {VIEWS.map((v) => (
          <button key={v} type="button" role="tab" aria-selected={view === v} className={view === v ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => go(v)} data-agency-view={v}>
            {trT(`view.${v}`)}
          </button>
        ))}
      </div>
      {unsettled > 0 && <p className={own.notice} data-agency-unsettled>{trT('unsettled', { n: unsettled })}</p>}
      {view === 'arrivals' && <Arrivals data={data} run={run} />}
      {view === 'pattis' && <Pattis data={data} run={run} />}
      {view === 'indents' && <Indents data={data} run={run} />}
      <p className={own.muted}>{trT('workingPaper')}</p>
    </div>
  );
}

type Data = { invoices: InvoiceRecord[]; arrivals: readonly Arrival[]; sales: ReturnType<typeof agencySales>; pattis: ReturnType<typeof loadPattis>; indents: readonly Indent[]; lots: ReturnType<typeof lotBalances> };
type Run = (fn: () => string) => void;

const blankArrival = (): ArrivalInput => ({ date: todayInput(), principal_id: '', principal_name: '', principal_kind: 'agriculturist', lot_no: '', item_name: '', unit: 'QTL', packages: 0, package_kind: 'BAG', qty: 0, advance: 0, advance_account_id: A.cash, produce: 'agricultural' });

function Arrivals({ data, run }: { data: Data; run: Run }) {
  const [a, setA] = useState<ArrivalInput>(blankArrival);
  const set = (p: Partial<ArrivalInput>) => setA((x) => ({ ...x, ...p }));
  const vendors = vendorsDb.all();
  const cashBank = chartOf(loadUserAccounts()).filter(isCashOrBankLedger);
  const save = () =>
    run(() => {
      const v = vendors.find((x) => x.id === a.principal_id);
      // The principal's kind lives on the supplier too (RCM-goods prompt on their bills).
      if (v && a.principal_kind && v.principal_kind !== a.principal_kind) vendorsDb.save({ ...v, principal_kind: a.principal_kind });
      const row = saveArrival({ ...a, principal_name: v?.name ?? '' });
      setA(blankArrival());
      return trT('saved', { n: row.number });
    });
  return (
    <>
      <details className={own.stack} data-arrival-form>
        <summary>{trT('newArrival')}</summary>
        <div className={own.row}>
          <F label={trT('date')}><DateField className={controls.input} value={a.date} onChange={(e) => set({ date: e.target.value })} /></F>
          <F label={trT('principal')}>
            <SelectField className={controls.select} value={a.principal_id} onChange={(e) => set({ principal_id: e.target.value, principal_kind: vendors.find((v) => v.id === e.target.value)?.principal_kind ?? a.principal_kind })} data-arrival-principal>
              <option value="">{trT('pickPrincipal')}</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </SelectField>
          </F>
          <F label={trT('principalKind')}>
            <SelectField className={controls.select} value={a.principal_kind} onChange={(e) => set({ principal_kind: e.target.value as PrincipalKind })}>
              {PRINCIPAL_KINDS.map((k) => <option key={k} value={k}>{trT(`kind.${k}`)}</option>)}
            </SelectField>
          </F>
          <F label={trT('lot')}><input className={controls.input} value={a.lot_no} onChange={(e) => set({ lot_no: e.target.value })} data-arrival-lot /></F>
          <F label={trT('item')}><input className={controls.input} value={a.item_name} onChange={(e) => set({ item_name: e.target.value })} data-arrival-item /></F>
          <F label={trT('hsn')}><input className={controls.input} value={a.hsn ?? ''} onChange={(e) => set({ hsn: e.target.value.replace(/\D/g, '') })} /></F>
          <F label={trT('packages')}><input type="number" min={0} className={controls.input} value={a.packages || ''} onChange={(e) => set({ packages: numIn(e.target.value) })} data-arrival-packages /></F>
          <F label={trT('packageKind')}><input className={controls.input} value={a.package_kind ?? ''} onChange={(e) => set({ package_kind: e.target.value })} /></F>
          <F label={trT('grossWeight')}><input type="number" min={0} className={controls.input} value={a.gross_weight ?? ''} onChange={(e) => set({ gross_weight: e.target.value === '' ? undefined : numIn(e.target.value) })} /></F>
          <F label={trT('netQty')}><input type="number" min={0} step="0.001" className={controls.input} value={a.qty || ''} onChange={(e) => set({ qty: numIn(e.target.value) })} data-arrival-qty /></F>
          <F label={trT('unit')}><input className={controls.input} value={a.unit} onChange={(e) => set({ unit: e.target.value })} data-arrival-unit /></F>
          <F label={trT('produce')}>
            <SelectField className={controls.select} value={a.produce} onChange={(e) => set({ produce: e.target.value as ArrivalInput['produce'] })}>
              <option value="agricultural">{trT('produce.agricultural')}</option>
              <option value="other">{trT('produce.other')}</option>
            </SelectField>
          </F>
          <F label={trT('vehicle')}><input className={controls.input} value={a.vehicle_no ?? ''} onChange={(e) => set({ vehicle_no: e.target.value })} /></F>
          <F label={trT('lr')}><input className={controls.input} value={a.lr_no ?? ''} onChange={(e) => set({ lr_no: e.target.value })} /></F>
          <F label={trT('advance')}><input type="number" min={0} className={controls.input} value={a.advance || ''} onChange={(e) => set({ advance: numIn(e.target.value) })} /></F>
          {(a.advance ?? 0) > 0 && (
            <F label={trT('paidFrom')}>
              <SelectField className={controls.select} value={a.advance_account_id} onChange={(e) => set({ advance_account_id: e.target.value })}>
                {cashBank.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </SelectField>
            </F>
          )}
        </div>
        <div><button type="button" className={controls.btnPrimary} onClick={save} data-arrival-save>{trT('save')}</button></div>
      </details>
      <div className={own.tableWrap}>
        <table className={own.table} data-arrivals>
          <thead><tr><th>{trT('number')}</th><th>{trT('date')}</th><th>{trT('principal')}</th><th>{trT('lot')}</th><th>{trT('item')}</th><th className={own.num}>{trT('netQty')}</th><th className={own.num}>{trT('sold')}</th><th className={own.num}>{trT('balance')}</th><th>{trT('status')}</th><th /></tr></thead>
          <tbody>
            {data.lots.map(({ arrival: r, sold, balance }) => (
              <tr key={r.id} data-arrival={r.number}>
                <td>{r.number}</td><td>{r.date}</td><td>{r.principal_name}</td><td>{r.lot_no}</td><td>{r.item_name}</td>
                <td className={own.num}>{r.qty} {r.unit}</td><td className={own.num}>{sold}</td><td className={own.num}>{balance}</td>
                <td>{r.status === 'cancelled' ? trT('cancelled') : trT('open')}</td>
                <td>
                  {r.status !== 'cancelled' && (
                    <button type="button" className={controls.btnGhost} onClick={() => { const why = window.prompt(trT('cancelReason')); if (why) run(() => `${cancelArrival(r.id, why, data.invoices).number}: ${trT('cancelled')}`); }}>
                      {trT('cancel')}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.lots.length && <p className={own.muted}>{trT('none')}</p>}
      </div>
    </>
  );
}

const DEDUCTIONS: DeductionInput[] = [
  { label: '', basis: 'percent', rate: 0, aadat: true },
  { label: '', basis: 'percent', rate: 0 },
  { label: '', basis: 'per_package', rate: 0 },
  { label: '', basis: 'per_package', rate: 0 },
  { label: '', basis: 'fixed', rate: 0 },
];
const DED_KEYS = ['ded.aadat', 'ded.marketFee', 'ded.hamali', 'ded.tulai', 'ded.freight'] as const;

function Pattis({ data, run }: { data: Data; run: Run }) {
  const [date, setDate] = useState(todayInput);
  const [principal, setPrincipal] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [ded, setDed] = useState<DeductionInput[]>(() => DEDUCTIONS.map((d, i) => ({ ...d, label: trT(DED_KEYS[i]) })));
  const [shown, setShown] = useState('');
  const principals = [...new Map(data.arrivals.filter((a) => a.status !== 'cancelled').map((a) => [a.principal_id, a.principal_name])).entries()];
  const lots = data.lots.filter((l) => l.arrival.principal_id === principal && l.arrival.status !== 'cancelled' && l.sold !== 0);
  const company = localDb.settings.activeProfile()?.companyName ?? '';
  const make = () => run(() => savePatti({ date, principalId: principal, arrivalIds: picked, deductions: ded }, { arrivals: data.arrivals, sales: data.sales }).number);
  const open = data.pattis.find((p) => p.id === shown);
  return (
    <>
      <div className={own.row}>
        <F label={trT('date')}><DateField className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} /></F>
        <F label={trT('principal')}>
          <SelectField className={controls.select} value={principal} onChange={(e) => { setPrincipal(e.target.value); setPicked([]); }} data-patti-principal>
            <option value="">{trT('pickPrincipal')}</option>
            {principals.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
          </SelectField>
        </F>
      </div>
      {principal && (
        <div className={own.stack} data-patti-form>
          <strong>{trT('pickLots')}</strong>
          {lots.map((l) => (
            <label key={l.arrival.id} className={controls.check}>
              <input type="checkbox" checked={picked.includes(l.arrival.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, l.arrival.id] : p.filter((x) => x !== l.arrival.id)))} data-patti-lot={l.arrival.lot_no} />
              {l.arrival.number} · {l.arrival.lot_no} · {l.arrival.item_name}: {l.sold} {l.arrival.unit} → {money(l.amount)}
            </label>
          ))}
          <strong>{trT('deductions')}</strong>
          {ded.map((d, i) => (
            <div key={i} className={own.row}>
              <F label={trT('item')}><input className={controls.input} value={d.label} onChange={(e) => setDed((x) => x.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} /></F>
              <F label={trT('rate')}>
                <input type="number" min={0} step="0.01" className={controls.input} value={d.rate || ''} onChange={(e) => setDed((x) => x.map((y, j) => (j === i ? { ...y, rate: numIn(e.target.value) } : y)))} data-patti-rate={i} />
              </F>
              <F label={trT('commBasis')}>
                <SelectField className={controls.select} value={d.basis} onChange={(e) => setDed((x) => x.map((y, j) => (j === i ? { ...y, basis: e.target.value as DeductionInput['basis'] } : y)))}>
                  {(['percent', 'per_package', 'per_qty', 'fixed'] as const).map((b) => <option key={b} value={b}>{trT(`basis.${b}`)}</option>)}
                </SelectField>
              </F>
            </div>
          ))}
          <div><button type="button" className={controls.btnPrimary} onClick={make} disabled={!picked.length} data-patti-make>{trT('makePatti')}</button></div>
        </div>
      )}
      <div className={own.tableWrap}>
        <table className={own.table} data-pattis>
          <thead><tr><th>{trT('number')}</th><th>{trT('date')}</th><th>{trT('principal')}</th><th className={own.num}>{trT('gross')}</th><th className={own.num}>{trT('totalDeductions')}</th><th className={own.num}>{trT('netPayable')}</th><th>{trT('status')}</th><th /></tr></thead>
          <tbody>
            {data.pattis.map((p) => (
              <tr key={p.id} data-patti={p.number}>
                <td>{p.number}</td><td>{p.date}</td><td>{p.principal_name}</td>
                <td className={own.num}>{money(p.gross)}</td><td className={own.num}>{money(p.total_deductions + p.advance)}</td><td className={own.num}>{money(p.net_payable)}</td>
                <td>{trT(p.status === 'posted' ? 'posted' : p.status === 'cancelled' ? 'cancelled' : 'draft')}</td>
                <td>
                  <button type="button" className={controls.btnGhost} onClick={() => setShown(p.id === shown ? '' : p.id)} data-patti-view>{trT('view')}</button>
                  {p.status === 'draft' && <button type="button" className={controls.btnGhost} onClick={() => run(() => `${postPatti(p.id).number}: ${trT('posted')}`)} data-patti-post>{trT('post')}</button>}
                  {p.status !== 'cancelled' && (
                    <button type="button" className={controls.btnGhost} onClick={() => { const why = window.prompt(trT('cancelReason')); if (why) run(() => `${cancelPatti(p.id, why).number}: ${trT('cancelled')}`); }}>{trT('cancel')}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.pattis.length && <p className={own.muted}>{trT('none')}</p>}
      </div>
      {open && (
        <div className={own.stack} data-patti-print>
          <pre className={own.textarea}>{pattiText(open, company, money)}</pre>
          <p className={own.muted}>{trT(open.commission_gst === 'exempt' ? 'aadatExempt' : 'aadatTaxable')}</p>
          <div className={own.row}>
            <button type="button" className={controls.btnOutline} onClick={() => window.print()}>{trT('print')}</button>
            <a className={controls.btnOutline} href={`https://wa.me/?text=${encodeURIComponent(pattiText(open, company, money))}`} target="_blank" rel="noopener noreferrer">{trT('whatsapp')}</a>
          </div>
        </div>
      )}
    </>
  );
}

const blankIndent = (): IndentInput => ({ date: todayInput(), buyer_name: '', principal_id: '', principal_name: '', item: '', qty: 0, rate: 0, commission_basis: 'percent', commission_rate: 0 });

function Indents({ data, run }: { data: Data; run: Run }) {
  const [x, setX] = useState<IndentInput>(blankIndent);
  const [picked, setPicked] = useState<string[]>([]);
  const set = (p: Partial<IndentInput>) => setX((v) => ({ ...v, ...p }));
  const clients = localDb.clients.getAll();
  const sum = indentSummary(data.indents, data.invoices);
  const save = () =>
    run(() => {
      const row = saveIndent({ ...x, principal_name: clients.find((c) => c.id === x.principal_id)?.name ?? '' });
      setX(blankIndent());
      return trT('saved', { n: row.number });
    });
  return (
    <>
      <p className={own.muted}>{trT('pending', { n: sum.pending })} · {trT('due', { amount: money(sum.due) })}</p>
      <details className={own.stack}>
        <summary>{trT('newIndent')}</summary>
        <div className={own.row}>
          <F label={trT('date')}><DateField className={controls.input} value={x.date} onChange={(e) => set({ date: e.target.value })} /></F>
          <F label={trT('buyer')}><input className={controls.input} value={x.buyer_name} onChange={(e) => set({ buyer_name: e.target.value })} /></F>
          <F label={trT('pickClient')}>
            <SelectField className={controls.select} value={x.principal_id} onChange={(e) => set({ principal_id: e.target.value })}>
              <option value="">-</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </SelectField>
          </F>
          <F label={trT('item')}><input className={controls.input} value={x.item} onChange={(e) => set({ item: e.target.value })} /></F>
          <F label={trT('qty')}><input type="number" min={0} className={controls.input} value={x.qty || ''} onChange={(e) => set({ qty: numIn(e.target.value) })} /></F>
          <F label={trT('unit')}><input className={controls.input} value={x.unit ?? ''} onChange={(e) => set({ unit: e.target.value })} /></F>
          <F label={trT('rate')}><input type="number" min={0} className={controls.input} value={x.rate || ''} onChange={(e) => set({ rate: numIn(e.target.value) })} /></F>
          <F label={trT('commBasis')}>
            <SelectField className={controls.select} value={x.commission_basis} onChange={(e) => set({ commission_basis: e.target.value as IndentInput['commission_basis'] })}>
              <option value="percent">{trT('comm.percent')}</option>
              <option value="per_unit">{trT('comm.per_unit')}</option>
            </SelectField>
          </F>
          <F label={trT('rate')}><input type="number" min={0} step="0.01" className={controls.input} value={x.commission_rate || ''} onChange={(e) => set({ commission_rate: numIn(e.target.value) })} /></F>
          <F label={trT('delivery')}><DateField className={controls.input} value={x.delivery_date ?? ''} onChange={(e) => set({ delivery_date: e.target.value || undefined })} /></F>
        </div>
        <div><button type="button" className={controls.btnPrimary} onClick={save}>{trT('save')}</button></div>
      </details>
      <div className={own.tableWrap}>
        <table className={own.table} data-indents>
          <thead><tr><th /><th>{trT('number')}</th><th>{trT('date')}</th><th>{trT('buyer')}</th><th>{trT('principal')}</th><th>{trT('item')}</th><th className={own.num}>{trT('commission')}</th><th>{trT('status')}</th><th /></tr></thead>
          <tbody>
            {data.indents.map((i) => {
              const st = indentStatus(i, data.invoices);
              return (
                <tr key={i.id}>
                  <td>{(st === 'dispatched' || st === 'paid') && <input type="checkbox" aria-label={i.number} checked={picked.includes(i.id)} onChange={(e) => setPicked((p) => (e.target.checked ? [...p, i.id] : p.filter((y) => y !== i.id)))} />}</td>
                  <td>{i.number}</td><td>{i.date}</td><td>{i.buyer_name}</td><td>{i.principal_name}</td><td>{i.item} · {i.qty}{i.unit ? ` ${i.unit}` : ''}</td>
                  <td className={own.num}>{money(commissionOf(i))}</td><td>{trT(`ist.${st}`)}</td>
                  <td>
                    {st === 'placed' && <button type="button" className={controls.btnGhost} onClick={() => { const ref = window.prompt(trT('principalInvoice')) ?? ''; run(() => markIndent(i.id, 'dispatched', { date: todayInput(), ref }).number); }}>{trT('markDispatched')}</button>}
                    {st === 'dispatched' && <button type="button" className={controls.btnGhost} onClick={() => run(() => markIndent(i.id, 'paid', { date: todayInput() }).number)}>{trT('markPaid')}</button>}
                    {st !== 'billed' && st !== 'cancelled' && (
                      <button type="button" className={controls.btnGhost} onClick={() => { const why = window.prompt(trT('cancelReason')); if (why) run(() => markIndent(i.id, 'cancelled', { date: todayInput(), ref: why }).number); }}>{trT('cancel')}</button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!data.indents.length && <p className={own.muted}>{trT('none')}</p>}
      </div>
      <div>
        <button type="button" className={controls.btnPrimary} disabled={!picked.length} onClick={() => run(() => { const out = billCommission(picked, todayInput()); setPicked([]); return out.map((b) => b.invoice_number).join(', '); })}>
          {trT('billCommission')}
        </button>
      </div>
    </>
  );
}

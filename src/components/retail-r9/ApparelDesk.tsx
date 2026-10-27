/**
 * RT-C Apparel desk (Inventory → Apparel, pack `apparel`) and its host parts — ONE lazy chunk (each chunk name costs
 * the hosts' preload map): views *Alterations* (slips, board, tailor bill), *Size × colour* (stock grid) and *Price
 * bands* (band per item, bulk by HSN, the band table); and the parts the editor, the POS and the supplier bill mount
 * lazily: `EditorApparel` (band hook + Grid button), `BandChip`, `PosApparel` (band hook, chips, alterations due) and
 * `BillGrid`. Working papers — verify with your CA (RT1–RT3).
 */
import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Boxes, Package, Percent } from 'lucide-react';
import { useT } from '../../i18n';
import { rtcT } from '../../i18n/areas/retail-r9c';
import { PRICE_BAND_RULES, type PriceBandKind } from '../../lib/retail-rules';
import { BAND_KINDS, bandAt, bandForHsn, liveBandLookup, setBands, syncBands } from '../../lib/retail/rt-bands';
import { gridAxes, gridParents, parentOfName, purchaseLine, saleLine, soldLast30, stockGrid, stockGridCsv, type StockCell } from '../../lib/retail/rt-matrix';
import { addAlteration, alterationRule, billedJobs, chargeLine, deleteAlteration, dueJobs, loadAlterations, makeTailorBill, moveAlteration, nextStatus, readyLink } from '../../lib/retail/rt-alterations';
import { stockDb } from '../../lib/inventory';
import { loadTracking } from '../../lib/stock-tracking';
import { godownsDb } from '../../lib/godowns';
import { vendorsDb } from '../../lib/vendors';
import { localDb } from '../../lib/localDb';
import { generateId, getTable } from '../../lib/storage';
import { num } from '../../lib/invoice-calc';
import { formatCurrency, todayInput } from '../../lib/utils';
import { shiftDay } from '../../lib/dates';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { downloadTextFile } from '../receivables/exportUtils';
import { NumberInput } from '../ui/NumberInput';
import MatrixEntryDialog from './MatrixEntryDialog';
import AlterationSlip from './AlterationSlip';
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { PurchaseLine } from '../../types/purchases';
import type { AlterationJob, AlterationStatus } from '../../types/retail-r9';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';

type Done = (msg: string, error?: boolean) => void;
const VIEWS = [['alterations', Package], ['matrix', Boxes], ['bands', Percent]] as const;
const sm = `${controls.btnOutline} ${controls.btnSm}`;

export default function ApparelDesk({ view, onDone }: { view?: string; onDone: Done }) {
  useT();
  const v = VIEWS.some(([id]) => id === view) ? view : 'alterations';
  return (
    <section className={surface.card} data-apparel-desk={v}>
      <div className={surface.cardHead}>
        <span className={controls.segment}>
          {VIEWS.map(([id, Icon]) => (
            <Link key={id} to={`/inventory?tab=apparel&view=${id}`} className={id === v ? `${controls.segmentBtn} ${controls.segmentBtnActive}` : controls.segmentBtn}><Icon size={14} aria-hidden="true" /> {rtcT(`view.${id}`)}</Link>
          ))}
        </span>
      </div>
      <div className={surface.cardBody}>
        {v === 'matrix' ? <MatrixView /> : v === 'bands' ? <BandsView onDone={onDone} /> : <AlterationsView onDone={onDone} />}
        <p className={controls.hint}>{rtcT('workingPaper')}</p>
      </div>
    </section>
  );
}

/* ── RT-C1 Price bands ── */

function BandsView({ onDone }: { onDone: Done }) {
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const items = useMemo(() => stockDb.items().filter((i) => !i.variant_of).sort((a, b) => a.name.localeCompare(b.name)), [tick]);
  const run = (fn: () => string) => {
    try {
      onDone(fn());
      setTick((t) => t + 1);
    } catch (e) {
      onDone((e as Error).message, true);
    }
  };
  const bulk = () => run(() => rtcT('bulkDone', { n: setBands(items.filter((i) => !i.gst_band && bandForHsn(i.hsn)).map((i) => ({ id: i.id, band: bandForHsn(i.hsn) }))) }));
  return (
    <>
      <h3 className={surface.cardHeadIcon}><Percent size={16} aria-hidden="true" /> {rtcT('bandsTitle')}</h3>
      <p className={surface.sectionNote}>{rtcT('bandsHint')}</p>
      <ul className={controls.hint} data-band-rules>
        {BAND_KINDS.flatMap((k) => PRICE_BAND_RULES[k].map((r) => (
          <li key={`${k}${r.from}`}>{rtcT('ruleRow', { kind: rtcT(`band.${k}`), from: r.from, upTo: r.value.upTo, rate: r.value.rate, above: r.value.above })}{r.verified ? '' : ` (${rtcT('unverified')})`}</li>
        )))}
      </ul>
      <button type="button" className={sm} onClick={bulk} data-band-bulk>{rtcT('bulkHsn')}</button>
      {items.length === 0 ? <p className={controls.hint}>{rtcT('noItems')}</p> : (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th>{rtcT('colItem')}</th><th>HSN</th><th>{rtcT('colBand')}</th></tr></thead>
            <tbody>
              {items.slice(0, 300).map((i) => (
                <tr key={i.id}>
                  <td>{i.name}</td>
                  <td className={surface.mono}>{i.hsn ?? ''}</td>
                  <td>
                    <select className={controls.select} value={i.gst_band ?? ''} aria-label={`${rtcT('colBand')} ${i.name}`} data-band-item={i.name}
                      onChange={(e) => run(() => (setBands([{ id: i.id, band: (e.target.value || undefined) as PriceBandKind | undefined }]), rtcT('bandSaved', { name: i.name })))}>
                      <option value="">{rtcT('bandNone')}</option>
                      {BAND_KINDS.map((k) => <option key={k} value={k}>{rtcT(`band.${k}`)}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/** The line chip (editor): "5% band · ₹2,379/pc", or "rate typed by hand". */
export function BandChip({ item, date }: { item: InvoiceItem; date?: string }) {
  useT();
  const b = item.band_rate;
  if (!b || (b.rate === undefined && !b.manual)) return null;
  if (b.manual) return <div className={controls.hint} data-band-chip="manual">{rtcT('chipManual')}</div>;
  const vars = { rate: b.rate ?? 0, value: b.value_per_piece.toLocaleString('en-IN'), limit: bandAt(b.kind, date).upTo.toLocaleString('en-IN') };
  return <div className={controls.hint} title={rtcT('chipTip', vars)} data-band-chip={b.rate}><Percent size={12} aria-hidden="true" /> {rtcT('chip', vars)}</div>;
}

/** Editor: keeps band lines' rates in step (rate, discount, quantity, invoice discount, date) and the Grid button. */
export function EditorApparel({ gridOn }: { gridOn: boolean }) {
  useT();
  useEffect(() => {
    const run = () => {
      const st = useInvoiceStore.getState();
      const next = syncBands(st as unknown as InvoiceRecord);
      if (next !== st.items) st.patch({ items: next });
    };
    run();
    return useInvoiceStore.subscribe(run);
  }, []);
  const [open, setOpen] = useState(false);
  const items = useInvoiceStore((s) => s.items);
  if (!gridOn) return null;
  const parentId = [...items].reverse().map((l) => parentOfName(l.name, stockDb.items())).find(Boolean)?.id;
  return (
    <>
      <button type="button" className={controls.btnOutline} onClick={() => setOpen(true)} data-grid-open><Boxes size={16} aria-hidden="true" /> {rtcT('gridBtn')}</button>
      {open && (
        <MatrixEntryDialog<InvoiceItem> open lines={items} parentId={parentId} rateOf={(p) => num(p.sale_rate)} onClose={() => setOpen(false)}
          make={(c, p, q, r) => saleLine(c, p, q, r, generateId())} onApply={(lines) => useInvoiceStore.getState().patch({ items: lines })} />
      )}
    </>
  );
}

/** Supplier bill: the Grid button (one grid → one line per non-zero cell, stock-in by item id). */
export function BillGrid({ lines, onChange }: { lines: PurchaseLine[]; onChange: (lines: PurchaseLine[]) => void }) {
  useT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={sm} onClick={() => setOpen(true)} data-grid-open><Boxes size={14} aria-hidden="true" /> {rtcT('gridBtn')}</button>
      {open && <MatrixEntryDialog<PurchaseLine> open lines={lines} rateOf={(p) => num(p.opening_rate)} onClose={() => setOpen(false)} make={(c, p, q, r) => purchaseLine(c, p, q, r, generateId())} onApply={onChange} />}
    </>
  );
}

/** POS: bands on the cart (after offers / loyalty / voucher discounts), their chips, and today's due alterations. */
export function PosApparel({ record, setItems }: { record: InvoiceRecord; setItems: Dispatch<SetStateAction<InvoiceItem[]>> }) {
  useT();
  useEffect(() => {
    const next = syncBands(record, liveBandLookup());
    if (next === record.items) return;
    const by = new Map(next.map((l) => [l.id, l]));
    setItems((cur) => cur.map((l) => ((n) => (n && (n.tax_rate !== l.tax_rate || n.band_rate !== l.band_rate) ? { ...l, tax_rate: n.tax_rate, band_rate: n.band_rate } : l))(by.get(l.id))));
  }, [record, setItems]);
  const due = useMemo(() => dueJobs(loadAlterations(), todayInput()).length, []);
  const banded = record.items.filter((l) => l.band_rate?.rate !== undefined);
  if (!banded.length && !due) return null;
  return (
    <div className={controls.hint} data-pos-bands>
      {banded.length > 0 && <strong>{rtcT('posBands')}: </strong>}
      {banded.map((l) => <span key={l.id} data-band-line={l.name}>{l.name} — <BandChipText item={l} date={record.issue_date} />; </span>)}
      {due > 0 && <Link to="/inventory?tab=apparel&view=alterations" data-pos-alt-due>{rtcT('dueCount', { n: due })}</Link>}
    </div>
  );
}
const BandChipText = ({ item, date }: { item: InvoiceItem; date: string }) => <span title={rtcT('chipTip', { rate: item.band_rate?.rate ?? 0, value: item.band_rate?.value_per_piece ?? 0, limit: bandAt(item.band_rate!.kind, date).upTo })}>{rtcT('chip', { rate: item.band_rate?.rate ?? 0, value: item.band_rate?.value_per_piece ?? 0 })}</span>;

/* ── RT-C2 stock matrix ── */

function MatrixView() {
  const all = useMemo(() => stockDb.items(), []);
  const parents = useMemo(() => gridParents(all), [all]);
  const godowns = useMemo(() => godownsDb.list(), []);
  const [pid, setPid] = useState(parents[0]?.id ?? '');
  const [godown, setGodown] = useState('');
  const parent = parents.find((p) => p.id === pid);
  const tracking = useMemo(() => loadTracking(), []);
  const today = todayInput();
  const sold = useMemo(() => soldLast30(getTable<InvoiceRecord>('invoices'), all, today), [all, today]);
  const cells = parent ? stockGrid(parent, all, (id) => { const t = tracking.get(id); return godown ? t?.byGodown[godown] ?? 0 : t?.qty ?? 0; }, sold) : [];
  const axes = parent ? gridAxes(parent) : [];
  const [rowAx, colAx, tabAx] = axes;
  const cell = (c: StockCell | undefined) => !c ? <td /> : (
    <td className={surface.numeric} data-matrix-cell={c.key} style={c.qty <= 0 ? { color: 'var(--loss)' } : undefined} title={c.child?.name}>
      <strong>{c.qty}</strong>{c.qty <= 0 && <small> {rtcT('soldOut')}</small>}<br /><small>{rtcT('sold30', { n: c.sold })}</small>
    </td>
  );
  const table = (tabVal?: string) => (
    <div className={surface.tableWrap} key={tabVal ?? '-'}>
      {tabVal && <strong>{tabAx.name}: {tabVal}</strong>}
      <table className={surface.table}>
        <thead><tr><th>{rowAx.name}</th>{(colAx?.values ?? ['']).map((c) => <th key={c} className={surface.numeric}>{c || '—'}</th>)}</tr></thead>
        <tbody>{rowAx.values.map((r) => <tr key={r}><th>{r}</th>{(colAx?.values ?? ['']).map((c) => <td key={c} style={{ padding: 0 }}>{cell(cells.find((x) => x.attrs[rowAx.name] === r && (!colAx || x.attrs[colAx.name] === c) && (!tabAx || x.attrs[tabAx.name] === tabVal)))}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
  return (
    <>
      <h3 className={surface.cardHeadIcon}><Boxes size={16} aria-hidden="true" /> {rtcT('matrixTitle')}</h3>
      {parents.length === 0 ? <p className={controls.hint}>{rtcT('gridNoStyle')}</p> : (
        <>
          <div className={controls.row} style={{ flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' }}>
            <label className={controls.field}><span className={controls.label}>{rtcT('gridStyle')}</span>
              <select className={controls.select} value={pid} onChange={(e) => setPid(e.target.value)} data-matrix-style>{parents.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
            </label>
            {godowns.length > 1 && (
              <label className={controls.field}><span className={controls.label}>{rtcT('godown')}</span>
                <select className={controls.select} value={godown} onChange={(e) => setGodown(e.target.value)}><option value="">{rtcT('allGodowns')}</option>{godowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select>
              </label>
            )}
            {parent && <button type="button" className={sm} onClick={() => downloadTextFile(`Stock_grid_${parent.name.replace(/\W+/g, '_')}_${today}.csv`, stockGridCsv(parent, cells))}>{rtcT('csv')}</button>}
          </div>
          {parent && rowAx && (tabAx ? tabAx.values.map((x) => table(x)) : table())}
        </>
      )}
    </>
  );
}

/* ── RT-C3 alterations ── */

const BLANK = { customer: '', phone: '', garment: '', notes: '', tailor_id: '', due: '', charge: 0, tailor_rate: 0 };

function AlterationsView({ onDone }: { onDone: Done }) {
  const navigate = useNavigate();
  const day = todayInput();
  const [tick, setTick] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const jobs = useMemo(() => loadAlterations().sort((a, b) => a.due.localeCompare(b.due) || a.number.localeCompare(b.number)), [tick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const billed = useMemo(() => billedJobs(jobs, getTable<InvoiceRecord>('invoices')), [jobs]);
  const tailors = useMemo(() => vendorsDb.all(), []);
  const [form, setForm] = useState({ ...BLANK, due: shiftDay(day, 3) });
  const [shown, setShown] = useState<string>('');
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [tb, setTb] = useState({ tailor: '', from: shiftDay(day, -6), to: day });
  const shop = localDb.settings.activeProfile()?.companyName ?? '';
  const run = (fn: () => string | Promise<string>) => {
    Promise.resolve().then(fn).then((m) => { setTick((t) => t + 1); onDone(m); }).catch((e: Error) => onDone(e.message, true));
  };
  const save = () => run(() => {
    const t = tailors.find((x) => x.id === form.tailor_id);
    const job = addAlteration({ ...form, date: day, ...(t ? { tailor_id: t.id, tailor_name: t.name } : { tailor_id: undefined }) });
    setShown(job.id);
    setForm({ ...BLANK, due: shiftDay(day, 3) });
    return rtcT('saved', { number: job.number });
  });
  const bill = (j: AlterationJob) => {
    const line = chargeLine(j, day, generateId());
    if (!line) return;
    const st = useInvoiceStore.getState();
    st.newDraft();
    st.setClient({ name: j.customer, phone: j.phone ?? '' });
    st.patch({ items: [line] });
    navigate('/invoice');
  };
  const list = jobs.filter((j) => filter === 'all' || (j.status !== 'delivered' && j.status !== 'cancelled'));
  const slip = jobs.find((j) => j.id === shown);
  const rule = alterationRule(day);
  const f = (k: keyof typeof BLANK) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  return (
    <>
      <h3 className={surface.cardHeadIcon}><Package size={16} aria-hidden="true" /> {rtcT('altTitle')}</h3>
      <p className={surface.sectionNote}>{rtcT('altSub')} {rtcT('chargeNote', { sac: rule.sac, rate: rule.rate })}</p>
      <div className={controls.row} style={{ flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' }} data-alt-form>
        <label className={controls.field}><span className={controls.label}>{rtcT('customer')}</span><input className={controls.input} value={form.customer} onChange={f('customer')} data-alt-customer /></label>
        <label className={controls.field}><span className={controls.label}>{rtcT('phone')}</span><input className={controls.input} inputMode="tel" value={form.phone} onChange={f('phone')} /></label>
        <label className={controls.field}><span className={controls.label}>{rtcT('garment')}</span><input className={controls.input} value={form.garment} onChange={f('garment')} data-alt-garment /></label>
        <label className={controls.field}><span className={controls.label}>{rtcT('notes')}</span><input className={controls.input} value={form.notes} onChange={f('notes')} /></label>
        <label className={controls.field}><span className={controls.label}>{rtcT('tailor')}</span>
          <select className={controls.select} value={form.tailor_id} onChange={f('tailor_id')}><option value="">{rtcT('tailorNone')}</option>{tailors.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
        </label>
        <label className={controls.field}><span className={controls.label}>{rtcT('due')}</span><input type="date" className={controls.input} value={form.due} onChange={f('due')} /></label>
        <label className={controls.field} style={{ maxWidth: 130 }}><span className={controls.label}>{rtcT('charge')}</span><NumberInput className={controls.input} value={form.charge} onChange={(charge) => setForm({ ...form, charge })} data-alt-charge /></label>
        <label className={controls.field} style={{ maxWidth: 110 }}><span className={controls.label}>{rtcT('tailorRate')}</span><NumberInput className={controls.input} value={form.tailor_rate} onChange={(tailor_rate) => setForm({ ...form, tailor_rate })} /></label>
        <button type="button" className={controls.btnPrimary} disabled={!form.customer.trim() || !form.garment.trim()} onClick={save} data-alt-save>{rtcT('save')}</button>
      </div>
      {slip && <AlterationSlip job={slip} shop={shop} />}
      <div className={controls.segment} style={{ margin: '0.75rem 0 0.25rem' }}>
        {(['open', 'all'] as const).map((x) => <button key={x} type="button" className={x === filter ? `${controls.segmentBtn} ${controls.segmentBtnActive}` : controls.segmentBtn} onClick={() => setFilter(x)}>{x === 'open' ? `${rtcT('st.received')} / ${rtcT('st.with_tailor')} / ${rtcT('st.ready')}` : '∑'}</button>)}
      </div>
      {list.length === 0 ? <p className={controls.hint}>{rtcT('empty')}</p> : (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th>#</th><th>{rtcT('customer')}</th><th>{rtcT('garment')}</th><th>{rtcT('tailor')}</th><th>{rtcT('due')}</th><th className={surface.numeric}>₹</th><th /></tr></thead>
            <tbody>
              {list.map((j) => {
                const nx = nextStatus(j.status);
                const wa = j.status === 'ready' ? readyLink(j, rtcT('readyMsg', { name: j.customer, garment: j.garment, number: j.number, shop })) : undefined;
                return (
                  <tr key={j.id} data-alt-row={j.number}>
                    <td><button type="button" className={controls.btnGhost} onClick={() => setShown(j.id)}>{j.number}</button><br /><small>{rtcT(`st.${j.status}`)}</small></td>
                    <td>{[j.customer, j.phone].filter(Boolean).join(' · ')}</td>
                    <td>{j.garment}{j.notes ? <><br /><small>{j.notes}</small></> : null}</td>
                    <td>{j.tailor_name ?? '—'}</td>
                    <td>{j.due}{j.due < day && (j.status === 'received' || j.status === 'with_tailor') ? <small style={{ color: 'var(--loss)' }}> {rtcT('overdue')}</small> : null}</td>
                    <td className={surface.numeric}>{j.charge > 0 ? formatCurrency(j.charge) : rtcT('free')}</td>
                    <td style={{ textAlign: 'right' }}>
                      {nx && <button type="button" className={sm} onClick={() => run(() => (moveAlteration(j.id, nx, day), rtcT(`st.${nx}`)))} data-alt-next={nx}>{rtcT(`go.${nx as Exclude<AlterationStatus, 'received' | 'cancelled'>}`)}</button>}
                      {wa && <a className={`${controls.btnGhost} ${controls.btnSm}`} href={wa} target="_blank" rel="noopener noreferrer">{rtcT('wa')}</a>}
                      {j.charge > 0 && j.status !== 'cancelled' && (billed.has(j.id) ? <small> {rtcT('billed')}</small> : <button type="button" className={sm} onClick={() => bill(j)} data-alt-bill>{rtcT('bill', { amount: j.charge })}</button>)}
                      {nx && <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => run(() => (moveAlteration(j.id, 'cancelled', day), rtcT('st.cancelled')))}>{rtcT('cancel')}</button>}
                      <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => window.confirm(rtcT('confirmDel', { number: j.number })) && run(() => (deleteAlteration(j.id), `${j.number} ✓`))}>{rtcT('del')}</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {tailors.length > 0 && (
        <div className={controls.row} style={{ flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', marginTop: '0.75rem' }}>
          <label className={controls.field}><span className={controls.label}>{rtcT('tailor')}</span>
            <select className={controls.select} value={tb.tailor} onChange={(e) => setTb({ ...tb, tailor: e.target.value })}><option value="">—</option>{tailors.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          </label>
          <label className={controls.field}><span className={controls.label}>{rtcT('from')}</span><input type="date" className={controls.input} value={tb.from} onChange={(e) => setTb({ ...tb, from: e.target.value })} /></label>
          <label className={controls.field}><span className={controls.label}>{rtcT('to')}</span><input type="date" className={controls.input} value={tb.to} onChange={(e) => setTb({ ...tb, to: e.target.value })} /></label>
          <button type="button" className={sm} disabled={!tb.tailor} onClick={() => run(async () => {
            const t = tailors.find((x) => x.id === tb.tailor)!;
            const r = await makeTailorBill({ id: t.id, name: t.name }, tb.from, tb.to);
            return rtcT('tbDone', { n: r.n, total: r.total });
          })}>{rtcT('tailorBill')}</button>
        </div>
      )}
    </>
  );
}



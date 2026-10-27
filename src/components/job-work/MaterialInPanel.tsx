import { useMemo, useState } from 'react';
import { PackageCheck, Pencil, Plus, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { cn, formatDate, formatMoney, todayInput } from '../../lib/utils';
import { num } from '../../lib/invoice-calc';
import { computeStockDetailed } from '../../lib/inventory';
import { bomsDb } from '../../lib/manufacturing';
import { bomConsumption, materialInDb } from '../../lib/job-work';
import type { JobWorkReceiptLine, MaterialIn } from '../../types/job-work';
import { jwT } from '../../i18n/areas/job-work';
import { JwLinesGrid } from './JwLinesGrid';
import { collectEvents } from '../../lib/inventory';
import { serialsAvailable } from '../../lib/serial-vouchers';
import { blankJwLine, cleanJw, qtyText, type JwData, type JwGridLine } from './lines';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './job-work.module.css';

const DRAFT = '__jw_draft__';

/** Material In: processed goods, scrap and returned inputs from a job worker; inputs consumed there; losses; 5C supplies. */
export function MaterialInPanel({ data }: { data: JwData }) {
  const { ctx } = data;
  const [editing, setEditing] = useState<MaterialIn | 'new' | null>(null);
  const [deleting, setDeleting] = useState<MaterialIn | null>(null);
  const rows = [...data.ins].sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number, undefined, { numeric: true }));
  const name = (id: string) => ctx.items.find((i) => i.id === id)?.name ?? '?';

  return (
    <>
      <div className={styles.bar}>
        <span className={styles.muted}>{data.jwGodowns.length ? jwT('received') : jwT('noJobWorkers')}</span>
        {ctx.canBooks && data.jwGodowns.length > 0 && (
          <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={() => setEditing('new')}>
            <Plus size={14} aria-hidden="true" /> {jwT('newIn')}
          </button>
        )}
      </div>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead>
            <tr><th>{jwT('number')}</th><th>{jwT('date')}</th><th>{jwT('jobWorker')}</th><th>{jwT('received')}</th><th className={styles.num}>{jwT('charges')}</th><th><span className={surface.srOnly}>{jwT('actions')}</span></th></tr>
          </thead>
          <tbody>
            {rows.map((v) => (
              <tr key={v.id}>
                <td className={styles.mono}>{v.number}</td>
                <td>{formatDate(v.date)}</td>
                <td>{v.party_name}{v.jw_challan_no ? <div className={styles.muted}>{v.jw_challan_no}</div> : null}</td>
                <td>{[...v.received, ...(v.supplied ?? [])].map((l) => `${name(l.item_id)} × ${qtyText(num(l.qty))}${l.unit ? ` ${l.unit}` : ''}`).join(', ') || '—'}</td>
                <td className={styles.num}>{v.charges ? formatMoney(v.charges) : '—'}</td>
                <td className={surface.rowActions}>
                  {ctx.canBooks && (
                    <>
                      <button type="button" className={controls.btnIcon} aria-label={`${jwT('edit')} ${v.number}`} onClick={() => setEditing(v)}><Pencil size={15} /></button>
                      <button type="button" className={controls.btnDanger} aria-label={`${jwT('delete')} ${v.number}`} onClick={() => setDeleting(v)}><Trash2 size={15} /></button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className={styles.muted}>{jwT('empty')}</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && <InModal data={data} doc={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      <ConfirmDialog
        open={!!deleting} destructive title={jwT('delete')} message={jwT('confirmDelete', { number: deleting?.number ?? '' })} confirmLabel={jwT('delete')}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          try {
            materialInDb.remove(deleting.id);
            ctx.changed(jwT('deleted', { number: deleting.number }));
          } catch (e) {
            ctx.error((e as Error).message);
          }
        }}
      />
    </>
  );
}

function InModal({ data, doc, onClose }: { data: JwData; doc: MaterialIn | null; onClose: () => void }) {
  const { ctx } = data;
  const partyOf = (godownId: string) => {
    const last = [...data.outs].filter((o) => o.job_worker_godown === godownId).sort((a, b) => b.date.localeCompare(a.date))[0];
    const g = data.jwGodowns.find((x) => x.id === godownId);
    return { party_name: last?.party_name ?? g?.name.replace(/ \(job worker\)$/, '') ?? '', vendor_id: last?.vendor_id ?? g?.vendor_id, party_gstin: last?.party_gstin };
  };
  const [date, setDate] = useState(doc?.date ?? todayInput());
  const [godown, setGodown] = useState(doc?.job_worker_godown ?? data.jwGodowns[0]?.id ?? '');
  const [orderId, setOrderId] = useState(doc?.order_id ?? '');
  const [jwNo, setJwNo] = useState(doc?.jw_challan_no ?? '');
  const [jwDate, setJwDate] = useState(doc?.jw_challan_date ?? '');
  const [via, setVia] = useState(doc?.via_party_name ?? '');
  const [viaGstin, setViaGstin] = useState(doc?.via_party_gstin ?? '');
  const [consumed, setConsumed] = useState<JwGridLine[]>(() => doc?.consumed.map((l) => ({ ...l })) ?? [blankJwLine()]);
  const [received, setReceived] = useState<JwGridLine[]>(() => doc?.received.map((l) => ({ ...l })) ?? [blankJwLine({ kind: 'processed' })]);
  const [losses, setLosses] = useState<JwGridLine[]>(() => doc?.losses?.map((l) => ({ ...l })) ?? []);
  const [supplied, setSupplied] = useState<JwGridLine[]>(() => doc?.supplied?.map((l) => ({ ...l })) ?? []);
  const [supplyInv, setSupplyInv] = useState(doc?.supply_invoice_no ?? '');
  const [charges, setCharges] = useState(doc?.charges ? String(doc.charges) : '');
  const [narration, setNarration] = useState(doc?.narration ?? '');
  const [error, setError] = useState('');
  const [hint, setHint] = useState('');
  // 7S: serial-tracked items come back by serial (returned / consumed / lost from the job worker's godown; processed under new serials).
  const tracked = useMemo(() => ctx.items.filter((i) => i.track_stock).sort((a, b) => a.name.localeCompare(b.name)), [ctx.items]);
  const serialPool = useMemo(() => {
    let events: ReturnType<typeof collectEvents> | null = null;
    return (id: string) => {
      const docs = ctx.inputs.jobWorkDocs;
      events ??= collectEvents({ ...ctx.inputs, includeTransfers: true, jobWorkDocs: docs ? { ...docs, ins: docs.ins.filter((x) => x.id !== doc?.id) } : docs });
      return serialsAvailable(id, date, godown, events);
    };
  }, [ctx.inputs, doc, date, godown]);
  const anyBatch = tracked.some((i) => i.track_batches);
  const challans = data.balances.lines.filter((l) => l.godown === godown && (l.pending > 0 || doc)).map((l) => ({ id: l.lineId, item_id: l.item_id, label: `${l.number} · ${qtyText(l.pending)}` }));
  const orders = data.orders.filter((o) => o.direction === 'out');
  const party = partyOf(godown);

  const draft = useMemo((): MaterialIn => ({
    id: doc?.id ?? DRAFT, number: doc?.number ?? '', date, ...party, job_worker_godown: godown, order_id: orderId || undefined,
    jw_challan_no: jwNo.trim() || undefined, jw_challan_date: jwDate || undefined, via_party_name: via.trim() || undefined, via_party_gstin: viaGstin.trim().toUpperCase() || undefined,
    consumed: cleanJw(consumed), received: cleanJw(received).map((l) => ({ ...l, kind: l.kind ?? 'processed' })) as JobWorkReceiptLine[],
    ...(cleanJw(losses).length ? { losses: cleanJw(losses) } : {}), ...(cleanJw(supplied).length ? { supplied: cleanJw(supplied), supply_invoice_no: supplyInv.trim() || undefined } : {}),
    charges: num(charges) > 0 ? num(charges) : undefined, narration: narration.trim() || undefined,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [doc, date, godown, orderId, jwNo, jwDate, via, viaGstin, consumed, received, losses, supplied, supplyInv, charges, narration]);

  const preview = useMemo(() => {
    if (!draft.consumed.length || !draft.received.some((l) => l.kind === 'processed')) return null;
    try {
      const docs = ctx.inputs.jobWorkDocs ?? { outs: data.outs, ins: [], rejections: [] };
      const vc = computeStockDetailed({ ...ctx.inputs, asOf: date, jobWorkDocs: { ...docs, ins: [...docs.ins.filter((x) => x.id !== draft.id), draft] } }).vouchers.get(draft.id);
      return vc ? { inputs: vc.consumed, charges: vc.extra, scrap: vc.fixed, total: vc.pool } : null;
    } catch {
      return null;
    }
  }, [ctx.inputs, data.outs, draft, date]);

  const fillBom = () => {
    const processed = cleanJw(received).filter((l) => (l.kind ?? 'processed') === 'processed');
    const first = processed[0];
    const order = data.orders.find((o) => o.id === orderId);
    const bom = (order?.bom_id ? bomsDb.all().find((b) => b.id === order.bom_id) : undefined) ?? (first ? bomsDb.forItem(first.item_id)[0] : undefined);
    if (!first || !bom) return setHint(jwT('noBomFor'));
    const qty = processed.filter((l) => l.item_id === bom.item_id).reduce((s, l) => s + num(l.qty) * (num(l.unit_factor) || 1), 0);
    setConsumed(bomConsumption(bom, qty));
    setHint(jwT('fillBomHint', { qty: qtyText(qty), item: ctx.items.find((i) => i.id === bom.item_id)?.name ?? '' }));
  };

  const submit = () => {
    try {
      const { id: _id, number: _n, ...rest } = draft;
      void _id; void _n;
      const saved = materialInDb.save({ ...rest, id: doc?.id, number: doc?.number }, ctx.items);
      onClose();
      ctx.changed(jwT('saved', { number: saved.number }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const grid = { godowns: data.ownGodowns, batch: anyBatch, units: data.units };
  return (
    <Modal open onClose={onClose} size="xl" title={doc ? `${jwT('secIn')} ${doc.number}` : jwT('newIn')}
      subtitle={doc ? undefined : jwT('nextNumber', { number: materialInDb.nextNumber(date) })}
      footer={<><button type="button" className={controls.btnOutline} onClick={onClose}>{jwT('cancel')}</button><button type="button" className={controls.btnPrimary} onClick={submit}><PackageCheck size={16} aria-hidden="true" /> {jwT('save')}</button></>}>
      <form className={styles.form} noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }}>
        <div className={controls.row3}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="jwr-date">{jwT('date')}</label>
            <input id="jwr-date" type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="jwr-jw">{jwT('jobWorker')}</label>
            <select id="jwr-jw" className={controls.select} value={godown} onChange={(e) => setGodown(e.target.value)} disabled={!!doc}>
              {data.jwGodowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="jwr-order">{jwT('order')}</label>
            <select id="jwr-order" className={controls.select} value={orderId} onChange={(e) => setOrderId(e.target.value)}>
              <option value="">{jwT('noOrder')}</option>
              {orders.map((o) => <option key={o.id} value={o.id}>{o.number} · {o.party_name}</option>)}
            </select>
          </div>
        </div>
        <div className={controls.row3}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="jwr-no">{jwT('jwChallanNo')}</label>
            <input id="jwr-no" className={controls.input} value={jwNo} onChange={(e) => setJwNo(e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="jwr-dt">{jwT('jwChallanDate')}</label>
            <input id="jwr-dt" type="date" className={controls.input} value={jwDate} onChange={(e) => setJwDate(e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="jwr-ch">{jwT('charges')}</label>
            <input id="jwr-ch" className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" value={charges} onChange={(e) => setCharges(e.target.value)} />
          </div>
        </div>
        <p className={styles.muted}>{jwT('chargesHint')}</p>
        <p className={styles.section}>{jwT('received')}</p>
        <JwLinesGrid lines={received} items={tracked} onChange={setReceived} opts={{ ...grid, label: jwT('received'), kinds: true, serials: 'byKind', serialPool }} />
        <div className={styles.bar} style={{ padding: 0 }}>
          <p className={styles.section}>{jwT('consumed')}</p>
          <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={fillBom}>{jwT('fillBom')}</button>
        </div>
        {hint && <p className={styles.muted} role="status">{hint}</p>}
        <JwLinesGrid lines={consumed} items={tracked} onChange={setConsumed} opts={{ label: jwT('consumed'), batch: anyBatch, challans, units: data.units, serials: 'out', serialPool }} />
        {preview && (
          <p className={cn(styles.notice, styles.info)} role="status">
            {jwT('costPreview', { inputs: formatMoney(preview.inputs), charges: formatMoney(preview.charges), scrap: formatMoney(preview.scrap), total: formatMoney(preview.total) })}
          </p>
        )}
        <p className={styles.section}>{jwT('losses')}</p>
        <JwLinesGrid lines={losses} items={tracked} onChange={setLosses} opts={{ label: jwT('losses'), batch: anyBatch, challans, units: data.units, serials: 'out', serialPool }} />
        {losses.length > 0 && <label className={styles.muted}><input type="checkbox" checked={losses.some((l) => l.mf?.scrap_at_jw)} onChange={(e) => setLosses(losses.map((l) => ({ ...l, mf: { ...l.mf, scrap_at_jw: e.target.checked || undefined } })))} data-jw-scrap-at-jw /> {jwT('scrapAtJw')}</label>}
        <p className={styles.section}>{jwT('supplied')}</p>
        <p className={styles.muted}>{jwT('supplyHint')}</p>
        <JwLinesGrid lines={supplied} items={tracked} onChange={setSupplied} opts={{ ...grid, label: jwT('supplied'), challans, serials: 'out', serialPool }} />
        {supplied.length > 0 && (
          <div className={controls.field}>
            <label className={controls.label} htmlFor="jwr-inv">{jwT('supplyInvoice')}</label>
            <input id="jwr-inv" className={controls.input} value={supplyInv} onChange={(e) => setSupplyInv(e.target.value)} />
          </div>
        )}
        <div className={controls.row3}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="jwr-via">{jwT('viaParty')}</label>
            <input id="jwr-via" className={controls.input} value={via} onChange={(e) => setVia(e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="jwr-viag">{jwT('viaGstin')}</label>
            <input id="jwr-viag" className={controls.input} value={viaGstin} onChange={(e) => setViaGstin(e.target.value)} disabled={!via.trim()} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="jwr-narr">{jwT('narration')}</label>
            <input id="jwr-narr" className={controls.input} value={narration} onChange={(e) => setNarration(e.target.value)} />
          </div>
        </div>
        {error && <p className={cn(styles.notice, styles.danger)} role="alert">{error}</p>}
      </form>
    </Modal>
  );
}

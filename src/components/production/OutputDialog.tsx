import { useEffect, useMemo, useState } from 'react';
import { Factory } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { cn, todayInput } from '../../lib/utils';
import { num } from '../../lib/invoice-calc';
import { buildOutputVoucher, defaultOutputBatch, loadOrderDocs, orderProgress, productionOrdersDb } from '../../lib/production/orders';
import { ensureQcGodown } from '../../lib/production/qc';
import type { AdditionalCost, Bom, VoucherOutputLine, VoucherStockLine } from '../../types/manufacturing';
import type { ProductionOrder } from '../../types/production-r4';
import { pT } from '../../i18n/areas/production-r4';
import { defineArea } from '../../i18n/area';
import { qtyText, type MfgContext } from '../manufacturing/context';
import { parseSerials } from '../../lib/stock-tracking';
import { foodOutputDefaults, outputFoodDates } from '../../lib/mfg/mf-food';
import controls from '../../styles/controls.module.css';
import mfg from '../manufacturing/manufacturing.module.css';

// R13 (MF-A3): job-card figures (inline; the job-card module itself loads only for an order with a routing).
const jcT = defineArea(
  { ready: 'Job cards: last operation good {ready}; scrap {kg} kg goes into this journal.' } as const,
  { ready: 'जॉब कार्ड: अंतिम ऑपरेशन ठीक {ready}; स्क्रैप {kg} किलो इस जर्नल में जाएगा।' },
);

/**
 * Report output (R4-A1): a normal Manufacturing Journal tagged with the order. Components are consumed from the shop
 * floor in proportion to the quantity (editable), from the batches issued to the order.
 */
export function OutputDialog({ ctx, order, boms, onClose }: { ctx: MfgContext; order: ProductionOrder; boms: Bom[]; onClose: () => void }) {
  const progress = useMemo(() => orderProgress(order, loadOrderDocs()), [order]);
  const bom = boms.find((b) => b.id === order.bom_id);
  const item = ctx.items.find((i) => i.id === order.item_id);
  const left = Math.max(0, Math.round((num(order.planned_qty) - progress.output) * 1000) / 1000);
  const [date, setDate] = useState(todayInput());
  const [qty, setQty] = useState(String(left || ''));
  // MF-D1 / D2: a food order's batch, packed date and best-before (packed + shelf life) fill in; typed values win.
  const [food] = useState(() => foodOutputDefaults(order, item, todayInput()));
  const [batch, setBatch] = useState(item?.track_batches ? food.batch_no ?? defaultOutputBatch(order, progress.outputs.length + 1) : '');
  const [typedExpiry, setExpiry] = useState<string | null>(null);
  const [serialText, setSerialText] = useState('');
  const [labour, setLabour] = useState('');
  const dated = outputFoodDates(order, item, date, typedExpiry); // QA16 P6: follows the output date until typed
  const expiry = dated.expiry_date;
  const draftFor = (q: number) => buildOutputVoucher(order, progress, bom, { qty: q, date });
  const [components, setComponents] = useState<VoucherStockLine[]>(() => draftFor(num(qty)).components);
  const [error, setError] = useState('');
  // R13 (MF-A3): an order released with a routing reports its job cards' scrap kg in this journal (once) and offers the
  // last operation's good units; the job-card module loads only for such an order.
  const [jc, setJc] = useState<{ scrapLines: VoucherOutputLine[]; replaceScrapOf: string[]; ready: number } | null>(null);
  useEffect(() => {
    if (!order.mf?.ops?.length) return;
    let live = true;
    void import('../../lib/mfg/mf-jobcards').then((m) => live && setJc(m.outputExtras(order, ctx.items)), () => undefined);
    return () => { live = false; };
  }, [order, ctx.items]);
  // MF-D5: with the dated absorption switch on, the cards' conversion (hours × rate, AS 2 cap) goes into this journal.
  const [conv, setConv] = useState<{ date: string; lines?: AdditionalCost[] } | null>(null);
  useEffect(() => {
    if (!order.mf?.ops?.length) return;
    let live = true;
    void import('../../lib/mfg/mf-conversion').then((m) => live && setConv({ date, lines: m.outputConversion(order, date) }), () => undefined);
    return () => { live = false; };
  }, [order, date]);
  const name = (id: string) => ctx.items.find((i) => i.id === id)?.name ?? '?';

  const submit = () => {
    try {
      const godown = order.output_to_qc ? ensureQcGodown().id : undefined;
      const serials = parseSerials(serialText);
      const base = buildOutputVoucher(order, progress, bom, { qty: num(qty), date, batch_no: batch, expiry_date: expiry || undefined, serials: serials.length ? serials : undefined, godown_id: godown }, undefined, jc?.replaceScrapOf.length || conv?.lines?.length ? { ...(jc?.replaceScrapOf.length ? { scrapLines: jc.scrapLines, replaceScrapOf: jc.replaceScrapOf } : {}), ...(conv?.date === date && conv.lines?.length ? { conversion: conv.lines } : {}) } : undefined);
      const v = productionOrdersDb.reportOutput(order.id, { ...base, ...(base.batch_no && dated.mfg_date ? { mfg_date: dated.mfg_date } : {}), components: components.filter((c) => num(c.qty) > 0), costs: [...base.costs, ...(num(labour) > 0 ? [{ id: 'labour', label: pT('additionalCosts'), mode: 'amount' as const, value: num(labour) }] : [])] }, ctx.items, ctx.inputs);
      onClose();
      ctx.changed(pT('outputSaved', { number: v.number, qty: qtyText(v.qty) }));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" title={`${pT('reportOutput')} · ${order.number}`} subtitle={pT('outputHint', { done: qtyText(progress.output), planned: qtyText(order.planned_qty) })}
      footer={<><button type="button" className={controls.btnOutline} onClick={onClose}>{pT('cancel')}</button><button type="button" className={controls.btnPrimary} onClick={submit} data-testid="wo-output-save"><Factory size={16} aria-hidden="true" /> {pT('save')}</button></>}>
      <div className={mfg.form}>
        {jc && <p className={controls.hint} data-mf-output>{jcT('ready', { ready: qtyText(jc.ready), kg: qtyText(jc.scrapLines.reduce((t, l) => t + num(l.qty), 0)) })}</p>}
        <div className={controls.row3}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="out-date">{pT('date')}</label>
            <input id="out-date" type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="out-qty">{pT('qtyMade')}{item ? ` (${item.unit})` : ''}</label>
            <input id="out-qty" className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} onBlur={() => setComponents(draftFor(num(qty)).components)} />
          </div>
          {item?.track_batches && (
            <div className={controls.field}>
              <label className={controls.label} htmlFor="out-batch">{pT('finishedBatch')}</label>
              <input id="out-batch" className={controls.input} value={batch} onChange={(e) => setBatch(e.target.value)} />
            </div>
          )}
        </div>
        {item?.track_batches && (
          <div className={controls.field}>
            <label className={controls.label} htmlFor="out-exp">{pT('expiry')}</label>
            <input id="out-exp" type="date" className={controls.input} value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </div>
        )}
        {item?.track_serials && (
          <div className={controls.field}>
            <label className={controls.label} htmlFor="out-serials">{pT('finishedSerials')}</label>
            <textarea id="out-serials" className={controls.textarea} rows={3} value={serialText} onChange={(e) => setSerialText(e.target.value)} />
          </div>
        )}
        {order.output_to_qc && <p className={mfg.muted}>{pT('toQcNote')}</p>}
        <p className={mfg.section}>{pT('consumedFromFloor')}</p>
        <div className={mfg.wrap}>
          <table className={mfg.grid}>
            <thead><tr><th>{pT('material')}</th><th>{pT('batch')}</th><th className={mfg.num}>{pT('qty')}</th></tr></thead>
            <tbody>
              {components.map((c, i) => (
                <tr key={c.id}>
                  <td>{name(c.item_id)}</td>
                  <td>{c.batch_no ?? '—'}</td>
                  <td><input className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" aria-label={`${pT('qty')} · ${name(c.item_id)} ${i + 1}`} value={String(c.qty)} onChange={(e) => setComponents((cs) => cs.map((x) => (x.id === c.id ? { ...x, qty: num(e.target.value) } : x)))} /></td>
                </tr>
              ))}
              {components.length === 0 && <tr><td colSpan={3} className={mfg.muted}>{pT('nothingOnFloor')}</td></tr>}
            </tbody>
          </table>
        </div>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="out-labour">{pT('additionalCosts')} (₹)</label>
          <input id="out-labour" className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" value={labour} onChange={(e) => setLabour(e.target.value)} />
        </div>
        {error && <p className={cn(mfg.notice, mfg.danger)} role="alert">{error}</p>}
      </div>
    </Modal>
  );
}

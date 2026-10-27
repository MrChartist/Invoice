/**
 * AG-C2 yield panel on a production order (lazy; mounted by OrdersTab only with the `mill` pack): input, outputs by
 * kind, outturn vs standard, by-product %, loss split into moisture and unexplained, and the cost per unit of the main
 * product after the by-product credit (the engine's own snapshot). Edits the order's `ag.mill` meta.
 */
import { useState } from 'react';
import type { ProductionOrder } from '../../types/production-r4';
import type { MillOrderMeta } from '../../types/agri-r12';
import type { StockItem } from '../../lib/inventory';
import { useT } from '../../i18n';
import { localDb } from '../../lib/localDb';
import { manufacturingDb } from '../../lib/manufacturing';
import { batchYield, defaultMillMeta, setMillMeta } from '../../lib/agri/ag-yield';
import { B, fmtMoney } from '../transport/shared';
import { Num, Sel, Table } from './mill-ui';
import { T, errText, q, row } from './mill-kit';
import controls from '../../styles/controls.module.css';

export default function YieldPanel({ order, items, canEdit, onSaved }: { order: ProductionOrder; items: readonly StockItem[]; canEdit: boolean; onSaved: (msg: string, error?: boolean) => void }) {
  useT();
  const meta: MillOrderMeta = order.ag?.mill ?? defaultMillMeta(localDb.settings.get().mill_kind, order.date);
  const [m, setM] = useState({ inM: String(meta.input_moisture ?? ''), outM: String(meta.output_moisture ?? ''), std: String(meta.standard_outturn_pct), src: meta.std_source });
  const y = batchYield({ ...order, ag: { ...order.ag, mill: meta } }, manufacturingDb.all(), items);
  const save = () => {
    try {
      setMillMeta(order.id, { standard_outturn_pct: Number(m.std), std_source: m.src, ...(m.inM !== '' ? { input_moisture: Number(m.inM) } : {}), ...(m.outM !== '' ? { output_moisture: Number(m.outM) } : {}) });
      onSaved(T('saved'));
    } catch (e) {
      onSaved(errText(e), true);
    }
  };
  return (
    <section aria-label={T('yieldTitle')} data-ml-yield={y.outturnPct}>
      <h4>{T('yieldTitle')}</h4>
      {canEdit && (
        <div style={row}>
          <Num l={T('inMoisture')} v={m.inM} set={(x) => setM({ ...m, inM: x })} />
          <Num l={T('outMoisture')} v={m.outM} set={(x) => setM({ ...m, outM: x })} />
          <Num l={T('standard')} v={m.std} set={(x) => setM({ ...m, std: x })} d="std" />
          <Sel l={T('stdSource')} v={m.src} set={(x) => setM({ ...m, src: x as MillOrderMeta['std_source'] })} o={[['own', T('s.own')], ['cmr', T('s.cmr')]]} x={160} />
          <button type="button" className={B.os} onClick={save}>{T('save')}</button>
        </div>
      )}
      {y.input > 0 ? (
        <>
          <p className={controls.hint} data-ml-flag={y.flag ?? ''}>{T('variance', { pct: y.outturnPct, std: y.standard, d: y.variance })}{y.flag ? ` · ${T(`f.${y.flag}`)}` : ''}</p>
          <Table d="yield" head={['', T('qtl'), '%']} rows={[
            [T('input'), q(y.input), 100],
            [T('main'), q(y.main), y.input ? Math.round((y.main * 10000) / y.input) / 100 : 0],
            [T('co'), q(y.co), y.input ? Math.round((y.co * 10000) / y.input) / 100 : 0],
            [T('by'), q(y.by), y.byPct],
            ...(y.scrap ? [[T('scrap'), q(y.scrap), y.input ? Math.round((y.scrap * 10000) / y.input) / 100 : 0]] : []),
            [T('lossKg'), q(y.loss), y.lossPct],
            [`— ${T('moistureLoss')}`, q(y.moistureLoss), ''],
            [`— ${T('unexplained')}`, q(y.unexplained), ''],
          ]} />
          <p className={controls.hint}>{T('byCredit')}: {fmtMoney(y.deductions)} · {T('unitCost')}: {fmtMoney(y.unitCost)}</p>
        </>
      ) : <p className={controls.hint}>{T('noOutput')}</p>}
    </section>
  );
}

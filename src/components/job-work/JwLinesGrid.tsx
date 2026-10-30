import type { KeyboardEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { cn } from '../../lib/utils';
import { num } from '../../lib/invoice-calc';
import type { StockItem } from '../../lib/inventory';
import { cleanAltUnits, lineUnitPatch, roundTypedQty, unitChoices, type UnitMaster } from '../../lib/units';
import type { JobWorkGoodsKind, JobWorkReceiptKind } from '../../types/job-work';
import { blankJwLine, type JwGridLine } from './lines';
import type { Godown } from '../../types/stock';
import { jwT } from '../../i18n/areas/job-work';
import { s7T } from '../../i18n/areas/inventory-7s';
import { SerialCell } from '../manufacturing/SerialCell';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './job-work.module.css';

export interface JwGridOptions {
  label: string;
  /** Our own godowns (job workers' godowns left out); the column shows once there is more than one. */
  godowns?: Godown[];
  batch?: boolean;
  /** Value / unit, GST % and goods kind (Material Out). */
  value?: boolean;
  /** Receipt kinds (processed / scrap / returned) and scrap value. */
  kinds?: boolean;
  /** Challan lines a line may settle (out_line_id). */
  challans?: { id: string; label: string; item_id: string }[];
  units: readonly UnitMaster[];
  disabled?: boolean;
  /**
   * 7S: serial-tracked items list serials. `out` = serials leave a godown (pool offered), `in` = new serials,
   * `byKind` = Material In receipts (returned → out of the job worker's godown, processed / scrap → in).
   */
  serials?: 'out' | 'in' | 'byKind';
  serialPool?: (itemId: string, line: JwGridLine) => string[];
}

/** Keyboard-first line grid for job work (Enter on a quantity adds a line); alternate units per stock item. */
export function JwLinesGrid({ lines, items, onChange, opts }: {
  lines: JwGridLine[];
  items: StockItem[];
  onChange: (lines: JwGridLine[]) => void;
  opts: JwGridOptions;
}) {
  const multi = (opts.godowns?.length ?? 0) > 1;
  const byId = new Map(items.map((i) => [i.id, i]));
  const patch = (id: string, change: Partial<JwGridLine>) => onChange(lines.map((l) => (l.id === id ? { ...l, ...change } : l)));
  const add = () => {
    const line = blankJwLine(opts.kinds ? { kind: lines[lines.length - 1]?.kind ?? 'processed' } : {});
    onChange([...lines, line]);
    requestAnimationFrame(() => document.getElementById(`jw-${line.id}`)?.focus());
  };
  const onQtyKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      add();
    }
  };
  const L = opts.label;
  const kinds: [JobWorkGoodsKind, string][] = [['input', jwT('kindInput')], ['capital_goods', jwT('kindCapital')], ['mould_tool', jwT('kindTool')]];
  const rkinds: [JobWorkReceiptKind, string][] = [['processed', jwT('kindProcessed')], ['scrap', jwT('kindScrap')], ['returned', jwT('kindReturned')]];
  const anySerial = !!opts.serials && lines.some((l) => byId.get(l.item_id)?.track_serials);
  const serialDir = (l: JwGridLine) => (opts.serials === 'byKind' ? (l.kind === 'returned' ? 'out' : 'in') : opts.serials);
  const anyAlt = lines.some((l) => {
    const it = byId.get(l.item_id);
    return !!(it && cleanAltUnits(it.alt_units, it.unit || 'NOS'));
  });

  return (
    <div className={styles.wrap}>
      <table className={styles.grid}>
        <thead>
          <tr>
            <th>{jwT('item')}</th>
            {opts.kinds && <th>{jwT('type')}</th>}
            <th className={styles.num}>{jwT('qty')}</th>
            {anyAlt && <th>{jwT('unit')}</th>}
            {opts.value && <th className={styles.num}>{jwT('rate')}</th>}
            {opts.value && <th className={styles.num}>{jwT('gstPct')}</th>}
            {opts.value && <th>{jwT('goodsKind')}</th>}
            {opts.kinds && <th className={styles.num}>{jwT('scrapValue')}</th>}
            {opts.challans && <th>{jwT('challanNo')}</th>}
            {multi && <th>{opts.value ? jwT('fromGodown') : jwT('toGodown')}</th>}
            {opts.batch && <th>{jwT('batch')}</th>}
            {anySerial && <th>{s7T('serials')}</th>}
            <th><span className={surface.srOnly}>{jwT('actions')}</span></th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const n = i + 1;
            const it = byId.get(l.item_id);
            const choices = it ? unitChoices(it) : [];
            const unit = l.unit || it?.unit || '';
            return (
              <tr key={l.id}>
                <td>
                  <select id={`jw-${l.id}`} className={controls.select} disabled={opts.disabled} aria-label={jwT('lineItem', { label: L, n })} value={l.item_id}
                    onChange={(e) => {
                      const next = byId.get(e.target.value);
                      patch(l.id, { item_id: e.target.value, unit: undefined, unit_factor: undefined, serials: undefined, ...(opts.value && next ? { hsn: next.hsn, tax_rate: next.tax_rate, rate: l.rate || next.opening_rate || undefined } : {}) });
                    }}>
                    <option value="">{jwT('choose')}</option>
                    {items.map((x) => <option key={x.id} value={x.id}>{x.name}{x.unit ? ` (${x.unit})` : ''}</option>)}
                  </select>
                </td>
                {opts.kinds && (
                  <td>
                    <select className={controls.select} disabled={opts.disabled} aria-label={jwT('lineType', { label: L, n })} value={l.kind ?? 'processed'} onChange={(e) => patch(l.id, { kind: e.target.value as JobWorkReceiptKind })}>
                      {rkinds.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                    </select>
                  </td>
                )}
                <td>
                  <input className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" disabled={opts.disabled} aria-label={jwT('lineQty', { label: L, n })}
                    value={String(l.qty ?? '')} onKeyDown={onQtyKey}
                    onChange={(e) => patch(l.id, { qty: e.target.value === '' ? 0 : Number(e.target.value) })}
                    onBlur={() => patch(l.id, { qty: roundTypedQty(l.qty, unit, opts.units) })} />
                </td>
                {anyAlt && (
                  <td>
                    {it && choices.length > 1 ? (
                      <select className={controls.select} disabled={opts.disabled} aria-label={jwT('lineUnit', { label: L, n })} value={unit}
                        onChange={(e) => {
                          const p = lineUnitPatch(it, l, e.target.value);
                          patch(l.id, { unit: p.unit_factor ? p.unit : undefined, unit_factor: p.unit_factor, ...(opts.value || opts.kinds ? { rate: p.rate || undefined } : {}), qty: roundTypedQty(l.qty, p.unit, opts.units) });
                        }}>
                        {choices.map((c) => <option key={c.unit} value={c.unit}>{c.unit}</option>)}
                      </select>
                    ) : <span className={styles.muted}>{unit}</span>}
                  </td>
                )}
                {opts.value && (
                  <td><input className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" disabled={opts.disabled} aria-label={jwT('lineRate', { label: L, n })} value={l.rate ? String(l.rate) : ''} onChange={(e) => patch(l.id, { rate: Number(e.target.value) || undefined })} /></td>
                )}
                {opts.value && (
                  <td><input className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" disabled={opts.disabled} aria-label={jwT('lineGst', { label: L, n })} value={l.tax_rate !== undefined ? String(l.tax_rate) : ''} onChange={(e) => patch(l.id, { tax_rate: e.target.value === '' ? undefined : num(e.target.value) })} /></td>
                )}
                {opts.value && (
                  <td>
                    <select className={controls.select} disabled={opts.disabled} aria-label={jwT('lineKind', { label: L, n })} value={l.goods_kind ?? 'input'} onChange={(e) => patch(l.id, { goods_kind: e.target.value === 'input' ? undefined : e.target.value as JobWorkGoodsKind })}>
                      {kinds.map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                    </select>
                  </td>
                )}
                {opts.kinds && (
                  <td>
                    {l.kind === 'scrap'
                      ? <input className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" disabled={opts.disabled} aria-label={jwT('lineRate', { label: L, n })} value={l.rate ? String(l.rate) : ''} onChange={(e) => patch(l.id, { rate: Number(e.target.value) || undefined })} />
                      : <span className={styles.muted}>-</span>}
                  </td>
                )}
                {opts.challans && (
                  <td>
                    <select className={controls.select} disabled={opts.disabled} aria-label={jwT('lineChallan', { label: L, n })} value={l.out_line_id ?? ''} onChange={(e) => patch(l.id, { out_line_id: e.target.value || undefined })}>
                      <option value="">{jwT('anyChallan')}</option>
                      {opts.challans.filter((c) => c.item_id === l.item_id).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  </td>
                )}
                {multi && (
                  <td>
                    <select className={controls.select} disabled={opts.disabled} aria-label={jwT('lineGodown', { label: L, n })} value={l.godown_id ?? ''} onChange={(e) => patch(l.id, { godown_id: e.target.value || undefined })}>
                      <option value="">-</option>
                      {opts.godowns?.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                    </select>
                  </td>
                )}
                {opts.batch && (
                  <td>
                    {it?.track_batches
                      ? <input className={controls.input} disabled={opts.disabled} aria-label={jwT('lineBatch', { label: L, n })} value={l.batch_no ?? ''} onChange={(e) => patch(l.id, { batch_no: e.target.value || undefined })} />
                      : <span className={styles.muted}>-</span>}
                  </td>
                )}
                {anySerial && (
                  <td>
                    {it?.track_serials ? (
                      <SerialCell
                        key={`${l.id}:${l.item_id}:${serialDir(l)}`} serials={l.serials} qty={l.qty} disabled={opts.disabled}
                        label={s7T('lineSerials', { label: L, n })}
                        pool={serialDir(l) === 'out' && opts.serialPool ? () => opts.serialPool!(l.item_id, l) : undefined}
                        onChange={(serials) => patch(l.id, { serials })}
                      />
                    ) : <span className={styles.muted}>-</span>}
                  </td>
                )}
                <td>
                  <button type="button" className={controls.btnIcon} disabled={opts.disabled} aria-label={`${L} ${jwT('removeLine', { n })}`} onClick={() => onChange(lines.filter((x) => x.id !== l.id))}>
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {!opts.disabled && (
        <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={add}>
          <Plus size={14} aria-hidden="true" /> {jwT('addLine')} · {L}
        </button>
      )}
    </div>
  );
}


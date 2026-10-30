import { useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { cn, todayInput } from '../../lib/utils';
import { num } from '../../lib/invoice-calc';
import { computeTracking } from '../../lib/stock-tracking';
import { buildIssueLines, loadOrderDocs, materialRows, orderProgress, productionOrdersDb } from '../../lib/production/orders';
import type { ProductionOrder } from '../../types/production-r4';
import { pT } from '../../i18n/areas/production-r4';
import { qtyText, type MfgContext } from '../manufacturing/context';
import controls from '../../styles/controls.module.css';
import mfg from '../manufacturing/manufacturing.module.css';
import { DateField } from '../ui/DateField';
import { SelectField } from '../ui/SelectField';

/**
 * Issue materials to the shop floor (R4-A1): a normal stock transfer from a store to the WIP godown. Quantities are in
 * base units; batch items are split first-expiry-first and serial items take the first serials in stock.
 */
export function IssueDialog({ ctx, order, onClose }: { ctx: MfgContext; order: ProductionOrder; onClose: () => void }) {
  const [date, setDate] = useState(todayInput());
  const [from, setFrom] = useState(order.store_godown_id || 'main');
  const rows = useMemo(() => materialRows(order, orderProgress(order, loadOrderDocs())), [order]);
  const [want, setWant] = useState<Record<string, string>>(() => Object.fromEntries(rows.map((r) => [r.item_id, r.balance ? String(r.balance) : ''])));
  const [error, setError] = useState('');
  const stores = ctx.godowns.filter((g) => g.id !== order.wip_godown_id && g.kind !== 'transit');
  const item = (id: string) => ctx.items.find((i) => i.id === id);
  const lines = useMemo(() => {
    const tracking = computeTracking({ ...ctx.inputs, asOf: date || undefined });
    return buildIssueLines(rows, ctx.items, tracking, date, from, new Map(Object.entries(want).map(([k, v]) => [k, num(v)])));
  }, [rows, ctx.items, ctx.inputs, date, from, want]);

  const submit = () => {
    try {
      const { transfer, warnings } = productionOrdersDb.issue(order.id, { date, from, lines }, ctx.items, ctx.inputs);
      onClose();
      ctx.changed([pT('issuedMsg', { number: transfer.transfer_number }), ...warnings].join(' '));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" title={`${pT('issue')} · ${order.number}`} subtitle={pT('issueHint')}
      footer={<><button type="button" className={controls.btnOutline} onClick={onClose}>{pT('cancel')}</button><button type="button" className={controls.btnPrimary} disabled={!lines.length} onClick={submit} data-testid="wo-issue-save">{pT('issue')}</button></>}>
      <div className={mfg.form}>
        <div className={controls.row}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="iss-date">{pT('date')}</label>
            <DateField id="iss-date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="iss-from">{pT('fromGodown')}</label>
            <SelectField id="iss-from" className={controls.select} value={from} onChange={(e) => setFrom(e.target.value)}>
              {stores.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            </SelectField>
          </div>
        </div>
        <div className={mfg.wrap}>
          <table className={mfg.grid}>
            <thead><tr><th>{pT('material')}</th><th className={mfg.num}>{pT('required')}</th><th className={mfg.num}>{pT('issued')}</th><th className={mfg.num}>{pT('issueNow')}</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.item_id}>
                  <td>{item(r.item_id)?.name ?? '?'}</td>
                  <td className={mfg.num}>{qtyText(r.required)} {item(r.item_id)?.unit ?? ''}</td>
                  <td className={mfg.num}>{qtyText(r.issued)}</td>
                  <td><input className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" aria-label={`${pT('issueNow')} · ${item(r.item_id)?.name ?? ''}`} value={want[r.item_id] ?? ''} onChange={(e) => setWant((w) => ({ ...w, [r.item_id]: e.target.value }))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {lines.some((l) => l.batch_no || l.serials?.length) && (
          <p className={mfg.muted}>{pT('batchesPicked')}: {lines.filter((l) => l.batch_no || l.serials?.length).map((l) => `${item(l.item_id)?.name ?? ''} ${l.batch_no ?? ''} × ${qtyText(l.qty)}${l.serials?.length ? ` (${l.serials.join(', ')})` : ''}`).join('; ')}</p>
        )}
        {rows.some((r) => num(want[r.item_id]) + r.issued > r.required + 1e-6) && <p className={mfg.notice} role="status">{pT('overIssueWarn')}</p>}
        {error && <p className={cn(mfg.notice, mfg.danger)} role="alert">{error}</p>}
      </div>
    </Modal>
  );
}

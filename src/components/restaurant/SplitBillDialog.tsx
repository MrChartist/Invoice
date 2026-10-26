import { useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { NumberInput } from '../ui/NumberInput';
import type { TableOrder } from '../../types/restaurant';
import type { TenderMethod } from '../../lib/pos';
import { customPayerErrors, equalPayers, seatPicks, type PartPick } from '../../lib/restaurant/split-bill';
import { previewBill, previewParts, settleParts, startPayers, type SettleResult } from '../../lib/restaurant/orders-store';
import { cn, formatCurrency } from '../../lib/utils';
import { useT } from '../../i18n';
import { rT } from '../../i18n/areas/restaurant';
import controls from '../../styles/controls.module.css';
import styles from './restaurant.module.css';

type Mode = 'equal' | 'custom' | 'item' | 'seat';
const METHODS: TenderMethod[] = ['Cash', 'UPI', 'Card'];
const SHARE = 0;

export interface SplitBillDialogProps {
  order: TableOrder;
  onClose: () => void;
  /** Payer rows started (equal / custom), or the part bills saved (item / seat). */
  onDone: (r: { payers?: true; result?: SettleResult }) => void;
}

/** Settle → Split (R3-A3): equal / custom payers on one bill, or one bill per item group / seat. */
export function SplitBillDialog({ order, onClose, onDone }: SplitBillDialogProps) {
  useT();
  const [mode, setMode] = useState<Mode>('equal');
  const whole = useMemo(() => previewBill(order), [order]);
  const [n, setN] = useState(2);
  const [custom, setCustom] = useState<number[]>(() => equalPayers(whole.total, 2).map((p) => p.amount));
  const [names, setNames] = useState<string[]>([]);
  const parents = order.lines.filter((l) => !l.modifier_of);
  const seats = useMemo(() => seatPicks(order.lines), [order.lines]);
  const [itemParts, setItemParts] = useState(2);
  const [assign, setAssign] = useState<Record<string, number>>(() => Object.fromEntries(parents.map((l, i) => [l.id, (i % 2) + 1])));
  const [methods, setMethods] = useState<TenderMethod[]>(['Cash', 'Cash', 'Cash', 'Cash', 'Cash', 'Cash', 'Cash', 'Cash']);
  const [error, setError] = useState('');

  const parts = mode === 'seat' ? seats.parts : itemParts;
  const picks: PartPick[] = useMemo(() => {
    if (mode === 'seat') return seats.picks;
    const out: PartPick[] = [];
    for (const l of parents) {
      const a = assign[l.id] ?? 1;
      if (a === SHARE) for (let p = 1; p <= itemParts; p++) out.push({ line_id: l.id, part: p, qty: l.quantity / itemParts });
      else out.push({ line_id: l.id, part: Math.min(a, itemParts) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, seats, assign, itemParts, order.lines]);
  const preview = useMemo(() => (mode === 'item' || mode === 'seat' ? previewParts(order, picks, parts) : null), [mode, order, picks, parts]);

  const payers = mode === 'equal' ? equalPayers(whole.total, n) : custom.map((amount) => ({ amount }));
  const payerErrors = mode === 'custom' ? customPayerErrors(whole.total, custom) : [];

  const start = () => {
    try {
      startPayers(order.id, payers.map((p, i) => ({ ...p, ...(names[i]?.trim() ? { name: names[i].trim() } : {}) })));
      onDone({ payers: true });
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const saveParts = () => {
    if (!preview) return;
    const tenders = Array.from({ length: parts }, (_, i) => {
      const rec = preview.records.find((r) => r.split_of?.part === i + 1);
      return rec ? [{ method: methods[i] ?? 'Cash', amount: rec.total }] : [];
    });
    const res = settleParts(order.id, picks, parts, tenders);
    if (!res.ok) setError(res.errors[0] ?? '');
    else onDone({ result: res });
  };

  const d = preview?.recon.diff;
  return (
    <Modal
      open
      size="lg"
      onClose={onClose}
      title={rT('splitTitle')}
      subtitle={`${rT('total')} ${formatCurrency(whole.total)}`}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>{rT('cancel')}</button>
          {mode === 'equal' || mode === 'custom' ? (
            <button type="button" className={controls.btnPrimary} onClick={start} disabled={payerErrors.length > 0} data-split-start>{rT('startPayers')}</button>
          ) : (
            <button type="button" className={controls.btnPrimary} onClick={saveParts} disabled={!preview || preview.records.length < 2} data-split-save>{rT('settleParts', { n: preview?.records.length ?? 0 })}</button>
          )}
        </>
      }
    >
      <div className={styles.panel}>
        <div className={styles.tabs} role="tablist">
          {(['equal', 'custom', 'item', 'seat'] as Mode[]).map((m) => (
            <button key={m} type="button" role="tab" aria-selected={mode === m} className={cn(styles.tab, mode === m && styles.tabOn)} onClick={() => { setMode(m); setError(''); }}>
              {rT(m === 'equal' ? 'sEqual' : m === 'custom' ? 'sCustom' : m === 'item' ? 'sItem' : 'sSeat')}
            </button>
          ))}
        </div>

        {(mode === 'equal' || mode === 'custom') && (
          <>
            <p className={styles.muted}>{rT('payersNote')}</p>
            {mode === 'equal' && (
              <label className={controls.field}>
                <span className={controls.label}>{rT('parts')}</span>
                <NumberInput className={cn(controls.input, styles.narrow)} value={n} blankZero={false} onChange={(v) => setN(Math.min(Math.max(Math.floor(v) || 1, 1), 20))} aria-label={rT('parts')} id="split-n" />
              </label>
            )}
            {mode === 'custom' && (
              <div className={styles.actions}>
                <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => setCustom((c) => [...c, 0])}>+ {rT('payer')}</button>
                {custom.length > 1 && <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setCustom((c) => c.slice(0, -1))}>− {rT('payer')}</button>}
              </div>
            )}
            <div className={styles.parts}>
              {payers.map((p, i) => (
                <div key={i} className={styles.editRow}>
                  <label className={controls.field}>
                    <span className={controls.label}>{rT('payerN', { n: i + 1 })}</span>
                    <input className={controls.input} value={names[i] ?? ''} onChange={(e) => setNames((x) => { const y = [...x]; y[i] = e.target.value; return y; })} placeholder={rT('customerName')} />
                  </label>
                  <label className={cn(controls.field, styles.narrow)}>
                    <span className={controls.label}>{rT('amount')}</span>
                    {mode === 'custom' ? (
                      <NumberInput className={controls.input} value={custom[i]} onChange={(v) => setCustom((c) => c.map((x, j) => (j === i ? v : x)))} aria-label={rT('payerN', { n: i + 1 })} />
                    ) : (
                      <output className={controls.input} data-payer-amount={i}>{formatCurrency(p.amount)}</output>
                    )}
                  </label>
                </div>
              ))}
            </div>
            {payerErrors.map((e) => <p key={e} className={styles.error}>{e}</p>)}
          </>
        )}

        {(mode === 'item' || mode === 'seat') && (
          <>
            {mode === 'item' && (
              <label className={controls.field}>
                <span className={controls.label}>{rT('parts')}</span>
                <NumberInput className={cn(controls.input, styles.narrow)} value={itemParts} blankZero={false} onChange={(v) => setItemParts(Math.min(Math.max(Math.floor(v) || 2, 2), 8))} aria-label={rT('parts')} />
              </label>
            )}
            <div className={styles.parts}>
              {parents.map((l) => (
                <div key={l.id} className={styles.partRow}>
                  <span>{l.quantity} × {l.name}{l.seat ? ` · ${rT('seat')} ${l.seat}` : ''}</span>
                  {mode === 'item' ? (
                    <select className={controls.select} value={assign[l.id] ?? 1} onChange={(e) => setAssign((a) => ({ ...a, [l.id]: Number(e.target.value) }))} aria-label={l.name} data-split-line={l.name}>
                      {Array.from({ length: itemParts }, (_, i) => <option key={i} value={i + 1}>{rT('partN', { n: i + 1 })}</option>)}
                      <option value={SHARE}>{rT('shareAll')}</option>
                    </select>
                  ) : (
                    <span className={styles.chip}>{rT('partN', { n: seats.picks.find((p) => p.line_id === l.id)?.part ?? 1 })}</span>
                  )}
                </div>
              ))}
            </div>
            {preview && (
              <>
                <div className={styles.parts}>
                  {preview.records.map((r) => (
                    <div key={r.split_of?.part} className={styles.partRow}>
                      <span>{rT('partOf', { n: r.split_of?.part ?? 0, m: preview.records.length })} · {formatCurrency(r.total)}</span>
                      <select className={controls.select} value={methods[(r.split_of?.part ?? 1) - 1]} onChange={(e) => setMethods((m) => m.map((x, j) => (j === (r.split_of?.part ?? 1) - 1 ? (e.target.value as TenderMethod) : x)))} aria-label={rT('method')}>
                        {METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                <div>
                  <strong>{rT('recon')}</strong> <span className={styles.small}>{rT('reconHint')}</span>
                </div>
                <div className={styles.strip} role="table" aria-label={rT('recon')} data-split-recon>
                  <span /> <span>{rT('taxable')}</span><span>CGST</span><span>SGST</span><span>{rT('cess')}</span><span>{rT('total')}</span>
                  <span>{rT('sum')}</span><span>{preview.recon.parts.taxable.toFixed(2)}</span><span>{preview.recon.parts.cgst.toFixed(2)}</span><span>{preview.recon.parts.sgst.toFixed(2)}</span><span>{preview.recon.parts.cess.toFixed(2)}</span><span>{preview.recon.parts.total.toFixed(2)}</span>
                  <span>{rT('whole')}</span><span>{preview.recon.whole.taxable.toFixed(2)}</span><span>{preview.recon.whole.cgst.toFixed(2)}</span><span>{preview.recon.whole.sgst.toFixed(2)}</span><span>{preview.recon.whole.cess.toFixed(2)}</span><span>{preview.recon.whole.total.toFixed(2)}</span>
                  <span>{rT('diff')}</span><span>{d?.taxable.toFixed(2)}</span><span>{d?.cgst.toFixed(2)}</span><span>{d?.sgst.toFixed(2)}</span><span>{d?.cess.toFixed(2)}</span><span>{d?.total.toFixed(2)}</span>
                </div>
                <p className={preview.recon.taxExact ? styles.stripOk : styles.stripDiff} data-recon-exact={preview.recon.taxTotalExact ? '1' : '0'}>
                  {preview.recon.taxExact ? rT('reconOk') : rT('reconDiff', { amount: formatCurrency(Math.max(Math.abs(d?.cgst ?? 0), Math.abs(d?.sgst ?? 0), Math.abs((d?.cgst ?? 0) + (d?.sgst ?? 0) + (d?.igst ?? 0) + (d?.cess ?? 0)))) })}
                </p>
              </>
            )}
          </>
        )}
        <p className={styles.small}>{rT('splitCaNote')}</p>
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>
    </Modal>
  );
}

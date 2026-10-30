import { useMemo, useState } from 'react';
import { Plus, Save, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { cn, formatDate, todayInput } from '../../lib/utils';
import { num } from '../../lib/invoice-calc';
import { generateId, getTable } from '../../lib/storage';
import { isVoidStatus, readPurchase } from '../../lib/purchase-normalize';
import {
  LANDED_METHODS, allocationRows, chargeCandidates, landedExtras, landedVouchersDb, newCharge, targetLines, validateLandedVoucher,
} from '../../lib/landed-voucher';
import type { LandedCostVoucher, LandedMethod, LandedVoucherCharge, LandedVoucherTarget } from '../../types/production-r4';
import type { ReceiptNote } from '../../types/purchases';
import { useT } from '../../i18n';
import { pT } from '../../i18n/areas/production-r4';
import { money, qtyText, type MfgContext } from '../manufacturing/context';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import mfg from '../manufacturing/manufacturing.module.css';
import styles from './production.module.css';
import { DateField } from '../ui/DateField';
import { SelectField } from '../ui/SelectField';

/** /manufacturing?tab=landed — landed-cost voucher `LCV/FY…` spread over earlier bills / GRNs (R4-A5). */
export function LandedVoucherTab({ ctx }: { ctx: MfgContext }) {
  const { lang } = useT(); // QA19 U4: `goodsDocs` labels depend on it
  /* eslint-disable react-hooks/exhaustive-deps */
  const purchases = useMemo(() => getTable<unknown>('purchases'), [ctx.version]);
  const receipts = useMemo(() => getTable<ReceiptNote>('receipt_notes'), [ctx.version]);
  const vouchers = useMemo(() => landedVouchersDb.all(), [ctx.version]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const [editing, setEditing] = useState<LandedCostVoucher | null>(null);
  const [date, setDate] = useState(todayInput());
  const [method, setMethod] = useState<LandedMethod>('value');
  const [charges, setCharges] = useState<LandedVoucherCharge[]>([]);
  const [targets, setTargets] = useState<LandedVoucherTarget[]>([]);
  const [narration, setNarration] = useState('');
  const [pick, setPick] = useState('');
  const [target, setTarget] = useState('');
  const [deleting, setDeleting] = useState<LandedCostVoucher | null>(null);
  const [error, setError] = useState('');
  const items = ctx.items;
  const others = useMemo(() => vouchers.filter((v) => v.id !== editing?.id), [vouchers, editing]);
  const candidates = useMemo(() => chargeCandidates(purchases, items, vouchers, editing?.id), [purchases, items, vouchers, editing]);
  const goodsDocs = useMemo(() => {
    const bills = purchases.map((p) => readPurchase(p)).filter((b): b is NonNullable<typeof b> => !!b && !isVoidStatus(b.status) && !b.isExpense && !!b.id)
      .filter((b) => targetLines([{ kind: 'bill', id: b.id }], purchases, receipts, items).length > 0)
      .map((b) => ({ key: `bill:${b.id}`, label: `${pT('billWord')} ${b.number} · ${b.partyName} · ${formatDate(b.date)}`, date: b.date }));
    const grns = receipts.filter((g) => g.kind === 'GRN').map((g) => ({ key: `grn:${g.id}`, label: `${g.number} · ${g.vendor_name} · ${formatDate(g.date)}`, date: g.date }));
    return [...bills, ...grns].sort((a, b) => b.date.localeCompare(a.date));
  }, [purchases, receipts, items, lang]);
  const lines = useMemo(() => targetLines(targets, purchases, receipts, items, landedExtras(others, purchases, receipts, items)), [targets, purchases, receipts, items, others]);
  const preview = useMemo(() => allocationRows({ charges, method }, lines), [charges, method, lines]);
  const total = charges.reduce((s, c) => s + num(c.amount), 0);

  const reset = (v: LandedCostVoucher | null) => {
    setEditing(v);
    setDate(v?.date ?? todayInput());
    setMethod(v?.method ?? 'value');
    setCharges(v ? v.charges.map((c) => ({ ...c })) : []);
    setTargets(v ? [...v.targets] : []);
    setNarration(v?.narration ?? '');
    setError('');
  };
  const addCharge = () => {
    const c = candidates.find((x) => `${x.source.id}|${x.source.line_id ?? ''}` === pick);
    if (!c) return setCharges((cs) => [...cs, newCharge()]);
    setCharges((cs) => [...cs, { id: generateId(), source: c.source, label: c.label, amount: c.amount }]);
    setPick('');
  };
  const addTarget = () => {
    const [kind, id] = target.split(':');
    if (!id || targets.some((t) => t.kind === kind && t.id === id)) return;
    setTargets((ts) => [...ts, { kind: kind as LandedVoucherTarget['kind'], id }]);
    setTarget('');
  };
  const save = () => {
    const draft = { id: editing?.id, date, method, charges, targets, narration: narration.trim() || undefined };
    const err = validateLandedVoucher(draft, { vouchers, purchases, receipts, items });
    if (err) return setError(err);
    try {
      const v = landedVouchersDb.save({ ...draft, number: editing?.number }, { purchases, receipts, items });
      reset(null);
      ctx.changed(pT('lcvSaved', { number: v.number }));
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const docLabel = (t: LandedVoucherTarget) => goodsDocs.find((d) => d.key === `${t.kind}:${t.id}`)?.label ?? t.id;

  return (
    <>
      <p className={mfg.muted} style={{ margin: '0 0 0.75rem' }}>{pT('lcvIntro')}</p>
      {ctx.canBooks && (
        <section className={styles.panel} aria-label={editing ? editing.number : pT('newLcv')}>
          <div className={styles.inline}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="lcv-date">{pT('date')}{editing ? ` · ${editing.number}` : ` · ${landedVouchersDb.nextNumber(date)}`}</label>
              <DateField id="lcv-date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="lcv-method">{pT('method')}</label>
              <SelectField id="lcv-method" className={controls.select} value={method} onChange={(e) => setMethod(e.target.value as LandedMethod)}>
                {LANDED_METHODS.map((m) => <option key={m} value={m}>{pT(`method_${m}` as 'method_value')}</option>)}
              </SelectField>
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="lcv-narr">{pT('narration')}</label>
              <input id="lcv-narr" className={controls.input} value={narration} onChange={(e) => setNarration(e.target.value)} />
            </div>
          </div>
          <p className={mfg.section}>{pT('charges')}</p>
          <div className={mfg.wrap}>
            <table className={mfg.grid}>
              <thead><tr><th>{pT('chargeLabel')}</th><th className={mfg.num}>{pT('amount')}</th><th /></tr></thead>
              <tbody>
                {charges.map((c, i) => (
                  <tr key={c.id}>
                    <td><input className={controls.input} aria-label={`${pT('chargeLabel')} ${i + 1}`} value={c.label} readOnly={c.source.kind === 'bill'} onChange={(e) => setCharges((cs) => cs.map((x) => (x.id === c.id ? { ...x, label: e.target.value } : x)))} /></td>
                    <td><input className={cn(controls.input, controls.inputNumeric)} inputMode="decimal" aria-label={`${pT('amount')} ${i + 1}`} value={c.amount ? String(c.amount) : ''} readOnly={c.source.kind === 'bill'} onChange={(e) => setCharges((cs) => cs.map((x) => (x.id === c.id ? { ...x, amount: num(e.target.value) } : x)))} /></td>
                    <td><button type="button" className={controls.btnIcon} aria-label={`${pT('remove')} ${i + 1}`} onClick={() => setCharges((cs) => cs.filter((x) => x.id !== c.id))}><Trash2 size={15} aria-hidden="true" /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className={styles.inline}>
            <SelectField className={controls.select} aria-label={pT('pickCharge')} value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">{pT('memoCharge')}</option>
              {candidates.filter((c) => !c.usedBy).map((c) => <option key={`${c.source.id}|${c.source.line_id ?? ''}`} value={`${c.source.id}|${c.source.line_id ?? ''}`}>{c.label} · {money(c.amount)} · {formatDate(c.date)}</option>)}
            </SelectField>
            <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={addCharge}><Plus size={14} aria-hidden="true" /> {pT('addCharge')}</button>
          </div>
          <p className={mfg.section}>{pT('targets')}</p>
          {targets.length > 0 && <ul className={styles.log}>{targets.map((t) => <li key={`${t.kind}:${t.id}`}>{docLabel(t)} <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => setTargets((ts) => ts.filter((x) => x !== t))}>{pT('remove')}</button></li>)}</ul>}
          <div className={styles.inline}>
            <SelectField className={controls.select} aria-label={pT('pickTarget')} value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">{pT('choose')}</option>
              {goodsDocs.filter((d) => !targets.some((t) => `${t.kind}:${t.id}` === d.key)).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </SelectField>
            <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={addTarget} disabled={!target}><Plus size={14} aria-hidden="true" /> {pT('addTarget')}</button>
          </div>
          {preview.length > 0 && total > 0 && (
            <div className={mfg.wrap}>
              <table className={mfg.grid} data-testid="lcv-preview">
                <thead><tr><th>{pT('document')}</th><th>{pT('item')}</th><th className={mfg.num}>{pT('qtyBase')}</th><th className={mfg.num}>{pT('share')}</th><th className={mfg.num}>{pT('unitBefore')}</th><th className={mfg.num}>{pT('unitAfter')}</th></tr></thead>
                <tbody>{preview.map((r) => <tr key={`${r.target.id}|${r.line_id}`}><td>{docLabel(r.target)}</td><td>{r.name}</td><td className={mfg.num}>{qtyText(r.qty_base)}</td><td className={mfg.num}>{money(r.amount)}</td><td className={mfg.num}>{money(r.unit_before)}</td><td className={mfg.num}>{money(r.unit_after)}</td></tr>)}</tbody>
              </table>
            </div>
          )}
          {error && <p className={cn(mfg.notice, mfg.danger)} role="alert">{error}</p>}
          <div className={styles.actions}>
            <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={save}><Save size={14} aria-hidden="true" /> {pT('save')}</button>
            {editing && <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => reset(null)}>{pT('newLcv')}</button>}
          </div>
        </section>
      )}
      <p className={mfg.muted} style={{ margin: '0.75rem 0' }}>{pT('lcvBooksNote')}</p>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead><tr><th>{pT('number')}</th><th>{pT('date')}</th><th>{pT('method')}</th><th className={mfg.num}>{pT('amount')}</th><th>{pT('targets')}</th><th><span className={surface.srOnly}>{pT('actionsCol')}</span></th></tr></thead>
          <tbody>
            {[...vouchers].sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number, undefined, { numeric: true })).map((v) => (
              <tr key={v.id}>
                <td className={surface.mono}>{v.number}</td>
                <td>{formatDate(v.date)}</td>
                <td>{pT(`method_${v.method}` as 'method_value')}</td>
                <td className={mfg.num}>{money(v.charges.reduce((s, c) => s + num(c.amount), 0))}</td>
                <td>{v.targets.map(docLabel).join('; ')}</td>
                <td className={surface.rowActions}>
                  {ctx.canBooks && (
                    <>
                      <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => reset(v)}>{pT('edit')} <span className={surface.srOnly}>{v.number}</span></button>
                      <button type="button" className={controls.btnDanger} aria-label={`${pT('delete')} ${v.number}`} onClick={() => setDeleting(v)}><Trash2 size={15} /></button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {vouchers.length === 0 && <tr><td colSpan={6} className={mfg.muted}>{pT('noLcv')}</td></tr>}
          </tbody>
        </table>
      </div>
      <ConfirmDialog open={!!deleting} destructive title={pT('delete')} message={pT('confirmDeleteLcv', { number: deleting?.number ?? '' })} confirmLabel={pT('delete')}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          try {
            landedVouchersDb.remove(deleting.id, { purchases, receipts, items });
            if (editing?.id === deleting.id) reset(null);
            ctx.changed(pT('lcvDeleted', { number: deleting.number }));
          } catch (e) {
            ctx.error((e as Error).message);
          }
        }} />
    </>
  );
}

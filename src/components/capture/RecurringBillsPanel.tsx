/**
 * Recurring bills / expenses (8.43): rent, SaaS, AMC payable. Each run writes a DRAFT bill into the
 * inbox (never a posted bill). Lazy part of Expenses → Inbox.
 */
import { useState } from 'react';
import { Repeat, Trash2 } from 'lucide-react';
import { gstRateOptions } from '../../lib/tax-rules';
import { PURCHASE_CATEGORIES } from '../../types/purchases';
import type { Frequency } from '../../lib/recurring';
import { recurringBillsAll, recurringBillTotals, removeRecurringBill, saveRecurringBill, setRecurringBillActive } from '../../lib/recurring-bills';
import { vendorsDb } from '../../lib/vendors';
import { can } from '../../lib/access';
import { generateId } from '../../lib/storage';
import { cn, formatCurrency, formatDate, todayInput } from '../../lib/utils';
import { NumberInput } from '../ui/NumberInput';
import { useT } from '../../i18n';
import { capT } from '../../i18n/areas/capture';
import { frequencyText, recT } from '../../i18n/areas/recurring';
import { purCategory } from '../../i18n/areas/purchases';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import css from './capture.module.css';
import { SelectField } from '../ui/SelectField';
import { DateField } from '../ui/DateField';

const FREQS: Frequency[] = ['monthly', 'quarterly', 'half-yearly', 'yearly', 'weekly', 'custom-days'];

const blank = () => ({ name: '', kind: 'EXPENSE' as 'PURCHASE' | 'EXPENSE', vendorId: '', category: 'Rent', item: '', amount: 0, rate: 18, frequency: 'monthly' as Frequency, interval: 1, start: todayInput(), end: '', due: 7, itc: true });

export default function RecurringBillsPanel({ businessState, onChanged }: { businessState: string; onChanged: (m?: string, tone?: 'success' | 'error' | 'info') => void }) {
  useT();
  const [tick, setTick] = useState(0);
  const [f, setF] = useState(blank);
  const [open, setOpen] = useState(false);
  void tick;
  const rows = recurringBillsAll();
  const vendors = vendorsDb.all();
  const writable = can('books.edit');
  const today = todayInput();
  const set = (p: Partial<ReturnType<typeof blank>>) => setF((x) => ({ ...x, ...p }));

  const act = (fn: () => void, msg: string) => {
    try {
      fn();
      onChanged(msg);
    } catch (err) {
      onChanged((err as Error).message, 'error');
    }
    setTick((t) => t + 1);
  };

  const save = () =>
    act(() => {
      const v = vendors.find((x) => x.id === f.vendorId);
      saveRecurringBill(
        {
          name: f.name,
          kind: f.kind,
          vendor_id: v?.id,
          vendor_name: v?.name ?? '',
          vendor_gstin: v?.gstin,
          category: f.kind === 'PURCHASE' ? 'Purchases' : f.category,
          lines: [{ id: generateId(), name: f.item.trim() || f.name.trim() || f.category, quantity: 1, rate: Math.max(Number(f.amount) || 0, 0), tax_rate: Number(f.rate) || 0 }],
          itc_eligible: f.itc,
          due_in_days: f.due,
          frequency: f.frequency,
          interval: f.interval,
          start_date: f.start,
          end_date: f.end || undefined,
          active: true,
        },
        today,
      );
      setF(blank());
      setOpen(false);
    }, capT('recSaved'));

  return (
    <section className={surface.card} aria-label={capT('recTitle')}>
      <div className={surface.cardHead}>
        <span className={surface.cardHeadIcon}><Repeat size={16} /> {capT('recTitle')} ({rows.length})</span>
      </div>
      <div className={cn(surface.cardBody, css.stack)}>
        <p className={css.note}>{capT('recHint')}</p>
        {rows.length > 0 && (
          <ul className={css.list}>
            {rows.map((r) => (
              <li key={r.id} className={css.item}>
                <div className={css.main}>
                  <strong>{r.name}</strong>
                  <span className={css.sub}>
                    {r.vendor_name} · {frequencyText(r)} · {formatCurrency(recurringBillTotals(r, businessState).total)} · {r.active ? capT('recNext', { date: formatDate(r.next_run) }) : capT('recPaused')}
                  </span>
                </div>
                {writable && (
                  <div className={css.actions}>
                    <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => act(() => setRecurringBillActive(r.id, !r.active, today), r.active ? capT('recPaused') : capT('recResumed'))}>
                      {r.active ? capT('pause') : capT('resume')}
                    </button>
                    <button type="button" className={cn(controls.btnGhost, controls.btnSm)} aria-label={capT('recDelete', { name: r.name })} onClick={() => act(() => removeRecurringBill(r.id), capT('recDeleted'))}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
        {writable && (
          <details className={css.details} open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
            <summary>{capT('recNew')}</summary>
            <div className={cn(css.grid)} style={{ marginTop: '0.75rem' }}>
              <label className={controls.field}><span className={controls.label}>{capT('recName')}</span><input className={controls.input} value={f.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} placeholder={capT('recNamePh')} /></label>
              <label className={controls.field}><span className={controls.label}>{capT('recKind')}</span>
                <SelectField className={controls.select} value={f.kind} onChange={(e) => set({ kind: e.target.value === 'PURCHASE' ? 'PURCHASE' : 'EXPENSE' })}>
                  <option value="EXPENSE">{capT('kindExpense')}</option>
                  <option value="PURCHASE">{capT('kindBill')}</option>
                </SelectField>
              </label>
              <label className={controls.field}><span className={controls.label}>{capT('supplier')}</span>
                <SelectField className={controls.select} value={f.vendorId} onChange={(e) => set({ vendorId: e.target.value })}>
                  <option value="">-</option>
                  {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </SelectField>
              </label>
              {f.kind === 'EXPENSE' && (
                <label className={controls.field}><span className={controls.label}>{capT('head')}</span>
                  <SelectField className={controls.select} value={f.category} onChange={(e) => set({ category: e.target.value })}>
                    {PURCHASE_CATEGORIES.map((c) => <option key={c} value={c}>{purCategory(c)}</option>)}
                  </SelectField>
                </label>
              )}
              <label className={controls.field}><span className={controls.label}>{capT('recItem')}</span><input className={controls.input} value={f.item} maxLength={120} onChange={(e) => set({ item: e.target.value })} placeholder={capT('recItemPh')} /></label>
              <label className={controls.field}><span className={controls.label}>{capT('recAmount')}</span><NumberInput className={cn(controls.input, controls.inputNumeric)} value={f.amount} onChange={(v) => set({ amount: v })} /></label>
              <label className={controls.field}><span className={controls.label}>{capT('gstRate')}</span>
                <SelectField className={controls.select} value={f.rate} onChange={(e) => set({ rate: Number(e.target.value) })}>
                  {gstRateOptions(undefined, f.rate).map((s) => <option key={s} value={s}>{s}%</option>)}
                </SelectField>
              </label>
              <label className={controls.field}><span className={controls.label}>{capT('recFreq')}</span>
                <SelectField className={controls.select} value={f.frequency} onChange={(e) => set({ frequency: e.target.value as Frequency })}>
                  {FREQS.map((x) => <option key={x} value={x}>{recT(`freq.${x}`)}</option>)}
                </SelectField>
              </label>
              <label className={controls.field}><span className={controls.label}>{capT('recEvery')}</span><NumberInput className={cn(controls.input, controls.inputNumeric)} value={f.interval} onChange={(v) => set({ interval: Math.max(1, Math.round(v)) })} /></label>
              <label className={controls.field}><span className={controls.label}>{capT('recStart')}</span><DateField className={controls.input} value={f.start} onChange={(e) => set({ start: e.target.value })} /></label>
              <label className={controls.field}><span className={controls.label}>{capT('recEnd')}</span><DateField className={controls.input} value={f.end} min={f.start} onChange={(e) => set({ end: e.target.value })} /></label>
              <label className={controls.field}><span className={controls.label}>{capT('recDue')}</span><NumberInput className={cn(controls.input, controls.inputNumeric)} value={f.due} onChange={(v) => set({ due: Math.max(0, Math.round(v)) })} /></label>
            </div>
            <label className={controls.check} style={{ marginTop: '0.5rem' }}>
              <input type="checkbox" checked={f.itc} onChange={(e) => set({ itc: e.target.checked })} /> {capT('claimItc')}
            </label>
            <div className={css.bar} style={{ marginTop: '0.75rem' }}>
              <button type="button" className={controls.btnPrimary} onClick={save}>{capT('recCreate')}</button>
            </div>
          </details>
        )}
      </div>
    </section>
  );
}

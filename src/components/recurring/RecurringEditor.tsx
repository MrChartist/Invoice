import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { localDb } from '../../lib/localDb';
import { deriveGstMode, num } from '../../lib/invoice-calc';
import {
  FREQUENCY_LABELS,
  createSchedule,
  firstOccurrenceOnOrAfter,
  parseYmd,
  previewOccurrences,
  recurringDb,
  templateFromInvoice,
  templateTotals,
  type Frequency,
  type RecurringMode,
  type RecurringSchedule,
  type RecurringTemplate,
} from '../../lib/recurring';
import { blankItem, makeDraft, senderStateCode } from '../../store/invoice-defaults';
import { cn, formatCurrency, formatDate, todayInput } from '../../lib/utils';
import { GST_SLABS, type InvoiceRecord } from '../../types/invoice';
import controls from '../../styles/controls.module.css';
import styles from './recurring.module.css';

export interface RecurringEditorProps {
  open: boolean;
  onClose: () => void;
  /** Edit this schedule. */
  schedule?: RecurringSchedule;
  /** Prefill from a saved invoice (looked up by id). */
  fromInvoiceId?: string;
  /** Prefill from an in-memory invoice (may be unsaved). Wins over fromInvoiceId. */
  sourceInvoice?: InvoiceRecord;
  onSaved: (schedule: RecurringSchedule) => void;
}

const FREQUENCIES = Object.keys(FREQUENCY_LABELS) as Frequency[];

function scratchTemplate(): RecurringTemplate {
  const settings = localDb.settings.get();
  const draft = makeDraft({
    settings,
    sender: localDb.settings.activeProfile(),
    templateId: localDb.template.get(),
  });
  const tpl = templateFromInvoice({ ...draft, items: [blankItem(draft.tax_rate)] });
  // templateFromInvoice drops empty rows; a scratch schedule starts with one.
  return { ...tpl, items: [{ ...blankItem(draft.tax_rate), name: 'Monthly subscription — {month} {year}' }] };
}

function suggestName(t: RecurringTemplate): string {
  const first = t.items.find((i) => i.name.trim())?.name.replace(/\s*[—-]\s*\{.*$/, '').trim();
  return [t.client.name, first].filter(Boolean).join(' — ');
}

/** 1 -> "1st", 22 -> "22nd", 31 -> "31st", 11 -> "11th". */
function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  return `${n}${({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th'}`;
}

export function RecurringEditor(props: RecurringEditorProps) {
  if (!props.open) return null;
  const { open: _open, ...rest } = props;
  void _open;
  return <EditorBody {...rest} />;
}

function EditorBody({
  onClose,
  schedule,
  fromInvoiceId,
  sourceInvoice,
  onSaved,
}: Omit<RecurringEditorProps, 'open'>) {
  const today = todayInput();
  const savedInvoices = useMemo(
    () => localDb.invoices.getAll().filter((i) => i.doc_type !== 'QUOTATION' && i.doc_type !== 'DELIVERY_CHALLAN'),
    [],
  );
  const clients = useMemo(() => localDb.clients.getAll(), []);

  const initialSource = useMemo(
    () => sourceInvoice ?? (fromInvoiceId ? localDb.invoices.getById(fromInvoiceId) : undefined),
    [sourceInvoice, fromInvoiceId],
  );

  const [template, setTemplate] = useState<RecurringTemplate>(
    () => schedule?.template ?? (initialSource ? templateFromInvoice(initialSource) : scratchTemplate()),
  );
  const [name, setName] = useState(() => schedule?.name ?? suggestName(template));
  const [nameTouched, setNameTouched] = useState(Boolean(schedule));
  const [sourceId, setSourceId] = useState(initialSource?.id ?? '');
  const [frequency, setFrequency] = useState<Frequency>(schedule?.frequency ?? 'monthly');
  const [interval, setIntervalValue] = useState(String(schedule?.interval ?? 1));
  const [startDate, setStartDate] = useState(schedule?.start_date ?? today);
  const [endDate, setEndDate] = useState(schedule?.end_date ?? '');
  const [maxRuns, setMaxRuns] = useState(schedule?.max_runs ? String(schedule.max_runs) : '');
  const [dueIn, setDueIn] = useState(String(schedule?.due_in_days ?? localDb.settings.get().defaultDueDays ?? 14));
  const [mode, setMode] = useState<RecurringMode>(schedule?.mode ?? 'draft');
  const [errors, setErrors] = useState<string[]>([]);

  const rule = {
    frequency,
    interval: Math.max(1, Math.floor(num(interval, 1))),
    start_date: startDate,
    end_date: endDate || undefined,
    max_runs: num(maxRuns) > 0 ? Math.floor(num(maxRuns)) : undefined,
  };
  const startValid = Boolean(parseYmd(startDate));
  const consumed = schedule ? schedule.run_count + (schedule.skipped_count || 0) : 0;
  const rulesChanged =
    !schedule ||
    schedule.frequency !== rule.frequency ||
    schedule.interval !== rule.interval ||
    schedule.start_date !== rule.start_date;
  const previewFrom = schedule && !rulesChanged ? schedule.next_run : schedule && schedule.run_count > 0 ? today : startDate;
  const dates = startValid ? previewOccurrences(rule, 6, previewFrom, consumed) : [];
  const totals = useMemo(() => templateTotals(template), [template]);

  const patchTemplate = (patch: Partial<RecurringTemplate>) => setTemplate((t) => ({ ...t, ...patch }));

  const patchItem = (id: string, patch: Partial<RecurringTemplate['items'][number]>) =>
    setTemplate((t) => ({ ...t, items: t.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }));

  const pickInvoice = (id: string) => {
    setSourceId(id);
    const inv = savedInvoices.find((i) => i.id === id);
    const next = inv ? templateFromInvoice(inv) : scratchTemplate();
    setTemplate(next);
    if (!nameTouched) setName(suggestName(next));
  };

  const pickClient = (id: string) => {
    const c = clients.find((x) => x.id === id);
    if (!c) return;
    const place = c.state_code || template.place_of_supply;
    const anyTax = template.items.some((i) => num(i.tax_rate) > 0) || num(template.tax_rate) > 0;
    setTemplate((t) => ({
      ...t,
      client: { ...t.client, ...c },
      place_of_supply: place,
      gst_mode: deriveGstMode({
        senderStateCode: senderStateCode(t.sender),
        placeOfSupply: place,
        senderHasGstin: Boolean(t.sender?.companyGstin?.trim()),
        taxEnabled: anyTax,
      }),
    }));
    if (!nameTouched) setName(suggestName({ ...template, client: c }));
  };

  const validate = (): string[] => {
    const out: string[] = [];
    if (!name.trim()) out.push('Give the schedule a name.');
    if (!template.client.name.trim()) out.push('Choose a client.');
    if (!template.items.some((i) => (i.name.trim() || num(i.rate) > 0) && num(i.quantity) > 0)) {
      out.push('Add at least one priced line item.');
    }
    if (totals.total <= 0) out.push('The invoice total is zero — check the rates.');
    if (!startValid) out.push('Choose a valid start date.');
    if (endDate && startDate && endDate < startDate) out.push('End date cannot be before the start date.');
    if (!(num(interval) >= 1)) out.push('Repeat interval must be at least 1.');
    return out;
  };

  const save = () => {
    const problems = validate();
    setErrors(problems);
    if (problems.length) return;
    const cleaned: RecurringTemplate = {
      ...template,
      items: template.items.filter((i) => i.name.trim() || num(i.rate) > 0),
    };
    try {
      let saved: RecurringSchedule;
      if (schedule) {
        const nextRun = !rulesChanged
          ? schedule.next_run
          : schedule.run_count === 0
            ? startDate
            : firstOccurrenceOnOrAfter(rule, today);
        saved = recurringDb.save({
          ...schedule,
          name: name.trim(),
          template: cleaned,
          ...rule,
          next_run: nextRun,
          due_in_days: Math.max(0, Math.floor(num(dueIn, 14))),
          mode,
        });
      } else {
        saved = recurringDb.save(
          createSchedule({
            name,
            template: cleaned,
            ...rule,
            due_in_days: num(dueIn, 14),
            mode,
          }),
        );
      }
      onSaved(saved);
      onClose();
    } catch (err) {
      setErrors([(err as Error).message]);
    }
  };

  const hasClientName = Boolean(template.client.name.trim());

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={schedule ? 'Edit recurring invoice' : 'New recurring invoice'}
      subtitle="Invoices are created automatically when each date arrives — the next time you open the app."
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={controls.btnPrimary} onClick={save}>
            {schedule ? 'Save changes' : 'Create schedule'}
          </button>
        </>
      }
    >
      <form
        className={styles.form}
        onSubmit={(e) => {
          e.preventDefault();
          save();
        }}
        noValidate
      >
        {errors.length > 0 && (
          <ul className={styles.errors} role="alert">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>What to bill</h3>
          {!schedule && (
            <div className={controls.field}>
              <label className={controls.label} htmlFor="rec-source">Start from</label>
              <select
                id="rec-source"
                className={controls.select}
                value={sourceId}
                onChange={(e) => pickInvoice(e.target.value)}
              >
                <option value="">{sourceInvoice && !sourceId ? 'Current invoice' : 'Blank — pick a client below'}</option>
                {savedInvoices.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.invoice_number || 'Unnumbered'} · {i.client.name || 'No client'} · {formatCurrency(i.total, i.currency)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className={controls.row}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="rec-name">Schedule name</label>
              <input
                id="rec-name"
                className={controls.input}
                value={name}
                placeholder="e.g. Acme — monthly research plan"
                onChange={(e) => {
                  setName(e.target.value);
                  setNameTouched(true);
                }}
              />
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="rec-client">Client</label>
              {hasClientName && !clients.some((c) => c.id === template.client.id) ? (
                <input id="rec-client" className={controls.input} value={template.client.name} readOnly />
              ) : (
                <select
                  id="rec-client"
                  className={controls.select}
                  value={template.client.id ?? ''}
                  onChange={(e) => pickClient(e.target.value)}
                >
                  <option value="">Select a client…</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div role="group" aria-label="Line items" className={styles.section}>
            <div className={styles.itemHead} aria-hidden="true">
              <span>Item</span>
              <span>Qty</span>
              <span>Rate</span>
              <span>GST %</span>
              <span />
            </div>
            {template.items.map((item, idx) => (
              <div className={styles.itemRow} key={item.id}>
                <input
                  className={controls.input}
                  aria-label={`Item ${idx + 1} name`}
                  value={item.name}
                  placeholder="Service — {month} {year}"
                  onChange={(e) => patchItem(item.id, { name: e.target.value })}
                />
                <input
                  className={cn(controls.input, controls.inputNumeric)}
                  aria-label={`Item ${idx + 1} quantity`}
                  placeholder="Qty"
                  type="number"
                  min="0"
                  step="any"
                  value={item.quantity}
                  onChange={(e) => patchItem(item.id, { quantity: num(e.target.value) })}
                />
                <input
                  className={cn(controls.input, controls.inputNumeric)}
                  aria-label={`Item ${idx + 1} rate`}
                  placeholder="Rate (₹)"
                  type="number"
                  min="0"
                  step="any"
                  value={item.rate}
                  onChange={(e) => patchItem(item.id, { rate: num(e.target.value), amount: num(e.target.value) * num(item.quantity) })}
                />
                <select
                  className={controls.select}
                  aria-label={`Item ${idx + 1} GST rate`}
                  value={item.tax_rate ?? 0}
                  onChange={(e) => patchItem(item.id, { tax_rate: num(e.target.value) })}
                >
                  {GST_SLABS.map((s) => (
                    <option key={s} value={s}>{s}%</option>
                  ))}
                </select>
                <button
                  type="button"
                  className={controls.btnDanger}
                  aria-label={`Remove item ${idx + 1}`}
                  disabled={template.items.length <= 1}
                  onClick={() => patchTemplate({ items: template.items.filter((i) => i.id !== item.id) })}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            ))}
            <div>
              <button
                type="button"
                className={cn(controls.btnGhost, controls.btnSm)}
                onClick={() => patchTemplate({ items: [...template.items, blankItem(template.tax_rate)] })}
              >
                <Plus size={14} /> Add item
              </button>
            </div>
            <p className={controls.hint}>
              Tip: <code>{'{month}'}</code>, <code>{'{year}'}</code> and <code>{'{period}'}</code> in an item name
              become that run&apos;s month and year.
            </p>
            <div className={styles.totalLine}>
              <span>Total per invoice</span>
              <span>{formatCurrency(totals.total, template.currency)}</span>
            </div>
          </div>
        </section>

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Schedule</h3>
          <div className={controls.row}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="rec-freq">Repeats</label>
              <select
                id="rec-freq"
                className={controls.select}
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as Frequency)}
              >
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>{FREQUENCY_LABELS[f]}</option>
                ))}
              </select>
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="rec-interval">
                Every {frequency === 'custom-days' ? 'N days' : 'N periods'}
              </label>
              <input
                id="rec-interval"
                className={cn(controls.input, controls.inputNumeric)}
                type="number"
                min="1"
                step="1"
                value={interval}
                onChange={(e) => setIntervalValue(e.target.value)}
              />
            </div>
          </div>
          <div className={controls.row}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="rec-start">First invoice date</label>
              <input id="rec-start" className={controls.input} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="rec-due">Payment due after (days)</label>
              <input
                id="rec-due"
                className={cn(controls.input, controls.inputNumeric)}
                type="number"
                min="0"
                step="1"
                value={dueIn}
                onChange={(e) => setDueIn(e.target.value)}
              />
            </div>
          </div>
          <div className={controls.row}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="rec-end">End date (optional)</label>
              <input id="rec-end" className={controls.input} type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="rec-max">Stop after N invoices (optional)</label>
              <input
                id="rec-max"
                className={cn(controls.input, controls.inputNumeric)}
                type="number"
                min="1"
                step="1"
                placeholder="Unlimited"
                value={maxRuns}
                onChange={(e) => setMaxRuns(e.target.value)}
              />
            </div>
          </div>

          <div className={controls.field}>
            <span className={controls.label} id="rec-mode-label">When an invoice is due</span>
            <div className={controls.segment} role="radiogroup" aria-labelledby="rec-mode-label">
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'draft'}
                className={mode === 'draft' ? controls.segmentBtnActive : controls.segmentBtn}
                onClick={() => setMode('draft')}
              >
                Create a Draft to review
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'issue'}
                className={mode === 'issue' ? controls.segmentBtnActive : controls.segmentBtn}
                onClick={() => setMode('issue')}
              >
                Issue as Sent
              </button>
            </div>
          </div>
        </section>

        <section className={styles.section} aria-live="polite">
          <h3 className={styles.sectionTitle}>Next {dates.length || 6} dates</h3>
          {dates.length === 0 ? (
            <p className={controls.hint}>No upcoming dates — check the start date, end date and limits.</p>
          ) : (
            <ol className={styles.preview}>
              {dates.map((d, i) => (
                <li key={d} className={i === 0 ? styles.previewFirst : styles.previewItem}>
                  {formatDate(d)}
                  <span className={styles.previewDay}>
                    {new Intl.DateTimeFormat('en-IN', { weekday: 'long' }).format(new Date(`${d}T12:00:00`))}
                    {i === 0 ? ' · first' : ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {parseYmd(startDate) && Number(startDate.slice(8, 10)) > 28 && frequency !== 'weekly' && frequency !== 'custom-days' && (
            <p className={controls.hint}>
              Started on the {ordinal(Number(startDate.slice(8, 10)))}: shorter months use their last day, then it returns to the {ordinal(Number(startDate.slice(8, 10)))}.
            </p>
          )}
        </section>
      </form>
    </Modal>
  );
}

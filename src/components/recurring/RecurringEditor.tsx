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
  startAfterInvoice,
  templateFromInvoice,
  templateTotals,
  type Frequency,
  type RecurringMode,
  type RecurringSchedule,
  type RecurringTemplate,
} from '../../lib/recurring';
import { blankItem, makeDraft, senderStateCode } from '../../store/invoice-defaults';
import { cn, formatCurrency, formatDate, todayInput } from '../../lib/utils';
import { type InvoiceRecord } from '../../types/invoice';
import { gstRateOptions } from '../../lib/tax-rules';
import { isRecurringSource } from '../../lib/documents';
import controls from '../../styles/controls.module.css';
import styles from './recurring.module.css';
import { dateLocale, getLanguage, useT } from '../../i18n';
import { recT } from '../../i18n/areas/recurring';
import { SnapshotFields } from '../custom-fields/SnapshotFields';
import { customFieldsDb, finalizeValues } from '../../lib/custom-fields';
import { areaNodes } from '../../i18n/areas/nodes';
import { loadPaymentTerms } from '../../lib/payment-terms';

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
  useT(); // re-render on a language switch (5.4)
  const today = todayInput();
  const savedInvoices = useMemo(
    () => localDb.invoices.getAll().filter((i) => isRecurringSource(i.doc_type)),
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
  // QA-3 F6: from an invoice, the first date defaults to the next occurrence after it (not today, which
  // would bill the invoice's own period again); a date the user picks wins.
  const [startPick, setStartPick] = useState(schedule?.start_date ?? '');
  const [endDate, setEndDate] = useState(schedule?.end_date ?? '');
  const [maxRuns, setMaxRuns] = useState(schedule?.max_runs ? String(schedule.max_runs) : '');
  const [dueIn, setDueIn] = useState(String(schedule?.due_in_days ?? localDb.settings.get().defaultDueDays ?? 14));
  const [mode, setMode] = useState<RecurringMode>(schedule?.mode ?? 'draft');
  // PENDING 49 (8.111): instalments on every run — a payment term, or the source document's schedule re-dated.
  const [termId, setTermId] = useState(schedule?.payment_terms_id ?? '');
  const terms = useMemo(() => loadPaymentTerms().filter((t) => !t.inactive || t.id === schedule?.payment_terms_id), [schedule?.payment_terms_id]);
  const [errors, setErrors] = useState<string[]>([]);

  const sourceDate = (savedInvoices.find((i) => i.id === sourceId) ?? initialSource)?.issue_date;
  const startDate = startPick || (sourceDate ? startAfterInvoice({ frequency, interval: Math.max(1, Math.floor(num(interval, 1))) }, sourceDate, today) : today);
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
    if (!name.trim()) out.push(recT('eName'));
    if (!template.client.name.trim()) out.push(recT('eClient'));
    if (!template.items.some((i) => (i.name.trim() || num(i.rate) > 0) && num(i.quantity) > 0)) {
      out.push(recT('eLine'));
    }
    if (totals.total <= 0) out.push(recT('eZero'));
    if (!startValid) out.push(recT('eStart'));
    if (endDate && startDate && endDate < startDate) out.push(recT('eEnd'));
    if (!(num(interval) >= 1)) out.push(recT('eInterval'));
    return out;
  };

  const save = () => {
    const problems = validate();
    setErrors(problems);
    if (problems.length) return;
    const cleaned: RecurringTemplate = {
      ...template,
      items: template.items.filter((i) => i.name.trim() || num(i.rate) > 0),
      custom_values: finalizeValues(template.custom_values, customFieldsDb.all(), !schedule), // 6.23 (PENDING #25)
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
          payment_terms_id: termId || undefined,
        });
      } else {
        const created = createSchedule({
          name,
          template: cleaned,
          ...rule,
          due_in_days: num(dueIn, 14),
          mode,
        });
        saved = recurringDb.save(termId ? { ...created, payment_terms_id: termId } : created);
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
      title={schedule ? recT('editTitle') : recT('newTitle')}
      subtitle={recT('editorSub')}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>
            {recT('cancel')}
          </button>
          <button type="button" className={controls.btnPrimary} onClick={save}>
            {schedule ? recT('saveChanges') : recT('create')}
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
          <h3 className={styles.sectionTitle}>{recT('whatToBill')}</h3>
          {!schedule && (
            <div className={controls.field}>
              <label className={controls.label} htmlFor="rec-source">{recT('startFrom')}</label>
              <select
                id="rec-source"
                className={controls.select}
                value={sourceId}
                onChange={(e) => pickInvoice(e.target.value)}
              >
                <option value="">{sourceInvoice && !sourceId ? recT('currentInvoice') : recT('blank')}</option>
                {savedInvoices.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.invoice_number || recT('unnumbered')} · {i.client.name || recT('noClient')} · {formatCurrency(i.total, i.currency)}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className={controls.row}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="rec-name">{recT('name')}</label>
              <input
                id="rec-name"
                className={controls.input}
                value={name}
                placeholder={recT('namePh')}
                onChange={(e) => {
                  setName(e.target.value);
                  setNameTouched(true);
                }}
              />
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="rec-client">{recT('client')}</label>
              {hasClientName && !clients.some((c) => c.id === template.client.id) ? (
                <input id="rec-client" className={controls.input} value={template.client.name} readOnly />
              ) : (
                <select
                  id="rec-client"
                  className={controls.select}
                  value={template.client.id ?? ''}
                  onChange={(e) => pickClient(e.target.value)}
                >
                  <option value="">{recT('selectClient')}</option>
                  {clients.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              )}
            </div>
          </div>

          <div role="group" aria-label={recT('lineItems')} className={styles.section}>
            <div className={styles.itemHead} aria-hidden="true">
              <span>{recT('item')}</span>
              <span>{recT('qty')}</span>
              <span>{recT('rate')}</span>
              <span>{recT('gstPct')}</span>
              <span />
            </div>
            {template.items.map((item, idx) => (
              <div className={styles.itemRow} key={item.id}>
                <input
                  className={controls.input}
                  aria-label={recT('itemName', { n: idx + 1 })}
                  value={item.name}
                  placeholder="Service — {month} {year}"
                  onChange={(e) => patchItem(item.id, { name: e.target.value })}
                />
                <input
                  className={cn(controls.input, controls.inputNumeric)}
                  aria-label={recT('itemQty', { n: idx + 1 })}
                  placeholder={recT('qty')}
                  type="number"
                  min="0"
                  step="any"
                  value={item.quantity}
                  onChange={(e) => patchItem(item.id, { quantity: num(e.target.value) })}
                />
                <input
                  className={cn(controls.input, controls.inputNumeric)}
                  aria-label={recT('itemRate', { n: idx + 1 })}
                  placeholder={recT('ratePh')}
                  type="number"
                  min="0"
                  step="any"
                  value={item.rate}
                  onChange={(e) => patchItem(item.id, { rate: num(e.target.value), amount: num(e.target.value) * num(item.quantity) })}
                />
                <select
                  className={controls.select}
                  aria-label={recT('itemGst', { n: idx + 1 })}
                  value={item.tax_rate ?? 0}
                  onChange={(e) => patchItem(item.id, { tax_rate: num(e.target.value) })}
                >
                  {gstRateOptions(undefined, item.tax_rate ?? 0).map((s) => (
                    <option key={s} value={s}>{s}%</option>
                  ))}
                </select>
                <button
                  type="button"
                  className={controls.btnDanger}
                  aria-label={recT('removeItem', { n: idx + 1 })}
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
                <Plus size={14} /> {recT('addItem')}
              </button>
            </div>
            <p className={controls.hint}>
              {areaNodes(recT('tip'), { month: <code>{'{month}'}</code>, year: <code>{'{year}'}</code>, period: <code>{'{period}'}</code> })}
            </p>
            <div className={styles.totalLine}>
              <span>{recT('totalPer')}</span>
              <span>{formatCurrency(totals.total, template.currency)}</span>
            </div>
          </div>
        </section>

        <SnapshotFields scope="document" idPrefix="rec" values={template.custom_values} onChange={(custom_values) => setTemplate((t) => ({ ...t, custom_values }))} />

        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>{recT('schedule')}</h3>
          <div className={controls.row}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="rec-freq">{recT('repeats')}</label>
              <select
                id="rec-freq"
                className={controls.select}
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as Frequency)}
              >
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>{recT(`freq.${f}`)}</option>
                ))}
              </select>
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="rec-interval">
                {frequency === 'custom-days' ? recT('everyNDays') : recT('everyNPeriods')}
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
              <label className={controls.label} htmlFor="rec-start">{recT('firstDate')}</label>
              <input id="rec-start" className={controls.input} type="date" value={startDate} onChange={(e) => setStartPick(e.target.value)} />
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="rec-due">{recT('dueAfter')}</label>
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
              <label className={controls.label} htmlFor="rec-term">{recT('instTerm')}</label>
              <select id="rec-term" className={controls.select} value={termId} onChange={(e) => setTermId(e.target.value)} data-rec-term>
                <option value="">{template.instalments?.length ? recT('instFromDoc', { n: template.instalments.length }) : recT('instNone')}</option>
                {terms.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
          </div>
          <div className={controls.row}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="rec-end">{recT('endDate')}</label>
              <input id="rec-end" className={controls.input} type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="rec-max">{recT('stopAfter')}</label>
              <input
                id="rec-max"
                className={cn(controls.input, controls.inputNumeric)}
                type="number"
                min="1"
                step="1"
                placeholder={recT('unlimited')}
                value={maxRuns}
                onChange={(e) => setMaxRuns(e.target.value)}
              />
            </div>
          </div>

          <div className={controls.field}>
            <span className={controls.label} id="rec-mode-label">{recT('whenDue')}</span>
            <div className={controls.segment} role="radiogroup" aria-labelledby="rec-mode-label">
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'draft'}
                className={mode === 'draft' ? controls.segmentBtnActive : controls.segmentBtn}
                onClick={() => setMode('draft')}
              >
                {recT('modeDraft')}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mode === 'issue'}
                className={mode === 'issue' ? controls.segmentBtnActive : controls.segmentBtn}
                onClick={() => setMode('issue')}
              >
                {recT('modeIssue')}
              </button>
            </div>
          </div>
        </section>

        <section className={styles.section} aria-live="polite">
          <h3 className={styles.sectionTitle}>{recT('nextDates', { n: dates.length || 6 })}</h3>
          {dates.length === 0 ? (
            <p className={controls.hint}>{recT('noDates')}</p>
          ) : (
            <ol className={styles.preview}>
              {dates.map((d, i) => (
                <li key={d} className={i === 0 ? styles.previewFirst : styles.previewItem}>
                  {formatDate(d)}
                  <span className={styles.previewDay}>
                    {new Intl.DateTimeFormat(dateLocale(), { weekday: 'long' }).format(new Date(`${d}T12:00:00`))}
                    {i === 0 ? recT('first') : ''}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {parseYmd(startDate) && Number(startDate.slice(8, 10)) > 28 && frequency !== 'weekly' && frequency !== 'custom-days' && (
            <p className={controls.hint}>
              {recT('monthEnd', { day: getLanguage() === 'hi' ? Number(startDate.slice(8, 10)) : ordinal(Number(startDate.slice(8, 10))) })}
            </p>
          )}
        </section>
      </form>
    </Modal>
  );
}

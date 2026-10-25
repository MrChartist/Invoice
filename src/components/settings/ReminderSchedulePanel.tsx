import { useMemo, useState } from 'react';
import { BellRing } from 'lucide-react';
import { can } from '../../lib/access';
import {
  DEFAULT_REMINDER_SCHEDULE, SCHEDULED_STAGES, TEMPLATE_VARS, buildReminder, builtInTemplate, scheduleIssues, unknownPlaceholders,
  type ReminderLanguage, type ReminderSchedule, type ReminderTemplates, type ScheduledStage,
} from '../../lib/reminders';
import { loadReminderSchedule, saveReminderSchedule } from '../../lib/reminder-settings';
import type { InvoiceRecord } from '../../types/invoice';
import { localDb } from '../../lib/localDb';
import { addDaysInput, todayInput } from '../../lib/utils';
import { useT } from '../../i18n';
import { colT } from '../../i18n/areas/collections';
import { remindT } from '../../i18n/areas/reminders';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from '../collections/collections.module.css';

const LANGS: ReminderLanguage[] = ['en', 'hinglish'];

/** A sample bill for the live preview (never stored). */
function sampleInvoice(): InvoiceRecord {
  const today = todayInput();
  return {
    id: 'preview', invoice_number: 'INV/FY26-27/0042', doc_type: 'TAX_INVOICE', issue_date: addDaysInput(-20, today), due_date: addDaysInput(-10, today),
    status: 'Sent', currency: 'INR', template_id: 'classic', client: { name: 'Bharat Traders', email: '', address: '', city: '', zip: '' },
    sender: localDb.settings.activeProfile(), items: [], gst_mode: 'NONE', place_of_supply: '', reverse_charge: false, discount_type: 'PERCENT',
    discount_rate: 0, tax_rate: 0, shipping: 0, other_charges: 0, round_off_enabled: false, amount_paid: 0, notes: '', terms: '',
    subtotal: 25000, discount_amount: 0, taxable_value: 25000, cgst_amount: 0, sgst_amount: 0, igst_amount: 0, tax_amount: 0, round_off: 0,
    total: 25000, balance_due: 25000,
  };
}

/**
 * Settings → Defaults → Reminder schedule (R2-A5): when each stage starts, the wait between reminders, and
 * the wording per stage and language (blank = built-in text; unknown placeholders are flagged and fall back).
 */
export function ReminderSchedulePanel({ notify }: { notify: (m: string, tone?: 'success' | 'error' | 'info') => void }) {
  useT();
  const [s, setS] = useState<ReminderSchedule>(loadReminderSchedule);
  const [stage, setStage] = useState<ScheduledStage>('overdue_polite');
  const [lang, setLang] = useState<ReminderLanguage>('en');
  const allowed = can('settings.manage');
  const issues = scheduleIssues(s);
  const sample = useMemo(() => sampleInvoice(), []);
  const tpl = s.templates?.[lang]?.[stage] ?? {};
  const unknown = [...unknownPlaceholders(tpl.subject ?? ''), ...unknownPlaceholders(tpl.body ?? '')];
  const preview = buildReminder(sample, stage, lang, new Date(), { templates: s.templates });
  const base = builtInTemplate(stage, lang);

  const num = (k: 'upcoming_days' | 'polite_after' | 'firm_after' | 'final_after') => (
    <label className={controls.field}>
      <span className={controls.label}>{colT(k === 'upcoming_days' ? 'rsUpcoming' : k === 'polite_after' ? 'rsPolite' : k === 'firm_after' ? 'rsFirm' : 'rsFinal')}</span>
      <input className={`${controls.input} ${controls.inputNumeric}`} type="number" min="0" max="365" value={s[k]} disabled={!allowed}
        onChange={(e) => setS({ ...s, [k]: Math.max(0, Math.round(Number(e.target.value) || 0)) })} data-schedule-field={k} />
    </label>
  );
  const setTpl = (field: 'subject' | 'body', value: string) => {
    const templates: ReminderTemplates = { ...(s.templates ?? {}) };
    const byLang = { ...(templates[lang] ?? {}) };
    byLang[stage] = { ...(byLang[stage] ?? {}), [field]: value };
    templates[lang] = byLang;
    setS({ ...s, templates });
  };
  const save = () => {
    try {
      setS(saveReminderSchedule(s));
      notify(colT('rsSaved'));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  return (
    <section className={surface.card} data-reminder-schedule>
      <div className={surface.cardHead}><span className={surface.cardHeadIcon}><BellRing size={16} /> {colT('rsTitle')}</span></div>
      <div className={`${surface.cardBody} ${styles.stack}`}>
        <p className={surface.sectionNote}>{colT('rsIntro')}</p>
        <div className={styles.grid4}>
          {num('upcoming_days')}
          {num('polite_after')}
          {num('firm_after')}
          {num('final_after')}
        </div>
        <fieldset className={`${styles.plain} ${styles.stack}`}>
          <legend className={controls.label}>{colT('rsCooldown')}</legend>
          <div className={styles.grid4}>
            {SCHEDULED_STAGES.map((st) => (
              <label key={st} className={controls.field}>
                <span className={controls.label}>{remindT(`stage.${st}`)}</span>
                <input className={`${controls.input} ${controls.inputNumeric}`} type="number" min="1" max="90" value={s.cooldowns[st]} disabled={!allowed}
                  onChange={(e) => setS({ ...s, cooldowns: { ...s.cooldowns, [st]: Math.max(1, Math.round(Number(e.target.value) || 1)) } })} />
              </label>
            ))}
          </div>
        </fieldset>
        {issues.length > 0 && <div className={controls.error} role="alert">{issues.map((i) => <div key={i}>{i}</div>)}</div>}

        <div className={styles.box}>
          <span className={styles.boxHead}>{colT('rsTemplates')}</span>
          <div className={styles.grid2}>
            <label className={controls.field}>
              <span className={controls.label}>{colT('rsStage')}</span>
              <select className={controls.select} value={stage} onChange={(e) => setStage(e.target.value as ScheduledStage)}>
                {SCHEDULED_STAGES.map((st) => <option key={st} value={st}>{remindT(`stage.${st}`)}</option>)}
              </select>
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{colT('rsLang')}</span>
              <select className={controls.select} value={lang} onChange={(e) => setLang(e.target.value as ReminderLanguage)}>
                {LANGS.map((l) => <option key={l} value={l}>{l === 'en' ? 'English' : 'Hinglish'}</option>)}
              </select>
            </label>
          </div>
          <label className={controls.field}>
            <span className={controls.label}>{colT('rsSubject')}</span>
            <input className={controls.input} value={tpl.subject ?? ''} placeholder={base.subject} disabled={!allowed} onChange={(e) => setTpl('subject', e.target.value)} />
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{colT('rsBody')}</span>
            <textarea className={controls.textarea} rows={6} value={tpl.body ?? ''} placeholder={base.body} disabled={!allowed} onChange={(e) => setTpl('body', e.target.value)} data-template-body />
            <span className={controls.hint}>{colT('rsBlank')}</span>
          </label>
          <div className={styles.chips} aria-label={colT('rsPlaceholders', { list: '' })}>
            {TEMPLATE_VARS.map((v) => (
              <button key={v} type="button" className={styles.chip} disabled={!allowed} onClick={() => setTpl('body', `${tpl.body ?? ''}{${v}}`)}>{`{${v}}`}</button>
            ))}
          </div>
          {unknown.length > 0 && <p className={styles.warn} role="alert" data-template-unknown>{colT('rsUnknown', { list: unknown.join(', ') })}</p>}
          {(tpl.subject || tpl.body) && (
            <div><button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={() => { setTpl('subject', ''); setTpl('body', ''); }}>{colT('rsClear')}</button></div>
          )}
          <span className={controls.label}>{colT('rsPreview')}</span>
          <pre className={styles.preview} data-template-preview>{`${preview.subject}\n\n${preview.body}`}</pre>
        </div>

        {allowed && (
          <div className={styles.inlineActions}>
            <button type="button" className={controls.btnOutline} onClick={() => setS({ ...DEFAULT_REMINDER_SCHEDULE, ...(s.templates ? { templates: s.templates } : {}) })}>{colT('rsReset')}</button>
            <button type="button" className={controls.btnPrimary} onClick={save} disabled={issues.length > 0} data-schedule-save>{colT('rsSave')}</button>
          </div>
        )}
      </div>
    </section>
  );
}

export default ReminderSchedulePanel;

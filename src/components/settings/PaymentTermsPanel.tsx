import { lazy, Suspense, useState } from 'react';
import { CalendarClock, Plus, Trash2 } from 'lucide-react';
import { can } from '../../lib/access';
import { localDb } from '../../lib/localDb';
import { validateUdyam, normalizeUdyam } from '../../lib/msme';
import {
  TERM_KINDS, describeTerm, loadPaymentTerms, savePaymentTerm, setTermActive, termIssues,
  type OffsetKind, type PaymentTerm, type TermInstalment, type TermKind,
} from '../../lib/payment-terms';
import { SHORT_PAY_ACCOUNTS, loadCollectionSettings, saveCollectionSettings, type CollectionSettings } from '../../lib/settlement';
import { useT } from '../../i18n';
import { colT } from '../../i18n/areas/collections';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from '../collections/collections.module.css';

// R13 (MF-A5): Udyam category, print switch and FSSAI number (lazy row beside the Udyam number).
const MfProfileRow = lazy(() => import('../mfg/MfProfileRow'));

const OFFSETS: OffsetKind[] = ['days', 'eom', 'day_next_month'];
const blankTerm = (): PaymentTerm => ({ id: '', name: '', kind: 'net', days: 30 });
const blankRows = (): TermInstalment[] => [
  { percent: 30, offset_kind: 'days', offset: 0, label: 'Advance' },
  { percent: 70, offset_kind: 'days', offset: 45 },
];

/**
 * Settings → Defaults → Payment terms (R2-A1) and the settlement settings (R2-A2): the terms master (create /
 * edit / deactivate), the seller's Udyam number for the MSME 45-day note, and the settlement discount options
 * (GST variant, clerk cap, short-payment account).
 */
export function PaymentTermsPanel({ notify }: { notify: (m: string, tone?: 'success' | 'error' | 'info') => void }) {
  useT();
  const [terms, setTerms] = useState<PaymentTerm[]>(loadPaymentTerms);
  const [edit, setEdit] = useState<PaymentTerm | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [settings, setSettings] = useState<CollectionSettings>(loadCollectionSettings);
  const profile = localDb.settings.activeProfile();
  const [udyam, setUdyam] = useState(profile?.msme_udyam ?? '');
  const canEdit = can('master.edit');
  const canSettings = can('settings.manage');

  const save = () => {
    if (!edit) return;
    const issues = termIssues(edit);
    if (issues.length) return setErrors(issues);
    try {
      savePaymentTerm(edit);
      setTerms(loadPaymentTerms());
      setEdit(null);
      setErrors([]);
      notify(colT('ptSaved'));
    } catch (err) {
      setErrors([(err as Error).message]);
    }
  };
  const toggle = (t: PaymentTerm) => {
    try {
      setTermActive(t.id, !!t.inactive);
      setTerms(loadPaymentTerms());
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  const saveUdyam = () => {
    const bad = validateUdyam(udyam);
    if (bad) return notify(bad, 'error');
    const s = localDb.settings.get();
    try {
      localDb.settings.save({ ...s, profiles: s.profiles.map((p) => (p.id === s.activeProfileId ? { ...p, msme_udyam: normalizeUdyam(udyam) || undefined } : p)) });
      notify(colT('ptUdyamSaved'));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  const saveSettings = () => {
    try {
      setSettings(saveCollectionSettings(settings));
      notify(colT('ssSaved'));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };
  const setRow = (i: number, patch: Partial<TermInstalment>) =>
    setEdit((e) => (e ? { ...e, instalments: (e.instalments ?? []).map((r, k) => (k === i ? { ...r, ...patch } : r)) } : e));

  return (
    <section className={surface.card} data-payment-terms-panel>
      <div className={surface.cardHead}>
        <span className={surface.cardHeadIcon}><CalendarClock size={16} /> {colT('ptTitle')}</span>
        {canEdit && !edit && (
          <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => { setEdit(blankTerm()); setErrors([]); }} data-term-new>
            <Plus size={14} /> {colT('ptNew')}
          </button>
        )}
      </div>
      <div className={`${surface.cardBody} ${styles.stack}`}>
        <p className={surface.sectionNote}>{colT('ptIntro')}</p>
        <ul className={styles.termList}>
          {terms.map((t) => (
            <li key={t.id} className={`${styles.item} ${t.inactive ? styles.inactive : ''}`}>
              <div className={styles.itemMain}>
                <span className={styles.itemTitle}>{t.name}{t.inactive ? ` · ${colT('ptInactive')}` : ''}</span>
                <span className={styles.itemMeta}>{describeTerm(t)}</span>
              </div>
              {canEdit && (
                <div className={styles.itemActions}>
                  <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={() => { setEdit({ ...t }); setErrors([]); }}>{colT('ptEdit')}</button>
                  <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={() => toggle(t)}>{t.inactive ? colT('ptActivate') : colT('ptDeactivate')}</button>
                </div>
              )}
            </li>
          ))}
        </ul>
        {!terms.some((t) => t.created_at) && <p className={styles.note}>{colT('ptStarter')}</p>}
        <p className={styles.note}>{colT('ptClientDefault')}</p>

        {edit && (
          <div className={styles.box} data-term-editor>
            <div className={styles.grid2}>
              <label className={controls.field}>
                <span className={controls.label}>{colT('ptName')}</span>
                <input className={controls.input} value={edit.name} maxLength={60} onChange={(e) => setEdit({ ...edit, name: e.target.value })} data-term-name />
              </label>
              <label className={controls.field}>
                <span className={controls.label}>{colT('ptKind')}</span>
                <select className={controls.select} value={edit.kind}
                  onChange={(e) => { const kind = e.target.value as TermKind; setEdit({ ...edit, kind, ...(kind === 'instalments' && !edit.instalments?.length ? { instalments: blankRows() } : {}), ...(kind === 'day_next_month' && !edit.day ? { day: 10 } : {}) }); }}
                  data-term-kind>
                  {TERM_KINDS.map((k) => <option key={k} value={k}>{colT(`kind.${k}`)}</option>)}
                </select>
              </label>
              {(edit.kind === 'net' || edit.kind === 'eom') && (
                <label className={controls.field}>
                  <span className={controls.label}>{colT('ptDays')}</span>
                  <input className={`${controls.input} ${controls.inputNumeric}`} type="number" min="0" value={edit.days ?? 0} onChange={(e) => setEdit({ ...edit, days: Number(e.target.value) })} data-term-days />
                </label>
              )}
              {edit.kind === 'day_next_month' && (
                <label className={controls.field}>
                  <span className={controls.label}>{colT('ptDay')}</span>
                  <input className={`${controls.input} ${controls.inputNumeric}`} type="number" min="1" max="31" value={edit.day ?? 1} onChange={(e) => setEdit({ ...edit, day: Number(e.target.value) })} />
                </label>
              )}
            </div>
            {edit.kind === 'instalments' && (
              <table className={styles.rowsTable}>
                <thead><tr><th scope="col">{colT('ptLabel')}</th><th scope="col">{colT('ptPercent')}</th><th scope="col">{colT('ptOffset')}</th><th scope="col"><span className={surface.srOnly}>{colT('ptRemoveRow')}</span></th></tr></thead>
                <tbody>
                  {(edit.instalments ?? []).map((r, i) => (
                    <tr key={i}>
                      <td><input className={controls.input} value={r.label ?? ''} aria-label={colT('ptLabel')} onChange={(e) => setRow(i, { label: e.target.value })} /></td>
                      <td><input className={`${controls.input} ${controls.inputNumeric}`} type="number" min="0" max="100" step="0.01" value={r.percent} aria-label={colT('ptPercent')} onChange={(e) => setRow(i, { percent: Number(e.target.value) })} /></td>
                      <td>
                        <span className={styles.inlineActions}>
                          <input className={`${controls.input} ${controls.inputNumeric}`} type="number" min="0" value={r.offset} aria-label={colT('ptOffset')} onChange={(e) => setRow(i, { offset: Number(e.target.value) })} />
                          <select className={controls.select} value={r.offset_kind} aria-label={colT('ptOffset')} onChange={(e) => setRow(i, { offset_kind: e.target.value as OffsetKind })}>
                            {OFFSETS.map((o) => <option key={o} value={o}>{colT(`off.${o}`)}</option>)}
                          </select>
                        </span>
                      </td>
                      <td>
                        <button type="button" className={controls.btnIcon} aria-label={colT('ptRemoveRow')} disabled={(edit.instalments ?? []).length <= 2}
                          onClick={() => setEdit({ ...edit, instalments: (edit.instalments ?? []).filter((_, k) => k !== i) })}>
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {edit.kind === 'instalments' && (
              <div>
                <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`}
                  onClick={() => setEdit({ ...edit, instalments: [...(edit.instalments ?? []), { percent: 0, offset_kind: 'days', offset: 30 }] })}>
                  <Plus size={14} /> {colT('ptAddRow')}
                </button>
              </div>
            )}
            <label className={controls.check}>
              <input type="checkbox" checked={!!edit.early_discount} onChange={(e) => setEdit({ ...edit, early_discount: e.target.checked ? { percent: 2, days: 7 } : undefined })} data-term-early />
              {colT('ptEarly')}
            </label>
            {edit.early_discount && (
              <div className={styles.grid2}>
                <label className={controls.field}>
                  <span className={controls.label}>{colT('ptEarlyPct')}</span>
                  <input className={`${controls.input} ${controls.inputNumeric}`} type="number" min="0" max="99" step="0.01" value={edit.early_discount.percent} onChange={(e) => setEdit({ ...edit, early_discount: { ...edit.early_discount!, percent: Number(e.target.value) } })} />
                </label>
                <label className={controls.field}>
                  <span className={controls.label}>{colT('ptEarlyDays')}</span>
                  <input className={`${controls.input} ${controls.inputNumeric}`} type="number" min="0" value={edit.early_discount.days} onChange={(e) => setEdit({ ...edit, early_discount: { ...edit.early_discount!, days: Number(e.target.value) } })} />
                </label>
              </div>
            )}
            {errors.length > 0 && <div className={controls.error} role="alert">{errors.map((e) => <div key={e}>{e}</div>)}</div>}
            <div className={styles.inlineActions}>
              <button type="button" className={controls.btnOutline} onClick={() => setEdit(null)}>{colT('cancel')}</button>
              <button type="button" className={controls.btnPrimary} onClick={save} data-term-save>{colT('ptSave')}</button>
            </div>
          </div>
        )}

        {canSettings && (
          <div className={styles.box}>
            <label className={controls.field}>
              <span className={controls.label}>{colT('ptUdyam')}</span>
              <span className={styles.inlineActions}>
                <input className={`${controls.input} ${controls.inputMono}`} value={udyam} placeholder="UDYAM-MH-01-0000001" onChange={(e) => setUdyam(e.target.value.toUpperCase())} />
                <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={saveUdyam}>{colT('save')}</button>
              </span>
              <span className={controls.hint}>{colT('ptUdyamHint')}</span>
            </label>
            <Suspense fallback={null}><MfProfileRow notify={notify} /></Suspense>
          </div>
        )}

        {canSettings && (
          <div className={styles.box} data-settlement-settings>
            <span className={styles.boxHead}>{colT('ssTitle')}</span>
            <label className={controls.check}>
              <input type="checkbox" checked={settings.gst_variant} onChange={(e) => setSettings({ ...settings, gst_variant: e.target.checked })} />
              {colT('ssGst')}
            </label>
            {settings.gst_variant && <p className={styles.warn} role="note">{colT('settleGstWarn')}</p>}
            <div className={styles.grid4}>
              <label className={controls.field}>
                <span className={controls.label}>{colT('ssCapAbs')}</span>
                <input className={`${controls.input} ${controls.inputNumeric}`} type="number" min="0" value={settings.clerk_cap_abs} onChange={(e) => setSettings({ ...settings, clerk_cap_abs: Number(e.target.value) })} />
              </label>
              <label className={controls.field}>
                <span className={controls.label}>{colT('ssCapPct')}</span>
                <input className={`${controls.input} ${controls.inputNumeric}`} type="number" min="0" max="100" step="0.1" value={settings.clerk_cap_pct} onChange={(e) => setSettings({ ...settings, clerk_cap_pct: Number(e.target.value) })} />
              </label>
              <label className={controls.field}>
                <span className={controls.label}>{colT('ssShort')}</span>
                <select className={controls.select} value={settings.short_pay_account} onChange={(e) => setSettings({ ...settings, short_pay_account: e.target.value })}>
                  {SHORT_PAY_ACCOUNTS.map((a) => <option key={a} value={a}>{colT(`acc.${a}`)}</option>)}
                </select>
              </label>
            </div>
            <p className={styles.note}>{colT('ssCapHint')}</p>
            <p className={styles.note}>{colT('ssCa')}</p>
            <div><button type="button" className={controls.btnPrimary} onClick={saveSettings}>{colT('ssSave')}</button></div>
          </div>
        )}
      </div>
    </section>
  );
}

export default PaymentTermsPanel;

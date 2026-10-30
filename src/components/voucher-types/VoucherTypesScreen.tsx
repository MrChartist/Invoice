/**
 * Voucher Types master screen (P1-13): list, create, alter, delete / inactivate. Lazy — mounted from
 * Accounts Info (`/books?tab=coa&m=voucher-types`) and the Gateway Create / Alter menus.
 */
import { useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { vtT, type VtKey } from '../../i18n/areas/voucher-types';
import { can } from '../../lib/access';
import { isCashOrBankLedger } from '../../lib/bank-ledgers';
import { godownsDb } from '../../lib/godowns';
import { chartOf, loadUserAccounts } from '../../lib/ledger/accounts';
import { todayInput } from '../../lib/utils';
import {
  VOUCHER_BASES,
  deleteVoucherType,
  loadVoucherTypes,
  numberingExample,
  saveVoucherType,
  validateVoucherType,
  voucherTypeUsage,
  type VoucherBase,
  type VoucherType,
  type VoucherTypeInput,
} from '../../lib/voucher-types';
import { TEMPLATES } from '../templates/registry';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './VoucherTypes.module.css';
import { SelectField } from '../ui/SelectField';

const baseLabel = (b: VoucherBase) => vtT(`b${b}` as VtKey);
const blank = (): VoucherTypeInput => ({ name: '', base: 'SALES', prefix: '', restart: 'yearly' });
const BANK_BASES = new Set<VoucherBase>(['RECEIPT', 'PAYMENT', 'CONTRA']);
const GODOWN_BASES = new Set<VoucherBase>(['SALES', 'CREDIT_NOTE', 'DEBIT_NOTE']);

export interface VoucherTypesScreenProps {
  onBack?: () => void;
  notify?: (msg: string, tone?: 'success' | 'error') => void;
  /** Open straight into the create form. */
  startCreate?: boolean;
}

export default function VoucherTypesScreen({ onBack, notify, startCreate }: VoucherTypesScreenProps) {
  useT();
  const [version, setVersion] = useState(0);
  const types = useMemo(() => loadVoucherTypes(), [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const [draft, setDraft] = useState<VoucherTypeInput | null>(() => (startCreate && can('master.edit') ? blank() : null));
  const [error, setError] = useState('');
  const edit = can('master.edit');
  const banks = useMemo(() => chartOf(loadUserAccounts()).filter((a) => isCashOrBankLedger(a)), []);
  const godowns = useMemo(() => godownsDb.list(), []);
  const today = todayInput();

  const save = () => {
    if (!draft) return;
    setError('');
    const errs = validateVoucherType(draft, types);
    if (errs.length) return setError(errs[0]);
    try {
      const row = saveVoucherType(draft);
      notify?.(vtT('saved', { name: row.name }));
      setDraft(null);
      setVersion((v) => v + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const remove = (t: VoucherType) => {
    try {
      deleteVoucherType(t.id);
      notify?.(vtT('deleted', { name: t.name }));
      setVersion((v) => v + 1);
    } catch (err) {
      notify?.((err as Error).message, 'error');
    }
  };

  const set = (p: Partial<VoucherTypeInput>) => setDraft((d) => (d ? { ...d, ...p } : d));

  if (draft) {
    const example = numberingExample({ ...draft, prefix: draft.prefix || 'X' }, today);
    return (
      <section className={surface.card} aria-label={vtT('title')} onKeyDown={(e) => {
        if (e.key === 'Escape') setDraft(null);
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
          e.preventDefault();
          save();
        }
      }}>
        <div className={surface.cardHead}>{draft.id ? `${vtT('alter')}: ${draft.name}` : vtT('create')}</div>
        <div className={surface.cardBody}>
          <div className={styles.form}>
            <label className={controls.field}>
              <span className={controls.label}>{vtT('name')}</span>
              <input className={controls.input} value={draft.name} autoFocus onChange={(e) => set({ name: e.target.value })} data-testid="vt-name" />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{vtT('base')}</span>
              <SelectField className={controls.select} value={draft.base} disabled={!!draft.id} onChange={(e) => set({ base: e.target.value as VoucherBase, bank_account_id: undefined, godown_id: undefined, use_for_pos: undefined })} data-testid="vt-base">
                {VOUCHER_BASES.map((b) => <option key={b} value={b}>{baseLabel(b)}</option>)}
              </SelectField>
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{vtT('prefix')}</span>
              <input className={`${controls.input} ${controls.inputMono}`} value={draft.prefix} maxLength={12} onChange={(e) => set({ prefix: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') })} data-testid="vt-prefix" />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{vtT('suffix')}</span>
              <input className={`${controls.input} ${controls.inputMono}`} value={draft.suffix ?? ''} maxLength={8} onChange={(e) => set({ suffix: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, '') || undefined })} />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{vtT('startNumber')}</span>
              <input className={controls.input} type="number" min={1} value={draft.start_number ?? 1} onChange={(e) => set({ start_number: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{vtT('width')}</span>
              <input className={controls.input} type="number" min={1} max={9} value={draft.width ?? 4} onChange={(e) => set({ width: Math.min(9, Math.max(1, Math.floor(Number(e.target.value) || 4))) })} />
            </label>
            <label className={controls.field}>
              <span className={controls.label}>{vtT('restart')}</span>
              <SelectField className={controls.select} value={draft.restart ?? 'yearly'} onChange={(e) => set({ restart: e.target.value === 'monthly' ? 'monthly' : 'yearly' })}>
                <option value="yearly">{vtT('yearly')}</option>
                <option value="monthly">{vtT('monthly')}</option>
              </SelectField>
            </label>
            <p className={`${controls.hint} ${styles.wide}`} aria-live="polite">
              {vtT('example', { number: '' })}<span className={styles.example}>{example}</span>
            </p>
            {(GODOWN_BASES.has(draft.base)) && (
              <>
                <label className={controls.field}>
                  <span className={controls.label}>{vtT('printTitle')}</span>
                  <input className={controls.input} value={draft.print_title ?? ''} maxLength={40} onChange={(e) => set({ print_title: e.target.value || undefined })} />
                  <span className={controls.hint}>{vtT('printTitleHint')}</span>
                </label>
                <label className={controls.field}>
                  <span className={controls.label}>{vtT('template')}</span>
                  <SelectField className={controls.select} value={draft.template_id ?? ''} onChange={(e) => set({ template_id: e.target.value || undefined })}>
                    <option value="">{vtT('keep')}</option>
                    {TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </SelectField>
                </label>
                <label className={controls.field}>
                  <span className={controls.label}>{vtT('defaultGodown')}</span>
                  <SelectField className={controls.select} value={draft.godown_id ?? ''} onChange={(e) => set({ godown_id: e.target.value || undefined })}>
                    <option value="">{vtT('keep')}</option>
                    {godowns.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </SelectField>
                </label>
              </>
            )}
            {BANK_BASES.has(draft.base) && (
              <label className={controls.field}>
                <span className={controls.label}>{vtT('defaultBank')}</span>
                <SelectField className={controls.select} value={draft.bank_account_id ?? ''} onChange={(e) => set({ bank_account_id: e.target.value || undefined })}>
                  <option value="">{vtT('keep')}</option>
                  {banks.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </SelectField>
              </label>
            )}
            {draft.base === 'SALES' && (
              <label className={controls.check}>
                <input type="checkbox" checked={!!draft.use_for_pos} onChange={(e) => set({ use_for_pos: e.target.checked || undefined })} />
                {vtT('useForPos')}
              </label>
            )}
            {draft.id && (
              <label className={controls.check}>
                <input type="checkbox" checked={!!draft.inactive} onChange={(e) => set({ inactive: e.target.checked || undefined })} />
                {vtT('inactive')}
              </label>
            )}
          </div>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <div className={styles.actions} style={{ marginTop: 12 }}>
            <button type="button" className={`${controls.btn} ${controls.btnOutline}`} onClick={() => setDraft(null)}>{vtT('cancel')} (Esc)</button>
            <button type="button" className={`${controls.btn} ${controls.btnPrimary}`} onClick={save} data-testid="vt-save">{vtT('save')} (Ctrl+A)</button>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className={surface.card} aria-label={vtT('title')} onKeyDown={(e) => e.key === 'Escape' && onBack?.()}>
      <div className={surface.cardHead}>{vtT('title')}</div>
      <div className={surface.cardBody}>
        <p className={controls.hint}>{vtT('hint')}</p>
        {types.length === 0 ? (
          <p className={controls.hint}>{vtT('none')}</p>
        ) : (
          <ul className={styles.list} data-testid="vt-list">
            {types.map((t) => {
              const used = voucherTypeUsage(t.id);
              return (
                <li key={t.id} className={styles.row}>
                  <span className={styles.rowMain}>
                    <span className={styles.rowName}>
                      {t.name}
                      {t.use_for_pos && <span className={styles.badge}>{vtT('pos')}</span>}
                      {t.inactive && <span className={styles.badge}>{vtT('inactive').split(' (')[0]}</span>}
                    </span>
                    <span className={styles.meta}>
                      {baseLabel(t.base)} · <span className={styles.mono}>{numberingExample(t, today)}</span>
                      {t.restart === 'monthly' ? ` · ${vtT('monthly')}` : ''}
                      {used ? ` · ${vtT('used', { n: used })}` : ''}
                    </span>
                  </span>
                  {edit && (
                    <span className={styles.actions}>
                      <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => { setError(''); setDraft({ ...t }); }}>{vtT('alter')}</button>
                      {!used && <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={() => remove(t)}>{vtT('delete')}</button>}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <div className={styles.actions} style={{ marginTop: 12 }}>
          {onBack && <button type="button" className={`${controls.btn} ${controls.btnOutline}`} onClick={onBack}>{vtT('back')}</button>}
          {edit && <button type="button" className={`${controls.btn} ${controls.btnPrimary}`} onClick={() => { setError(''); setDraft(blank()); }} data-testid="vt-create">{vtT('create')}</button>}
        </div>
      </div>
    </section>
  );
}

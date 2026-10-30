/**
 * Reconcile → Rules (8.45): the bank-rule list and editor. Lazy chunk. The editor is also opened
 * pre-filled from the suggestions strip after a manual categorisation ("Create rule for similar lines?").
 */
import { useMemo, useState } from 'react';
import { Plus, Trash2, Wand2 } from 'lucide-react';
import { gstRateOptions } from '../../../lib/tax-rules';
import { PURCHASE_CATEGORIES } from '../../../types/purchases';
import { rulesDb, validateRule, type BankRule, type RuleAction, type RuleCondition } from '../../../lib/bank-rules';
import { chartOf, loadUserAccounts } from '../../../lib/ledger/accounts';
import { isCashOrBankLedger } from '../../../lib/bank-ledgers';
import { bankAccountsDb } from '../../../lib/bank-accounts';
import { vendorsDb } from '../../../lib/vendors';
import { localDb } from '../../../lib/localDb';
import { can } from '../../../lib/access';
import { cn } from '../../../lib/utils';
import { Modal } from '../../ui/Modal';
import { NumberInput } from '../../ui/NumberInput';
import { CostCentreSelect } from '../../cost-centres/CostCentreSelect';
import { useCostCentres } from '../../cost-centres/useCostCentres';
import { BranchSelect } from '../../branches/BranchSelect';
import { useT } from '../../../i18n';
import { capT } from '../../../i18n/areas/capture';
import { purCategory } from '../../../i18n/areas/purchases';
import controls from '../../../styles/controls.module.css';
import surface from '../../../styles/surface.module.css';
import css from '../../capture/capture.module.css';
import { SelectField } from '../../ui/SelectField';

export type RuleDraft = Omit<BankRule, 'id' | 'created_at'> & { id?: string };

const KINDS: RuleCondition['kind'][] = ['contains', 'starts', 'regex', 'counterparty', 'amount', 'direction', 'account'];
const ACTIONS: RuleAction['kind'][] = ['expense', 'voucher', 'receipt', 'contra', 'ignore'];

const blankCondition = (kind: RuleCondition['kind']): RuleCondition => {
  switch (kind) {
    case 'contains':
    case 'starts':
      return { kind, text: '' };
    case 'regex':
      return { kind, pattern: '' };
    case 'counterparty':
      return { kind, token: '' };
    case 'amount':
      return { kind };
    case 'direction':
      return { kind, dir: 'debit' };
    default:
      return { kind: 'account', bankAccountId: 'default' };
  }
};

const emptyRule = (): RuleDraft => ({
  name: '',
  match: 'all',
  conditions: [{ kind: 'contains', text: '' }, { kind: 'direction', dir: 'debit' }],
  action: { kind: 'expense', category: 'Bank charges', gst_rate: 18, itc: true },
  priority: 100,
  active: true,
});

export function RuleEditorModal({ rule, onClose, onSaved }: { rule: RuleDraft | null; onClose: () => void; onSaved: (r: BankRule) => void }) {
  useT();
  return (
    <Modal open={!!rule} onClose={onClose} size="lg" title={rule?.id ? capT('ruleEdit') : capT('ruleNew')} subtitle={capT('ruleSub')}>
      {rule && <RuleForm key={rule.id ?? 'new'} initial={rule} onClose={onClose} onSaved={onSaved} />}
    </Modal>
  );
}

function RuleForm({ initial, onClose, onSaved }: { initial: RuleDraft; onClose: () => void; onSaved: (r: BankRule) => void }) {
  const [r, setR] = useState<RuleDraft>(initial);
  const [error, setError] = useState('');
  const centres = useCostCentres();
  const chart = useMemo(() => chartOf(loadUserAccounts()), []);
  const vendors = useMemo(() => vendorsDb.all(), []);
  const clients = useMemo(() => localDb.clients.getAll(), []);
  const banks = useMemo(() => bankAccountsDb.all(), []);
  const a = r.action;
  const setA = (p: Partial<RuleAction>) => setR({ ...r, action: { ...a, ...p } });
  const setC = (i: number, c: RuleCondition) => setR({ ...r, conditions: r.conditions.map((x, j) => (j === i ? c : x)) });
  const ledgers = a.kind === 'contra' ? chart.filter((x) => isCashOrBankLedger(x)) : chart.filter((x) => !isCashOrBankLedger(x));

  const save = () => {
    const problem = validateRule(r);
    if (problem) return setError(problem);
    try {
      onSaved(rulesDb.save(r));
      onClose();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <form className={css.stack} onSubmit={(e) => { e.preventDefault(); save(); }}>
      <div className={css.grid}>
        <label className={controls.field}><span className={controls.label}>{capT('ruleName')}</span><input className={controls.input} value={r.name} maxLength={80} onChange={(e) => setR({ ...r, name: e.target.value })} /></label>
        <label className={controls.field}><span className={controls.label}>{capT('ruleMatch')}</span>
          <SelectField className={controls.select} value={r.match} onChange={(e) => setR({ ...r, match: e.target.value === 'any' ? 'any' : 'all' })}>
            <option value="all">{capT('matchAll')}</option>
            <option value="any">{capT('matchAny')}</option>
          </SelectField>
        </label>
        <label className={controls.field}><span className={controls.label}>{capT('rulePriority')}</span><NumberInput className={cn(controls.input, controls.inputNumeric)} value={r.priority} onChange={(v) => setR({ ...r, priority: Math.round(v) })} /></label>
      </div>

      <fieldset className={css.stack}>
        <legend className={controls.label}>{capT('conditions')}</legend>
        {r.conditions.map((c, i) => (
          <div key={i} className={css.cond}>
            <SelectField className={controls.select} aria-label={capT('condKind')} value={c.kind} onChange={(e) => setC(i, blankCondition(e.target.value as RuleCondition['kind']))}>
              {KINDS.map((k) => <option key={k} value={k}>{capT(`c_${k}`)}</option>)}
            </SelectField>
            {(c.kind === 'contains' || c.kind === 'starts') && <input className={controls.input} aria-label={capT('condText')} maxLength={120} value={c.text} onChange={(e) => setC(i, { ...c, text: e.target.value })} />}
            {c.kind === 'regex' && <input className={cn(controls.input, controls.inputMono)} aria-label={capT('condText')} maxLength={120} value={c.pattern} onChange={(e) => setC(i, { ...c, pattern: e.target.value })} />}
            {c.kind === 'counterparty' && <input className={controls.input} aria-label={capT('condText')} maxLength={60} value={c.token} onChange={(e) => setC(i, { ...c, token: e.target.value.toUpperCase() })} />}
            {c.kind === 'amount' && (
              <>
                <NumberInput className={cn(controls.input, controls.inputNumeric)} aria-label={capT('min')} value={c.min ?? 0} onChange={(v) => setC(i, { ...c, min: v || undefined })} />
                <NumberInput className={cn(controls.input, controls.inputNumeric)} aria-label={capT('max')} value={c.max ?? 0} onChange={(v) => setC(i, { ...c, max: v || undefined })} />
              </>
            )}
            {c.kind === 'direction' && (
              <SelectField className={controls.select} aria-label={capT('c_direction')} value={c.dir} onChange={(e) => setC(i, { ...c, dir: e.target.value === 'credit' ? 'credit' : 'debit' })}>
                <option value="debit">{capT('debit')}</option>
                <option value="credit">{capT('credit')}</option>
              </SelectField>
            )}
            {c.kind === 'account' && (
              <SelectField className={controls.select} aria-label={capT('c_account')} value={c.bankAccountId} onChange={(e) => setC(i, { ...c, bankAccountId: e.target.value })}>
                {banks.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </SelectField>
            )}
            <button type="button" className={cn(controls.btnGhost, controls.btnSm)} aria-label={capT('removeCond')} disabled={r.conditions.length < 2} onClick={() => setR({ ...r, conditions: r.conditions.filter((_, j) => j !== i) })}><Trash2 size={14} /></button>
          </div>
        ))}
        <div className={css.bar}>
          <button type="button" className={cn(controls.btnOutline, controls.btnSm)} disabled={r.conditions.length >= 8} onClick={() => setR({ ...r, conditions: [...r.conditions, blankCondition('contains')] })}><Plus size={14} /> {capT('addCond')}</button>
        </div>
      </fieldset>

      <fieldset className={css.stack}>
        <legend className={controls.label}>{capT('then')}</legend>
        <div className={css.grid}>
          <label className={controls.field}><span className={controls.label}>{capT('actionKind')}</span>
            <SelectField className={controls.select} value={a.kind} onChange={(e) => setR({ ...r, action: { kind: e.target.value as RuleAction['kind'], ...(e.target.value === 'expense' ? { category: 'Other', gst_rate: 0 } : {}) } })}>
              {ACTIONS.map((k) => <option key={k} value={k}>{capT(`a_${k}`)}</option>)}
            </SelectField>
          </label>
          {a.kind === 'expense' && (
            <>
              <label className={controls.field}><span className={controls.label}>{capT('head')}</span>
                <SelectField className={controls.select} value={a.category ?? ''} onChange={(e) => setA({ category: e.target.value })}>
                  {PURCHASE_CATEGORIES.map((c) => <option key={c} value={c}>{purCategory(c)}</option>)}
                </SelectField>
              </label>
              <label className={controls.field}><span className={controls.label}>{capT('gstRate')}</span>
                <SelectField className={controls.select} value={a.gst_rate ?? 0} onChange={(e) => setA({ gst_rate: Number(e.target.value) })}>
                  {gstRateOptions(undefined, a.gst_rate ?? 0).map((s) => <option key={s} value={s}>{s}%</option>)}
                </SelectField>
              </label>
            </>
          )}
          {(a.kind === 'voucher' || a.kind === 'contra') && (
            <label className={controls.field}><span className={controls.label}>{a.kind === 'contra' ? capT('otherAccount') : capT('ledger')}</span>
              <SelectField className={controls.select} value={a.ledger_id ?? ''} onChange={(e) => setA({ ledger_id: e.target.value })}>
                <option value="">-</option>
                {ledgers.map((x) => <option key={x.id} value={x.id}>{x.code} · {x.name}</option>)}
              </SelectField>
            </label>
          )}
          {(a.kind === 'expense' || a.kind === 'voucher') && (
            <label className={controls.field}><span className={controls.label}>{capT('supplier')}</span>
              <SelectField className={controls.select} value={a.vendor_id ?? ''} onChange={(e) => { const v = vendors.find((x) => x.id === e.target.value); setA({ vendor_id: v?.id, vendor_name: v?.name }); }}>
                <option value="">-</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </SelectField>
            </label>
          )}
          {a.kind === 'receipt' && (
            <label className={controls.field}><span className={controls.label}>{capT('customer')}</span>
              <SelectField className={controls.select} value={a.client_id ?? ''} onChange={(e) => setA({ client_id: e.target.value })}>
                <option value="">-</option>
                {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </SelectField>
            </label>
          )}
          {a.kind !== 'ignore' && a.kind !== 'contra' && (
            <label className={controls.field}><span className={controls.label}>{capT('mode')}</span>
              <SelectField className={controls.select} value={a.mode ?? ''} onChange={(e) => setA({ mode: (e.target.value || undefined) as RuleAction['mode'] })}>
                <option value="">{capT('modeAuto')}</option>
                {['UPI', 'NEFT', 'IMPS', 'RTGS', 'Cheque', 'Card', 'ACH', 'Cash'].map((m) => <option key={m} value={m}>{m}</option>)}
              </SelectField>
            </label>
          )}
          {(a.kind === 'expense' || a.kind === 'voucher') && (
            <CostCentreSelect id="rule-cc" value={a.cost_centre_id} onChange={(v) => setA({ cost_centre_id: v })} centres={centres} />
          )}
          {(a.kind === 'expense' || a.kind === 'voucher') && (
            <div className={controls.field}><BranchSelect id="rule-branch" value={a.branch_id} onChange={(v) => setA({ branch_id: v })} /></div>
          )}
        </div>
        {a.kind === 'expense' && (
          <label className={controls.check}><input type="checkbox" checked={a.itc !== false} onChange={(e) => setA({ itc: e.target.checked })} /> {capT('claimItc')}</label>
        )}
      </fieldset>

      <label className={controls.check}><input type="checkbox" checked={r.active} onChange={(e) => setR({ ...r, active: e.target.checked })} /> {capT('ruleActive')}</label>
      {error && <p className={controls.error} role="alert">{error}</p>}
      <div className={css.bar}>
        <button type="submit" className={controls.btnPrimary}>{capT('saveRule')}</button>
        <button type="button" className={controls.btnOutline} onClick={onClose}>{capT('cancel')}</button>
      </div>
    </form>
  );
}

export default function BankRulesPanel({ notify }: { notify: (m: string, tone?: 'success' | 'error' | 'info') => void }) {
  useT();
  const [tick, setTick] = useState(0);
  const [editing, setEditing] = useState<RuleDraft | null>(null);
  void tick;
  const rules = rulesDb.all().sort((x, y) => x.priority - y.priority || x.created_at.localeCompare(y.created_at));
  const writable = can('books.edit');
  return (
    <section className={surface.card} aria-label={capT('rulesTitle')}>
      <div className={surface.cardHead}>
        <span className={surface.cardHeadIcon}><Wand2 size={16} /> {capT('rulesTitle')} ({rules.length})</span>
        {writable && <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={() => setEditing(emptyRule())}><Plus size={14} /> {capT('ruleNew')}</button>}
      </div>
      <div className={cn(surface.cardBody, css.stack)}>
        <p className={css.note}>{capT('rulesHint')}</p>
        {rules.length === 0 ? (
          <p className={css.note}>{capT('noRules')}</p>
        ) : (
          <ul className={css.list}>
            {rules.map((r) => (
              <li key={r.id} className={css.item}>
                <div className={css.main}>
                  <strong>{r.name}{r.active ? '' : ` · ${capT('inactive')}`}</strong>
                  <span className={css.sub}>{r.conditions.map((c) => capT(`c_${c.kind}`)).join(r.match === 'any' ? ` ${capT('or')} ` : ` ${capT('and')} `)} → {capT(`a_${r.action.kind}`)}{r.action.category ? ` (${purCategory(r.action.category)})` : ''}</span>
                </div>
                {writable && (
                  <div className={css.actions}>
                    <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => setEditing(r)}>{capT('edit')}</button>
                    <button type="button" className={cn(controls.btnGhost, controls.btnSm)} aria-label={capT('deleteRule', { name: r.name })} onClick={() => {
                      try {
                        rulesDb.remove(r.id);
                        notify(capT('ruleDeleted'));
                      } catch (err) {
                        notify((err as Error).message, 'error');
                      }
                      setTick((t) => t + 1);
                    }}><Trash2 size={14} /></button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      <RuleEditorModal rule={editing} onClose={() => setEditing(null)} onSaved={() => { notify(capT('ruleSaved')); setTick((t) => t + 1); }} />
    </section>
  );
}

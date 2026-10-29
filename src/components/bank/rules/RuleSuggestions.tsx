/**
 * Reconcile tab strip (8.45): Rule and Memory suggestions for lines that invoice matching left open,
 * applied as one all-or-nothing batch, plus the "Create rule for similar lines?" offer after a line was
 * categorised by hand. Match suggestions stay in the line list below (labelled there). Lazy chunk.
 */
import { useEffect, useMemo, useState } from 'react';
import { Wand2 } from 'lucide-react';
import type { BankLine, BankStatement } from '../../../lib/bank-recon';
import { buildActionMemory, buildMemory, ruleDraftFromLine, rulesDb, suggestCategorisations, type RuleAction, type RuleSuggestion } from '../../../lib/bank-rules';
import { applyBankBatch } from '../../../lib/bank-rules-apply';
import { can } from '../../../lib/access';
import { localDb } from '../../../lib/localDb';
import { loadVouchers } from '../../../lib/ledger/vouchers';
import { chartOf, loadUserAccounts } from '../../../lib/ledger/accounts';
import { isCashOrBankLedger } from '../../../lib/bank-ledgers';
import { cn, formatDate, formatMoney } from '../../../lib/utils';
import { RuleEditorModal, type RuleDraft } from './BankRulesPanel';
import { useT } from '../../../i18n';
import { capT } from '../../../i18n/areas/capture';
import { purCategory } from '../../../i18n/areas/purchases';
import controls from '../../../styles/controls.module.css';
import surface from '../../../styles/surface.module.css';
import css from '../../capture/capture.module.css';

export interface RulePrompt {
  line: BankLine;
  action: RuleAction;
  bankAccountId?: string;
}

interface Props {
  statements: readonly BankStatement[];
  /** Open lines in view (unmatched / orphan). */
  lines: readonly BankLine[];
  /** Lines that already carry a Match suggestion: rules run after invoice matching. */
  matched: ReadonlySet<string>;
  purchases: readonly unknown[];
  purchasePayments: readonly { id?: string; purchase_id?: string }[];
  prompt: RulePrompt | null;
  onPromptDone: () => void;
  onApplied: (next: BankStatement[], message: string) => void;
  notify: (m: string, tone?: 'success' | 'error' | 'info') => void;
  onManage: () => void;
}

const money = (n: number) => `₹${formatMoney(n)}`;

export default function RuleSuggestions({ statements, lines, matched, purchases, purchasePayments, prompt, onPromptDone, onApplied, notify, onManage }: Props) {
  useT();
  const [tick, setTick] = useState(0);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<RuleDraft | null>(null);
  const accountOf = useMemo(() => {
    const m = new Map<string, string | undefined>();
    for (const st of statements) for (const l of st.lines) m.set(l.id, st.bank_account_id);
    return (id: string) => m.get(id);
  }, [statements]);
  const memory = useMemo(() => buildMemory(statements, purchases as never, purchasePayments), [statements, purchases, purchasePayments]);
  // 8.46: memory for receipts (customer) and payment / receipt vouchers (ledger), read from past matched lines.
  const actions = useMemo(() => {
    const chart = new Map(chartOf(loadUserAccounts()).map((a) => [a.id, a]));
    return buildActionMemory(statements, localDb.payments.getAll(), localDb.invoices.getAll(), loadVouchers(), (id) => isCashOrBankLedger(chart.get(id)));
  }, [statements]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rules = useMemo(() => rulesDb.all(), [tick]);
  // R18-C4: a society's credits naming a unit (A-101, FLAT 101 A) become receipts from its member (lazy, society only).
  const [hs, setHs] = useState<{ f: (l: readonly BankLine[]) => RuleSuggestion[] } | null>(null);
  useEffect(() => { if (localDb.settings.get().society_kind) void import('../../../lib/society/hs-bank-io').then((m) => setHs({ f: m.societySuggestions })); }, []);
  const list = useMemo(() => {
    const base = suggestCategorisations(lines, rules, memory, { accountOf }, matched, actions), seen = new Set(base.map((s) => s.lineId));
    return hs ? [...base, ...hs.f(lines.filter((l) => !seen.has(l.id) && !matched.has(l.id) && !l.ignored && !l.matched_to))] : base;
  }, [lines, rules, memory, accountOf, matched, hs, actions]);
  const byId = useMemo(() => new Map(lines.map((l) => [l.id, l])), [lines]);
  const writable = can('books.edit');
  const picked = list.filter((s) => !off.has(s.lineId));

  const describe = (s: RuleSuggestion) => {
    const a = s.action;
    if (a.kind === 'expense') return `${capT('a_expense')}: ${purCategory(a.category ?? 'Other')}${a.vendor_name ? ` · ${a.vendor_name}` : ''}${a.gst_rate ? ` · GST ${a.gst_rate}%${a.itc !== false ? ' ITC' : ''}` : ''}`;
    return capT(`a_${a.kind}`);
  };

  const apply = () => {
    try {
      const next = applyBankBatch(picked.map((s) => ({ line: byId.get(s.lineId)!, action: s.action, source: s.source, ruleId: s.ruleId, label: s.label })));
      setOff(new Set());
      onApplied(next, capT('applied', { n: picked.length }));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  if (!list.length && !prompt) return null;
  return (
    <section className={surface.card} aria-label={capT('sugTitle')}>
      <div className={surface.cardHead}>
        <span className={surface.cardHeadIcon}><Wand2 size={16} /> {capT('sugTitle')} ({list.length})</span>
        <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={onManage}>{capT('manageRules')}</button>
      </div>
      <div className={cn(surface.cardBody, css.stack)}>
        {prompt && writable && (
          <div className={css.warn} role="status">
            {capT('promptText')}{' '}
            <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={() => setEditing(ruleDraftFromLine(prompt.line, prompt.action, prompt.bankAccountId))}>{capT('promptYes')}</button>{' '}
            <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={onPromptDone}>{capT('promptNo')}</button>
          </div>
        )}
        {list.length > 0 && (
          <>
            <p className={css.note}>{capT('sugHint', { match: matched.size })}</p>
            <ul className={css.list}>
              {list.map((s) => {
                const l = byId.get(s.lineId);
                if (!l) return null;
                return (
                  <li key={s.lineId} className={css.item}>
                    <label className={cn(controls.check, css.main)}>
                      <input type="checkbox" checked={!off.has(s.lineId)} disabled={!writable} onChange={(e) => {
                        const n = new Set(off);
                        if (e.target.checked) n.delete(s.lineId);
                        else n.add(s.lineId);
                        setOff(n);
                      }} />
                      <span>
                        <span className={s.source === 'rule' ? css.tagRule : css.tagMemory}>{s.source === 'rule' ? capT('tagRule') : capT('tagMemory')}</span>
                        {formatDate(l.date)} · {l.debit > 0 ? `− ${money(l.debit)}` : `+ ${money(l.credit)}`} · {l.narration.slice(0, 80)}
                        <br />
                        <span className={css.sub}>→ {describe(s)} · {s.source === 'rule' ? s.label : capT('learned', { token: s.label, n: s.count ?? 1 })}</span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            {writable && (
              <div className={css.bar}>
                <button type="button" className={controls.btnPrimary} disabled={!picked.length} onClick={apply}>{capT('applySelected', { n: picked.length })}</button>
              </div>
            )}
          </>
        )}
      </div>
      <RuleEditorModal
        rule={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          notify(capT('ruleSaved'));
          onPromptDone();
          setTick((t) => t + 1);
        }}
      />
    </section>
  );
}

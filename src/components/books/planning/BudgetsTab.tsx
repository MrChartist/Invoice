/**
 * Books → Budgets (roadmap 6.17): budgets per Indian FY, per income / expense account, monthly
 * (annual spread evenly, or month by month), optionally per cost centre; month / quarter / YTD /
 * full-year budget vs actual with variance ₹ and %, favourable / adverse colouring, CSV and Excel
 * export, and "copy last year's actuals" (+x%) as next year's budget.
 */
import { Fragment, useMemo, useState } from 'react';
import { Copy, Pencil, Plus, Target, Trash2 } from 'lucide-react';
import {
  GROUPS,
  MONTH_LABELS,
  budgetReportCsv,
  budgetReportRows,
  budgetVsActual,
  budgetableAccounts,
  budgetsFromActuals,
  deleteBudget,
  fyLabelOf,
  loadBudgets,
  monthlyActuals,
  rangeFor,
  rangeLabel,
  rupeesToPaise,
  saveBudget,
  saveBudgets,
  spreadEvenly,
  sumMonths,
  type Account,
  type Budget,
  type BudgetReport,
  type Ledger,
  type RangeMode,
  type Variance,
} from '../../../lib/ledger';
import { costCentreLabel, loadCostCentres, type CostCentre } from '../../../lib/cost-centres';
import { fyStartYearOf } from '../../../lib/books';
import { todayIso } from '../../../lib/tax-rules';
import { EmptyState } from '../../ui/EmptyState';
import { Modal } from '../../ui/Modal';
import { CostCentreSelect } from '../../cost-centres/CostCentreSelect';
import { money } from '../ledger/format';
import { PrintTitle, StatementToolbar } from '../ledger/shared';
import surface from '../../../styles/surface.module.css';
import controls from '../../../styles/controls.module.css';
import books from '../books.module.css';
import styles from './planning.module.css';
import { useT } from '../../../i18n';
import { planT } from '../../../i18n/areas/books-planning';
import { plural } from '../../../i18n/areas/plural';
import { SelectField } from '../../ui/SelectField';

interface Props {
  ledger: Ledger;
  notify: (msg: string, tone?: 'success' | 'error') => void;
}

const MODES = [
  { id: 'month', label: 'modeMonth' },
  { id: 'quarter', label: 'modeQuarter' },
  { id: 'ytd', label: 'modeYtd' },
  { id: 'year', label: 'modeYear' },
] as const satisfies ReadonlyArray<{ id: RangeMode; label: string }>;

const signed = (paise: number) => (paise < 0 ? `−${money(-paise)}` : paise > 0 ? `+${money(paise)}` : money(0));
const tone = (v: Variance) => (v.variance === 0 ? '' : v.favourable ? styles.fav : styles.adv);
const toneWord = (v: Variance) => planT(v.variance === 0 ? 'onBudget' : v.favourable ? 'favourable' : 'adverse');
const pct = (v: Variance) => (v.percent === null ? '-' : `${v.percent > 0 ? '+' : ''}${v.percent}%`);

export function BudgetsTab({ ledger, notify }: Props) {
  useT();
  const today = todayIso();
  const currentFy = fyStartYearOf(today);
  const [version, setVersion] = useState(0);
  const budgets = useMemo(() => {
    void version;
    return loadBudgets();
  }, [version]);
  const centres = useMemo(() => loadCostCentres(), []);
  const [fy, setFy] = useState(currentFy);
  const [mode, setMode] = useState<RangeMode>('ytd');
  const monthNow = (() => {
    const m = Number(today.slice(5, 7));
    return m >= 4 ? m - 4 : m + 8;
  })();
  const [month, setMonth] = useState(fy === currentFy ? monthNow : 11);
  const [scope, setScope] = useState<string | undefined>(undefined);
  const [editing, setEditing] = useState<Budget | 'new' | null>(null);
  const [copying, setCopying] = useState(false);

  const fyOptions = useMemo(() => {
    const set = new Set<number>([currentFy - 2, currentFy - 1, currentFy, currentFy + 1, ...budgets.map((b) => b.fy_start_year)]);
    return [...set].sort((a, b) => b - a);
  }, [budgets, currentFy]);

  const actuals = useMemo(() => monthlyActuals(ledger, fy), [ledger, fy]);
  const range = rangeFor(mode, month);
  const report = useMemo(() => budgetVsActual(ledger, budgets, fy, range, scope ?? '', actuals), [ledger, budgets, fy, range.from, range.to, scope, actuals]); // eslint-disable-line react-hooks/exhaustive-deps
  const scopeName = scope ? costCentreLabel(centres.find((c) => c.id === scope), centres) : '';
  const fileBase = `budget-vs-actual-${fyLabelOf(fy)}-${mode}${mode === 'year' ? '' : `-${MONTH_LABELS[month]}`}${scope ? '-cc' : ''}`;

  const exportXlsx = async () => {
    const { downloadXlsx } = await import('../../../lib/xlsx');
    await downloadXlsx(`${fileBase}.xlsx`, [{ name: 'Budget vs actual', rows: budgetReportRows(report, scopeName).slice(2) }]);
  };

  const remove = (b: Budget) => {
    deleteBudget(b.id);
    setVersion((v) => v + 1);
    notify(planT('budgetDeleted'));
  };

  return (
    <div className={books.stack}>
      <section className={`${surface.card} no-print`}>
        <div className={surface.cardBody}>
          <div className={styles.controls}>
            <div className={controls.field}>
              <label className={controls.label} htmlFor="bud-fy">{planT('financialYear')}</label>
              <SelectField id="bud-fy" className={controls.select} value={fy} onChange={(e) => setFy(Number(e.target.value))}>
                {fyOptions.map((y) => <option key={y} value={y}>{planT('fyOption', { fy: fyLabelOf(y), from: y, to: y + 1 })}</option>)}
              </SelectField>
            </div>
            <div className={controls.field}>
              <span className={controls.label} id="bud-view">{planT('view')}</span>
              <div className={controls.segment} role="group" aria-labelledby="bud-view">
                {MODES.map((m) => (
                  <button key={m.id} type="button" aria-pressed={mode === m.id} className={mode === m.id ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setMode(m.id)}>
                    {planT(m.label)}
                  </button>
                ))}
              </div>
            </div>
            {mode !== 'year' && (
              <div className={controls.field}>
                <label className={controls.label} htmlFor="bud-month">{mode === 'ytd' ? planT('upTo') : mode === 'quarter' ? planT('quarterOf') : planT('modeMonth')}</label>
                <SelectField id="bud-month" className={controls.select} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
                  {MONTH_LABELS.map((m, i) => <option key={m} value={i}>{m} {i <= 8 ? fy : fy + 1}</option>)}
                </SelectField>
              </div>
            )}
            {centres.length > 0 && (
              <CostCentreSelect id="bud-scope" label={planT('budgetsFor')} centres={centres} value={scope} onChange={setScope} emptyLabel={planT('wholeBusiness')} />
            )}
          </div>
          <div className={styles.actionsBar}>
            <button type="button" className={controls.btnPrimary} onClick={() => setEditing('new')}><Plus size={16} /> {planT('addBudgetLine')}</button>
            <button type="button" className={controls.btnOutline} onClick={() => setCopying(true)}><Copy size={16} /> {planT('copyActuals', { fy: fyLabelOf(fy - 1) })}</button>
          </div>
        </div>
      </section>

      <StatementToolbar csv={() => budgetReportCsv(report, scopeName)} xlsx={() => void exportXlsx()} filename={`${fileBase}.csv`}>
        <span className={books.muted}>{rangeLabel(fy, range)}{scopeName ? ` · ${scopeName}` : ''}</span>
      </StatementToolbar>
      <PrintTitle title={planT('budgetVsActual')} sub={`${rangeLabel(fy, range)}${scopeName ? ` · ${scopeName}` : ''}`} />

      <section className={surface.card} aria-label={planT('budgetVsActual')}>
        {report.rows.length === 0 ? (
          <EmptyState
            icon={Target}
            title={planT('noBudgetTitle', { fy: `${fyLabelOf(fy)}${scopeName ? ` · ${scopeName}` : ''}` })}
            text={planT('noBudgetText')}
          />
        ) : (
          <div className={surface.tableWrap}>
            <table className={surface.table} data-testid="budget-report">
              <caption className={surface.srOnly}>{planT('budgetCaption', { range: rangeLabel(fy, range) })}</caption>
              <thead>
                <tr>
                  <th scope="col">{planT('colAccount')}</th>
                  <th scope="col" className={surface.numeric}>{planT('colBudget')}</th>
                  <th scope="col" className={surface.numeric}>{planT('colActual')}</th>
                  <th scope="col" className={surface.numeric}>{planT('colVarianceRs')}</th>
                  <th scope="col" className={surface.numeric}>{planT('colVariancePct')}</th>
                  <th scope="col" className="no-print"><span className={surface.srOnly}>{planT('actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {([true, false] as const).map((income) => {
                  const rows = report.rows.filter((r) => r.isIncome === income);
                  if (!rows.length) return null;
                  const t = income ? report.income : report.expense;
                  return (
                    <Fragment key={String(income)}>
                      <tr><th scope="rowgroup" colSpan={6}>{income ? planT('income') : planT('expenses')}</th></tr>
                      {rows.map((r) => (
                        <tr key={r.budgetRow.id}>
                          <td>{r.account.code} · {r.account.name}</td>
                          <td className={surface.numeric}>{money(r.budget)}</td>
                          <td className={surface.numeric}>{money(r.actual)}</td>
                          <td className={`${surface.numeric} ${tone(r)}`} title={toneWord(r)}>{signed(r.variance)}<span className={surface.srOnly}> ({toneWord(r)})</span></td>
                          <td className={`${surface.numeric} ${tone(r)}`}>{pct(r)}</td>
                          <td className="no-print">
                            <div className={surface.rowActions}>
                              <button type="button" className={controls.btnIcon} onClick={() => setEditing(r.budgetRow)} aria-label={planT('editBudgetFor', { name: r.account.name })}><Pencil size={16} /></button>
                              <button type="button" className={controls.btnDanger} onClick={() => remove(r.budgetRow)} aria-label={planT('deleteBudgetFor', { name: r.account.name })}><Trash2 size={16} /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      <TotalRow label={income ? planT('totalIncome') : planT('totalExpenses')} t={t} />
                    </Fragment>
                  );
                })}
                <TotalRow label={planT('netIncomeExpenses')} t={report.net} />
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className={books.muted}>
        {planT('budgetNote')}
      </p>

      {editing && (
        <BudgetEditor
          budget={editing === 'new' ? null : editing}
          fy={fy}
          scope={scope}
          accounts={budgetableAccounts(ledger.accounts)}
          allAccounts={ledger.accounts}
          centres={centres}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            setVersion((v) => v + 1);
            notify(planT('budgetSaved'));
          }}
        />
      )}
      {copying && (
        <CopyActualsModal
          ledger={ledger}
          fy={fy}
          hasCentres={centres.length > 0}
          existing={budgets.filter((b) => b.fy_start_year === fy).length}
          onClose={() => setCopying(false)}
          onDone={(msg) => {
            setCopying(false);
            setVersion((v) => v + 1);
            notify(msg);
          }}
        />
      )}
    </div>
  );
}

function TotalRow({ label, t }: { label: string; t: BudgetReport['income'] }) {
  return (
    <tr className={books.totalRow}>
      <td>{label}</td>
      <td className={surface.numeric}>{money(t.budget)}</td>
      <td className={surface.numeric}>{money(t.actual)}</td>
      <td className={`${surface.numeric} ${tone(t)}`}>{signed(t.variance)}<span className={surface.srOnly}> ({toneWord(t)})</span></td>
      <td className={`${surface.numeric} ${tone(t)}`}>{pct(t)}</td>
      <td className="no-print" />
    </tr>
  );
}

function BudgetEditor({ budget, fy, scope, accounts, allAccounts, centres, onClose, onSaved }: {
  budget: Budget | null;
  fy: number;
  scope: string | undefined;
  accounts: Account[];
  allAccounts: Account[];
  centres: CostCentre[];
  onClose: () => void;
  onSaved: () => void;
}) {
  useT();
  const [accountId, setAccountId] = useState(budget?.account_id ?? '');
  const [cc, setCc] = useState<string | undefined>(budget ? budget.cost_centre_id : scope);
  const evenStart = !budget || spreadEvenly(sumMonths(budget.months)).every((m, i) => m === budget.months[i]);
  const [monthly, setMonthly] = useState(!evenStart);
  const [annual, setAnnual] = useState(budget ? (sumMonths(budget.months) / 100).toFixed(2) : '');
  const [months, setMonths] = useState<string[]>(() => (budget ? budget.months.map((m) => (m / 100).toFixed(2)) : Array<string>(12).fill('')));
  const [error, setError] = useState('');

  const resolved = monthly ? months.map((m) => rupeesToPaise(m)) : spreadEvenly(rupeesToPaise(annual));

  const save = () => {
    try {
      saveBudget({ id: budget?.id, fy_start_year: budget?.fy_start_year ?? fy, account_id: accountId, ...(cc ? { cost_centre_id: cc } : {}), months: resolved }, allAccounts);
      onSaved();
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={budget ? planT('editBudgetLine') : planT('newBudgetLine')}
      subtitle={planT('aprToMar', { fy: fyLabelOf(budget?.fy_start_year ?? fy) })}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>{planT('cancel')}</button>
          <button type="button" className={controls.btnPrimary} onClick={save}>{planT('saveBudget')}</button>
        </>
      }
    >
      <form className={styles.formStack} onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div className={controls.row}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="bud-acct">{planT('colAccount')}</label>
            <SelectField id="bud-acct" className={controls.select} value={accountId} onChange={(e) => setAccountId(e.target.value)} autoFocus>
              <option value="">{planT('chooseAccount')}</option>
              {GROUPS.map((g) => {
                const list = accounts.filter((a) => a.group === g.id);
                return list.length ? (
                  <optgroup key={g.id} label={g.label}>
                    {list.map((a) => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}
                  </optgroup>
                ) : null;
              })}
            </SelectField>
          </div>
          <CostCentreSelect id="bud-cc" label={planT('ccOptional')} centres={centres} value={cc} onChange={setCc} emptyLabel={planT('wholeBusiness')} />
        </div>
        <div className={controls.segment} role="group" aria-label={planT('howToEnter')}>
          <button type="button" aria-pressed={!monthly} className={!monthly ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setMonthly(false)}>{planT('annualEven')}</button>
          <button
            type="button"
            aria-pressed={monthly}
            className={monthly ? controls.segmentBtnActive : controls.segmentBtn}
            onClick={() => {
              if (!monthly) setMonths(resolved.map((m) => (m / 100).toFixed(2)));
              setMonthly(true);
            }}
          >
            {planT('monthByMonth')}
          </button>
        </div>
        {!monthly ? (
          <div className={controls.field}>
            <label className={controls.label} htmlFor="bud-annual">{planT('annualBudget')}</label>
            <input id="bud-annual" className={`${controls.input} ${books.numInput}`} inputMode="decimal" value={annual} onChange={(e) => setAnnual(e.target.value)} placeholder="0.00" />
            <span className={controls.hint}>{planT(resolved[0] !== resolved[11] ? 'spreadAsOdd' : 'spreadAs', { amount: money(resolved[0]) })}</span>
          </div>
        ) : (
          <div className={styles.months}>
            {MONTH_LABELS.map((m, i) => (
              <div key={m} className={controls.field}>
                <label className={controls.label} htmlFor={`bud-m${i}`}>{m}</label>
                <input
                  id={`bud-m${i}`}
                  className={`${controls.input} ${books.numInput}`}
                  inputMode="decimal"
                  value={months[i]}
                  placeholder="0.00"
                  onChange={(e) => setMonths((list) => list.map((x, k) => (k === i ? e.target.value : x)))}
                />
              </div>
            ))}
          </div>
        )}
        <p className={books.muted}>{planT('totalForYear')} <strong>{money(sumMonths(resolved))}</strong></p>
        {error && <div className={controls.error} role="alert">{error}</div>}
      </form>
    </Modal>
  );
}

function CopyActualsModal({ ledger, fy, hasCentres, existing, onClose, onDone }: {
  ledger: Ledger;
  fy: number;
  hasCentres: boolean;
  existing: number;
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  useT();
  const [uplift, setUplift] = useState('0');
  const [byCc, setByCc] = useState(false);
  const [replace, setReplace] = useState(false);
  const rows = useMemo(() => budgetsFromActuals(ledger, fy - 1, Number(uplift) || 0, { byCostCentre: byCc, targetFy: fy }), [ledger, fy, uplift, byCc]);

  const run = () => {
    const r = saveBudgets(rows, { replace });
    onDone(`${plural(planT, 'copiedLinesOne', 'copiedLinesMany', r.added)}${r.replaced ? planT('copiedReplaced', { n: r.replaced }) : ''}${r.skipped ? planT('copiedKept', { n: r.skipped }) : ''}`);
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="md"
      title={planT('copyTitle', { from: fyLabelOf(fy - 1), to: fyLabelOf(fy) })}
      subtitle={planT('copySubtitle')}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>{planT('cancel')}</button>
          <button type="button" className={controls.btnPrimary} onClick={run} disabled={!rows.length}>{plural(planT, 'copyLinesOne', 'copyLinesMany', rows.length)}</button>
        </>
      }
    >
      <div className={styles.formStack}>
        <div className={controls.field}>
          <label className={controls.label} htmlFor="bud-uplift">{planT('adjustBy')}</label>
          <input id="bud-uplift" className={`${controls.input} ${books.numInput}`} inputMode="decimal" value={uplift} onChange={(e) => setUplift(e.target.value)} />
          <span className={controls.hint}>{planT('adjustHint')}</span>
        </div>
        {hasCentres && (
          <label className={controls.check}>
            <input type="checkbox" checked={byCc} onChange={(e) => setByCc(e.target.checked)} />
            {planT('perCc')}
          </label>
        )}
        {existing > 0 && (
          <label className={controls.check}>
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
            {planT('replaceExisting', { fy: fyLabelOf(fy) })}
          </label>
        )}
        {!rows.length && <p className={books.muted}>{planT(byCc ? 'noActualsCc' : 'noActuals', { fy: fyLabelOf(fy - 1) })}</p>}
      </div>
    </Modal>
  );
}

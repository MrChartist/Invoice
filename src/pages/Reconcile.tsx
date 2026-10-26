import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BookOpen, CheckCheck, Landmark, ListChecks, Scale, Upload } from 'lucide-react';
import {
  applySuggestions,
  bankDb,
  buildBrs,
  closingAcross,
  confirmableAll,
  ignoreLine,
  lineState,
  matchLine,
  noteLine,
  payoutCandidates,
  receiptCandidates,
  removeStatement,
  suggestMatches,
  summarizeRecon,
  takenIds,
  unmatchLine,
  BULK_CONFIRM_THRESHOLD,
  type BankLine,
  type BankStatement,
  type Candidate,
  type Suggestion,
} from '../lib/bank-recon';
import { accountBalanceAt, bankAccountBalanceAt, buildVouchers, loadBooksData, type BooksData } from '../lib/books';
import { StorageWriteError } from '../lib/storage';
import { DEFAULT_BANK_ID, accountIdOf, bankAccountsDb, pickableBankAccounts, type BankAccount } from '../lib/bank-accounts';
import { BankAccountsCard } from '../components/bank/BankAccountsCard';
import { formatDate, formatMoney } from '../lib/utils';
import { PageHeader } from '../components/ui/PageHeader';
import { StatCard } from '../components/ui/StatCard';
import { EmptyState } from '../components/ui/EmptyState';
import { LearnMore } from '../components/discover';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/useToast';
import { ImportPanel } from '../components/bank/ImportPanel';
import { LineList, type LineItem } from '../components/bank/LineList';
import { MatchPicker } from '../components/bank/MatchPicker';
import { CreateReceiptModal } from '../components/bank/CreateReceiptModal';
import { CreateExpenseModal } from '../components/bank/CreateExpenseModal';
import { BrsView } from '../components/bank/BrsView';
import { StatementsPanel } from '../components/bank/StatementsPanel';
import { useT } from '../i18n';
import { bankT } from '../i18n/areas/bank';
import controls from '../styles/controls.module.css';
import surface from '../styles/surface.module.css';
import bank from '../components/bank/reconcile.module.css';
import styles from './Reconcile.module.css';
import { bnkT } from '../i18n/areas/banking';
import type { BankDoc } from '../components/bank/docs/BankingDocs';
import type { RulePrompt } from '../components/bank/rules/RuleSuggestions';
import { capT } from '../i18n/areas/capture';
import { paymentsDb, purchasesDb } from '../lib/purchases';
import { RECONCILE_TABS, type ReconcileTab } from './page-tabs'; // R6-B1
import { discoverT } from '../i18n/areas/discover-r6';

// WP-5: deposit slip, payment advice, e-payments, cash tally — loaded only when the tab opens.
const BankingDocs = lazy(() => import('../components/bank/docs/BankingDocs'));
const BANK_DOCS: readonly BankDoc[] = ['deposit', 'advice', 'epay', 'cash', 'forex'];
// 8.45: bank rules + memory — the rule list and the suggestions strip load on demand.
const BankRulesPanel = lazy(() => import('../components/bank/rules/BankRulesPanel'));
const RuleSuggestions = lazy(() => import('../components/bank/rules/RuleSuggestions'));

const TABS = RECONCILE_TABS; // R6-B1: list in reconcile-tabs.ts
type TabId = ReconcileTab;

type Filter = 'review' | 'matched' | 'ignored' | 'all';
const FILTERS: { id: Filter; label: 'fReview' | 'fMatched' | 'fIgnored' | 'fAll' }[] = [
  { id: 'review', label: 'fReview' },
  { id: 'matched', label: 'fMatched' },
  { id: 'ignored', label: 'fIgnored' },
  { id: 'all', label: 'fAll' },
];

const rupees = (n: number) => `₹${formatMoney(n)}`;

export function Reconcile() {
  useT(); // re-render on a language switch (5.4)
  const [params, setParams] = useSearchParams();
  const [statements, setStatements] = useState<BankStatement[]>(() => bankDb.all());
  const [books, setBooks] = useState<BooksData>(() => loadBooksData());
  const [scope, setScope] = useState('all');
  const [accounts, setAccounts] = useState<BankAccount[]>(() => bankAccountsDb.all());
  const [accountId, setAccountId] = useState(DEFAULT_BANK_ID);
  const multi = pickableBankAccounts('brs', accounts.filter((a) => a.active !== false)).length > 1; // R5-A2: clearing accounts never take a statement
  const account = accounts.find((a) => a.id === accountId) ?? accounts[0];
  const [filter, setFilter] = useState<Filter>('review');
  const [query, setQuery] = useState('');
  const [pickerLine, setPickerLine] = useState<BankLine | null>(null);
  const [receiptLine, setReceiptLine] = useState<BankLine | null>(null);
  const [expenseLine, setExpenseLine] = useState<BankLine | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [rulePrompt, setRulePrompt] = useState<RulePrompt | null>(null);
  const { notify, toastNode } = useToast();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const requested = params.get('tab');
  const tab: TabId = TABS.some((t) => t.id === requested) ? (requested as TabId) : statements.length === 0 ? 'import' : 'reconcile';

  const refreshBooks = useCallback(() => setBooks(loadBooksData()), []);
  useEffect(() => {
    // Other pages may have recorded a receipt / payment since this one was last shown.
    const onFocus = () => setBooks(loadBooksData());
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  const selectTab = (id: TabId) => {
    const next = new URLSearchParams(params);
    next.set('tab', id);
    setParams(next, { replace: true });
  };
  const onTabKey = (e: React.KeyboardEvent, index: number) => {
    const target: Record<string, number> = {
      ArrowRight: (index + 1) % TABS.length,
      ArrowLeft: (index - 1 + TABS.length) % TABS.length,
      Home: 0,
      End: TABS.length - 1,
    };
    const n = target[e.key];
    if (n === undefined) return;
    e.preventDefault();
    selectTab(TABS[n].id);
    tabRefs.current[TABS[n].id]?.focus();
  };

  const persist = useCallback(
    (next: BankStatement[]) => {
      try {
        bankDb.saveAll(next);
        setStatements(next);
      } catch (err) {
        notify(err instanceof StorageWriteError ? err.message : bankT('saveFailed'), 'error');
      }
    },
    [notify],
  );

  /* ── derived data ─────────────────────────────────────────── */
  // Multi-account BRS: everything below works on the selected bank account's statements and entries.
  const acctStatements = useMemo(() => (multi ? statements.filter((s) => accountIdOf(s) === accountId) : statements), [statements, multi, accountId]);
  const scoped = useMemo(() => (scope === 'all' ? acctStatements : acctStatements.filter((s) => s.id === scope)), [acctStatements, scope]);
  const index = useMemo(
    () => ({
      payments: new Set(books.transactions.map((t) => t.id)),
      purchasePayments: new Set(books.purchasePayments.map((p) => String(p.id ?? ''))),
    }),
    [books],
  );
  const inAccount = useCallback((c: Candidate) => !multi || accountIdOf(c) === accountId, [multi, accountId]);
  const receipts = useMemo(() => receiptCandidates(books.invoices, books.transactions).filter(inAccount), [books, inAccount]);
  const payouts = useMemo(() => payoutCandidates(books.purchases, books.vendors, books.purchasePayments).filter(inAccount), [books, inAccount]);
  const entries = useMemo(() => new Map<string, Candidate>([...receipts, ...payouts].map((c) => [c.id, c])), [receipts, payouts]);

  const allLines = useMemo(
    () => scoped.flatMap((s) => s.lines.map((line) => ({ line, bank: s.bank_label }))).sort((a, b) => a.line.date.localeCompare(b.line.date)),
    [scoped],
  );
  const lines = useMemo(() => allLines.map((x) => x.line), [allLines]);
  const summary = useMemo(() => summarizeRecon(lines, index), [lines, index]);

  const suggestionList = useMemo(() => {
    // A line whose entry vanished is open again; hide its stale match from the engine.
    const open = lines.map((l) => (lineState(l, index) === 'orphan' ? { ...l, matched_to: undefined } : l));
    return suggestMatches(open, [...receipts, ...payouts], { taken: takenIds(statements) });
  }, [lines, receipts, payouts, statements, index]);
  const suggestions = useMemo(() => {
    const m = new Map<string, Suggestion[]>();
    for (const s of suggestionList) m.set(s.lineId, [...(m.get(s.lineId) ?? []), s]);
    return m;
  }, [suggestionList]);
  const confirmable = useMemo(() => confirmableAll(suggestionList), [suggestionList]);
  // Rules / memory run after invoice matching: open lines only, minus those with a Match suggestion.
  const openLines = useMemo(() => lines.filter((l) => { const st = lineState(l, index); return st === 'unmatched' || st === 'orphan'; }).map((l) => (l.matched_to ? { ...l, matched_to: undefined } : l)), [lines, index]);
  const matchedIds = useMemo(() => new Set(suggestions.keys()), [suggestions]);

  const closing = useMemo(() => closingAcross(scoped), [scoped]);
  const vouchers = useMemo(() => buildVouchers(books), [books]);
  const asOf = closing.asOf;
  const acctBalance = useMemo(
    () => (multi && account && asOf ? bankAccountBalanceAt(vouchers, books.openings, account, asOf) : null),
    [multi, account, vouchers, books.openings, asOf],
  );
  const booksBalance = useMemo(
    () => (acctBalance ? acctBalance.balance : asOf ? accountBalanceAt(vouchers, books.openings, 'bank', asOf) : 0),
    [acctBalance, vouchers, books.openings, asOf],
  );
  const openingMissing = acctBalance ? acctBalance.openingMissing : !books.openings.some((o) => o.account === 'bank');
  const fromDate = useMemo(() => lines.reduce((m, l) => (!m || l.date < m ? l.date : m), ''), [lines]);

  const brs = useMemo(
    () =>
      buildBrs({
        asOf,
        fromDate,
        booksBalance,
        lines,
        receipts,
        payouts,
        statementBalance: closing.balance,
        index,
      }),
    [asOf, fromDate, booksBalance, lines, receipts, payouts, closing.balance, index],
  );

  const items: LineItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    return allLines
      .map((x) => ({ line: x.line, bank: x.bank, state: lineState(x.line, index) }))
      .filter((x) => {
        if (filter === 'review' && x.state !== 'unmatched' && x.state !== 'orphan') return false;
        if (filter === 'matched' && x.state !== 'matched' && x.state !== 'manual') return false;
        if (filter === 'ignored' && x.state !== 'ignored') return false;
        if (!q) return true;
        const hay = `${x.line.narration} ${x.line.ref} ${x.line.date} ${x.line.debit || x.line.credit} ${x.line.note ?? ''}`.toLowerCase();
        return hay.includes(q);
      });
  }, [allLines, filter, query, index]);

  const counts: Record<Filter, number> = {
    review: summary.unreconciled,
    matched: summary.matched + summary.manual,
    ignored: summary.ignored,
    all: summary.total,
  };

  /* ── handlers ─────────────────────────────────────────────── */
  const matchTo = (line: BankLine, type: 'payment' | 'purchase_payment', ids: string[]) =>
    persist(matchLine(statements, line.id, { type, id: ids[0], ...(ids.length > 1 ? { ids } : {}) }));

  const importStatement = (st: BankStatement, info: { duplicates: number }) => {
    persist([...statements, multi && accountId !== DEFAULT_BANK_ID ? { ...st, bank_account_id: accountId } : st]);
    setScope('all');
    selectTab('reconcile');
    notify(info.duplicates ? bankT('importedDup', { n: st.lines.length, dup: info.duplicates }) : bankT('imported', { n: st.lines.length }));
  };

  const confirmAll = () => {
    persist(applySuggestions(statements, confirmable));
    setBulkOpen(false);
    notify(bankT(confirmable.length === 1 ? 'confirmedOne' : 'confirmedMany', { n: confirmable.length }));
  };

  const header = (
    <PageHeader
      title={bankT('title')}
      subtitle={bankT('subtitle')}
      actions={
        statements.length > 0 && (
          <button type="button" className={controls.btnPrimary} onClick={() => selectTab('import')}>
            <Upload size={16} /> {bankT('importStatement')}
          </button>
        )
      }
    />
  );

  const accountPicker = multi && (
    <div className={controls.field} style={{ maxWidth: 360, marginBottom: '1rem' }}>
      <label className={controls.label} htmlFor="rec-account">{bankT('bankAccount')}</label>
      <select id="rec-account" className={controls.select} value={accountId} onChange={(e) => { setAccountId(e.target.value); setScope('all'); }}>
        {pickableBankAccounts('brs', accounts.filter((a) => a.active !== false || a.id === accountId)).map((a) => (
          <option key={a.id} value={a.id}>{a.name}{a.number ? ` (${a.number})` : ''}</option>
        ))}
      </select>
    </div>
  );
  const accountsCard = (
    <BankAccountsCard
      accounts={accounts}
      statements={statements}
      payments={[...books.transactions, ...books.purchasePayments]}
      onChange={(next) => {
        setAccounts(next);
        if (!next.some((a) => a.id === accountId && a.active !== false)) setAccountId(DEFAULT_BANK_ID);
      }}
      notify={notify}
    />
  );

  if (statements.length === 0 && tab !== 'documents' && tab !== 'rules') {
    return (
      <div className={surface.page}>
        {header}
        {/* R6-B3: nothing imported yet — what the screen needs, and the two first steps. */}
        <EmptyState
          icon={Landmark}
          title={discoverT('reconTitle')}
          text={discoverT('reconText')}
          action={
            <div className={surface.pageActions} style={{ justifyContent: 'center' }} data-recon-empty>
              <button type="button" className={controls.btnPrimary} onClick={() => document.querySelector<HTMLElement>('[data-recon-import] input, [data-recon-import] button')?.focus()}>
                {bankT('importStatement')}
              </button>
              <button type="button" className={controls.btnOutline} onClick={() => document.querySelector<HTMLElement>('[data-recon-accounts] button')?.focus()}>
                {discoverT('reconAccount')}
              </button>
              <LearnMore topic="reconcile" />
            </div>
          }
        />
        <div data-recon-accounts>{accountsCard}</div>
        {accountPicker}
        <div data-recon-import>
          <ImportPanel existing={statements} onImport={importStatement} />
        </div>
        {toastNode}
      </div>
    );
  }

  const diff = closing.balance === null ? null : Math.round((closing.balance - booksBalance) * 100) / 100;

  return (
    <div className={surface.page}>
      {header}

      <div className={surface.statGrid}>
        <StatCard
          label={bankT('statBalStatement')}
          icon={Landmark}
          value={closing.balance === null ? '—' : rupees(closing.balance)}
          hint={closing.balance === null ? bankT('enterUnderStatements') : bankT('asOn', { date: formatDate(closing.asOf) })}
        />
        <StatCard
          label={bankT('statBalBooks')}
          icon={BookOpen}
          value={rupees(booksBalance)}
          hint={multi && account ? (openingMissing ? bankT('noOpeningFor', { name: account.name }) : account.name) : openingMissing ? bankT('noBankOpening') : bankT('bankInBooks')}
        />
        <StatCard
          label={bankT('statDiff')}
          icon={Scale}
          tone={diff === null ? 'default' : Math.abs(diff) <= 0.01 ? 'profit' : 'warning'}
          value={diff === null ? '—' : rupees(diff)}
          hint={bankT('diffHint')}
        />
        <StatCard
          label={bankT('statUnrec')}
          icon={ListChecks}
          tone={summary.unreconciled ? 'warning' : 'profit'}
          value={bankT(summary.unreconciled === 1 ? 'linesOne' : 'linesMany', { n: summary.unreconciled })}
          hint={summary.unreconciled ? bankT('unrecHint', { inAmt: rupees(summary.unreconciledCredits), outAmt: rupees(summary.unreconciledDebits) }) : bankT('pctReconciled', { n: summary.pctReconciled })}
        />
      </div>

      <div className={styles.tabs} role="tablist" aria-label={bankT('views')}>
        {TABS.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              tabRefs.current[t.id] = el;
            }}
            id={`rec-tab-${t.id}`}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            aria-controls={`rec-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            className={tab === t.id ? styles.tabActive : styles.tab}
            onClick={() => selectTab(t.id)}
            onKeyDown={(e) => onTabKey(e, i)}
          >
            {t.id === 'documents' ? bnkT('tabDocuments') : t.id === 'rules' ? capT('tabRules') : bankT(t.label as Exclude<typeof t.label, 'tabDocuments' | 'tabRules'>)}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`rec-panel-${tab}`} aria-labelledby={`rec-tab-${tab}`} tabIndex={0} className={styles.panel}>
        {tab !== 'documents' && accountPicker}
        {tab !== 'import' && tab !== 'statements' && acctStatements.length > 1 && (
          <div className={controls.field} style={{ maxWidth: 360, marginBottom: '1rem' }}>
            <label className={controls.label} htmlFor="rec-scope">{bankT('statement')}</label>
            <select id="rec-scope" className={controls.select} value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="all">{bankT('allStatements', { n: acctStatements.length })}</option>
              {acctStatements.map((s) => (
                <option key={s.id} value={s.id}>{s.bank_label} — {s.file_name}</option>
              ))}
            </select>
          </div>
        )}

        {tab === 'reconcile' && (
          <div className={bank.stack}>
            <div className={bank.toolbar}>
              <div className={bank.toolbarGroup} role="group" aria-label={bankT('showLines')}>
                {FILTERS.map((f) => (
                  <button key={f.id} type="button" aria-pressed={filter === f.id} className={filter === f.id ? bank.chipActive : bank.chip} onClick={() => setFilter(f.id)}>
                    {bankT(f.label)} <span className={bank.count}>{counts[f.id]}</span>
                  </button>
                ))}
              </div>
              <div className={bank.toolbarGroup}>
                <input
                  type="search"
                  className={`${controls.input} ${bank.search}`}
                  placeholder={bankT('searchPh')}
                  aria-label={bankT('searchAria')}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button type="button" className={controls.btnOutline} disabled={confirmable.length === 0} onClick={() => setBulkOpen(true)}>
                  <CheckCheck size={16} /> {bankT('confirmAll', { pct: BULK_CONFIRM_THRESHOLD, n: confirmable.length })}
                </button>
              </div>
            </div>
            {openLines.length > 0 && (
              <Suspense fallback={null}>
                <RuleSuggestions
                  statements={statements}
                  lines={openLines}
                  matched={matchedIds}
                  purchases={books.purchases}
                  purchasePayments={books.purchasePayments}
                  prompt={rulePrompt}
                  onPromptDone={() => setRulePrompt(null)}
                  onApplied={(next, message) => {
                    setStatements(next);
                    refreshBooks();
                    notify(message);
                  }}
                  notify={notify}
                  onManage={() => selectTab('rules')}
                />
              </Suspense>
            )}
            <div className={surface.card}>
              {items.length === 0 ? (
                <EmptyState
                  icon={CheckCheck}
                  title={filter === 'review' ? bankT('nothingToReview') : bankT('noLines')}
                  text={filter === 'review' ? bankT('nothingToReviewText') : bankT('noLinesText')}
                />
              ) : (
                <LineList
                  items={items}
                  entries={entries}
                  suggestions={suggestions}
                  showBank={acctStatements.length > 1 && scope === 'all'}
                  onConfirm={(s) => persist(applySuggestions(statements, [s]))}
                  onUnmatch={(id) => persist(unmatchLine(statements, id))}
                  onIgnore={(id, v) => persist(ignoreLine(statements, id, v))}
                  onMatchManually={setPickerLine}
                  onMarkReconciled={(id) => persist(matchLine(statements, id, { type: 'manual' }))}
                  onCreateReceipt={setReceiptLine}
                  onCreateExpense={setExpenseLine}
                  onNote={(id, note) => persist(noteLine(statements, id, note))}
                />
              )}
            </div>
          </div>
        )}

        {tab === 'brs' && (
          <BrsView brs={brs} bankLabel={multi && account ? account.name : scope === 'all' ? acctStatements.map((s) => s.bank_label).filter((v, i, a) => a.indexOf(v) === i).join(' + ') : (scoped[0]?.bank_label ?? '')} openingMissing={openingMissing} />
        )}

        {tab === 'statements' && accountsCard}
        {tab === 'statements' && (
          <StatementsPanel
            statements={acctStatements}
            index={index}
            onClosingBalance={(id, v) => persist(statements.map((s) => (s.id === id ? { ...s, closing_balance: v } : s)))}
            onRemove={(id) => {
              persist(removeStatement(statements, id));
              setScope('all');
              notify(bankT('statementDeleted'));
            }}
          />
        )}

        {tab === 'import' && <ImportPanel existing={statements} onImport={importStatement} onCancel={() => selectTab('reconcile')} />}
        {tab === 'import' && multi && account && <p className={surface.sectionNote}>{bankT('importsInto', { name: account.name })}</p>}
        {tab === 'rules' && (
          <Suspense fallback={null}>
            <BankRulesPanel notify={notify} />
          </Suspense>
        )}
        {tab === 'documents' && (
          <Suspense fallback={null}>
            <BankingDocs
              doc={BANK_DOCS.includes(params.get('doc') as BankDoc) ? (params.get('doc') as BankDoc) : 'deposit'}
              onDoc={(d) => {
                const next = new URLSearchParams(params);
                next.set('doc', d);
                setParams(next, { replace: true });
              }}
              notify={notify}
            />
          </Suspense>
        )}
      </div>

      <MatchPicker
        line={pickerLine}
        candidates={[...receipts, ...payouts].filter((c) => !takenIds(statements).has(c.id))}
        onClose={() => setPickerLine(null)}
        onApply={matchTo}
      />
      <CreateReceiptModal
        line={receiptLine}
        onClose={() => setReceiptLine(null)}
        onChanged={refreshBooks}
        onSettled={(line, payments) => {
          matchTo(line, 'payment', payments.map((p) => p.id));
          notify(bankT(payments.length > 1 ? 'receiptMany' : 'receiptOne'));
        }}
      />
      <CreateExpenseModal
        line={expenseLine}
        onClose={() => setExpenseLine(null)}
        onChanged={refreshBooks}
        onSettled={(line, paymentId) => {
          matchTo(line, 'purchase_payment', [paymentId]);
          notify(bankT('paymentMatched'));
          // 8.45: offer a rule for similar lines, pre-filled from this categorisation.
          const bill = purchasesDb.get(paymentsDb.all().find((p) => p.id === paymentId)?.purchase_id ?? '');
          if (bill?.kind === 'EXPENSE') {
            const st = statements.find((x) => x.lines.some((l) => l.id === line.id));
            setRulePrompt({ line, bankAccountId: st?.bank_account_id, action: { kind: 'expense', category: bill.category, vendor_id: bill.vendor_id, vendor_name: bill.vendor_name, gst_rate: bill.lines.length === 1 ? bill.lines[0].tax_rate : 0, itc: bill.itc_eligible } });
          }
        }}
      />
      <ConfirmDialog
        open={bulkOpen}
        title={bankT(confirmable.length === 1 ? 'bulkTitleOne' : 'bulkTitleMany', { n: confirmable.length })}
        message={bankT('bulkMessage', { pct: BULK_CONFIRM_THRESHOLD })}
        confirmLabel={bankT('confirmMatches')}
        onConfirm={confirmAll}
        onClose={() => setBulkOpen(false)}
      />
      {toastNode}
    </div>
  );
}

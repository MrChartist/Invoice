import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { accountBalanceAt, buildVouchers, loadBooksData, type BooksData } from '../lib/books';
import { StorageWriteError } from '../lib/storage';
import { formatDate, formatMoney } from '../lib/utils';
import { PageHeader } from '../components/ui/PageHeader';
import { StatCard } from '../components/ui/StatCard';
import { EmptyState } from '../components/ui/EmptyState';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../components/ui/useToast';
import { ImportPanel } from '../components/bank/ImportPanel';
import { LineList, type LineItem } from '../components/bank/LineList';
import { MatchPicker } from '../components/bank/MatchPicker';
import { CreateReceiptModal } from '../components/bank/CreateReceiptModal';
import { CreateExpenseModal } from '../components/bank/CreateExpenseModal';
import { BrsView } from '../components/bank/BrsView';
import { StatementsPanel } from '../components/bank/StatementsPanel';
import controls from '../styles/controls.module.css';
import surface from '../styles/surface.module.css';
import bank from '../components/bank/reconcile.module.css';
import styles from './Reconcile.module.css';

const TABS = [
  { id: 'reconcile', label: 'Reconcile' },
  { id: 'brs', label: 'BRS statement' },
  { id: 'statements', label: 'Statements' },
  { id: 'import', label: 'Import' },
] as const;
type TabId = (typeof TABS)[number]['id'];

type Filter = 'review' | 'matched' | 'ignored' | 'all';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'review', label: 'To review' },
  { id: 'matched', label: 'Matched' },
  { id: 'ignored', label: 'Ignored' },
  { id: 'all', label: 'All' },
];

const rupees = (n: number) => `₹${formatMoney(n)}`;

export function Reconcile() {
  const [params, setParams] = useSearchParams();
  const [statements, setStatements] = useState<BankStatement[]>(() => bankDb.all());
  const [books, setBooks] = useState<BooksData>(() => loadBooksData());
  const [scope, setScope] = useState('all');
  const [filter, setFilter] = useState<Filter>('review');
  const [query, setQuery] = useState('');
  const [pickerLine, setPickerLine] = useState<BankLine | null>(null);
  const [receiptLine, setReceiptLine] = useState<BankLine | null>(null);
  const [expenseLine, setExpenseLine] = useState<BankLine | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
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
        notify(err instanceof StorageWriteError ? err.message : 'Could not save — browser storage may be full.', 'error');
      }
    },
    [notify],
  );

  /* ── derived data ─────────────────────────────────────────── */
  const scoped = useMemo(() => (scope === 'all' ? statements : statements.filter((s) => s.id === scope)), [statements, scope]);
  const index = useMemo(
    () => ({
      payments: new Set(books.transactions.map((t) => t.id)),
      purchasePayments: new Set(books.purchasePayments.map((p) => String(p.id ?? ''))),
    }),
    [books],
  );
  const receipts = useMemo(() => receiptCandidates(books.invoices, books.transactions), [books]);
  const payouts = useMemo(() => payoutCandidates(books.purchases, books.vendors, books.purchasePayments), [books]);
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

  const closing = useMemo(() => closingAcross(scoped), [scoped]);
  const vouchers = useMemo(() => buildVouchers(books), [books]);
  const asOf = closing.asOf;
  const booksBalance = useMemo(() => (asOf ? accountBalanceAt(vouchers, books.openings, 'bank', asOf) : 0), [vouchers, books.openings, asOf]);
  const openingMissing = !books.openings.some((o) => o.account === 'bank');
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
    persist([...statements, st]);
    setScope('all');
    selectTab('reconcile');
    notify(`Imported ${st.lines.length} transactions${info.duplicates ? ` (${info.duplicates} duplicates skipped)` : ''}`);
  };

  const confirmAll = () => {
    persist(applySuggestions(statements, confirmable));
    setBulkOpen(false);
    notify(`Confirmed ${confirmable.length} match${confirmable.length === 1 ? '' : 'es'}`);
  };

  const header = (
    <PageHeader
      title="Bank reconciliation"
      subtitle="Match your bank statement to the receipts and payments in your books, then print the BRS."
      actions={
        statements.length > 0 && (
          <button type="button" className={controls.btnPrimary} onClick={() => selectTab('import')}>
            <Upload size={16} /> Import statement
          </button>
        )
      }
    />
  );

  if (statements.length === 0) {
    return (
      <div className={surface.page}>
        {header}
        <ImportPanel existing={statements} onImport={importStatement} />
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
          label="Balance per statement"
          icon={Landmark}
          value={closing.balance === null ? '—' : rupees(closing.balance)}
          hint={closing.balance === null ? 'Enter it under Statements' : `as on ${formatDate(closing.asOf)}`}
        />
        <StatCard label="Balance per books" icon={BookOpen} value={rupees(booksBalance)} hint={openingMissing ? 'No bank opening balance set in Books' : 'bank account in Books'} />
        <StatCard
          label="Difference"
          icon={Scale}
          tone={diff === null ? 'default' : Math.abs(diff) <= 0.01 ? 'profit' : 'warning'}
          value={diff === null ? '—' : rupees(diff)}
          hint="statement − books, before timing differences"
        />
        <StatCard
          label="Unreconciled"
          icon={ListChecks}
          tone={summary.unreconciled ? 'warning' : 'profit'}
          value={`${summary.unreconciled} line${summary.unreconciled === 1 ? '' : 's'}`}
          hint={summary.unreconciled ? `+${rupees(summary.unreconciledCredits)} in · −${rupees(summary.unreconciledDebits)} out` : `${summary.pctReconciled}% reconciled`}
        />
      </div>

      <div className={styles.tabs} role="tablist" aria-label="Reconciliation views">
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
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`rec-panel-${tab}`} aria-labelledby={`rec-tab-${tab}`} tabIndex={0} className={styles.panel}>
        {tab !== 'import' && tab !== 'statements' && statements.length > 1 && (
          <div className={controls.field} style={{ maxWidth: 360, marginBottom: '1rem' }}>
            <label className={controls.label} htmlFor="rec-scope">Statement</label>
            <select id="rec-scope" className={controls.select} value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="all">All statements ({statements.length})</option>
              {statements.map((s) => (
                <option key={s.id} value={s.id}>{s.bank_label} — {s.file_name}</option>
              ))}
            </select>
          </div>
        )}

        {tab === 'reconcile' && (
          <div className={bank.stack}>
            <div className={bank.toolbar}>
              <div className={bank.toolbarGroup} role="group" aria-label="Show lines">
                {FILTERS.map((f) => (
                  <button key={f.id} type="button" aria-pressed={filter === f.id} className={filter === f.id ? bank.chipActive : bank.chip} onClick={() => setFilter(f.id)}>
                    {f.label} <span className={bank.count}>{counts[f.id]}</span>
                  </button>
                ))}
              </div>
              <div className={bank.toolbarGroup}>
                <input
                  type="search"
                  className={`${controls.input} ${bank.search}`}
                  placeholder="Search narration, amount, date"
                  aria-label="Search statement lines"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <button type="button" className={controls.btnOutline} disabled={confirmable.length === 0} onClick={() => setBulkOpen(true)}>
                  <CheckCheck size={16} /> Confirm all ≥ {BULK_CONFIRM_THRESHOLD}% ({confirmable.length})
                </button>
              </div>
            </div>
            <div className={surface.card}>
              {items.length === 0 ? (
                <EmptyState
                  icon={CheckCheck}
                  title={filter === 'review' ? 'Nothing left to review' : 'No lines here'}
                  text={filter === 'review' ? 'Every line is matched, ignored or reconciled. Open the BRS statement to print it.' : 'Try another filter or clear the search.'}
                />
              ) : (
                <LineList
                  items={items}
                  entries={entries}
                  suggestions={suggestions}
                  showBank={statements.length > 1 && scope === 'all'}
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
          <BrsView brs={brs} bankLabel={scope === 'all' ? statements.map((s) => s.bank_label).filter((v, i, a) => a.indexOf(v) === i).join(' + ') : (scoped[0]?.bank_label ?? '')} openingMissing={openingMissing} />
        )}

        {tab === 'statements' && (
          <StatementsPanel
            statements={statements}
            index={index}
            onClosingBalance={(id, v) => persist(statements.map((s) => (s.id === id ? { ...s, closing_balance: v } : s)))}
            onRemove={(id) => {
              persist(removeStatement(statements, id));
              setScope('all');
              notify('Statement deleted');
            }}
          />
        )}

        {tab === 'import' && <ImportPanel existing={statements} onImport={importStatement} onCancel={() => selectTab('reconcile')} />}
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
          notify(`Receipt${payments.length > 1 ? 's' : ''} recorded and matched`);
        }}
      />
      <CreateExpenseModal
        line={expenseLine}
        onClose={() => setExpenseLine(null)}
        onChanged={refreshBooks}
        onSettled={(line, paymentId) => {
          matchTo(line, 'purchase_payment', [paymentId]);
          notify('Payment recorded and matched');
        }}
      />
      <ConfirmDialog
        open={bulkOpen}
        title={`Confirm ${confirmable.length} high-confidence match${confirmable.length === 1 ? '' : 'es'}?`}
        message={`Only unambiguous matches scoring ${BULK_CONFIRM_THRESHOLD}% or more are applied — same amount, close date and a matching UTR, invoice number or party name. Nothing is written to your invoices; you can unmatch any line afterwards.`}
        confirmLabel="Confirm matches"
        onConfirm={confirmAll}
        onClose={() => setBulkOpen(false)}
      />
      {toastNode}
    </div>
  );
}

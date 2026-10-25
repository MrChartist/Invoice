import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Ban, Check, CheckCircle2, CircleSlash, FilePlus2, Link2, Receipt, Search, Undo2 } from 'lucide-react';
import {
  inferMode,
  matchedIdsOf,
  tierOf,
  type BankLine,
  type Candidate,
  type LineState,
  type Suggestion,
} from '../../lib/bank-recon';
import { formatDate, formatMoney } from '../../lib/utils';
import { useT } from '../../i18n';
import { bankT } from '../../i18n/areas/bank';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './reconcile.module.css';

export interface LineItem {
  line: BankLine;
  state: LineState;
  /** Statement label, shown when several statements are loaded. */
  bank: string;
}

export interface LineListProps {
  items: LineItem[];
  /** Every book entry by id, for describing matches and suggestions. */
  entries: ReadonlyMap<string, Candidate>;
  suggestions: ReadonlyMap<string, Suggestion[]>;
  showBank: boolean;
  onConfirm: (s: Suggestion) => void;
  onUnmatch: (lineId: string) => void;
  onIgnore: (lineId: string, ignored: boolean) => void;
  onMatchManually: (line: BankLine) => void;
  onMarkReconciled: (lineId: string) => void;
  onCreateReceipt: (line: BankLine) => void;
  onCreateExpense: (line: BankLine) => void;
  onNote: (lineId: string, note: string) => void;
}

const PAGE = 100;

function describe(c: Candidate | undefined): { title: string; sub: string } {
  if (!c) return { title: bankT('entryRemoved'), sub: '' };
  const what = c.kind === 'payment' ? bankT('receipt') : bankT('payment');
  return {
    title: [what, c.docNumber, c.party && `· ${c.party}`].filter(Boolean).join(' '),
    sub: `${formatMoney(c.amount)} · ${formatDate(c.date)}${c.method ? ` · ${c.method}` : ''}`,
  };
}

export function LineList(props: LineListProps) {
  useT(); // re-render on a language switch (5.4)
  const { items } = props;
  const [shown, setShown] = useState(PAGE);
  // New filter / search / data => start from the top again.
  const signature = items.length ? `${items.length}:${items[0].line.id}:${items[items.length - 1].line.id}` : '0';
  useEffect(() => setShown(PAGE), [signature]);

  return (
    <>
      <ul className={styles.list} aria-label={bankT('linesAria')}>
        {items.slice(0, shown).map((it) => (
          <LineRow key={it.line.id} item={it} {...props} />
        ))}
      </ul>
      {items.length > shown && (
        <div style={{ padding: '0.875rem 1.25rem', borderTop: '1px solid var(--border)' }}>
          <button type="button" className={controls.btnOutline} onClick={() => setShown((n) => n + PAGE)}>
            {bankT('showMore', { n: Math.min(PAGE, items.length - shown), left: items.length - shown })}
          </button>
        </div>
      )}
    </>
  );
}

function LineRow({ item, entries, suggestions, showBank, ...act }: LineListProps & { item: LineItem }) {
  const { line, state } = item;
  const credit = line.credit > 0 && !(line.debit > 0);
  const amount = credit ? line.credit : line.debit;
  const mode = inferMode(line.narration);
  const done = state === 'matched' || state === 'manual' || state === 'ignored';
  const sug = suggestions.get(line.id)?.[0];
  const matchedEntries = matchedIdsOf(line.matched_to).map((id) => entries.get(id));

  return (
    <li className={done ? styles.rowDone : styles.row}>
      <div className={styles.cDate}>
        <div className={styles.date}>{formatDate(line.date)}</div>
        {mode !== 'Other' && <span className={styles.mode}>{mode}</span>}
      </div>
      <div className={styles.cNarr}>
        <div className={styles.narr} title={line.narration}>{line.narration || bankT('noNarration')}</div>
        <div className={styles.narrMeta}>
          {[showBank && item.bank, line.ref && bankT('refN', { ref: line.ref }), line.balance !== undefined && bankT('balN', { amount: formatMoney(line.balance) })].filter(Boolean).join(' · ')}
        </div>
      </div>
      <div className={`${styles.amount} ${styles.cAmount} ${credit ? styles.pos : styles.neg}`}>
        <span className={surface.srOnly}>{credit ? bankT('creditSr') : bankT('debitSr')}</span>
        {credit ? '+' : '−'}₹{formatMoney(amount)}
      </div>
      <div className={`${styles.side} ${styles.cSide}`}>
        {state === 'matched' && (
          <>
            <span className={styles.statusOk}><CheckCircle2 size={12} aria-hidden="true" /> {bankT('matched')}</span>
            {matchedEntries.map((c, i) => {
              const d = describe(c);
              return (
                <div key={i}>
                  {c?.kind === 'payment' && c.docId ? (
                    <Link to={`/invoice/${c.docId}`} className={styles.link}>{d.title}</Link>
                  ) : (
                    <span className={styles.cand}>{d.title}</span>
                  )}
                  <div className={styles.candSub}>{d.sub}</div>
                </div>
              );
            })}
            <div className={styles.actions}>
              <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => act.onUnmatch(line.id)}>
                <Undo2 size={14} /> {bankT('unmatch')}
              </button>
            </div>
          </>
        )}
        {state === 'manual' && (
          <>
            <span className={styles.statusOk}><Check size={12} aria-hidden="true" /> {bankT('manual')}</span>
            <NoteField line={line} onNote={act.onNote} />
            <div className={styles.actions}>
              <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => act.onUnmatch(line.id)}>
                <Undo2 size={14} /> {bankT('reopen')}
              </button>
            </div>
          </>
        )}
        {state === 'ignored' && (
          <>
            <span className={styles.status}><CircleSlash size={12} aria-hidden="true" /> {bankT('ignored')}</span>
            <NoteField line={line} onNote={act.onNote} />
            <div className={styles.actions}>
              <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => act.onIgnore(line.id, false)}>
                <Undo2 size={14} /> {bankT('restore')}
              </button>
            </div>
          </>
        )}
        {(state === 'unmatched' || state === 'orphan') && (
          <>
            {state === 'orphan' && (
              <span className={styles.statusWarn}>{bankT('orphan')}</span>
            )}
            {sug && <SuggestionCard sug={sug} entries={entries} onConfirm={() => act.onConfirm(sug)} onOther={() => act.onMatchManually(line)} />}
            <div className={styles.actions}>
              {!sug && (
                <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => act.onMatchManually(line)}>
                  <Search size={14} /> {bankT('matchDots')}
                </button>
              )}
              {credit ? (
                <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => act.onCreateReceipt(line)}>
                  <Receipt size={14} /> {bankT('createReceipt')}
                </button>
              ) : (
                <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => act.onCreateExpense(line)}>
                  <FilePlus2 size={14} /> {bankT('createExpense')}
                </button>
              )}
              <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => act.onMarkReconciled(line.id)} title={bankT('markReconciledHint')}>
                <Check size={14} /> {bankT('markReconciled')}
              </button>
              <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => act.onIgnore(line.id, true)}>
                <Ban size={14} /> {bankT('ignore')}
              </button>
            </div>
          </>
        )}
      </div>
    </li>
  );
}

function SuggestionCard({ sug, entries, onConfirm, onOther }: { sug: Suggestion; entries: ReadonlyMap<string, Candidate>; onConfirm: () => void; onOther: () => void }) {
  const tier = tierOf(sug.confidence);
  const items = sug.candidateIds.map((id) => describe(entries.get(id)));
  const isPick = sug.rank === 1;
  return (
    <div className={tier === 'high' ? styles.suggestHigh : tier === 'medium' ? styles.suggestMed : styles.suggest}>
      <div className={styles.suggestHead}>
        <span className={tier === 'high' ? styles.pillHigh : tier === 'medium' ? styles.pillMed : styles.pillLow} title={bankT('confidence')}>
          {sug.confidence}% · {tier === 'high' ? bankT('high') : tier === 'medium' ? bankT('medium') : bankT('low')}
        </span>
        <span className={styles.candSub}>{isPick ? (sug.combo ? bankT('suggestedSplit') : bankT('suggestedMatch')) : bankT('alternative')}</span>
      </div>
      {items.map((d, i) => (
        <div key={i}>
          <div className={styles.cand}>{d.title}</div>
          <div className={styles.candSub}>{d.sub}</div>
        </div>
      ))}
      <ul className={styles.reasons} aria-label={bankT('why')}>
        {sug.reasons.map((r) => <li key={r}>{r}</li>)}
      </ul>
      <div className={styles.actions}>
        <button type="button" className={`${controls.btnPrimary} ${controls.btnSm}`} onClick={onConfirm}>
          <Check size={14} /> {bankT('confirm')}
        </button>
        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={onOther}>
          <Link2 size={14} /> {bankT('other')}
        </button>
      </div>
    </div>
  );
}

function NoteField({ line, onNote }: { line: BankLine; onNote: (id: string, note: string) => void }) {
  const [value, setValue] = useState(line.note ?? '');
  return (
    <input
      className={`${controls.input} ${styles.noteInput}`}
      aria-label={bankT('noteAria')}
      placeholder={bankT('notePh')}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => value !== (line.note ?? '') && onNote(line.id, value)}
    />
  );
}

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Download, Printer } from 'lucide-react';
import { brsCsv, type Brs, type BrsItem } from '../../lib/bank-recon';
import { round2 } from '../../lib/invoice-calc';
import { localDb } from '../../lib/localDb';
import { downloadCsv } from '../books/download';
import { formatDate, formatMoney } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './reconcile.module.css';

const sum = (xs: readonly BrsItem[]) => round2(xs.reduce((t, x) => t + x.amount, 0));
const money = (n: number) => `₹${formatMoney(n)}`;

export interface BrsViewProps {
  brs: Brs;
  bankLabel: string;
  /** True when no opening balance was entered in Books > Cash & bank (the books figure is then movements only). */
  openingMissing: boolean;
}

/** Tally-style Bank Reconciliation Statement: books balance -> timing differences -> bank balance. */
export function BrsView({ brs, bankLabel, openingMissing }: BrsViewProps) {
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!printing) return;
    document.body.classList.add('brs-printing');
    const done = () => {
      document.body.classList.remove('brs-printing');
      setPrinting(false);
    };
    window.addEventListener('afterprint', done, { once: true });
    const t = window.setTimeout(() => window.print(), 50);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('afterprint', done);
      document.body.classList.remove('brs-printing');
    };
  }, [printing]);

  const reconciled = brs.difference !== null && Math.abs(brs.difference) <= 0.01;

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <p className={styles.muted} style={{ maxWidth: 640 }}>
          Starts from the balance in your Books for the bank account and walks it to the bank&apos;s own balance. A non-zero difference means a transaction is missing on one side or the books opening balance is off.
        </p>
        <div className={styles.toolbarGroup}>
          <button type="button" className={controls.btnOutline} onClick={() => downloadCsv(`brs-${brs.asOf}.csv`, brsCsv(brs))}>
            <Download size={16} /> Export CSV
          </button>
          <button type="button" className={controls.btnOutline} onClick={() => setPrinting(true)}>
            <Printer size={16} /> Print
          </button>
        </div>
      </div>

      {openingMissing && (
        <div className={styles.noticeWarn} role="note">
          <AlertTriangle size={16} className={styles.noticeIcon} aria-hidden="true" />
          <span>
            No bank opening balance is set in <strong>Books → Cash &amp; bank</strong>, so the books balance below is only the movements recorded in this app. Enter the opening balance to make the difference meaningful.
          </span>
        </div>
      )}

      <div className={surface.card}>
        <div className={surface.cardHead}>
          <span>Bank reconciliation statement — {bankLabel}</span>
          <span className={styles.muted}>as on {formatDate(brs.asOf)}</span>
        </div>
        <Paper brs={brs} />
      </div>

      <div className={reconciled ? styles.notice : styles.noticeWarn} role="status">
        {reconciled ? (
          <CheckCircle2 size={16} className={styles.diffOk} aria-hidden="true" />
        ) : (
          <AlertTriangle size={16} className={styles.noticeIcon} aria-hidden="true" />
        )}
        <span>
          {brs.statementBalance === null
            ? 'The statement has no balance column. Enter the closing balance under Statements to see the difference.'
            : reconciled
              ? 'Fully reconciled: the books walk exactly to the bank statement balance.'
              : `Unexplained difference of ${money(brs.difference ?? 0)}. Check unmatched lines, ignored lines and the books opening balance.`}
        </span>
      </div>

      {printing &&
        createPortal(
          <div className={styles.printRoot}>
            <h1 style={{ fontSize: '16pt', margin: 0 }}>{localDb.settings.activeProfile()?.companyName || 'Bank reconciliation'}</h1>
            <h2 style={{ fontSize: '12pt', margin: '4pt 0 12pt' }}>
              Bank reconciliation statement — {bankLabel} — as on {formatDate(brs.asOf)}
            </h2>
            <Paper brs={brs} />
            <p style={{ fontSize: '8pt', marginTop: '14pt' }}>Working paper generated from your own books; verify with your accountant.</p>
          </div>,
          document.body,
        )}
    </div>
  );
}

function Section({ title, items, sign }: { title: string; items: readonly BrsItem[]; sign: 1 | -1 }) {
  const total = sum(items);
  return (
    <>
      <div className={styles.brsHead}>
        <span>{title}{items.length ? ` (${items.length})` : ''}</span>
        <span className={styles.amt}>{sign < 0 && total ? '−' : ''}{money(total)}</span>
      </div>
      {items.slice(0, 200).map((it, i) => (
        <div key={i} className={styles.brsSub}>
          <span className={styles.brsDesc}>
            {it.description}
            <span className={styles.brsDate}>{formatDate(it.date)}</span>
          </span>
          <span className={styles.amt}>{money(it.amount)}</span>
        </div>
      ))}
      {items.length > 200 && <div className={styles.brsSub}><span>…and {items.length - 200} more (see the CSV)</span><span /></div>}
    </>
  );
}

function Paper({ brs }: { brs: Brs }) {
  const diff = brs.difference;
  return (
    <div className={styles.brs}>
      <div className={styles.brsTotal}>
        <span>Balance as per books</span>
        <span className={styles.amt}>{money(brs.booksBalance)}</span>
      </div>
      <Section title="Add: payments issued, not yet debited by the bank" items={brs.paymentsNotCleared} sign={1} />
      <Section title="Less: receipts recorded, not yet credited by the bank" items={brs.receiptsNotCleared} sign={-1} />
      <Section title="Add: credited by the bank, not in books" items={brs.bankCreditsNotInBooks} sign={1} />
      <Section title="Less: debited by the bank, not in books" items={brs.bankDebitsNotInBooks} sign={-1} />
      <div className={styles.brsTotal}>
        <span>Balance as per bank (computed)</span>
        <span className={styles.amt}>{money(brs.computedBankBalance)}</span>
      </div>
      <div className={styles.brsRow}>
        <span>Balance as per bank statement</span>
        <span className={styles.amt}>{brs.statementBalance === null ? '—' : money(brs.statementBalance)}</span>
      </div>
      <div className={styles.brsTotal}>
        <span>Difference</span>
        <span className={`${styles.amt} ${diff === null ? '' : Math.abs(diff) <= 0.01 ? styles.diffOk : styles.diffBad}`}>
          {diff === null ? '—' : money(diff)}
        </span>
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Download, Printer } from 'lucide-react';
import { brsCsv, type Brs, type BrsItem } from '../../lib/bank-recon';
import { round2 } from '../../lib/invoice-calc';
import { localDb } from '../../lib/localDb';
import { downloadCsv } from '../books/download';
import { formatDate, formatMoney } from '../../lib/utils';
import { useT } from '../../i18n';
import { bankT } from '../../i18n/areas/bank';
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
  useT(); // re-render on a language switch (5.4)
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
          {bankT('brsIntro')}
        </p>
        <div className={styles.toolbarGroup}>
          <button type="button" className={controls.btnOutline} onClick={() => downloadCsv(`brs-${brs.asOf}.csv`, brsCsv(brs))}>
            <Download size={16} /> {bankT('exportCsv')}
          </button>
          <button type="button" className={controls.btnOutline} onClick={() => setPrinting(true)}>
            <Printer size={16} /> {bankT('print')}
          </button>
        </div>
      </div>

      {openingMissing && (
        <div className={styles.noticeWarn} role="note">
          <AlertTriangle size={16} className={styles.noticeIcon} aria-hidden="true" />
          <span>{bankT('brsNoOpening')}</span>
        </div>
      )}

      <div className={surface.card}>
        <div className={surface.cardHead}>
          <span>{bankT('brsTitle', { bank: bankLabel })}</span>
          <span className={styles.muted}>{bankT('asOn', { date: formatDate(brs.asOf) })}</span>
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
            ? bankT('brsNoBalance')
            : reconciled
              ? bankT('brsReconciled')
              : bankT('brsUnexplained', { amount: money(brs.difference ?? 0) })}
        </span>
      </div>

      {printing &&
        createPortal(
          <div className={styles.printRoot}>
            <h1 style={{ fontSize: '16pt', margin: 0 }}>{localDb.settings.activeProfile()?.companyName || bankT('title')}</h1>
            <h2 style={{ fontSize: '12pt', margin: '4pt 0 12pt' }}>
              {bankT('brsPrintTitle', { bank: bankLabel, date: formatDate(brs.asOf) })}
            </h2>
            <Paper brs={brs} />
            <p style={{ fontSize: '8pt', marginTop: '14pt' }}>{bankT('brsPrintNote')}</p>
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
      {items.length > 200 && <div className={styles.brsSub}><span>{bankT('andMore', { n: items.length - 200 })}</span><span /></div>}
    </>
  );
}

function Paper({ brs }: { brs: Brs }) {
  const diff = brs.difference;
  return (
    <div className={styles.brs}>
      <div className={styles.brsTotal}>
        <span>{bankT('balBooks')}</span>
        <span className={styles.amt}>{money(brs.booksBalance)}</span>
      </div>
      <Section title={bankT('addNotDebited')} items={brs.paymentsNotCleared} sign={1} />
      <Section title={bankT('lessNotCredited')} items={brs.receiptsNotCleared} sign={-1} />
      <Section title={bankT('addCreditedNotBooks')} items={brs.bankCreditsNotInBooks} sign={1} />
      <Section title={bankT('lessDebitedNotBooks')} items={brs.bankDebitsNotInBooks} sign={-1} />
      <div className={styles.brsTotal}>
        <span>{bankT('balBankComputed')}</span>
        <span className={styles.amt}>{money(brs.computedBankBalance)}</span>
      </div>
      <div className={styles.brsRow}>
        <span>{bankT('balBankStatement')}</span>
        <span className={styles.amt}>{brs.statementBalance === null ? '—' : money(brs.statementBalance)}</span>
      </div>
      <div className={styles.brsTotal}>
        <span>{bankT('statDiff')}</span>
        <span className={`${styles.amt} ${diff === null ? '' : Math.abs(diff) <= 0.01 ? styles.diffOk : styles.diffBad}`}>
          {diff === null ? '—' : money(diff)}
        </span>
      </div>
    </div>
  );
}

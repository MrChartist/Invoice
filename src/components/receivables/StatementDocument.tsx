import { forwardRef } from 'react';
import { upiLink } from '../../lib/share';
import { QRCodeCanvas } from 'qrcode.react';
import type { Client, SenderProfile } from '../../types/invoice';
import type { Ledger, PartyReceivable } from '../../lib/receivables';
import { closingInWords } from '../../lib/receivables';
import { formatDate, formatMoney } from '../../lib/utils';
import styles from './StatementDocument.module.css';
import { AGEING_STRIP, ageingStrip, openItemRows, openItemTotals, transactionRows, type StatementStyle } from '../../lib/statement-styles';

export interface StatementDocumentProps {
  /** Sender profile snapshot — pass localDb.settings.activeProfile(). */
  sender: SenderProfile | null;
  party: PartyReceivable;
  /** Full client record when known (address, GSTIN…). */
  client?: Client;
  ledger: Ledger;
  currency?: string;
  /** R2-A6: balance forward (default, the original paper), open items or transactions. */
  styleKind?: StatementStyle;
  /** R2-A6: print the ageing strip (Current … 90+) of the open bills as of this local day. */
  ageing?: { asOf: string };
}

const STYLE_TITLES: Record<StatementStyle, string> = {
  balance_forward: 'Statement of Account',
  open_items: 'Statement of Open Items',
  transactions: 'Transaction Statement',
};

function buildUpiUrl(sender: SenderProfile | null, amount: number): string {
  if (!sender?.upiId) return '';
  return upiLink({ pa: sender.upiId, pn: sender.accountName || sender.companyName, amount: amount > 0 ? amount : undefined }) ?? '';
}

/** Signed balance as "1,234.00 Dr" / "1,234.00 Cr". */
function drCr(n: number, currency: string): string {
  if (Math.abs(n) < 0.005) return formatMoney(0, currency);
  return `${formatMoney(Math.abs(n), currency)} ${n > 0 ? 'Dr' : 'Cr'}`;
}

/** A4 client statement of account: white paper, brand-neutral. Forwards its ref for export. */
export const StatementDocument = forwardRef<HTMLDivElement, StatementDocumentProps>(
  function StatementDocument({ sender, party, client, ledger, currency = 'INR', styleKind = 'balance_forward', ageing }, ref) {
    const m = (n: number) => formatMoney(n, currency);
    const openRows = styleKind === 'open_items' ? openItemRows(party) : [];
    const openTotals = openItemTotals(party);
    const txRows = styleKind === 'transactions' ? transactionRows(ledger) : [];
    const strip = ageing ? ageingStrip(party, ageing.asOf) : null;
    const payable = party.net > 0.004;
    const upi = currency === 'INR' && payable ? buildUpiUrl(sender, party.net) : '';
    const period =
      ledger.from || ledger.to
        ? `${ledger.from ? formatDate(ledger.from) : 'Beginning'} – ${ledger.to ? formatDate(ledger.to) : 'Date'}`
        : 'All transactions';
    const address = [client?.address, [client?.city, client?.zip].filter(Boolean).join(' '), client?.state]
      .filter(Boolean)
      .join('\n');

    return (
      <div ref={ref} className={styles.paper}>
        <header className={styles.head}>
          <div className={styles.company}>
            {sender?.logo && <img className={styles.logo} src={sender.logo} alt="" />}
            <div>
              <h1 className={styles.companyName}>{sender?.companyName || 'Your business'}</h1>
              <div className={styles.companyMeta}>
                {[sender?.companyAddress, sender?.companyGstin && `GSTIN: ${sender.companyGstin}`,
                  [sender?.companyPhone, sender?.companyEmail].filter(Boolean).join(' · ')]
                  .filter(Boolean).join('\n')}
              </div>
            </div>
          </div>
          <div className={styles.docTitle}>
            <h2>{STYLE_TITLES[styleKind]}</h2>
            <div className={styles.period}>{period}</div>
            <div className={styles.period}>Generated {formatDate(new Date())}</div>
          </div>
        </header>

        <section className={styles.meta}>
          <div className={styles.box}>
            <div className={styles.boxLabel}>Statement for</div>
            <div className={styles.partyName}>{party.name}</div>
            <div className={styles.partyLine}>
              {[client?.company, address, client?.gstin && `GSTIN: ${client.gstin}`,
                [client?.phone, client?.email].filter(Boolean).join(' · ')]
                .filter(Boolean).join('\n')}
            </div>
          </div>
          <div className={styles.box}>
            <div className={styles.boxLabel}>Account summary</div>
            {styleKind === 'open_items' ? (
              <dl className={styles.summary}>
                <dt>Open bills</dt><dd>{m(openTotals.open)}</dd>
                <dt>Less credits / advances</dt><dd>{m(openTotals.unallocated)}</dd>
                <dt className={styles.summaryTotal}>Balance due</dt>
                <dd className={styles.summaryTotal}>{drCr(openTotals.net, currency)}</dd>
              </dl>
            ) : styleKind === 'transactions' ? (
              <dl className={styles.summary}>
                <dt>Billed (debit)</dt><dd>{m(ledger.totalDebit)}</dd>
                <dt className={styles.summaryTotal}>Received / credited</dt>
                <dd className={styles.summaryTotal}>{m(ledger.totalCredit)}</dd>
              </dl>
            ) : (
              <dl className={styles.summary}>
                <dt>Opening balance</dt><dd>{drCr(ledger.opening, currency)}</dd>
                <dt>Billed (debit)</dt><dd>{m(ledger.totalDebit)}</dd>
                <dt>Received / credited</dt><dd>{m(ledger.totalCredit)}</dd>
                <dt className={styles.summaryTotal}>Closing balance</dt>
                <dd className={styles.summaryTotal}>{drCr(ledger.closing, currency)}</dd>
              </dl>
            )}
          </div>
        </section>

        {styleKind === 'open_items' && (
          <table className={styles.table} data-statement-open-items>
            <thead>
              <tr>
                <th>Bill</th><th>Date</th><th>Due</th>
                <th className={styles.num}>Original</th><th className={styles.num}>Credited</th><th className={styles.num}>Received</th>
                <th className={styles.num}>Open</th><th className={styles.num}>Days overdue</th>
              </tr>
            </thead>
            <tbody>
              {openRows.map((r) => (
                <tr key={r.invoiceId}>
                  <td>{r.number}</td><td>{formatDate(r.date)}</td><td>{formatDate(r.due)}</td>
                  <td className={styles.num}>{m(r.original)}</td>
                  <td className={styles.num}>{r.credited ? m(r.credited) : ''}</td>
                  <td className={styles.num}>{r.received ? m(r.received) : ''}</td>
                  <td className={styles.num}>{m(r.open)}</td>
                  <td className={styles.num}>{r.daysOverdue > 0 ? r.daysOverdue : ''}</td>
                </tr>
              ))}
              {openRows.length === 0 && <tr><td colSpan={8} className={styles.sub}>No open bills.</td></tr>}
              {openTotals.unallocated > 0.004 && (
                <tr><td colSpan={6}>Less credits / advances not allocated to a bill</td><td className={styles.num}>−{m(openTotals.unallocated)}</td><td /></tr>
              )}
              <tr className={styles.rowStrong}>
                <td colSpan={6}>Balance due</td>
                <td className={styles.num}>{drCr(openTotals.net, currency)}</td><td />
              </tr>
            </tbody>
          </table>
        )}

        {styleKind === 'transactions' && (
          <table className={styles.table} data-statement-transactions>
            <thead>
              <tr><th>Date</th><th>Voucher</th><th>Particulars</th><th className={styles.num}>Debit</th><th className={styles.num}>Credit</th></tr>
            </thead>
            <tbody>
              {txRows.map((e, i) => (
                <tr key={`${e.ref}-${i}`}>
                  <td>{formatDate(e.date)}</td><td>{e.ref}</td><td>{e.particulars}</td>
                  <td className={styles.num}>{e.debit ? m(e.debit) : ''}</td>
                  <td className={styles.num}>{e.credit ? m(e.credit) : ''}</td>
                </tr>
              ))}
              {txRows.length === 0 && <tr><td colSpan={5} className={styles.sub}>No transactions in this period.</td></tr>}
              <tr className={styles.rowStrong}>
                <td colSpan={3}>Total</td>
                <td className={styles.num}>{m(ledger.totalDebit)}</td>
                <td className={styles.num}>{m(ledger.totalCredit)}</td>
              </tr>
            </tbody>
          </table>
        )}

        {styleKind === 'balance_forward' && (<>

        <table className={styles.table}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Voucher</th>
              <th>Particulars</th>
              <th className={styles.num}>Debit</th>
              <th className={styles.num}>Credit</th>
              <th className={styles.num}>Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{ledger.from ? formatDate(ledger.from) : ''}</td>
              <td />
              <td><em>Opening balance</em></td>
              <td /><td />
              <td className={styles.num}>{drCr(ledger.opening, currency)}</td>
            </tr>
            {ledger.entries.map((e, i) => (
              <tr key={`${e.ref}-${i}`}>
                <td>{formatDate(e.date)}</td>
                <td>{e.ref}</td>
                <td>{e.particulars}</td>
                <td className={styles.num}>{e.debit ? m(e.debit) : ''}</td>
                <td className={styles.num}>{e.credit ? m(e.credit) : ''}</td>
                <td className={styles.num}>{drCr(e.balance, currency)}</td>
              </tr>
            ))}
            {ledger.entries.length === 0 && (
              <tr><td colSpan={6} className={styles.sub}>No transactions in this period.</td></tr>
            )}
            <tr className={styles.rowStrong}>
              <td colSpan={3}>Total / Closing balance</td>
              <td className={styles.num}>{m(ledger.totalDebit)}</td>
              <td className={styles.num}>{m(ledger.totalCredit)}</td>
              <td className={styles.num}>{drCr(ledger.closing, currency)}</td>
            </tr>
          </tbody>
        </table>

        <p className={styles.words}>
          <strong>Closing balance in words:</strong> {closingInWords(ledger.closing, currency)}
        </p>
        </>)}

        {styleKind === 'balance_forward' && party.bills.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Open bill</th><th>Due date</th>
                <th className={styles.num}>Outstanding</th><th className={styles.num}>Overdue by</th>
              </tr>
            </thead>
            <tbody>
              {party.bills.map((b) => (
                <tr key={b.invoiceId}>
                  <td>{b.number}</td>
                  <td>{formatDate(b.dueDate)}</td>
                  <td className={styles.num}>{m(b.outstanding)}</td>
                  <td className={styles.num}>{b.daysOverdue > 0 ? `${b.daysOverdue} days` : 'Not due'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {ageing && (
          <table className={styles.table} data-ageing-strip>
            <thead>
              <tr>{AGEING_STRIP.map((b) => <th key={b} className={styles.num}>{b === 'Current' ? 'Current' : `${b} days`}</th>)}<th className={styles.num}>Total open</th></tr>
            </thead>
            <tbody>
              <tr>
                {AGEING_STRIP.map((b) => <td key={b} className={styles.num}>{m(strip![b])}</td>)}
                <td className={styles.num}>{m(openTotals.open)}</td>
              </tr>
              <tr><td colSpan={AGEING_STRIP.length + 1} className={styles.sub}>Ageing of open bills as of {formatDate(ageing.asOf)}</td></tr>
            </tbody>
          </table>
        )}

        {(sender?.upiId || sender?.accountNumber) && payable && (
          <div className={styles.bottom}>
            <div className={styles.pay}>
              <div className={styles.boxLabel}>Payment details</div>
              {sender?.accountNumber && (
                <div>
                  {sender.accountName && <>A/c name: {sender.accountName}<br /></>}
                  {sender.bankName && <>Bank: {sender.bankName}<br /></>}
                  A/c no: {sender.accountNumber}{sender.ifsc && <> · IFSC: {sender.ifsc}</>}
                </div>
              )}
              {sender?.upiId && <div>UPI: {sender.upiId}</div>}
            </div>
            {upi && (
              <div className={styles.qr}>
                <QRCodeCanvas value={upi} size={72} level="M" />
                <div>Scan to pay {m(party.net)}</div>
              </div>
            )}
          </div>
        )}

        <footer className={styles.foot}>
          <span>This is a computer-generated statement and needs no signature.</span>
          <span>Errors and omissions excepted.</span>
        </footer>
      </div>
    );
  },
);

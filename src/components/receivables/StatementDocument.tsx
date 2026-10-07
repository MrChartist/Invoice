import { forwardRef } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import type { Client, SenderProfile } from '../../types/invoice';
import type { Ledger, PartyReceivable } from '../../lib/receivables';
import { closingInWords } from '../../lib/receivables';
import { formatDate, formatMoney } from '../../lib/utils';
import styles from './StatementDocument.module.css';

export interface StatementDocumentProps {
  /** Sender profile snapshot — pass localDb.settings.activeProfile(). */
  sender: SenderProfile | null;
  party: PartyReceivable;
  /** Full client record when known (address, GSTIN…). */
  client?: Client;
  ledger: Ledger;
  currency?: string;
}

function buildUpiUrl(sender: SenderProfile | null, amount: number): string {
  if (!sender?.upiId) return '';
  const payee = encodeURIComponent(sender.accountName || sender.companyName);
  return `upi://pay?pa=${sender.upiId}&pn=${payee}&cu=INR${amount > 0 ? `&am=${amount.toFixed(2)}` : ''}`;
}

/** Signed balance as "1,234.00 Dr" / "1,234.00 Cr". */
function drCr(n: number, currency: string): string {
  if (Math.abs(n) < 0.005) return formatMoney(0, currency);
  return `${formatMoney(Math.abs(n), currency)} ${n > 0 ? 'Dr' : 'Cr'}`;
}

/** A4 client statement of account: white paper, brand-neutral. Forwards its ref for export. */
export const StatementDocument = forwardRef<HTMLDivElement, StatementDocumentProps>(
  function StatementDocument({ sender, party, client, ledger, currency = 'INR' }, ref) {
    const m = (n: number) => formatMoney(n, currency);
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
            <h2>Statement of Account</h2>
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
            <dl className={styles.summary}>
              <dt>Opening balance</dt><dd>{drCr(ledger.opening, currency)}</dd>
              <dt>Billed (debit)</dt><dd>{m(ledger.totalDebit)}</dd>
              <dt>Received / credited</dt><dd>{m(ledger.totalCredit)}</dd>
              <dt className={styles.summaryTotal}>Closing balance</dt>
              <dd className={styles.summaryTotal}>{drCr(ledger.closing, currency)}</dd>
            </dl>
          </div>
        </section>

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

        {party.bills.length > 0 && (
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

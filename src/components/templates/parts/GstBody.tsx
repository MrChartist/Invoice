import type { ReactNode } from 'react';
import { QRCodeCanvas } from 'qrcode.react';
import { cn, currencySymbol, formatQuantity } from '../../../lib/utils';
import { amountInWords } from '../../../lib/amount-in-words';
import { formatPlaceOfSupply } from '../../../lib/india-states';
import type { CalcTotals } from '../../../lib/invoice-calc';
import { DOCUMENT_LABELS, type InvoiceRecord, type SenderProfile } from '../../../types/invoice';
import { usePaper } from '../paper-context';
import { AddressLines, Logo } from './PaperHeader';
import { buildUpiUrl, isTaxed } from '../paper-helpers';
import styles from '../invoice-paper.module.css';

interface Props {
  invoice: InvoiceRecord;
  sender: SenderProfile;
  totals: CalcTotals;
}

function Cell({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn(styles.gCell, className)}>
      <div className={styles.gLabel}>{label}</div>
      <div className={styles.gValue}>{children}</div>
    </div>
  );
}

/**
 * Tally-style tax invoice: everything lives in one ruled grid — parties and
 * document facts on top, the item grid with tax ledgers as rows, an HSN/SAC
 * tax summary, then bank/declaration and the signatory box.
 */
export function GstBody({ invoice, sender, totals }: Props) {
  const { money, currency, date, col, show, footerText, headerNote } = usePaper();
  const c = invoice.client;
  const cur = invoice.currency;
  const symbol = currencySymbol(cur);
  const title = DOCUMENT_LABELS[invoice.doc_type] ?? 'Invoice';
  const isQuote = invoice.doc_type === 'QUOTATION';
  const cgstSgst = isTaxed(invoice, totals);
  const igst = !cgstSgst && invoice.gst_mode !== 'NONE' && totals.tax_amount > 0;
  const taxed = cgstSgst || igst;
  const lines = totals.lines;
  const showHsn = col.hsn && lines.some((l) => l.hsn);
  const showUnit = col.unit;
  const showDisc = col.discount && totals.line_discount_total > 0;
  const upiUrl = buildUpiUrl(sender);
  const place = formatPlaceOfSupply(invoice.place_of_supply);
  const totalQty = lines.reduce((s, l) => s + l.quantity, 0);
  const cityLine = [c.city, c.zip].filter(Boolean).join(' ');
  const hsnRows = taxed ? totals.hsn_rows : [];
  const bankLines = show.bank && (sender.accountNumber || sender.upiId);
  const notes = [invoice.notes, show.terms ? invoice.terms : ''].filter(Boolean).join('\n\n');
  // Columns before the amount column — used to span the ledger rows.
  const spanBefore = 1 + 1 + (showHsn ? 1 : 0) + 1 + 1 + (showUnit ? 1 : 0) + (showDisc ? 1 : 0);

  return (
    <div className={styles.gFrame}>
      <div className={styles.gTitle}>{title.toUpperCase()}</div>
      {headerNote && <div className={styles.gNote}>{headerNote}</div>}

      <div className={styles.gRow}>
        <div className={cn(styles.gCell, styles.gSeller)}>
          <div className={styles.gSellerHead}>
            {sender.logo && <Logo src={sender.logo} />}
            <div>
              <div className={styles.gName}>{sender.companyName || 'Your business name'}</div>
              {sender.companyTagline && <div className={styles.eyebrow}>{sender.companyTagline}</div>}
            </div>
          </div>
          <div className={styles.meta} style={{ marginTop: 5 }}>
            <AddressLines sender={sender} />
            {sender.companyGstin && (
              <>
                <b>GSTIN/UIN:</b> {sender.companyGstin}
                <br />
              </>
            )}
            {sender.pan && (
              <>
                <b>PAN:</b> {sender.pan}
                <br />
              </>
            )}
            {sender.companyPhone && <>Contact: {sender.companyPhone}<br /></>}
            {sender.companyEmail && <>E-Mail: {sender.companyEmail}<br /></>}
            {sender.regLine}
          </div>
        </div>
        <div className={styles.gMeta}>
          <Cell label={isQuote ? 'Quotation No.' : 'Invoice No.'}>{invoice.invoice_number || 'DRAFT'}</Cell>
          <Cell label="Dated">{date(invoice.issue_date)}</Cell>
          <Cell label={isQuote ? 'Valid until' : 'Due date'}>{date(invoice.due_date) || '—'}</Cell>
          <Cell label="Buyer's Ref / PO">{invoice.po_number || '—'}</Cell>
          {show.place && <Cell label="Place of supply">{place || '—'}</Cell>}
          <Cell label="Reverse charge">{invoice.reverse_charge ? 'Yes' : 'No'}</Cell>
        </div>
      </div>

      <div className={styles.gRow}>
        <div className={styles.gCell}>
          <div className={styles.gLabel}>{isQuote ? 'Prepared for' : 'Buyer (Bill to)'}</div>
          <div className={styles.gName} style={{ fontSize: 13 }}>{c.name || 'Client name'}</div>
          <div className={styles.meta}>
            {c.company && <>{c.company}<br /></>}
            {c.address && c.address.split('\n').map((l, i) => <span key={i}>{l}<br /></span>)}
            {cityLine && <>{cityLine}<br /></>}
            {c.state && <>{c.state}<br /></>}
            {c.phone && <>Contact: {c.phone}<br /></>}
            {c.email && <>{c.email}<br /></>}
            {c.gstin && <><b>GSTIN/UIN:</b> {c.gstin}</>}
          </div>
        </div>
        <div className={styles.gCell}>
          <div className={styles.gLabel}>Currency</div>
          <div className={styles.gValue}>{cur}</div>
          {invoice.balance_due > 0 && invoice.amount_paid > 0 && (
            <>
              <div className={styles.gLabel} style={{ marginTop: 8 }}>Amount received</div>
              <div className={styles.gValue}>{currency(invoice.amount_paid, cur)}</div>
            </>
          )}
        </div>
      </div>

      <table className={styles.gItems}>
        <thead>
          <tr>
            <th style={{ width: 28 }}>Sl</th>
            <th>Description of {taxed ? 'goods / services' : 'items'}</th>
            {showHsn && <th style={{ width: 64 }}>HSN/SAC</th>}
            <th className={styles.right} style={{ width: 54 }}>Qty</th>
            <th className={styles.right} style={{ width: 74 }}>Rate</th>
            {showUnit && <th style={{ width: 38 }}>per</th>}
            {showDisc && <th className={styles.right} style={{ width: 46 }}>Disc %</th>}
            <th className={styles.right} style={{ width: 90 }}>Amount ({symbol})</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => {
            const src = invoice.items.find((it) => it.id === line.id);
            return (
              <tr key={line.id}>
                <td className={cn(styles.center, styles.num)}>{i + 1}</td>
                <td>
                  <div className={styles.itemName}>{line.name || '—'}</div>
                  {src?.description && <div className={styles.itemDesc}>{src.description}</div>}
                </td>
                {showHsn && <td className={cn(styles.center, styles.num)}>{line.hsn || '—'}</td>}
                <td className={cn(styles.right, styles.num)}>{formatQuantity(line.quantity)}</td>
                <td className={cn(styles.right, styles.num)}>{money(line.rate, cur)}</td>
                {showUnit && <td className={styles.center}>{line.unit || ''}</td>}
                {showDisc && (
                  <td className={cn(styles.right, styles.num)}>{src?.discount_percent ? `${src.discount_percent}` : ''}</td>
                )}
                <td className={cn(styles.right, styles.num)} style={{ fontWeight: 700 }}>{money(line.taxable, cur)}</td>
              </tr>
            );
          })}
          {totals.discount_amount > 0 && totals.invoice_discount_amount > 0 && (
            <tr className={styles.gLedger}>
              <td colSpan={spanBefore} className={styles.right}><i>Invoice discount (already applied above)</i></td>
              <td className={cn(styles.right, styles.num)}>-{money(totals.invoice_discount_amount, cur)}</td>
            </tr>
          )}
          {cgstSgst && (
            <>
              <tr className={styles.gLedger}>
                <td colSpan={spanBefore} className={styles.right}><b>CGST</b></td>
                <td className={cn(styles.right, styles.num)}>{money(totals.cgst_amount, cur)}</td>
              </tr>
              <tr className={styles.gLedger}>
                <td colSpan={spanBefore} className={styles.right}><b>SGST</b></td>
                <td className={cn(styles.right, styles.num)}>{money(totals.sgst_amount, cur)}</td>
              </tr>
            </>
          )}
          {igst && (
            <tr className={styles.gLedger}>
              <td colSpan={spanBefore} className={styles.right}><b>{invoice.gst_mode === 'SINGLE' ? 'Tax' : 'IGST'}</b></td>
              <td className={cn(styles.right, styles.num)}>{money(totals.tax_amount, cur)}</td>
            </tr>
          )}
          {totals.shipping > 0 && (
            <tr className={styles.gLedger}>
              <td colSpan={spanBefore} className={styles.right}>Shipping</td>
              <td className={cn(styles.right, styles.num)}>{money(totals.shipping, cur)}</td>
            </tr>
          )}
          {totals.other_charges !== 0 && (
            <tr className={styles.gLedger}>
              <td colSpan={spanBefore} className={styles.right}>Other charges</td>
              <td className={cn(styles.right, styles.num)}>{money(totals.other_charges, cur)}</td>
            </tr>
          )}
          {totals.round_off !== 0 && (
            <tr className={styles.gLedger}>
              <td colSpan={spanBefore} className={styles.right}>Round off</td>
              <td className={cn(styles.right, styles.num)}>{money(totals.round_off, cur)}</td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className={styles.gTotal}>
            <td colSpan={spanBefore - (showUnit ? 1 : 0) - (showDisc ? 1 : 0) - 2} className={styles.right}>Total</td>
            <td className={cn(styles.right, styles.num)}>{formatQuantity(totalQty)}</td>
            <td colSpan={1 + (showUnit ? 1 : 0) + (showDisc ? 1 : 0)} />
            <td className={cn(styles.right, styles.num)}>{currency(totals.total, cur)}</td>
          </tr>
        </tfoot>
      </table>

      {show.words && (
        <div className={styles.gWords}>
          <span className={styles.gLabel}>Amount chargeable (in words)</span>
          <b>{amountInWords(totals.total, cur)}</b>
        </div>
      )}

      {taxed && hsnRows.length > 0 && (
        <table className={styles.gHsn}>
          <thead>
            <tr>
              <th rowSpan={2} className={styles.left}>HSN/SAC</th>
              <th rowSpan={2}>Taxable value</th>
              {cgstSgst ? (
                <>
                  <th colSpan={2}>Central tax</th>
                  <th colSpan={2}>State tax</th>
                </>
              ) : (
                <th colSpan={2}>{invoice.gst_mode === 'SINGLE' ? 'Tax' : 'Integrated tax'}</th>
              )}
              <th rowSpan={2}>Total tax</th>
            </tr>
            <tr>
              <th>Rate</th>
              <th>Amount</th>
              {cgstSgst && (
                <>
                  <th>Rate</th>
                  <th>Amount</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {hsnRows.map((r) => (
              <tr key={`${r.hsn}-${r.rate}`}>
                <td className={styles.left}>{r.hsn}</td>
                <td>{money(r.taxable, cur)}</td>
                {cgstSgst ? (
                  <>
                    <td>{r.rate / 2}%</td>
                    <td>{money(r.cgst, cur)}</td>
                    <td>{r.rate / 2}%</td>
                    <td>{money(r.sgst, cur)}</td>
                  </>
                ) : (
                  <>
                    <td>{r.rate}%</td>
                    <td>{money(r.igst, cur)}</td>
                  </>
                )}
                <td>{money(r.tax, cur)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className={styles.left}>Total</td>
              <td>{money(totals.taxable_value, cur)}</td>
              {cgstSgst ? (
                <>
                  <td />
                  <td>{money(totals.cgst_amount, cur)}</td>
                  <td />
                  <td>{money(totals.sgst_amount, cur)}</td>
                </>
              ) : (
                <>
                  <td />
                  <td>{money(totals.igst_amount, cur)}</td>
                </>
              )}
              <td>{money(totals.tax_amount, cur)}</td>
            </tr>
          </tfoot>
        </table>
      )}

      {taxed && show.words && (
        <div className={styles.gWords}>
          <span className={styles.gLabel}>Tax amount (in words)</span>
          <b>{amountInWords(totals.tax_amount, cur)}</b>
        </div>
      )}

      <div className={cn(styles.gRow, styles.keepTogether)}>
        <div className={styles.gCell}>
          {bankLines && (
            <div className={styles.gBank}>
              <div>
                <div className={styles.gLabel}>Company&apos;s bank details</div>
                <div className={styles.payLines}>
                  {sender.accountName && <><strong>A/c holder:</strong> {sender.accountName}<br /></>}
                  {sender.bankName && <><strong>Bank:</strong> {sender.bankName}<br /></>}
                  {sender.accountNumber && <><strong>A/c no.:</strong> {sender.accountNumber}<br /></>}
                  {sender.ifsc && <><strong>IFS code:</strong> {sender.ifsc}<br /></>}
                  {sender.upiId && <><strong>UPI:</strong> {sender.upiId}</>}
                </div>
              </div>
              {show.qr && upiUrl && <QRCodeCanvas value={upiUrl} size={60} level="M" />}
            </div>
          )}
          {notes && (
            <div style={bankLines ? { marginTop: 8 } : undefined}>
              <div className={styles.gLabel}>Declaration / terms</div>
              <div className={styles.notesText}>{notes}</div>
            </div>
          )}
        </div>
        <div className={cn(styles.gCell, styles.gSign)}>
          <div className={styles.gLabel}>for {sender.companyName || 'the company'}</div>
          {show.signature && sender.signature ? (
            <img src={sender.signature} alt="Signature" className={styles.signatureImg} style={{ margin: '6px 0' }} />
          ) : (
            <div className={styles.gSignSpace} />
          )}
          <div className={styles.signatureLine} style={{ border: 'none', borderTop: '1px solid var(--tpl-ink)' }}>
            Authorised Signatory
          </div>
        </div>
      </div>

      <div className={styles.gFoot}>{footerText || 'This is a computer generated invoice'}</div>
    </div>
  );
}

import { cn, formatDate } from '../../../lib/utils';
import { formatPlaceOfSupply } from '../../../lib/india-states';
import { DOCUMENT_LABELS, type InvoiceRecord } from '../../../types/invoice';
import styles from '../invoice-paper.module.css';

interface PartyPanelProps {
  invoice: InvoiceRecord;
  /** Minimal/Swiss templates drop the panel background. */
  plain?: boolean;
}

function MetaRow({ label, value }: { label: string; value?: string }) {
  if (!value) return null;
  return (
    <>
      <span className={styles.metaKey}>{label}</span>
      <span className={styles.metaVal}>{value}</span>
    </>
  );
}

/** "Bill to" party plus the document's key dates and GST context. */
export function PartyPanel({ invoice, plain }: PartyPanelProps) {
  const c = invoice.client;
  const isQuote = invoice.doc_type === 'QUOTATION';
  const placeOfSupply = formatPlaceOfSupply(invoice.place_of_supply);
  const cityLine = [c.city, c.zip].filter(Boolean).join(' ');

  return (
    <section className={cn(plain ? styles.partiesPlain : styles.parties)}>
      <div>
        <div className={styles.eyebrow}>{isQuote ? 'Prepared for' : 'Bill to'}</div>
        <div className={styles.partyName}>{c.name || 'Client name'}</div>
        <div className={styles.meta}>
          {c.company && (
            <>
              {c.company}
              <br />
            </>
          )}
          {c.address && (
            <>
              {c.address.split('\n').map((line, i) => (
                <span key={i}>
                  {line}
                  <br />
                </span>
              ))}
            </>
          )}
          {cityLine && (
            <>
              {cityLine}
              <br />
            </>
          )}
          {c.state && (
            <>
              {c.state}
              <br />
            </>
          )}
          {c.email && (
            <>
              {c.email}
              <br />
            </>
          )}
          {c.phone && (
            <>
              {c.phone}
              <br />
            </>
          )}
          {c.gstin && (
            <>
              <span className={styles.metaLabel}>GSTIN:</span> {c.gstin}
            </>
          )}
        </div>
      </div>

      <div className={styles.metaGrid}>
        <MetaRow label={isQuote ? 'Quote date' : 'Issue date'} value={formatDate(invoice.issue_date)} />
        <MetaRow
          label={isQuote ? 'Valid until' : 'Due date'}
          value={formatDate(invoice.due_date)}
        />
        <MetaRow label="PO / Ref" value={invoice.po_number || undefined} />
        <MetaRow label="Place of supply" value={placeOfSupply || undefined} />
        <MetaRow label="Currency" value={invoice.currency} />
        {invoice.reverse_charge && <MetaRow label="Reverse charge" value="Yes" />}
        {invoice.doc_type !== 'INVOICE' && (
          <MetaRow label="Document" value={DOCUMENT_LABELS[invoice.doc_type]} />
        )}
      </div>
    </section>
  );
}

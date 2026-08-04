import { Fragment } from 'react';
import { cn } from '../../../lib/utils';
import { DOCUMENT_LABELS, type InvoiceRecord, type SenderProfile } from '../../../types/invoice';
import type { TemplateMetadata } from '../registry';
import styles from '../invoice-paper.module.css';

interface HeaderProps {
  invoice: InvoiceRecord;
  sender: SenderProfile;
  meta: TemplateMetadata;
}

function AddressLines({ sender }: { sender: SenderProfile }) {
  const lines = (sender.companyAddress ?? '').split('\n').filter(Boolean);
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {line}
          <br />
        </Fragment>
      ))}
    </>
  );
}

function SenderIdentity({ sender, align = 'right' }: { sender: SenderProfile; align?: 'left' | 'right' }) {
  return (
    <div style={{ textAlign: align, maxWidth: 260 }}>
      <div className={styles.orgName}>{sender.companyName || 'Your business name'}</div>
      {sender.companyTagline && <div className={styles.eyebrow}>{sender.companyTagline}</div>}
      <div className={styles.meta} style={{ marginTop: 6 }}>
        <AddressLines sender={sender} />
        {sender.companyPhone && (
          <>
            <span className={styles.metaLabel}>M:</span> {sender.companyPhone}
            <br />
          </>
        )}
        {sender.companyEmail && (
          <>
            {sender.companyEmail}
            <br />
          </>
        )}
        {sender.companyWebsite && (
          <>
            {sender.companyWebsite}
            <br />
          </>
        )}
        {sender.companyGstin && (
          <>
            <span className={styles.metaLabel}>GSTIN:</span> {sender.companyGstin}
            <br />
          </>
        )}
        {sender.pan && (
          <>
            <span className={styles.metaLabel}>PAN:</span> {sender.pan}
            <br />
          </>
        )}
        {sender.regLine && <>{sender.regLine}</>}
      </div>
    </div>
  );
}

/** The four header treatments the 20 templates are built from. */
export function PaperHeader({ invoice, sender, meta }: HeaderProps) {
  const title = DOCUMENT_LABELS[invoice.doc_type] ?? 'Invoice';
  const titleStyle = { fontFamily: meta.fontFamily };

  if (meta.layout === 'corporate') {
    return (
      <header className={styles.headBand}>
        <div>
          {sender.logo ? (
            <img src={sender.logo} alt="" className={styles.logo} />
          ) : (
            <div className={styles.orgName} style={{ ...titleStyle, fontSize: 26 }}>
              {sender.companyName || 'Your business name'}
            </div>
          )}
          {sender.companyTagline && (
            <div className={styles.eyebrow} style={{ marginTop: 6 }}>
              {sender.companyTagline}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className={styles.docTitle} style={{ ...titleStyle, fontSize: 34 }}>
            {title.toUpperCase()}
          </div>
          <div className={styles.docNumber}>#{invoice.invoice_number || 'DRAFT'}</div>
        </div>
      </header>
    );
  }

  if (meta.layout === 'minimal') {
    return (
      <header className={styles.headSwiss}>
        <div>
          <div className={styles.docTitle} style={{ ...titleStyle, fontSize: 27 }}>
            {title.toUpperCase()}
          </div>
          <div className={styles.docNumber}>NO. {invoice.invoice_number || 'DRAFT'}</div>
        </div>
        <div>{sender.logo && <img src={sender.logo} alt="" className={styles.logo} />}</div>
        <SenderIdentity sender={sender} />
      </header>
    );
  }

  if (meta.layout === 'centered') {
    return (
      <header className={styles.headCentered}>
        {sender.logo && <img src={sender.logo} alt="" className={styles.logo} />}
        <div className={styles.orgName} style={{ ...titleStyle, fontSize: 24 }}>
          {sender.companyName || 'Your business name'}
        </div>
        {sender.companyTagline && <div className={styles.eyebrow}>{sender.companyTagline}</div>}
        <div className={styles.meta}>
          <AddressLines sender={sender} />
          {sender.companyGstin && (
            <>
              <span className={styles.metaLabel}>GSTIN:</span> {sender.companyGstin}
            </>
          )}
        </div>
        <div className={styles.centeredRule}>
          {title.toUpperCase()} · {invoice.invoice_number || 'DRAFT'}
        </div>
      </header>
    );
  }

  return (
    <header className={cn(styles.headClassic)}>
      <div>
        {sender.logo && (
          <img src={sender.logo} alt="" className={styles.logo} style={{ marginBottom: 12 }} />
        )}
        <div className={styles.docTitle} style={titleStyle}>
          {title.toUpperCase()}
        </div>
        <div className={styles.docNumber}>#{invoice.invoice_number || 'DRAFT'}</div>
      </div>
      <SenderIdentity sender={sender} />
    </header>
  );
}

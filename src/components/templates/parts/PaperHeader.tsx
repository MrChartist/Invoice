import { Fragment, type CSSProperties } from 'react';
import { cn } from '../../../lib/utils';
import { DOCUMENT_LABELS, type InvoiceRecord, type SenderProfile } from '../../../types/invoice';
import type { TemplateMetadata } from '../registry';
import { DOC_TITLE_HI } from '../labels';
import { usePaper } from '../paper-context';
import styles from '../invoice-paper.module.css';

interface HeaderProps {
  invoice: InvoiceRecord;
  sender: SenderProfile;
  meta: TemplateMetadata;
}

export function AddressLines({ sender }: { sender: SenderProfile }) {
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

export function Logo({ src, style }: { src: string; style?: CSSProperties }) {
  const { logoSize } = usePaper();
  return (
    <img
      src={src}
      alt=""
      className={cn(styles.logo, logoSize === 's' && styles.logoS, logoSize === 'l' && styles.logoL)}
      style={style}
    />
  );
}

export function SenderIdentity({
  sender,
  align = 'right',
  hideName = false,
}: {
  sender: SenderProfile;
  align?: 'left' | 'right';
  hideName?: boolean;
}) {
  return (
    <div style={{ textAlign: align, maxWidth: 260 }}>
      {!hideName && <div className={styles.orgName}>{sender.companyName || 'Your business name'}</div>}
      {!hideName && sender.companyTagline && <div className={styles.eyebrow}>{sender.companyTagline}</div>}
      <div className={styles.meta} style={{ marginTop: hideName ? 0 : 6 }}>
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

function DocTitle({ invoice, style }: { invoice: InvoiceRecord; style?: CSSProperties }) {
  const { bilingual } = usePaper();
  const title = DOCUMENT_LABELS[invoice.doc_type] ?? 'Invoice';
  return (
    <>
      <div className={styles.docTitle} style={style}>
        {title.toUpperCase()}
      </div>
      {bilingual && <div className={styles.biTitle}>{DOC_TITLE_HI[invoice.doc_type]}</div>}
    </>
  );
}

/** Three account-summary cells printed under the letterhead (statement style). */
export function StatementStrip({ invoice, due }: { invoice: InvoiceRecord; due: string }) {
  const { t, date, currency } = usePaper();
  const isQuote = invoice.doc_type === 'QUOTATION';
  return (
    <div className={styles.statementStrip}>
      <div>
        <div className={styles.eyebrowMuted}>{isQuote ? t('quoteDate') : t('issueDate')}</div>
        <div className={styles.statementVal}>{date(invoice.issue_date)}</div>
      </div>
      <div>
        <div className={styles.eyebrowMuted}>{isQuote ? t('validUntil') : t('dueDate')}</div>
        <div className={styles.statementVal}>{date(invoice.due_date) || '—'}</div>
      </div>
      <div>
        <div className={styles.eyebrowMuted}>{t('balanceDue')}</div>
        <div className={cn(styles.statementVal, styles.statementDue)}>{due || currency(invoice.balance_due ?? 0, invoice.currency)}</div>
      </div>
    </div>
  );
}

/** The header treatments the templates are built from. */
export function PaperHeader({ invoice, sender, meta }: HeaderProps) {
  const { logoPosition, bilingual } = usePaper();
  const layout = meta.layout;
  const title = DOCUMENT_LABELS[invoice.doc_type] ?? 'Invoice';
  // The Ink skin sets its own serif title face in CSS; don't override it inline.
  const titleStyle = layout === 'ink' ? undefined : { fontFamily: meta.fontFamily };
  const number = invoice.invoice_number || 'DRAFT';

  const band = layout === 'corporate' || layout === 'ember';
  // An explicit logo position pulls the logo out into its own row above the header
  // (band headers keep it inside and just re-order).
  const detached = !!sender.logo && logoPosition !== 'auto' && !band;
  const logoInline = !!sender.logo && !detached;

  const header = (() => {
    if (layout === 'corporate') {
      return (
        <header className={styles.headBand} data-logopos={logoPosition}>
          <div>
            {logoInline && sender.logo ? (
              <Logo src={sender.logo} />
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
            {bilingual && <div className={styles.biTitle}>{DOC_TITLE_HI[invoice.doc_type]}</div>}
            <div className={styles.docNumber}>#{number}</div>
          </div>
        </header>
      );
    }

    if (layout === 'ember') {
      return (
        <header className={styles.headEmber} data-logopos={logoPosition}>
          <div>
            {logoInline && sender.logo ? (
              <Logo src={sender.logo} />
            ) : (
              <div className={styles.orgName} style={{ fontSize: 24 }}>
                {sender.companyName || 'Your business name'}
              </div>
            )}
            {sender.companyTagline && <div className={styles.emberTag}>{sender.companyTagline}</div>}
          </div>
          <div style={{ textAlign: 'right' }}>
            <div className={styles.docTitle} style={{ ...titleStyle, fontSize: 32 }}>
              {title.toUpperCase()}
            </div>
            <div className={styles.docNumber}>#{number}</div>
          </div>
        </header>
      );
    }

    if (layout === 'minimal') {
      return (
        <header className={styles.headSwiss}>
          <div>
            <DocTitle invoice={invoice} style={{ ...titleStyle, fontSize: 27 }} />
            <div className={styles.docNumber}>NO. {number}</div>
          </div>
          <div>{logoInline && sender.logo && <Logo src={sender.logo} />}</div>
          <SenderIdentity sender={sender} />
        </header>
      );
    }

    if (layout === 'centered') {
      return (
        <header className={styles.headCentered}>
          {logoInline && sender.logo && <Logo src={sender.logo} />}
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
            {title.toUpperCase()} · {number}
          </div>
        </header>
      );
    }

    if (layout === 'letterhead') {
      return (
        <>
          <header className={styles.headLetter}>
            <div className={styles.letterBrand}>
              {logoInline && sender.logo && <Logo src={sender.logo} />}
              <div className={styles.letterName}>{sender.companyName || 'Your business name'}</div>
              {sender.companyTagline && <div className={styles.eyebrow}>{sender.companyTagline}</div>}
            </div>
            <SenderIdentity sender={sender} hideName />
          </header>
          <div className={styles.letterTitle}>
            <span>{title}</span>
            <span className={styles.docNumber}>No. {number}</span>
          </div>
        </>
      );
    }

    // classic, ink, bilingual
    return (
      <header className={cn(styles.headClassic, layout === 'ink' && styles.headInk)}>
        <div>
          {logoInline && sender.logo && <Logo src={sender.logo} style={{ marginBottom: 12 }} />}
          <DocTitle invoice={invoice} style={titleStyle} />
          <div className={styles.docNumber}>#{number}</div>
        </div>
        <SenderIdentity sender={sender} />
      </header>
    );
  })();

  if (!detached || !sender.logo) return header;
  return (
    <>
      <div className={styles.logoRow} data-pos={logoPosition}>
        <Logo src={sender.logo} />
      </div>
      {header}
    </>
  );
}

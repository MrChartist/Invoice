import { lazy, Suspense, useMemo, type CSSProperties } from 'react';
import type { TemplateLayout, TemplateProps } from './registry';
import { templateById } from './registry';
import { PaperContext, buildPaperConfig } from './paper-context';
import { PaperHeader, StatementStrip } from './parts/PaperHeader';
import { PartyPanel } from './parts/PartyPanel';
import { CustomFieldsBlock } from './parts/CustomFieldsBlock';
import { PaperItemsTable } from './parts/PaperItemsTable';
import { ChallanQtyTable } from './parts/ChallanQtyTable';
import { NotesBlock, PaymentBlock, TaxSummary, TotalsBlock } from './parts/FooterBlocks';
import { GstBody } from './parts/GstBody';
import { ReceiptBody } from './parts/ReceiptBody';
import { StatusStamp } from './parts/StatusStamp';
import { IrnBlock } from './parts/IrnBlock';
import { SupplyDeclaration } from './parts/SupplyDeclaration';
import { CopyBanner } from './parts/CopyBanner';
import { TransportBlock } from './parts/TransportBlock';
import { PartyBalanceBlock } from './parts/PartyBalanceBlock';
import { PaymentScheduleBlock } from './parts/PaymentScheduleBlock'; // R2-A1
import { AcceptanceBlock } from './parts/AcceptanceBlock';
import { OptionalItemsBlock } from './parts/OptionalItemsBlock';
import { ProposalSections } from './parts/ProposalSections';
import { rcmTaxNote } from './paper-helpers';
import { supplyDeclaration } from '../../lib/bill-of-supply';
import { buildIrnPrint, resolveEInvoiceMeta } from '../../lib/einvoice-print';
import type { EInvoiceMeta } from '../../lib/einvoice';
import { DOCUMENT_LABELS } from '../../types/invoice';
import { cn, formatDate } from '../../lib/utils';
import { contrastText, marginVars, paperSize, printPageCss } from '../../lib/design-prefs';
import { PageArt } from './parts/PageArt'; // R3-C3
import styles from './invoice-paper.module.css';

// R3-C2: photo pages and the receiver signature load only for documents that carry them.
const LazyPhotoPages = lazy(() => import('./parts/PhotoPages'));
const LazyDeliveryProof = lazy(() => import('./parts/DeliveryProofBlock'));

export interface TemplateEngineProps extends TemplateProps {
  templateId: string;
  /**
   * Emit a `@page` rule matching the paper size. Leave off for previews; turn
   * on for the single instance that is actually printed.
   */
  pageRule?: boolean;
  /**
   * IRP details to print (IRN, Ack, signed QR, e-Way no). Omit to look them up by
   * `invoice.id` in `einvoice_meta`; pass `null` to print none (e.g. a draft preview).
   */
  einvoiceMeta?: EInvoiceMeta | null;
  /**
   * Copy banner text ("Original for Recipient" …, see `src/lib/print-copies.ts`). Omit or '' for
   * the legacy single paper with no banner.
   */
  copyLabel?: string;
}

const SKIN: Partial<Record<TemplateLayout, string | undefined>> = {
  classic: styles.frameRail,
  corporate: styles.bordered,
  ink: styles.skinInk,
  ember: styles.skinEmber,
  letterhead: styles.skinLetter,
  bilingual: styles.skinBi,
  gst: styles.skinGst,
  receipt: styles.skinReceipt,
};

/**
 * Renders one invoice/quotation onto its paper, skinned per the chosen template.
 * Without `design` the output is the template's native A4 look; with it, the
 * user's preferences (accent, font, columns, paper, density, …) are applied.
 */
export function TemplateEngine({ invoice, sender, totals, templateId, design, pageRule, einvoiceMeta, copyLabel }: TemplateEngineProps) {
  const meta = templateById(templateId);
  const layout: TemplateLayout = design?.paper === 'thermal80' ? 'receipt' : meta.layout;
  const cfg = useMemo(() => buildPaperConfig(design, layout, layout === 'bilingual'), [design, layout]);
  const effMeta = layout === meta.layout ? meta : { ...meta, layout };

  const accent = design?.accent ?? meta.accent;
  // Hindi text (bilingual labels, Devanagari item names) always uses the self-hosted Noto Sans
  // Devanagari, so the PDF looks the same on every device; its unicode-range leaves Latin alone.
  const fontFamily = `'Noto Sans Devanagari', ${cfg.fontOverride ?? meta.fontFamily}`;
  const size = paperSize(design);
  const plainParties = layout === 'minimal' || layout === 'ink' || layout === 'letterhead';

  const outerStyle = { '--tpl-accent': accent, fontFamily } as CSSProperties & Record<string, string | number>;
  if (design?.accent) outerStyle['--tpl-on-accent'] = contrastText(design.accent);
  Object.assign(outerStyle, marginVars(design)); // R3-C3 page margins (nothing without them)
  if (design && design.paper !== 'A4') {
    outerStyle.width = size.width;
    outerStyle.minHeight = size.autoHeight ? 0 : size.height;
  }

  const outerClass = cn(styles.paper, SKIN[layout]);
  // Pre-printed stationery (P2): the letterhead is already on the sheet; leave room for it.
  const preprinted = design?.preprinted?.on ? design.preprinted : null;
  const dataAttrs = design
    ? {
        'data-paper': design.paper.toLowerCase(),
        'data-density': design.density,
        ...(preprinted ? { 'data-preprinted': '' } : {}),
      }
    : undefined;
  const innerStyle: CSSProperties | undefined = preprinted
    ? { paddingTop: `calc(var(--tpl-pt) + ${preprinted.top_mm}mm)`, paddingLeft: `calc(var(--tpl-px) + ${preprinted.left_mm}mm)` }
    : undefined;

  // Read from the document's own sender snapshot first (Critical Rule 3), like the rest of the paper.
  const declaration = supplyDeclaration(invoice, invoice.sender ?? sender);

  // Rule 46(p): tax payable on reverse charge, printed once under every layout (new-style RCM documents).
  const rcmNote = rcmTaxNote(totals, (n) => cfg.currency(n, invoice.currency));

  const irn = buildIrnPrint(einvoiceMeta === undefined ? resolveEInvoiceMeta(invoice.id) : einvoiceMeta);

  const showInitials = !preprinted && (layout === 'corporate' || layout === 'centered') && sender.companyName;

  // 8H delivery challan toggles: print without amounts; mark a returnable challan.
  const challan = invoice.doc_type === 'DELIVERY_CHALLAN';
  const hideAmounts = challan && !!invoice.challan_hide_amounts;
  const returnNote = challan && invoice.challan_returnable
    ? `Returnable delivery challan — not a sale. Goods to be returned${invoice.challan_return_by ? ` by ${formatDate(invoice.challan_return_by)}` : ''}.`
    : '';

  const layoutBody = (() => {
    // R2-B3: proposal sections and optional items wrap the ruled GST grid / the receipt.
    if ((layout === 'gst' || layout === 'receipt') && !hideAmounts) {
      return (
        <>
          <ProposalSections invoice={invoice} place="before" />
          {layout === 'gst' ? <GstBody invoice={invoice} sender={sender} totals={totals} skipEway={irn?.ewayNo} /> : <ReceiptBody invoice={invoice} sender={sender} totals={totals} />}
          <OptionalItemsBlock invoice={invoice} />
          <ProposalSections invoice={invoice} place="after" />
        </>
      );
    }
    return (
      <>
        {preprinted ? (
          <div className={styles.preHead}>
            <strong>{DOCUMENT_LABELS[invoice.doc_type] ?? 'Invoice'}</strong>
            <span>{invoice.invoice_number || 'DRAFT'}</span>
          </div>
        ) : (
          <PaperHeader invoice={invoice} sender={sender} meta={effMeta} />
        )}
        {cfg.headerNote && <div className={styles.headerNote}>{cfg.headerNote}</div>}
        {layout === 'letterhead' && !hideAmounts && (
          <StatementStrip invoice={invoice} due={cfg.currency(totals.balance_due, invoice.currency)} />
        )}
        <PartyPanel invoice={invoice} plain={plainParties} skipDates={layout === 'letterhead'} />
        <CustomFieldsBlock invoice={invoice} />
        <TransportBlock invoice={invoice} skipEway={irn?.ewayNo} />
        <ProposalSections invoice={invoice} place="before" />
        {hideAmounts ? <ChallanQtyTable invoice={invoice} /> : <PaperItemsTable invoice={invoice} totals={totals} tableStyle={effMeta.tableStyle} />}
        {!hideAmounts && <TaxSummary invoice={invoice} totals={totals} />}
        <OptionalItemsBlock invoice={invoice} />
        <ProposalSections invoice={invoice} place="after" />

        <div className={cn(styles.footer, styles.keepTogether)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {!hideAmounts && <PaymentBlock sender={sender} />}
            <NotesBlock invoice={invoice} />
          </div>
          {!hideAmounts && <TotalsBlock invoice={invoice} sender={sender} totals={totals} />}
        </div>

        {layout === 'letterhead' && (
          <div className={styles.letterFoot}>
            {[sender.companyName, sender.companyPhone, sender.companyEmail, sender.companyWebsite, sender.regLine]
              .filter(Boolean)
              .join('  ·  ')}
          </div>
        )}
        {cfg.footerText && (
          <div className={styles.strip} style={{ justifyContent: 'center', textAlign: 'center' }}>
            <span>{cfg.footerText}</span>
          </div>
        )}
      </>
    );
  })();

  // R2-B3: a quotation's proposal cover comes before the header of every layout.
  const body = (
    <>
      <ProposalSections invoice={invoice} place="cover" />
      {layoutBody}
    </>
  );

  return (
    <PaperContext.Provider value={cfg}>
      {pageRule && <style>{printPageCss(design)}</style>}
      <div className={outerClass} style={outerStyle} {...dataAttrs}>
        {showInitials && <div className={styles.watermark}>{sender.companyName.substring(0, 2).toUpperCase()}</div>}
        <StatusStamp invoice={invoice} />
        <PageArt />
        <div className={styles.inner} style={innerStyle}>
          <CopyBanner label={copyLabel} />
          {body}
          {irn && <IrnBlock model={irn} />}
          {declaration && <SupplyDeclaration text={declaration} />}
          {rcmNote && <SupplyDeclaration text={rcmNote} />}
          {returnNote && <SupplyDeclaration text={returnNote} />}
          {/* 8.5: "Previous balance + This bill = Total due" from the bill's own snapshot (off by default). */}
          <PartyBalanceBlock invoice={invoice} compact={layout === 'receipt'} />
          <PaymentScheduleBlock invoice={invoice} compact={layout === 'receipt'} />
          {/* 8G: payment schedule + quote acceptance snapshot (from the document only). */}
          <AcceptanceBlock invoice={invoice} compact={layout === 'receipt'} />
          {/* R3-C2: receiver signature ("Received by") right after the signature / acceptance block. */}
          {invoice.delivery_proof && <Suspense fallback={null}><LazyDeliveryProof invoice={invoice} compact={layout === 'receipt'} /></Suspense>}
          {/* R3-C2: photo pages after the totals / annexure (2 × 2 per page). */}
          {invoice.attachments?.some((a) => a.print) && <Suspense fallback={null}><LazyPhotoPages invoice={invoice} /></Suspense>}
        </div>
      </div>
    </PaperContext.Provider>
  );
}

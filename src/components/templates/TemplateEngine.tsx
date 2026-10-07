import { useMemo, type CSSProperties } from 'react';
import type { TemplateLayout, TemplateProps } from './registry';
import { templateById } from './registry';
import { PaperContext, buildPaperConfig } from './paper-context';
import { PaperHeader, StatementStrip } from './parts/PaperHeader';
import { PartyPanel } from './parts/PartyPanel';
import { PaperItemsTable } from './parts/PaperItemsTable';
import { NotesBlock, PaymentBlock, TaxSummary, TotalsBlock } from './parts/FooterBlocks';
import { GstBody } from './parts/GstBody';
import { ReceiptBody } from './parts/ReceiptBody';
import { StatusStamp } from './parts/StatusStamp';
import { cn } from '../../lib/utils';
import { contrastText, paperSize, printPageCss } from '../../lib/design-prefs';
import styles from './invoice-paper.module.css';

export interface TemplateEngineProps extends TemplateProps {
  templateId: string;
  /**
   * Emit a `@page` rule matching the paper size. Leave off for previews; turn
   * on for the single instance that is actually printed.
   */
  pageRule?: boolean;
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
export function TemplateEngine({ invoice, sender, totals, templateId, design, pageRule }: TemplateEngineProps) {
  const meta = templateById(templateId);
  const layout: TemplateLayout = design?.paper === 'thermal80' ? 'receipt' : meta.layout;
  const cfg = useMemo(() => buildPaperConfig(design, layout, layout === 'bilingual'), [design, layout]);
  const effMeta = layout === meta.layout ? meta : { ...meta, layout };

  const accent = design?.accent ?? meta.accent;
  const fontFamily = cfg.fontOverride ?? meta.fontFamily;
  const size = paperSize(design);
  const plainParties = layout === 'minimal' || layout === 'ink' || layout === 'letterhead';

  const outerStyle = { '--tpl-accent': accent, fontFamily } as CSSProperties & Record<string, string | number>;
  if (design?.accent) outerStyle['--tpl-on-accent'] = contrastText(design.accent);
  if (design && design.paper !== 'A4') {
    outerStyle.width = size.width;
    outerStyle.minHeight = size.autoHeight ? 0 : size.height;
  }

  const outerClass = cn(styles.paper, SKIN[layout]);
  const dataAttrs = design
    ? { 'data-paper': design.paper.toLowerCase(), 'data-density': design.density }
    : undefined;

  const showInitials = (layout === 'corporate' || layout === 'centered') && sender.companyName;

  const body = (() => {
    if (layout === 'gst') return <GstBody invoice={invoice} sender={sender} totals={totals} />;
    if (layout === 'receipt') return <ReceiptBody invoice={invoice} sender={sender} totals={totals} />;
    return (
      <>
        <PaperHeader invoice={invoice} sender={sender} meta={effMeta} />
        {cfg.headerNote && <div className={styles.headerNote}>{cfg.headerNote}</div>}
        {layout === 'letterhead' && (
          <StatementStrip invoice={invoice} due={cfg.currency(totals.balance_due, invoice.currency)} />
        )}
        <PartyPanel invoice={invoice} plain={plainParties} skipDates={layout === 'letterhead'} />
        <PaperItemsTable invoice={invoice} totals={totals} tableStyle={effMeta.tableStyle} />
        <TaxSummary invoice={invoice} totals={totals} />

        <div className={cn(styles.footer, styles.keepTogether)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <PaymentBlock sender={sender} />
            <NotesBlock invoice={invoice} />
          </div>
          <TotalsBlock invoice={invoice} sender={sender} totals={totals} />
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

  return (
    <PaperContext.Provider value={cfg}>
      {pageRule && <style>{printPageCss(design)}</style>}
      <div className={outerClass} style={outerStyle} {...dataAttrs}>
        {showInitials && <div className={styles.watermark}>{sender.companyName.substring(0, 2).toUpperCase()}</div>}
        <StatusStamp invoice={invoice} />
        <div className={styles.inner}>{body}</div>
      </div>
    </PaperContext.Provider>
  );
}

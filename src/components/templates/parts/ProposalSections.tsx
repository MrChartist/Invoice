import type { InvoiceRecord } from '../../../types/invoice';
import type { SectionPlace } from '../../../types/sales-r2';
import { sectionsAt } from '../../../lib/proposal-sections';
import { getAttachment, isImageMime } from '../../../lib/attachments';
import { cn } from '../../../lib/utils';
import styles from './sales-r2-paper.module.css';

/** Only image attachments stored on this device, as a data URL (never a remote URL). */
function imageOf(id: string | undefined): string {
  if (!id) return '';
  const a = getAttachment(id);
  return a && isImageMime(a.mime) && /^data:image\//.test(a.data) ? a.data : '';
}

/**
 * R2-B3: proposal sections of a quotation at one place — the cover (before the header), before the
 * items or after them. Plain text keeps its line breaks; the optional image is an attachment of the
 * same document. Accent variable only.
 */
export function ProposalSections({ invoice, place }: { invoice: InvoiceRecord; place: SectionPlace }) {
  const list = sectionsAt(invoice, place);
  if (!list.length) return null;
  return (
    <section className={cn(styles.sections, place === 'cover' && styles.cover)} data-proposal={place}>
      {list.map((s) => {
        const img = imageOf(s.attachment_id);
        return (
          <div key={s.id} className={styles.section}>
            {s.title && <div className={styles.sectionTitle}>{s.title}</div>}
            {s.body && <div className={styles.sectionBody}>{s.body}</div>}
            {img && <img className={styles.sectionImg} src={img} alt={s.title || 'Proposal image'} />}
          </div>
        );
      })}
    </section>
  );
}

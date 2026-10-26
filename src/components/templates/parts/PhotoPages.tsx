import type { InvoiceRecord } from '../../../types/invoice';
import { getAttachment } from '../../../lib/attachments';
import { photoPages, printablePhotos, sanitizePrint } from '../../../lib/doc-evidence';
import styles from './docs-r3-pages.module.css';

const GROUP_LABEL = { before: 'Before', after: 'After', other: 'Photo' } as const;

/**
 * R3-C2 photo pages: image attachments marked "Print on document", after the totals, a 2 × 2 grid per
 * page with captions (Before → After → Other, at most 12). Lazy inside TemplateEngine; renders nothing
 * without marked photos. Printed labels stay English like the other paper labels.
 */
export default function PhotoPages({ invoice }: { invoice: InvoiceRecord }) {
  const photos = printablePhotos(invoice.attachments)
    .map((ref) => ({ ref, data: getAttachment(ref.id)?.data ?? '' }))
    .filter((p) => p.data.startsWith('data:image/'));
  if (!photos.length) return null;
  return (
    <section className={styles.photos} aria-label="Photos" data-photo-pages>
      <p className={styles.photosHead}>Photos · {invoice.invoice_number || 'Draft'}</p>
      {photoPages(photos).map((page, i) => (
        <div key={i} className={styles.photoGrid}>
          {page.map(({ ref, data }) => {
            const print = sanitizePrint(ref.print);
            return (
              <figure key={ref.id} className={styles.photo}>
                <img src={data} alt={print?.caption || ref.name} />
                <figcaption>
                  <span className={styles.group}>{GROUP_LABEL[print?.group ?? 'other']}</span>
                  {print?.caption ?? ''}
                </figcaption>
              </figure>
            );
          })}
        </div>
      ))}
    </section>
  );
}

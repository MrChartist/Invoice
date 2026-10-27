/**
 * R11 placeholder for the builder desk (Receivables → Realty) until CN-C merges `RealtyDesk` and replaces this lazy
 * target. Renders one line, so the builder profile's landing URL always opens. (CN-B / CN-D may use it for a view too.)
 */
import { useT } from '../../i18n';
import { defineArea } from '../../i18n/area';

const stubT = defineArea(
  { stub: 'This desk arrives with the next construction update. RA bills, BOQs and the works paper already work under Time → Works.' } as const,
  { stub: 'यह डेस्क अगले निर्माण अपडेट में आएगा। रनिंग बिल, BOQ और वर्क्स पेपर समय → वर्क्स में पहले से काम करते हैं।' },
);

export default function R11Stub({ title }: { title: string }) {
  useT();
  return (
    <section data-r11-stub>
      <h3>{title}</h3>
      <p>{stubT('stub')}</p>
    </section>
  );
}

/**
 * R11 placeholder for a Works view (CN-B / CN-D) or the builder desk (CN-C) whose package has not merged yet: the
 * owning package replaces the lazy target. Renders one line, so a profile's landing URL always opens.
 */
import { useT } from '../../i18n';
import { cnT } from '../../i18n/areas/construction-r11a';

export default function R11Stub({ title }: { title: string }) {
  useT();
  return (
    <section data-r11-stub>
      <h3>{title}</h3>
      <p>{cnT('stub')}</p>
    </section>
  );
}

import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { RECORD_KEYS, useInvoiceStore } from '../../store/useInvoiceStore';
import { pick } from '../../store/pick';
import { TemplateEngine } from '../templates/TemplateEngine';
import { designForDoc, paperSize, resolve as resolveDesign } from '../../lib/design-prefs';
import { blankProfile, localDb } from '../../lib/localDb';
import type { InvoiceRecord } from '../../types/invoice';
import { useT } from '../../i18n';
import { d3T } from '../../i18n/areas/docs-r3';
import paper from '../templates/invoice-paper.module.css';
import styles from './LivePreviewPane.module.css';

const KEYS = [...RECORD_KEYS, 'totals'] as const;
/** Same as `DEBOUNCE_MS` (editor-layout.ts), kept local so that module stays inside the editor chunk. */
const DEBOUNCE_MS = 250;
type PreviewSection = 'party' | 'items' | 'totals' | 'notes';

/** Which form section a click on the paper belongs to (party block, items table, totals, notes). */
function blockOf(target: Element | null): PreviewSection | null {
  if (!target) return null;
  if (target.closest(`.${paper.parties}, .${paper.partiesPlain}`)) return 'party';
  if (target.closest(`.${paper.totals}`)) return 'totals';
  if (target.closest('table')) return 'items';
  if (target.closest(`.${paper.boxSoft}`)) return 'notes';
  return null;
}

/**
 * R3-C1 live paper beside the editor form (≥ 1280 px). Read-only: it renders `TemplateEngine` with the
 * resolved design at fit-to-width scale from the store (shallow selector), deferred with
 * `useDeferredValue` plus a 250 ms idle debounce so typing stays fast. Clicking the party block, the
 * items, the totals or the notes scrolls to and focuses that part of the form.
 */
export default function LivePreviewPane() {
  useT();
  const live = useInvoiceStore(useShallow((st) => pick(st, KEYS)));
  const deferred = useDeferredValue(live);
  const [shown, setShown] = useState(deferred);
  useEffect(() => {
    const t = setTimeout(() => setShown(deferred), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [deferred]);

  const sender = useMemo(() => shown.sender ?? localDb.settings.activeProfile() ?? blankProfile(), [shown.sender]);
  const design = useMemo(() => designForDoc(resolveDesign(sender.id), shown.doc_type), [sender.id, shown.doc_type]);
  const width = paperSize(design).width;

  const box = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 0.5, height: 600 });
  useLayoutEffect(() => {
    const host = box.current;
    const sheet = inner.current;
    if (!host || !sheet || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const scale = Math.min(1, Math.max(0.2, host.clientWidth / width));
      setFit({ scale, height: sheet.offsetHeight * scale });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    ro.observe(sheet);
    return () => ro.disconnect();
  }, [width]);

  const rendered = useMemo(
    () => (
      <TemplateEngine
        invoice={shown as unknown as InvoiceRecord}
        sender={sender}
        totals={shown.totals}
        templateId={shown.template_id}
        design={design}
        einvoiceMeta={shown.id ? undefined : null}
      />
    ),
    [shown, sender, design],
  );

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const section = blockOf(e.target as Element);
    if (!section) return;
    const card = document.querySelector<HTMLElement>(`[data-r3c-section="${section}"]`);
    if (!card) return;
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    card.querySelector<HTMLElement>('input:not([type=hidden]):not(:disabled), textarea:not(:disabled), select:not(:disabled)')?.focus({ preventScroll: true });
  };

  return (
    <aside className={styles.pane} aria-label={d3T('lp.aria')} data-live-preview>
      <div className={styles.head}>
        <span>{d3T('lp.title')}</span>
        <span className={styles.hint}>{d3T('lp.hint')}</span>
      </div>
      <div ref={box} className={styles.box} style={{ height: fit.height }}>
        <div ref={inner} className={styles.sheet} style={{ width, transform: `scale(${fit.scale})` }} onClick={onClick} aria-hidden="true">
          {rendered}
        </div>
      </div>
    </aside>
  );
}

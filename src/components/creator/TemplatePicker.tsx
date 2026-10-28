import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';
import { TEMPLATES, TEMPLATE_CATEGORIES } from '../templates/registry';
import { RECORD_KEYS, useInvoiceStore } from '../../store/useInvoiceStore';
import { cn } from '../../lib/utils';
import { draftHasContent, draftHash, lowEndDevice } from '../../lib/editor-layout';
import type { InvoiceRecord } from '../../types/invoice';
import { useT } from '../../i18n';
import { edT } from '../../i18n/areas/editor';
import styles from './TemplatePicker.module.css';

// R3-C1: live tiles render the draft in each template (lazy; static tiles on low-end devices).
const TemplateThumb = lazy(() => import('./TemplateThumb'));
const THUMB_IDLE_MS = 800;

function useLiveTiles(): boolean {
  const [on] = useState(() => {
    try {
      return typeof IntersectionObserver !== 'undefined'
        && !lowEndDevice(navigator.hardwareConcurrency, !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
    } catch {
      return false;
    }
  });
  return on;
}

/** The draft, snapshotted after the user stops typing (so tiles never re-render per keystroke). */
function useIdleDraft(enabled: boolean): { draft: InvoiceRecord | null; hash: string } {
  const snap = () => {
    const st = useInvoiceStore.getState();
    const draft = Object.fromEntries(RECORD_KEYS.map((k) => [k, st[k]])) as unknown as InvoiceRecord;
    return { draft, hash: draftHash([draft.client?.name, draft.items, draft.doc_type, draft.invoice_number, draft.gst_mode, draft.sender?.companyName, draft.notes]) };
  };
  const [state, setState] = useState<{ draft: InvoiceRecord | null; hash: string }>(() => (enabled ? snap() : { draft: null, hash: '' }));
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsub = useInvoiceStore.subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(() => setState((prev) => {
        const next = snap();
        return next.hash === prev.hash ? prev : next;
      }), THUMB_IDLE_MS);
    });
    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, [enabled]);
  return state;
}

/** Renders `children` once the tile scrolls into view (and keeps it). */
function InView({ children, fallback }: { children: React.ReactNode; fallback: React.ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setSeen(true);
        io.disconnect();
      }
    }, { rootMargin: '120px' });
    io.observe(el);
    return () => io.disconnect();
  }, [seen]);
  return <span ref={ref} className={styles.slot}>{seen ? children : fallback}</span>;
}

/** Gallery grouped by category: live tiles of the draft in each template (static tiles on low-end devices). */
export function TemplatePicker() {
  useT(); // re-render on a language switch (5.4)
  const templateId = useInvoiceStore((s) => s.template_id);
  const setTemplate = useInvoiceStore((s) => s.setTemplate);
  const live = useLiveTiles();
  const { draft, hash } = useIdleDraft(live);

  return (
    <div className={styles.wrap} role="radiogroup" aria-label={edT('tpAria')} data-live-tiles={live ? '' : undefined}>
      {TEMPLATE_CATEGORIES.map((category) => (
        <div key={category}>
          <div className={styles.cat}>{category}</div>
          <div className={styles.grid}>
            {TEMPLATES.filter((t) => t.category === category).map((t) => {
              const active = t.id === templateId;
              const staticThumb = (
                <span className={styles.thumb} style={{ '--accent-c': t.accent } as React.CSSProperties}>
                  <i />
                  <i />
                  <i />
                </span>
              );
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={cn(styles.tile, active && styles.active)}
                  onClick={() => setTemplate(t.id)}
                  title={t.description}
                >
                  {live ? (
                    <InView fallback={staticThumb}>
                      <Suspense fallback={staticThumb}>
                        <TemplateThumb templateId={t.id} draft={draft && draftHasContent(draft) ? draft : null} sender={draft?.sender ?? null} hash={hash} />
                      </Suspense>
                    </InView>
                  ) : staticThumb}
                  <span className={styles.name}>{t.name}</span>
                  {active && <Check size={13} className={styles.check} />}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

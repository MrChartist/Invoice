/**
 * R6-A3 glossary term: `<Term id="b2cl">B2CL</Term>` renders the text with a dotted underline; a tap or keyboard
 * focus + Enter opens a small popover (definition, "in this app", CA checklist ids). The glossary is its own chunk,
 * loaded on the first open. Lives inside the GST / TDS / payroll route chunks.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { getLanguage, useT } from '../../i18n';
import { helpT } from '../../i18n/areas/help-r6';
import type { GlossaryId, GlossaryTerm } from '../../lib/help/glossary';
import styles from './help.module.css';

let glossary: Promise<Readonly<Record<string, GlossaryTerm>>> | null = null;
const loadGlossary = () => (glossary ??= import('../../lib/help/glossary').then((m) => m.GLOSSARY));

export function Term({ id, children }: { id: GlossaryId; children: ReactNode }) {
  useT();
  const [open, setOpen] = useState(false);
  const [entry, setEntry] = useState<GlossaryTerm | null>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const popId = useId();

  useEffect(() => {
    if (!open) return;
    let alive = true;
    loadGlossary().then((g) => alive && setEntry(g[id] ?? null), () => undefined);
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      alive = false;
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, id]);

  const text = entry ? (getLanguage() === 'hi' ? entry.hi : entry.en) : null;
  return (
    <span className={styles.termWrap} ref={wrap}>
      <button
        type="button"
        className={styles.term}
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        data-term={id}
      >
        {children}
      </button>
      {open && (
        <span className={styles.pop} id={popId} role="dialog" aria-label={entry?.term ?? String(id)} data-term-pop={id}>
          {!text ? (
            <span>{helpT('termLoading')}</span>
          ) : (
            <>
              <span className={styles.popHead}>
                <span>{entry!.term}</span>
                <button type="button" className={styles.term} onClick={() => setOpen(false)}>{helpT('termClose')}</button>
              </span>
              <span>{text.def}</span>
              <span><strong>{helpT('termIn')}:</strong> {text.app}</span>
              {entry!.caItems?.length ? <span className={styles.muted}>{helpT('caItems', { ids: entry!.caItems.join(', ') })}</span> : null}
            </>
          )}
        </span>
      )}
    </span>
  );
}

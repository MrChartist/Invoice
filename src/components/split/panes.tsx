import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, Eye, Pencil, X } from 'lucide-react';
import { TemplateEngine } from '../templates/TemplateEngine';
import { designForDoc, paperSize, resolve as resolveDesign } from '../../lib/design-prefs';
import { calcInputFromRecord, calculateInvoice } from '../../lib/invoice-calc';
import { blankProfile, localDb } from '../../lib/localDb';
import { formatCurrency, formatDate } from '../../lib/utils';
import { splitT } from '../../i18n/areas/split-pl';
import type { InvoiceRecord } from '../../types/invoice';
import split from '../ui/SplitView.module.css';
import styles from './inspector.module.css';

/* Package PL: the lazy half of SplitView (pane chrome + resize) and the Invoices detail pane. */

/** The detail pane of a SplitView: Back (narrow) / close (wide), and a resize handle on pointer devices. */
export function SplitPane({ label, onClose, children }: { id: string; label: string; onClose: () => void; children: ReactNode }) {
  const handle = useRef<HTMLDivElement>(null);
  const [pct, setPct] = useState(50);
  useEffect(() => {
    handle.current?.parentElement?.style.setProperty('--split-w', `${pct}%`);
  }, [pct]);
  const set = (v: number) => setPct(Math.round(Math.min(70, Math.max(30, v))));
  const drag = (e: PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.parentElement?.getBoundingClientRect();
    if (box && e.currentTarget.hasPointerCapture(e.pointerId)) set(((e.clientX - box.left) / box.width) * 100);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowLeft' ? -5 : e.key === 'ArrowRight' ? 5 : 0;
    if (!step) return;
    e.preventDefault();
    set(pct + step);
  };
  return (
    <>
      <div
        ref={handle}
        className={split.handle}
        role="separator"
        aria-orientation="vertical"
        aria-label={splitT('resize')}
        aria-valuenow={pct}
        aria-valuemin={30}
        aria-valuemax={70}
        tabIndex={0}
        onPointerDown={(e) => e.currentTarget.setPointerCapture(e.pointerId)}
        onPointerMove={drag}
        onKeyDown={key}
      />
      <section className={split.detail} aria-label={label} data-split-detail>
        <div className={split.bar}>
          <button type="button" className={split.back} onClick={onClose}>
            <ChevronLeft size={16} aria-hidden="true" /> {splitT('back')}
          </button>
          <button type="button" className={split.close} onClick={onClose} aria-label={splitT('closePane')} title={splitT('closePane')}>
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        {children}
      </section>
    </>
  );
}

/** Invoices: the saved document as it prints (its own sender snapshot, AGENTS.md rule 3), its figures and actions. */
export function InvoiceInspector({ invoice, due, status, onPreview }: { invoice: InvoiceRecord; due: number | null; status: ReactNode; onPreview: () => void }) {
  const sender = invoice.sender ?? localDb.settings.activeProfile() ?? blankProfile();
  const design = useMemo(() => designForDoc(resolveDesign(sender.id), invoice.doc_type), [sender.id, invoice.doc_type]);
  const totals = useMemo(() => calculateInvoice(calcInputFromRecord(invoice)), [invoice]);
  const width = paperSize(design).width;
  const box = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState({ scale: 0.4, height: 480 });
  useLayoutEffect(() => {
    const host = box.current;
    const paper = sheet.current;
    if (!host || !paper || typeof ResizeObserver === 'undefined') return;
    const measure = () => {
      const scale = Math.min(1, Math.max(0.2, host.clientWidth / width));
      setFit({ scale, height: paper.offsetHeight * scale });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(host);
    ro.observe(paper);
    return () => ro.disconnect();
  }, [width, invoice.id]);

  return (
    <div className={styles.wrap} data-invoice-inspector={invoice.id}>
      <div className={styles.head}>
        <div className={styles.title}>
          <strong className={styles.id}>{invoice.invoice_number || '-'}</strong>
          <span className={styles.sub}>{invoice.client?.name || '-'}</span>
          <span className={styles.sub}>{[formatDate(invoice.issue_date), formatDate(invoice.due_date)].filter(Boolean).join(' · ')}</span>
        </div>
        {status}
      </div>
      <dl className={styles.facts}>
        <div>
          <dt>{splitT('total')}</dt>
          <dd>{formatCurrency(invoice.total, invoice.currency)}</dd>
        </div>
        {due != null && (
          <div>
            <dt>{splitT('balance')}</dt>
            <dd>{formatCurrency(due, invoice.currency)}</dd>
          </div>
        )}
      </dl>
      <div className={styles.actions}>
        <Link to={`/invoice/${invoice.id}`} className="btn sm">
          <Pencil size={16} aria-hidden="true" /> {splitT('open')}
        </Link>
        <button type="button" className="btn quiet sm" onClick={onPreview}>
          <Eye size={16} aria-hidden="true" /> {splitT('preview')}
        </button>
      </div>
      <div ref={box} className={styles.paper} style={{ height: fit.height }} aria-hidden="true">
        <div ref={sheet} className={styles.sheet} style={{ width, transform: `scale(${fit.scale})` }}>
          <TemplateEngine invoice={invoice} sender={sender} totals={totals} templateId={invoice.template_id} design={design} />
        </div>
      </div>
    </div>
  );
}

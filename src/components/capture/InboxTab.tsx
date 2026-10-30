/**
 * Expenses → Inbox (8.40 / 8.41 / 8.43): capture supplier bills from the e-invoice QR (camera, photo or
 * pasted text), the unprocessed-documents inbox, draft bills (captured, recurring, held for approval)
 * and the recurring-bill schedules. Lazy chunk; nothing here posts to the books — "Post" opens the
 * normal bill / expense form, whose save runs the duplicate guard and the approval gate.
 */
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Camera, ClipboardPaste, FileUp, Inbox, Trash2 } from 'lucide-react';
import type { PurchaseRecord } from '../../types/purchases';
import { cameraScanSupported } from '../scan/camera';
import { MAX_JSON_TEXT } from '../../lib/einvoice-qr';
import { captureFromQrText, INBOX_CHANGED_EVENT, openCaptureFromFile } from '../../lib/capture-browser';
import { inboxDb, type InboxDoc } from '../../lib/doc-inbox';
import { billOfDraft, draftsDb, type PurchaseDraft } from '../../lib/purchase-drafts';
import { runDueBillSchedules } from '../../lib/recurring-bills';
import { vendorsDb } from '../../lib/vendors';
import { openAttachment } from '../../lib/attachment-upload';
import { ATTACHMENT_ACCEPT } from '../../lib/attachments';
import { can } from '../../lib/access';
import { getTable } from '../../lib/storage';
import { cn, formatCurrency, formatDate, todayInput } from '../../lib/utils';
import { useT } from '../../i18n';
import { capT } from '../../i18n/areas/capture';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import css from './capture.module.css';

const CameraScanner = lazy(() => import('../scan/CameraScanner').then((m) => ({ default: m.CameraScanner })));
const RecurringBillsPanel = lazy(() => import('./RecurringBillsPanel'));
const PurchaseApprovals = lazy(() => import('../approvals/PurchaseApprovals'));

const MAX_FILES = 10;

export interface InboxTabProps {
  /** Open the bill / expense form on a draft (its id becomes the posted bill's id). */
  onPost: (record: PurchaseRecord) => void;
  onChanged: (message?: string, tone?: 'success' | 'error' | 'info') => void;
  businessState: string;
  /** Inbox row to highlight (`?doc=`). */
  focusId?: string | null;
}

export default function InboxTab({ onPost, onChanged, businessState, focusId }: InboxTabProps) {
  useT();
  const [tick, setTick] = useState(0);
  const [camera, setCamera] = useState(false);
  const [paste, setPaste] = useState(false);
  const [qrText, setQrText] = useState('');
  const [busy, setBusy] = useState(false);
  const [names, setNames] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const writable = can('books.edit');
  const refresh = () => setTick((t) => t + 1);
  void tick;

  useEffect(() => {
    // Draft any recurring bills that fell due, then follow inbox changes made elsewhere (share target).
    const on = () => refresh();
    // Deferred so the drafts appear without a synchronous setState inside the effect.
    const t = setTimeout(() => {
      try {
        if (runDueBillSchedules(todayInput(), businessState).drafted.length) on();
      } catch {
        /* viewer: nothing drafted */
      }
    }, 0);
    window.addEventListener(INBOX_CHANGED_EVENT, on);
    return () => {
      clearTimeout(t);
      window.removeEventListener(INBOX_CHANGED_EVENT, on);
    };
  }, [businessState]);

  useEffect(() => {
    if (focusId) document.querySelector(`[data-inbox="${CSS.escape(focusId)}"]`)?.scrollIntoView({ block: 'center' });
  }, [focusId]);

  const docs = inboxDb.open();
  const drafts = draftsDb.all().sort((a, b) => (b.created_at ?? '').localeCompare(a.created_at ?? ''));

  // One path with the "Scan bill" dialog (capture-browser.ts): signed QR text, or (8.46) the full e-invoice JSON.
  const fromQrText = (text: string, source: 'camera' | 'paste') => {
    try {
      const r = captureFromQrText(text, source);
      onChanged(r.message, r.tone);
      if (r.route) {
        setQrText('');
        setPaste(false);
      }
    } catch (err) {
      onChanged((err as Error).message, 'error');
    }
    refresh();
  };

  const onFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    const list = [...files].slice(0, MAX_FILES);
    let ok = 0;
    for (const f of list) {
      try {
        const out = await openCaptureFromFile(f, { source: 'upload' });
        ok++;
        if (out.note && list.length === 1) onChanged(out.note, 'info');
      } catch (err) {
        onChanged(`${f.name}: ${(err as Error).message}`, 'error');
      }
    }
    setBusy(false);
    if (fileRef.current) fileRef.current.value = '';
    if (files.length > MAX_FILES) onChanged(capT('maxFiles', { n: MAX_FILES }), 'info');
    if (ok) onChanged(capT('added', { n: ok }));
    refresh();
  };

  const run = (fn: () => void, msg?: string) => {
    try {
      fn();
      if (msg) onChanged(msg);
    } catch (err) {
      onChanged((err as Error).message, 'error');
    }
    refresh();
  };

  /** A document without a draft: make an empty draft bill / expense carrying the file, then open it. */
  const makeDraft = (doc: InboxDoc, kind: 'PURCHASE' | 'EXPENSE') =>
    run(() => {
      const d = draftsDb.save({
        kind,
        vendor_name: '',
        bill_number: '',
        date: todayInput(),
        category: kind === 'EXPENSE' ? 'Other' : 'Purchases',
        lines: [],
        taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0, amount_paid: 0,
        itc_eligible: true,
        attachments: doc.attachments,
        draft: { source: 'manual', created_at: new Date().toISOString(), inbox_id: doc.id },
      });
      inboxDb.update(doc.id, { draft_id: d.id });
      onPost({ ...billOfDraft(d), id: d.id } as PurchaseRecord);
    });

  const addVendor = (d: PurchaseDraft) =>
    run(() => {
      const name = (names[d.id] ?? '').trim();
      if (!name) throw new Error(capT('needName'));
      const v = vendorsDb.save({ name, gstin: d.vendor_gstin });
      draftsDb.save({ ...d, vendor_id: v.id, vendor_name: v.name, draft: { ...d.draft, review: d.draft.review?.filter((r) => r !== 'vendor') } });
    }, capT('vendorAdded'));

  const sourceTag = (d: PurchaseDraft) => {
    const ap = d.draft.approval;
    if (ap?.state === 'pending') return <span className={css.tagWarn}>{capT('srcPending', { by: ap.requested_by || '-' })}</span>;
    if (ap?.state === 'rejected') return <span className={css.tagWarn}>{capT('srcRejected', { note: ap.note || '-' })}</span>;
    return <span className={css.tag}>{capT(d.draft.source === 'capture' ? 'srcCapture' : d.draft.source === 'recurring' ? 'srcRecurring' : 'srcManual')}</span>;
  };

  const waiting = drafts.some((d) => d.draft.approval?.state === 'pending') || getTable<{ state?: string }>('payment_requests').some((r) => r.state === 'pending');

  return (
    <div className={css.stack}>
      {(waiting || can('settings.manage')) && (
        <section className={surface.card}>
          <div className={surface.cardBody}>
            <Suspense fallback={null}>
              <PurchaseApprovals notify={(m, tone) => onChanged(m, tone)} />
            </Suspense>
          </div>
        </section>
      )}
      <section className={surface.card} aria-label={capT('captureTitle')}>
        <div className={surface.cardHead}>
          <span className={surface.cardHeadIcon}><Inbox size={16} /> {capT('captureTitle')}</span>
        </div>
        <div className={cn(surface.cardBody, css.stack)}>
          <p className={css.note}>{capT('captureHint')}</p>
          {writable && (
            <div className={css.bar}>
              {cameraScanSupported() && (
                <button type="button" className={controls.btnPrimary} onClick={() => setCamera(true)}>
                  <Camera size={16} /> {capT('scanQr')}
                </button>
              )}
              <button type="button" className={controls.btnOutline} disabled={busy} onClick={() => fileRef.current?.click()}>
                <FileUp size={16} /> {busy ? capT('reading') : capT('upload')}
              </button>
              <button type="button" className={controls.btnOutline} aria-expanded={paste} onClick={() => setPaste((p) => !p)}>
                <ClipboardPaste size={16} /> {capT('pasteQr')}
              </button>
              <input ref={fileRef} type="file" hidden multiple accept={`${ATTACHMENT_ACCEPT},.json,application/json`} onChange={(e) => void onFiles(e.target.files)} data-testid="capture-file" />
            </div>
          )}
          {paste && (
            <div className={css.stack}>
              <label className={controls.label} htmlFor="cap-qr">{capT('pasteLabel')}</label>
              <textarea id="cap-qr" className={cn(controls.textarea, css.textarea)} maxLength={MAX_JSON_TEXT} value={qrText} onChange={(e) => setQrText(e.target.value)} />
              <div className={css.bar}>
                <button type="button" className={controls.btnPrimary} disabled={!qrText.trim()} onClick={() => fromQrText(qrText, 'paste')}>{capT('readQr')}</button>
              </div>
            </div>
          )}
          <p className={css.note}>{capT('pdfNote')}</p>
        </div>
      </section>

      <section className={surface.card} aria-label={capT('draftsTitle')}>
        <div className={surface.cardHead}>{capT('draftsTitle')} ({drafts.length})</div>
        <div className={surface.cardBody}>
          {drafts.length === 0 ? (
            <p className={css.note}>{capT('noDrafts')}</p>
          ) : (
            <ul className={css.list}>
              {drafts.map((d) => {
                const inboxId = d.draft.inbox_id;
                return (
                  <li key={d.id} className={cn(css.item, inboxId && inboxId === focusId && css.focus)} data-inbox={inboxId}>
                    <div className={css.main}>
                      <strong>{d.vendor_name || d.vendor_gstin || capT('noVendor')} {d.bill_number ? `· ${d.bill_number}` : ''}</strong>
                      <span className={css.sub}>
                        {sourceTag(d)}
                        {d.kind === 'EXPENSE' ? capT('kindExpense') : capT('kindBill')} · {formatDate(d.date)} · {formatCurrency(d.total)}
                        {d.draft.review?.includes('gst') ? ` · ${capT('reviewGst')}` : ''}
                        {d.draft.review?.includes('billNo') && !d.bill_number ? ` · ${capT('reviewNo')}` : ''}
                        {d.draft.foreign_buyer ? ` · ${capT('warnBuyer', { gstin: d.draft.foreign_buyer })}` : ''}
                      </span>
                    </div>
                    {writable && (
                      <div className={css.actions}>
                        {!d.vendor_id && d.vendor_gstin && (
                          <>
                            <input className={controls.input} placeholder={capT('vendorName')} aria-label={capT('vendorNameFor', { gstin: d.vendor_gstin })} value={names[d.id] ?? ''} onChange={(e) => setNames({ ...names, [d.id]: e.target.value })} />
                            <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => addVendor(d)}>{capT('addVendor')}</button>
                          </>
                        )}
                        {d.attachments?.[0] && (
                          <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => openAttachment(d.attachments![0])}>{capT('viewFile')}</button>
                        )}
                        {d.draft.approval?.state !== 'pending' && (
                          <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={() => onPost({ ...billOfDraft(d), id: d.id } as PurchaseRecord)}>{capT('post')}</button>
                        )}
                        <button type="button" className={cn(controls.btnGhost, controls.btnSm)} aria-label={capT('deleteDraft')} onClick={() => run(() => {
                          draftsDb.remove(d.id);
                          if (inboxId) inboxDb.update(inboxId, { draft_id: undefined });
                        }, capT('draftDeleted'))}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>

      <section className={surface.card} aria-label={capT('inboxTitle')}>
        <div className={surface.cardHead}>{capT('inboxTitle')} ({docs.filter((r) => !r.draft_id).length})</div>
        <div className={surface.cardBody}>
          {docs.filter((r) => !r.draft_id).length === 0 ? (
            <p className={css.note}>{capT('noDocs')}</p>
          ) : (
            <ul className={css.list}>
              {docs.filter((r) => !r.draft_id).map((doc) => (
                <li key={doc.id} className={cn(css.item, doc.id === focusId && css.focus)} data-inbox={doc.id}>
                  <div className={css.main}>
                    <strong>{doc.attachments?.[0]?.name || (doc.qr ? `e-Invoice ${doc.qr.docNo}` : capT('qrOnly'))}</strong>
                    <span className={css.sub}>
                      <span className={css.tag}>{capT(`src_${doc.source}`)}</span>
                      {formatDate(doc.added_at.slice(0, 10))}{doc.intent ? ` · ${doc.intent === 'expense' ? capT('kindExpense') : capT('kindBill')}` : ''}{doc.note ? ` · ${doc.note}` : ''}
                    </span>
                  </div>
                  {writable && (
                    <div className={css.actions}>
                      {doc.attachments?.[0] && <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => openAttachment(doc.attachments![0])}>{capT('viewFile')}</button>}
                      <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={() => makeDraft(doc, 'PURCHASE')}>{capT('toBill')}</button>
                      <button type="button" className={cn(controls.btnOutline, controls.btnSm)} onClick={() => makeDraft(doc, 'EXPENSE')}>{capT('toExpense')}</button>
                      <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={() => run(() => inboxDb.update(doc.id, { status: 'dismissed' }), capT('dismissed'))}>{capT('dismiss')}</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <Suspense fallback={null}>
        <RecurringBillsPanel businessState={businessState} onChanged={(m, tone) => { refresh(); onChanged(m, tone); }} />
      </Suspense>

      {camera && (
        <Suspense fallback={null}>
          <CameraScanner open={camera} onClose={() => setCamera(false)} onCode={(code) => fromQrText(code, 'camera')} />
        </Suspense>
      )}
    </div>
  );
}

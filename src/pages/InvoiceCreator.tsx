import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Eye, FilePlus2, History, Palette, Save, X } from 'lucide-react';
import { useInvoiceStore } from '../store/useInvoiceStore';
import { pick } from '../store/pick';
import { useShallow } from 'zustand/react/shallow';
import { PageHeader } from '../components/ui/PageHeader';
import { useToast } from '../components/ui/useToast';
import { ItemsTable } from '../components/creator/ItemsTable';
import { SummaryPanel } from '../components/creator/SummaryPanel';
import { AdvancedTaxPanel } from '../components/creator/AdvancedTaxPanel';
import { StockWarnings } from '../components/creator/StockWarnings';
import { CreditWarning } from '../components/creator/CreditWarning';
import { PartiesSection } from '../components/creator/PartiesSection';
import { TemplatePicker } from '../components/creator/TemplatePicker';
import { CreatorHeader } from '../components/creator/CreatorHeader';
import { DocumentMetaCard } from '../components/creator/DocumentMetaCard';
import { SupplyNotice } from '../components/creator/SupplyNotice';
import { MobileSaveBar } from '../components/creator/MobileSaveBar';
import { CustomFieldsCard } from '../components/creator/CustomFieldsCard';
import { AttachmentsPanel } from '../components/attachments/AttachmentsPanel';
import { useCreatorKeys, useUnsavedChangesWarning } from '../hooks/useCreatorKeys';
import { useBottomBarInset } from '../hooks/useBottomBarInset';

import { localDb } from '../lib/localDb';
import { lockState } from '../lib/period-lock';
import { editorStockContext, liveDocTrackingIssues } from '../lib/stock-tracking';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { getJson, SINGLETON_KEYS } from '../lib/storage';
import { cn } from '../lib/utils';
import { num } from '../lib/invoice-calc';
import { DOCUMENT_LABELS, type DocumentType, type InvoiceRecord } from '../types/invoice';
import controls from '../styles/controls.module.css';
import surface from '../styles/surface.module.css';
import styles from './InvoiceCreator.module.css';

// Lock banner (+ PIN dialog) and the saved toast only matter occasionally: keep them out of the entry chunk.
const LockBanner = lazy(() => import('../components/creator/LockBanner').then((m) => ({ default: m.LockBanner })));
const SavedToast = lazy(() => import('../components/creator/SavedToast').then((m) => ({ default: m.SavedToast })));

// Actions for saved documents pull in conversions, sharing, e-invoice, recurring and interest.
const DocumentActions = lazy(() =>
  import('../components/creator/DocumentActions').then((m) => ({ default: m.DocumentActions })),
);

// The pickers start closed: they load right after the editor renders, off the first-paint path.
const ClientSearchModal = lazy(() => import('../components/modals/ClientSearchModal').then((m) => ({ default: m.ClientSearchModal })));
const ItemSearchModal = lazy(() => import('../components/modals/ItemSearchModal').then((m) => ({ default: m.ItemSearchModal })));

// The preview pulls in the template engine and QR code; load it only when opened.
const InvoicePreviewModal = lazy(() =>
  import('../components/preview/InvoicePreview').then((m) => ({ default: m.InvoicePreviewModal })),
);

export function InvoiceCreator() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { notify, toastNode } = useToast();
  const s = useInvoiceStore(
    useShallow((st) => pick(st, ['attachments', 'currency', 'dirty', 'doc_type', 'id', 'invoice_number', 'issue_date', 'items', 'notes', 'patch', 'setNotes', 'setTerms', 'status', 'terms', 'total'])),
  );

  const [previewOpen, setPreviewOpen] = useState(false);
  const [clientsOpen, setClientsOpen] = useState(false);
  const [itemTarget, setItemTarget] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [hasDraft, setHasDraft] = useState(false);
  const [missing, setMissing] = useState(false);
  const [saveTick, setSaveTick] = useState(0);
  const [lockTick, setLockTick] = useState(0);
  const [savedToast, setSavedToast] = useState<{ message: string; gapHint: string } | null>(null);
  // Selling an expired batch is blocked until the user confirms it (6.6).
  const [expiredAsk, setExpiredAsk] = useState<{ andNew: boolean; lines: string[] } | null>(null);

  const profiles = useMemo(() => localDb.settings.get().profiles.filter((p) => p.companyName.trim()), []);
  const editing = Boolean(s.id);
  const openPreview = useCallback(() => setPreviewOpen(true), []);

  // The stored copy decides whether the document is frozen (the edited date must not unlock itself).
  const stored = useMemo(
    () => (s.id ? localDb.invoices.getById(s.id) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.id, saveTick, lockTick],
  );
  const storedLock = stored ? lockState(stored) : 'open';
  const readOnly = storedLock === 'locked';
  const dateLocked = storedLock === 'open' && lockState({ id: s.id, issue_date: s.issue_date }) === 'locked';

  // Decide what the editor shows when the route changes.
  useEffect(() => {
    const store = useInvoiceStore.getState();
    setErrors([]);
    setMissing(false);
    if (id) {
      if (store.id !== id && !store.loadInvoice(id)) setMissing(true);
      setHasDraft(false);
      return;
    }
    const requested = searchParams.get('type');
    if (requested && requested in DOCUMENT_LABELS) {
      store.newDraft(requested as DocumentType); // e.g. /invoice?type=QUOTATION from the palette
      setHasDraft(false);
      return;
    }
    if (store.id) store.newDraft(); // leaving a saved document → start clean
    const draft = getJson<InvoiceRecord | null>(SINGLETON_KEYS.draft, null);
    setHasDraft(Boolean(draft && !draft.id && !useInvoiceStore.getState().dirty));
  }, [id, searchParams]);

  // Keep the sender snapshot populated for brand-new documents.
  useEffect(() => {
    const store = useInvoiceStore.getState();
    if (!store.sender && profiles.length) store.setSender(localDb.settings.activeProfile() ?? profiles[0]);
  }, [profiles, id]);

  const save = useCallback(
    (asDraft = false, andNew = false, expiredOk = false) => {
      // Batch / serial / godown checks (6.6 / 6.10 / 6.11) — only when issuing; drafts never move stock.
      if (!asDraft) {
        const st = useInvoiceStore.getState();
        const ctx = editorStockContext({ id: st.id, doc_type: st.doc_type, issue_date: st.issue_date });
        if (ctx?.multi) {
          for (const it of st.items) {
            if (!it.godown_id && it.name.trim() && ctx.find(it.name, it.hsn)) st.patchItem(it.id, { godown_id: ctx.defaultGodown });
          }
        }
        if (ctx) {
          const now = useInvoiceStore.getState();
          const issues = liveDocTrackingIssues({
            id: now.id || undefined,
            doc_type: now.doc_type,
            status: now.status === 'Draft' ? 'Sent' : now.status,
            issue_date: now.issue_date,
            items: now.items.filter((i) => i.name.trim() || num(i.rate) > 0),
          });
          if (issues.errors.length) {
            setErrors(issues.errors);
            window.scrollTo?.({ top: 0 });
            notify(issues.errors[0], 'error');
            return;
          }
          if (issues.expired.length && !expiredOk) {
            setExpiredAsk({ andNew, lines: issues.expired });
            return;
          }
        }
      }
      const result = useInvoiceStore.getState().saveInvoice({ asDraft });
      if (!result.ok) {
        setErrors(result.errors);
        if (result.locked) setLockTick((t) => t + 1);
        window.scrollTo?.({ top: 0 });
        notify(result.errors[0] ?? 'Could not save.', 'error');
        return;
      }
      setErrors([]);
      setSaveTick((t) => t + 1);
      const rec = result.record!;
      const message = `${DOCUMENT_LABELS[rec.doc_type]} ${rec.invoice_number} saved`;
      if (andNew) {
        // Save & new: straight to a clean form of the same type.
        useInvoiceStore.getState().newDraft(rec.doc_type);
        setHasDraft(false);
        if (id) navigate('/invoice');
        notify(message);
        return;
      }
      const gap = result.gap;
      const gapHint = gap
        ? `Series gap: ${gap.missingNumbers.slice(0, 3).join(', ')}${gap.missingCount > 3 ? ` and ${gap.missingCount - 3} more` : ''} left unused.`
        : '';
      setSavedToast({ message, gapHint });
      if (!id) navigate(`/invoice/${rec.id}`, { replace: true });
    },
    [id, navigate, notify],
  );

  // Warn before a refresh/tab close would drop edits to a saved document (new documents autosave as drafts).
  useUnsavedChangesWarning(Boolean(s.dirty && s.id));
  useBottomBarInset();

  // Easy exit: drafts autosave, so leaving never loses work. Esc closes when no field or dialog is active.
  const exitCreator = useCallback(() => navigate(id ? '/transactions' : '/'), [id, navigate]);
  const saveIssued = useCallback(() => save(), [save]);
  // Ctrl/⌘+S saves, Ctrl/⌘+P previews, Esc leaves.
  useCreatorKeys({ onSave: saveIssued, onPreview: openPreview, onExit: exitCreator });

  const startNew = (docType?: DocumentType) => {
    useInvoiceStore.getState().newDraft(docType);
    setErrors([]);
    setHasDraft(false);
    if (id) navigate('/invoice');
  };

  if (missing) {
    return (
      <div className={surface.page}>
        <PageHeader title="Document not found" subtitle="It may have been deleted, or it lives in another browser." />
        <button type="button" className={cn(controls.btnPrimary)} style={{ alignSelf: 'flex-start' }} onClick={() => navigate('/transactions')}>
          Back to invoices
        </button>
      </div>
    );
  }

  const label = DOCUMENT_LABELS[s.doc_type];

  return (
    <div className={cn(surface.page, styles.page)}>
      <CreatorHeader
        label={label}
        editing={editing}
        invoiceNumber={s.invoice_number}
        status={s.status}
        dirty={s.dirty}
        readOnly={readOnly}
        onNew={() => startNew()}
        onPreview={openPreview}
        onSaveDraft={() => save(true)}
        onSave={() => save()}
        onClose={exitCreator}
      />

      {hasDraft && (
        <div className={styles.banner} role="status">
          <History size={16} />
          <span>You have an unsaved draft from earlier.</span>
          <button type="button" className={controls.btnOutline + ' ' + controls.btnSm} onClick={() => { useInvoiceStore.getState().restoreDraft(); setHasDraft(false); }}>
            Restore draft
          </button>
          <button type="button" className={controls.btnGhost + ' ' + controls.btnSm} onClick={() => { startNew(); }}>
            Discard
          </button>
        </div>
      )}

      {stored && storedLock !== 'open' ? (
        <Suspense fallback={<div className={styles.bannerSlot} aria-hidden="true" />}>
          <LockBanner docId={stored.id} docNumber={stored.invoice_number} issueDate={stored.issue_date} onChange={() => setLockTick((t) => t + 1)} />
        </Suspense>
      ) : dateLocked ? (
        <Suspense fallback={<div className={styles.bannerSlot} aria-hidden="true" />}>
          <LockBanner docId="" issueDate={s.issue_date} onChange={() => setLockTick((t) => t + 1)} />
        </Suspense>
      ) : null}

      {errors.length > 0 && (
        <div className={styles.errors} role="alert">
          <div>
            <strong>Fix these before saving</strong>
            <ul>
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
          <button type="button" className={controls.btnIcon} onClick={() => setErrors([])} aria-label="Dismiss">
            <X size={16} />
          </button>
        </div>
      )}

      <div className={styles.layout}>
        <fieldset className={cn(styles.main, styles.fieldset, readOnly && styles.frozen)} disabled={readOnly}>
          <legend className={surface.srOnly}>{readOnly ? 'Document (locked, read-only)' : 'Document'}</legend>
          <DocumentMetaCard editing={editing} saveTick={saveTick} />
          <SupplyNotice />

          <section className={surface.card}>
            <div className={surface.cardHead}>2 · Parties</div>
            <div className={surface.cardBody}>
              <PartiesSection profiles={profiles} onSearchClients={() => setClientsOpen(true)} />
            </div>
            <CreditWarning />
          </section>

          <section className={surface.card}>
            <div className={surface.cardHead}>
              <span>3 · Items</span>
              <span className={styles.muted}>
                {s.items.filter((i) => i.name.trim() || i.rate > 0).length} line{s.items.length === 1 ? '' : 's'}
              </span>
            </div>
            <ItemsTable onPickCatalog={setItemTarget} />
            <StockWarnings />
          </section>

          <section className={surface.card}>
            <div className={surface.cardHead}>4 · Notes &amp; terms</div>
            <div className={surface.cardBody}>
              <label className={controls.field}>
                <span className={controls.label}>Note to client</span>
                <textarea className={controls.textarea} rows={2} value={s.notes} onChange={(e) => s.setNotes(e.target.value)} placeholder="Thank you for your business." />
              </label>
              <label className={controls.field}>
                <span className={controls.label}>Terms &amp; conditions</span>
                <textarea className={controls.textarea} rows={3} value={s.terms} onChange={(e) => s.setTerms(e.target.value)} />
              </label>
            </div>
          </section>

          <CustomFieldsCard />

          <section className={surface.card}>
            <div className={surface.cardHead}>Internal attachments</div>
            <div className={surface.cardBody}>
              <AttachmentsPanel
                value={s.attachments}
                onChange={(next) => s.patch({ attachments: next.length ? next : undefined })}
                label="Attachments"
                hint="Signed copies, purchase orders, delivery proofs — photos or PDFs. Kept on this device and in backups; never printed or shared with the client."
              />
            </div>
          </section>
        </fieldset>

        <aside className={styles.side}>
          <section className={surface.card}>
            <div className={surface.cardHead}>Summary</div>
            <div className={surface.cardBody}>
              <fieldset className={cn(styles.fieldset, readOnly && styles.frozen)} disabled={readOnly}>
                <legend className={surface.srOnly}>Summary and tax</legend>
                <SummaryPanel />
                <AdvancedTaxPanel />
              </fieldset>
              <div className={styles.sideActions}>
                <button type="button" className={cn(controls.btnPrimary, controls.btnLg, controls.btnBlock)} onClick={() => save()} disabled={readOnly}>
                  <Save size={18} /> Save {label.toLowerCase()}
                </button>
                <button type="button" className={cn(controls.btnOutline, controls.btnBlock)} onClick={() => save(false, true)} disabled={readOnly}>
                  <FilePlus2 size={16} /> Save &amp; new
                </button>
                <button type="button" className={cn(controls.btnOutline, controls.btnBlock)} onClick={() => setPreviewOpen(true)}>
                  <Eye size={16} /> Preview &amp; download PDF
                </button>
              </div>
            </div>
          </section>

          {editing && s.id && (
            <section className={surface.card}>
              <div className={surface.cardHead}>Document actions</div>
              <div className={surface.cardBody}>
                <Suspense fallback={<p className={styles.muted}>Loading…</p>}>
                  <DocumentActions invoiceId={s.id} refreshKey={saveTick + lockTick} onChanged={() => setLockTick((t) => t + 1)} />
                </Suspense>
              </div>
            </section>
          )}

          <section className={surface.card}>
            <div className={surface.cardHead}>
              <span className={surface.cardHeadIcon}>
                <Palette size={16} /> Template
              </span>
              <Link to="/design" className={styles.muted} style={{ color: 'var(--brand-text)', fontWeight: 600 }}>
                Customise
              </Link>
            </div>
            <div className={surface.cardBody}>
              <TemplatePicker />
            </div>
          </section>
        </aside>
      </div>

      <MobileSaveBar total={s.total} currency={s.currency} readOnly={readOnly} onPreview={openPreview} onSave={() => save()} />

      {previewOpen && (
        <Suspense fallback={null}>
          <InvoicePreviewModal isOpen={previewOpen} onClose={() => setPreviewOpen(false)} />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <ClientSearchModal isOpen={clientsOpen} onClose={() => setClientsOpen(false)} />
        <ItemSearchModal isOpen={!!itemTarget} onClose={() => setItemTarget(null)} targetItemId={itemTarget ?? ''} />
      </Suspense>
      {toastNode}
      <ConfirmDialog
        open={!!expiredAsk}
        destructive
        title="Sell an expired batch?"
        message={`${expiredAsk?.lines.join(' ') ?? ''} Selling expired goods is usually not allowed — pick another batch unless you are sure.`}
        confirmLabel="Sell anyway"
        cancelLabel="Pick another batch"
        onClose={() => setExpiredAsk(null)}
        onConfirm={() => {
          const ask = expiredAsk;
          setExpiredAsk(null);
          if (ask) save(false, ask.andNew, true);
        }}
      />
      {savedToast && (
        <Suspense fallback={null}>
        <SavedToast
          message={savedToast.message}
          gapHint={savedToast.gapHint}
          onClose={() => setSavedToast(null)}
          onView={() => setPreviewOpen(true)}
          onShare={() => {
            const anchor = document.querySelector<HTMLElement>('[data-share-anchor] button');
            anchor?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
            anchor?.click();
          }}
          onNew={() => startNew(s.doc_type)}
        />
        </Suspense>
      )}
    </div>
  );
}

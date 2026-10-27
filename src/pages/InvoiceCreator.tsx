import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Eye, FilePlus2, History, Palette, Save, X } from 'lucide-react';
import { useInvoiceStore } from '../store/useInvoiceStore';
import { pick } from '../store/pick';
import { useShallow } from 'zustand/react/shallow';
import { PageHeader } from '../components/ui/PageHeader';
import { useToast } from '../components/ui/useToast';
import { useHsnDefaultRate } from '../hooks/useHsnDefaultRate';
import { ItemsTable } from '../components/creator/ItemsTable';
import { ScanBar } from '../components/creator/ScanBar';
import { SummaryPanel } from '../components/creator/SummaryPanel';
import { AdvancedTaxPanel } from '../components/creator/AdvancedTaxPanel';
import { StockWarnings } from '../components/creator/StockWarnings';
import { CreditWarning } from '../components/creator/CreditWarning';
import { PartiesSection } from '../components/creator/PartiesSection';
import { TemplatePicker } from '../components/creator/TemplatePicker';
import { CreatorHeader } from '../components/creator/CreatorHeader';
import { DocumentMetaCard } from '../components/creator/DocumentMetaCard';
import { SupplyNotice } from '../components/creator/SupplyNotice';
import { GstExtrasFields } from '../components/creator/GstExtrasFields';
import { MobileSaveBar } from '../components/creator/MobileSaveBar';
import { CustomFieldsCard } from '../components/creator/CustomFieldsCard';
import { AttachmentsPanel } from '../components/attachments/AttachmentsPanel';
import { useCreatorKeys, useUnsavedChangesWarning } from '../hooks/useCreatorKeys';
import { useBottomBarInset } from '../hooks/useBottomBarInset';

import { localDb } from '../lib/localDb';
import { snapshotLineImages } from '../lib/line-images'; // R3-C2
import { useLivePreviewPane } from '../components/creator/live-preview-gate'; // R3-C1
import { MetaSummary } from '../components/invoicing-ux/MetaSummary';
import { LastRateHints } from '../components/invoicing-ux/LastRateHints';
import { duplicateInEditor } from '../components/invoicing-ux/editor-actions';
import { getSaveChoice, setSaveChoice, type SaveChoice } from '../lib/save-choice';
import { invoiceUpiLink, whatsappLink } from '../lib/share';
import { receivableBalance } from '../lib/rcm';
import { uxT } from '../i18n/areas/invoicing-ux';
import { clientToParty } from '../store/invoice-defaults';
import { issuingProfile } from '../lib/sync-device';
import { lockState } from '../lib/period-lock';
import { editorStockContext, isMrpMessage, liveDocTrackingIssues, liveMrpIssues, recordMrpOverrides, saveGates, withMrpIssues } from '../lib/stock-tracking'; // R9 (RT-A2) helpers; RT-E3 save gates
import { rxRequiredErrors } from '../lib/pharma-gate';
import { can, currentActor } from '../lib/access';
import { audit } from '../lib/audit';
import { trT } from '../i18n/areas/trade-r8c';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { getJson, SINGLETON_KEYS } from '../lib/storage';
import { cn } from '../lib/utils';
import { num } from '../lib/invoice-calc';
import { DOCUMENT_LABELS, type DocumentType, type InvoiceRecord } from '../types/invoice';
import { useT } from '../i18n';
import '../i18n/en-pages'; // page strings (5.4)
import { docLabel } from '../i18n/labels';
import controls from '../styles/controls.module.css';
import surface from '../styles/surface.module.css';
import styles from './InvoiceCreator.module.css';

// Lock banner (+ PIN dialog) and the saved toast only matter occasionally: keep them out of the entry chunk.
const ScreenTip = lazy(() => import('../components/help/ScreenTip')); // R6-A6 one-time tip
const LockBanner = lazy(() => import('../components/creator/LockBanner').then((m) => ({ default: m.LockBanner })));
const SavedToast = lazy(() => import('../components/creator/SavedToast').then((m) => ({ default: m.SavedToast })));

// Actions for saved documents pull in conversions, sharing, e-invoice, recurring and interest.
const DocumentActions = lazy(() =>
  import('../components/creator/DocumentActions').then((m) => ({ default: m.DocumentActions })),
);

// Unadjusted advances of the client (5.3): the advances maths stays out of the editor chunk.
// WP-9 maker-checker: banner for a document pending / rejected approval (chunk loads only then).
const ApprovalBanner = lazy(() => import('../components/approvals/ApprovalsPanel').then((m) => ({ default: m.ApprovalBanner })));
const AdvanceNotice = lazy(() => import('../components/creator/AdvanceNotice').then((m) => ({ default: m.AdvanceNotice })));
// 8G invoicing UX: payment schedule, last-rate hints, post-save send sheet (each its own chunk).
const PaymentScheduleCard = lazy(() => import('../components/invoicing-ux/PaymentScheduleCard'));
const SendSheet = lazy(() => import('../components/invoicing-ux/SendSheet'));
const PaymentModal = lazy(() => import('../components/modals/PaymentModal').then((m) => ({ default: m.PaymentModal })));

// The pickers start closed: they load right after the editor renders, off the first-paint path.
const ClientSearchModal = lazy(() => import('../components/modals/ClientSearchModal').then((m) => ({ default: m.ClientSearchModal })));
const ItemSearchModal = lazy(() => import('../components/modals/ItemSearchModal').then((m) => ({ default: m.ItemSearchModal })));

// R3-C1: live paper preview pane (≥ 1280 px, toggle remembered per device); never requested on phones.
const LivePreviewPane = lazy(() => import('../components/creator/LivePreviewPane'));

// The preview pulls in the template engine and QR code; load it only when opened.
const InvoicePreviewModal = lazy(() =>
  import('../components/preview/InvoicePreview').then((m) => ({ default: m.InvoicePreviewModal })),
);

export function InvoiceCreator() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { notify, toastNode } = useToast();
  useHsnDefaultRate(); // WP-6: HSN master rate on lines whose HSN is typed
  const { t, lang } = useT();
  const s = useInvoiceStore(
    useShallow((st) => pick(st, ['approval', 'attachments', 'currency', 'dirty', 'doc_type', 'id', 'invoice_number', 'issue_date', 'items', 'notes', 'patch', 'setNotes', 'setTerms', 'status', 'terms', 'total'])),
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
  const [sendId, setSendId] = useState<string | null>(null);
  // A1 / A4: preview opened with an automatic Print / Share PDF; payment dialog from the sheet.
  const [previewAction, setPreviewAction] = useState<'print' | 'share' | undefined>(undefined);
  const [payId, setPayId] = useState<string | null>(null);
  const [saveChoice, setSaveChoiceState] = useState<SaveChoice>(() => getSaveChoice());
  // Selling an expired batch is blocked until the user confirms it (6.6).
  const [expiredAsk, setExpiredAsk] = useState<{ andNew: boolean; lines: string[] } | null>(null);

  const profiles = useMemo(() => localDb.settings.get().profiles.filter((p) => p.companyName.trim()), []);
  const pane = useLivePreviewPane(); // R3-C1
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
    // `/invoice?party=<client id>` (Clients → ₹ Given on a GST profile, 8.2): a new invoice for that party.
    const partyId = searchParams.get('party');
    if (partyId) {
      const client = localDb.clients.getById(partyId);
      store.newDraft();
      if (client) store.setClient(clientToParty(client));
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
    if (!store.sender && profiles.length) store.setSender(issuingProfile(profiles, localDb.settings.activeProfile()) ?? profiles[0]);
  }, [profiles, id]);

  const mrpConfirmed = useRef<string[]>([]); // R9 (RT-A2): MRP lines the owner confirmed ("Sell anyway"), audited on save
  const save = useCallback(
    (asDraft = false, andNew = false, expiredOk = false, then: SaveChoice | 'sheet' = 'sheet') => {
      // Batch / serial / godown checks (6.6 / 6.10 / 6.11) — only when issuing; drafts never move stock.
      if (!asDraft) {
        const st = useInvoiceStore.getState();
        const ctx = editorStockContext({ id: st.id, doc_type: st.doc_type, issue_date: st.issue_date });
        if (ctx?.multi) {
          for (const it of st.items) {
            if (!it.godown_id && it.name.trim() && ctx.find(it.name, it.hsn)) st.patchItem(it.id, { godown_id: ctx.defaultGodown });
          }
        }
        {
          const now = useInvoiceStore.getState();
          const doc = {
            id: now.id || undefined,
            invoice_number: now.invoice_number,
            doc_type: now.doc_type,
            status: now.status === 'Draft' ? 'Sent' : now.status,
            issue_date: now.issue_date,
            items: now.items.filter((i) => i.name.trim() || num(i.rate) > 0),
            discount_type: now.discount_type,
            discount_rate: now.discount_rate,
            price_includes_tax: now.price_includes_tax,
          };
          // R9 (RT-A2): the MRP guard runs even without batch / serial / godown tracking (or agency lots).
          const found: ReturnType<typeof liveDocTrackingIssues> = ctx || st.items.some((i) => i.arrival_id) ? liveDocTrackingIssues(doc) : withMrpIssues({ errors: [], expired: [], warnings: [] }, liveMrpIssues(doc));
          const rxErr = [...rxRequiredErrors({ ...doc, rx: now.rx }), ...[...saveGates].flatMap((g) => g({ ...doc, total: now.total, kyc: now.kyc, client: now.client }))]; // R9 (RT-B1) "Require prescription for H1 / X"; RT-E3 "Require PAN"
          const issues = rxErr.length ? { ...found, errors: [...found.errors, ...rxErr] } : found;
          // QA8 T15: only agency-lot errors left — the owner may sell anyway, with a reason (audited).
          const lotOnly = !!issues.lots?.length && issues.errors.every((e) => issues.lots!.includes(e));
          const reason = lotOnly && can('settings.manage') ? window.prompt(trT('lotOverride', { list: issues.lots!.join(' ') }))?.trim() : '';
          if (reason) audit.record({ entity: 'invoice', entity_id: now.id || '', action: 'override', summary: `Agency lot check overridden: ${issues.lots!.join(' ')} Reason: ${reason}` });
          else if (issues.errors.length) {
            setErrors(issues.errors);
            window.scrollTo?.({ top: 0 });
            notify(issues.errors[0], 'error');
            return;
          }
          if (issues.expired.length && !expiredOk) {
            setExpiredAsk({ andNew, lines: issues.expired });
            return;
          }
          const mrpWarn = issues.warnings.filter(isMrpMessage);
          if (mrpWarn.length) notify(mrpWarn[0], 'info');
          if (expiredOk) mrpConfirmed.current = issues.expired;
        }
      }
      // R3-C2: each line snapshots its catalogue photo reference at save (later photo changes never reach it).
      {
        const st = useInvoiceStore.getState();
        const items = snapshotLineImages(st.items, localDb.items.getAll());
        if (items !== st.items) st.patch({ items });
      }
      const result = useInvoiceStore.getState().saveInvoice({ asDraft });
      if (result.ok && result.record && !asDraft && expiredOk) recordMrpOverrides(result.record, mrpConfirmed.current, currentActor()?.name ?? 'the owner', (r) => audit.record(r)); // R9 (RT-A2)
      mrpConfirmed.current = [];
      if (!result.ok) {
        setErrors(result.errors);
        if (result.locked) setLockTick((t) => t + 1);
        window.scrollTo?.({ top: 0 });
        notify(result.errors[0] ?? t('editor.couldNotSave'), 'error');
        return;
      }
      setErrors([]);
      setSaveTick((t) => t + 1);
      const rec = result.record!;
      const message = t('editor.savedMsg', { doc: docLabel(rec.doc_type), number: rec.invoice_number });
      if (andNew) {
        // Save & new: straight to a clean form of the same type.
        useInvoiceStore.getState().newDraft(rec.doc_type);
        setHasDraft(false);
        if (id) navigate('/invoice');
        notify(message);
        return;
      }
      const gap = result.gap;
      const gapList = gap ? gap.missingNumbers.slice(0, 3).join(', ') : '';
      const gapHint = gap
        ? t('editor.seriesGap', { numbers: gap.missingCount > 3 ? t('editor.andMore', { list: gapList, n: gap.missingCount - 3 }) : gapList })
        : '';
      if (result.warning) notify(result.warning, 'error');
      if (asDraft) {
        setSavedToast({ message, gapHint });
      } else if (then === 'print') {
        // A4 Save & print: straight to the print dialog.
        if (gapHint) notify(gapHint, 'info');
        setPreviewAction('print');
        setPreviewOpen(true);
      } else if (then === 'whatsapp' && rec.client?.phone) {
        // A4 Save & WhatsApp: open the tab now (still inside the click), fill in the chat once the
        // message module has loaded — the same text as the sheet (summary, balance, UPI link).
        const tab = window.open('', '_blank');
        const phone = rec.client.phone;
        void import('../lib/send-summary').then(({ partyOutstanding, sendMessage, sheetMessage }) => {
          const text = sheetMessage(sendMessage(rec, partyOutstanding(localDb.invoices.getAll(), rec.client)), receivableBalance(rec) > 0 ? invoiceUpiLink(rec) : null);
          const url = whatsappLink(phone, text);
          if (tab) {
            tab.opener = null;
            tab.location.href = url;
          } else window.open(url, '_blank', 'noopener');
        });
        notify(message);
      } else {
        // A1: the post-save success sheet stays until dismissed.
        if (gapHint) notify(gapHint, 'info');
        setSendId(rec.id);
      }
      if (!id) navigate(`/invoice/${rec.id}`, { replace: true });
    },
    [id, navigate, notify, lang],
  );

  /** A4: Save / Save & print / Save & WhatsApp, the choice remembered on this device. */
  const saveWith = useCallback(
    (choice: SaveChoice) => {
      setSaveChoiceState(setSaveChoice(choice));
      save(false, false, false, choice);
    },
    [save],
  );

  // A4 Alt+P: print the current document; Alt+D: duplicate it into a new unsaved document.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || e.ctrlKey || e.metaKey) return;
      const k = e.key.toLowerCase();
      if (k === 'p') {
        e.preventDefault();
        setPreviewAction('print');
        setPreviewOpen(true);
      } else if (k === 'd') {
        e.preventDefault();
        if (duplicateInEditor()) {
          if (id) navigate('/invoice');
          notify(uxT('dupDone'), 'info');
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [id, navigate, notify]);

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
        <PageHeader title={t('editor.notFound')} subtitle={t('editor.notFoundSub')} />
        <button type="button" className={cn(controls.btnPrimary)} style={{ alignSelf: 'flex-start' }} onClick={() => navigate('/transactions')}>
          {t('editor.backToInvoices')}
        </button>
      </div>
    );
  }

  const label = docLabel(s.doc_type);

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
          <span>{t('editor.draftBanner')}</span>
          <button type="button" className={controls.btnOutline + ' ' + controls.btnSm} onClick={() => { useInvoiceStore.getState().restoreDraft(); setHasDraft(false); }}>
            {t('editor.restoreDraft')}
          </button>
          <button type="button" className={controls.btnGhost + ' ' + controls.btnSm} onClick={() => { startNew(); }}>
            {t('common.discard')}
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

      <Suspense fallback={null}><ScreenTip id="editor" /></Suspense>
      {s.approval && s.approval.state !== 'approved' && (
        <Suspense fallback={null}>
          <ApprovalBanner approval={s.approval} />
        </Suspense>
      )}

      {errors.length > 0 && (
        <div className={styles.errors} role="alert">
          <div>
            <strong>{t('editor.fixErrors')}</strong>
            <ul>
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
          <button type="button" className={controls.btnIcon} onClick={() => setErrors([])} aria-label={t('common.dismiss')}>
            <X size={16} />
          </button>
        </div>
      )}

      {pane.wide && (
        <div className={styles.paneBar}>
          <button type="button" className={cn(controls.btnGhost, controls.btnSm)} aria-pressed={pane.on} onClick={pane.toggle} data-live-preview-toggle>
            <Eye size={15} /> {pane.on ? pane.hideLabel : pane.showLabel}
          </button>
        </div>
      )}
      <div className={cn(styles.layout, pane.on && styles.layoutWithPane)}>
        <fieldset className={cn(styles.main, styles.fieldset, readOnly && styles.frozen)} disabled={readOnly}>
          <legend className={surface.srOnly}>{readOnly ? t('editor.docLegendLocked') : t('editor.docLegend')}</legend>
          <SupplyNotice />
          <GstExtrasFields />

          {/* QA-3 F21: "1 · Document" leads again — a one-line strip (type picker inline) until edited. */}
          <MetaSummary forceOpen={errors.length > 0} editing={editing}>
            <DocumentMetaCard editing={editing} saveTick={saveTick} />
          </MetaSummary>

          <section className={surface.card} data-r3c-section="party">
            <div className={surface.cardHead}>{t('editor.parties')}</div>
            <div className={surface.cardBody}>
              <PartiesSection profiles={profiles} onSearchClients={() => setClientsOpen(true)} />
            </div>
            <CreditWarning />
            <Suspense fallback={null}>
              <AdvanceNotice onApplied={(m) => notify(m)} />
            </Suspense>
          </section>

          <section className={surface.card} data-r3c-section="items">
            <div className={surface.cardHead}>
              <span>{t('editor.items')}</span>
              <span className={styles.muted}>
                {(() => {
                  const n = s.items.filter((i) => i.name.trim() || i.rate > 0).length;
                  return n === 1 ? t('editor.linesOne') : t('editor.linesMany', { n });
                })()}
              </span>
            </div>
            <ScanBar disabled={readOnly} />
            <ItemsTable onPickCatalog={setItemTarget} />
            <StockWarnings />
            <LastRateHints />
          </section>

          <Suspense fallback={null}>
            <PaymentScheduleCard notify={notify} />
          </Suspense>

          <section className={surface.card} data-r3c-section="notes">
            <div className={surface.cardHead}>{t('editor.notesTerms')}</div>
            <div className={surface.cardBody}>
              <label className={controls.field}>
                <span className={controls.label}>{t('editor.noteToClient')}</span>
                <textarea className={controls.textarea} rows={2} value={s.notes} onChange={(e) => s.setNotes(e.target.value)} placeholder={t('editor.notePlaceholder')} />
              </label>
              <label className={controls.field}>
                <span className={controls.label}>{t('editor.terms')}</span>
                <textarea className={controls.textarea} rows={3} value={s.terms} onChange={(e) => s.setTerms(e.target.value)} />
              </label>
            </div>
          </section>

          <CustomFieldsCard />

          <section className={surface.card}>
            <div className={surface.cardHead}>{t('editor.attachments')}</div>
            <div className={surface.cardBody}>
              <AttachmentsPanel
                value={s.attachments}
                onChange={(next) => s.patch({ attachments: next.length ? next : undefined })}
                label={t('editor.attachmentsLabel')}
                hint={t('editor.attachmentsHint')}
                printable
              />
            </div>
          </section>
        </fieldset>

        <aside className={styles.side}>
          <section className={surface.card} data-r3c-section="totals">
            <div className={surface.cardHead}>{t('editor.summary')}</div>
            <div className={surface.cardBody}>
              <fieldset className={cn(styles.fieldset, readOnly && styles.frozen)} disabled={readOnly}>
                <legend className={surface.srOnly}>{t('editor.summaryLegend')}</legend>
                <SummaryPanel />
                <AdvancedTaxPanel />
              </fieldset>
              <div className={styles.sideActions}>
                <div className={styles.splitSave} role="group" aria-label={uxT('saveGroup')}>
                  <button type="button" className={cn(controls.btnPrimary, controls.btnLg, controls.btnBlock)} onClick={() => saveWith(saveChoice)} disabled={readOnly} data-save-main>
                    <Save size={18} /> {saveChoice === 'print' ? uxT('savePrint') : saveChoice === 'whatsapp' ? uxT('saveWhatsapp') : t('editor.saveDoc', { doc: lang === 'en' ? label.toLowerCase() : label })}
                  </button>
                  <select className={cn(controls.select, styles.splitPick)} value={saveChoice} disabled={readOnly} aria-label={uxT('saveChoose')} onChange={(e) => setSaveChoiceState(setSaveChoice(e.target.value as SaveChoice))} data-save-choice>
                    {/* QA-3 F21: the picker names what happens AFTER saving, so it does not read as another Save. */}
                    <option value="save">{uxT('saveOptOnly')}</option>
                    <option value="print">{uxT('saveOptPrint')}</option>
                    <option value="whatsapp">{uxT('saveOptWhatsapp')}</option>
                  </select>
                </div>
                <button type="button" className={cn(controls.btnOutline, controls.btnBlock)} onClick={() => save(false, true)} disabled={readOnly}>
                  <FilePlus2 size={16} /> {t('editor.saveNew')}
                </button>
                <button type="button" className={cn(controls.btnOutline, controls.btnBlock)} onClick={() => setPreviewOpen(true)}>
                  <Eye size={16} /> {t('editor.previewPdf')}
                </button>
              </div>
            </div>
          </section>

          {editing && s.id && (
            <section className={surface.card}>
              <div className={surface.cardHead}>{t('editor.docActions')}</div>
              <div className={surface.cardBody}>
                <Suspense fallback={<p className={styles.muted}>{t('common.loading')}</p>}>
                  <DocumentActions invoiceId={s.id} refreshKey={saveTick + lockTick} onChanged={() => setLockTick((t) => t + 1)} />
                </Suspense>
              </div>
            </section>
          )}

          <section className={surface.card}>
            <div className={surface.cardHead}>
              <span className={surface.cardHeadIcon}>
                <Palette size={16} /> {t('editor.template')}
              </span>
              <Link to="/design" className={styles.muted} style={{ color: 'var(--brand-text)', fontWeight: 600 }}>
                {t('editor.customise')}
              </Link>
            </div>
            <div className={surface.cardBody}>
              <TemplatePicker />
            </div>
          </section>
        </aside>
        {pane.on && (
          <Suspense fallback={<div className={styles.paneSlot} aria-hidden="true" />}>
            <LivePreviewPane />
          </Suspense>
        )}
      </div>

      <MobileSaveBar total={s.total} currency={s.currency} readOnly={readOnly} onPreview={openPreview} onSave={() => save()} />

      {previewOpen && (
        <Suspense fallback={null}>
          <InvoicePreviewModal isOpen={previewOpen} autoAction={previewAction} onClose={() => { setPreviewOpen(false); setPreviewAction(undefined); }} />
        </Suspense>
      )}
      {payId && (
        <Suspense fallback={null}>
          <PaymentModal
            invoice={localDb.invoices.getById(payId) ?? null}
            onClose={() => { setPayId(null); useInvoiceStore.getState().loadInvoice(payId); setSaveTick((n) => n + 1); }}
            onChanged={() => { useInvoiceStore.getState().loadInvoice(payId); setSaveTick((n) => n + 1); }}
          />
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
        title={t('editor.expiredTitle')}
        message={t('editor.expiredMsg', { lines: expiredAsk?.lines.join(' ') ?? '' })}
        confirmLabel={t('editor.sellAnyway')}
        cancelLabel={t('editor.pickAnother')}
        onClose={() => setExpiredAsk(null)}
        onConfirm={() => {
          const ask = expiredAsk;
          setExpiredAsk(null);
          if (ask) save(false, ask.andNew, true);
        }}
      />
      {sendId && (
        <Suspense fallback={null}>
          <SendSheet
            invoiceId={sendId}
            onClose={() => setSendId(null)}
            onPreview={(action) => { setPreviewAction(action); setPreviewOpen(true); }}
            onRecordPayment={() => setPayId(sendId)}
            onNew={() => startNew(s.doc_type)}
          />
        </Suspense>
      )}
      {savedToast && (
        <Suspense fallback={null}>
        <SavedToast
          message={savedToast.message}
          gapHint={savedToast.gapHint}
          onClose={() => setSavedToast(null)}
          onView={() => setPreviewOpen(true)}
          onShare={() => {
            // 8.105: the "Send to customer" sheet (balance + party outstanding, WhatsApp / e-mail / Share).
            if (s.id) setSendId(s.id);
          }}
          onNew={() => startNew(s.doc_type)}
        />
        </Suspense>
      )}
    </div>
  );
}

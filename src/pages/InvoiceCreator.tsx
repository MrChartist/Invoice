import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Eye, FilePlus2, History, Palette, Save, X } from 'lucide-react';
import { useInvoiceStore } from '../store/useInvoiceStore';
import { PageHeader } from '../components/ui/PageHeader';
import { StatusBadge } from '../components/ui/StatusBadge';
import { useToast } from '../components/ui/useToast';
import { ItemsTable } from '../components/creator/ItemsTable';
import { SummaryPanel } from '../components/creator/SummaryPanel';
import { AdvancedTaxPanel } from '../components/creator/AdvancedTaxPanel';
import { DocumentActions } from '../components/creator/DocumentActions';
import { StockWarnings } from '../components/creator/StockWarnings';
import { PartiesSection } from '../components/creator/PartiesSection';
import { TemplatePicker } from '../components/creator/TemplatePicker';
import { InvoicePreviewModal } from '../components/preview/InvoicePreview';
import { ClientSearchModal } from '../components/modals/ClientSearchModal';
import { ItemSearchModal } from '../components/modals/ItemSearchModal';
import { localDb } from '../lib/localDb';
import { getJson, SINGLETON_KEYS } from '../lib/storage';
import { STATUS_OPTIONS } from '../lib/invoice-status';
import { addDaysInput, CURRENCIES, formatCurrency, cn } from '../lib/utils';
import { DOCUMENT_LABELS, type DocumentType, type InvoiceRecord, type InvoiceStatus } from '../types/invoice';
import controls from '../styles/controls.module.css';
import surface from '../styles/surface.module.css';
import styles from './InvoiceCreator.module.css';

const DOC_TYPES = Object.keys(DOCUMENT_LABELS) as DocumentType[];
const DUE_PRESETS = [0, 7, 15, 30, 45];

export function InvoiceCreator() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { notify, toastNode } = useToast();
  const s = useInvoiceStore();

  const [previewOpen, setPreviewOpen] = useState(false);
  const [clientsOpen, setClientsOpen] = useState(false);
  const [itemTarget, setItemTarget] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [hasDraft, setHasDraft] = useState(false);
  const [missing, setMissing] = useState(false);
  const [saveTick, setSaveTick] = useState(0);

  const profiles = useMemo(() => localDb.settings.get().profiles.filter((p) => p.companyName.trim()), []);
  const editing = Boolean(s.id);
  const nextNumber = useMemo(
    () => (s.invoice_number ? '' : localDb.invoices.nextNumber(s.issue_date, s.doc_type, s.sender?.invoicePrefix || undefined)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.invoice_number, s.issue_date, s.doc_type, s.sender?.invoicePrefix, s.id],
  );

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
    (asDraft = false) => {
      const result = useInvoiceStore.getState().saveInvoice({ asDraft });
      if (!result.ok) {
        setErrors(result.errors);
        window.scrollTo?.({ top: 0 });
        notify(result.errors[0] ?? 'Could not save.', 'error');
        return;
      }
      setErrors([]);
      setSaveTick((t) => t + 1);
      const rec = result.record!;
      notify(`${DOCUMENT_LABELS[rec.doc_type]} ${rec.invoice_number} saved`);
      if (!id) navigate(`/invoice/${rec.id}`, { replace: true });
    },
    [id, navigate, notify],
  );

  // Ctrl/⌘+S saves, Ctrl/⌘+P previews.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();
      if (key === 's') {
        e.preventDefault();
        save();
      } else if (key === 'p') {
        e.preventDefault();
        setPreviewOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  // Warn before a refresh/tab close would drop edits to a saved document (new documents autosave as drafts).
  useEffect(() => {
    if (!(s.dirty && s.id)) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [s.dirty, s.id]);

  // Lift toasts above the fixed mobile save bar so they never cover Save.
  useEffect(() => {
    const mq = window.matchMedia?.('(max-width: 900px)');
    if (!mq) return;
    const apply = () => document.documentElement.style.setProperty('--bottom-bar-h', mq.matches ? '4.25rem' : '0px');
    apply();
    mq.addEventListener('change', apply);
    return () => {
      mq.removeEventListener('change', apply);
      document.documentElement.style.removeProperty('--bottom-bar-h');
    };
  }, []);

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
      <PageHeader
        title={
          <>
            {editing ? `Edit ${label.toLowerCase()}` : `New ${label.toLowerCase()}`}
            {s.invoice_number && <span className={styles.number}>{s.invoice_number}</span>}
            {editing && <StatusBadge status={s.status} />}
          </>
        }
        subtitle={s.dirty ? 'Unsaved changes — autosaved as a draft on this device' : editing ? 'All changes saved' : 'Fill in the details, then save.'}
        actions={
          <>
            {editing && (
              <button type="button" className={controls.btnOutline} onClick={() => startNew()}>
                <FilePlus2 size={16} /> New
              </button>
            )}
            <button type="button" className={controls.btnOutline} onClick={() => setPreviewOpen(true)}>
              <Eye size={16} /> Preview
            </button>
            {!editing && (
              <button type="button" className={controls.btnOutline} onClick={() => save(true)}>
                Save draft
              </button>
            )}
            <button type="button" className={controls.btnPrimary} onClick={() => save()}>
              <Save size={16} /> Save
            </button>
          </>
        }
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
        <div className={styles.main}>
          <section className={surface.card}>
            <div className={surface.cardHead}>1 · Document</div>
            <div className={surface.cardBody}>
              <div className={controls.row3}>
                <label className={controls.field}>
                  <span className={controls.label}>Type</span>
                  <select className={controls.select} value={s.doc_type} onChange={(e) => s.setDocType(e.target.value as DocumentType)} disabled={editing && Boolean(s.invoice_number)}>
                    {DOC_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {DOCUMENT_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={controls.field}>
                  <span className={controls.label}>Number</span>
                  <input
                    className={`${controls.input} ${controls.inputMono}`}
                    style={{ textTransform: 'none' }}
                    value={s.invoice_number}
                    onChange={(e) => s.setInvoiceNumber(e.target.value)}
                    placeholder={nextNumber || 'Auto'}
                  />
                  {!editing && <span className={controls.hint}>Leave blank to number automatically.</span>}
                </label>
                <label className={controls.field}>
                  <span className={controls.label}>PO / reference no.</span>
                  <input className={controls.input} value={s.po_number ?? ''} onChange={(e) => s.patch({ po_number: e.target.value })} placeholder="Optional" />
                </label>
              </div>
              <div className={controls.row3}>
                <label className={controls.field}>
                  <span className={controls.label}>Issue date</span>
                  <input className={controls.input} type="date" value={s.issue_date} onChange={(e) => s.setDates(e.target.value, s.due_date)} />
                </label>
                <div className={controls.field}>
                  <label className={controls.label} htmlFor="due-date">Due date</label>
                  <input id="due-date" className={controls.input} type="date" value={s.due_date} min={s.issue_date} onChange={(e) => s.setDates(s.issue_date, e.target.value)} />
                  <div className={styles.chips}>
                    {DUE_PRESETS.map((d) => (
                      <button key={d} type="button" aria-label={d === 0 ? 'Due on receipt' : `Due in ${d} days`} className={styles.chip} onClick={() => s.setDates(s.issue_date, addDaysInput(d, s.issue_date))}>
                        {d === 0 ? 'Now' : `${d}d`}
                      </button>
                    ))}
                  </div>
                </div>
                <div className={styles.pair}>
                  <label className={controls.field}>
                    <span className={controls.label}>Currency</span>
                    <select className={controls.select} value={s.currency} onChange={(e) => s.setCurrency(e.target.value)}>
                      {CURRENCIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.symbol} {c.code}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={controls.field}>
                    <span className={controls.label}>Status</span>
                    <select className={controls.select} value={s.status === 'Overdue' ? 'Sent' : s.status} onChange={(e) => s.setStatus(e.target.value as InvoiceStatus)}>
                      {STATUS_OPTIONS.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
              <label className={controls.check}>
                <input type="checkbox" checked={s.reverse_charge} onChange={(e) => s.setReverseCharge(e.target.checked)} />
                Tax is payable on reverse charge
              </label>
            </div>
          </section>

          <section className={surface.card}>
            <div className={surface.cardHead}>2 · Parties</div>
            <div className={surface.cardBody}>
              <PartiesSection profiles={profiles} onSearchClients={() => setClientsOpen(true)} />
            </div>
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
        </div>

        <aside className={styles.side}>
          <section className={surface.card}>
            <div className={surface.cardHead}>Summary</div>
            <div className={surface.cardBody}>
              <SummaryPanel />
              <AdvancedTaxPanel />
              <div className={styles.sideActions}>
                <button type="button" className={cn(controls.btnPrimary, controls.btnLg, controls.btnBlock)} onClick={() => save()}>
                  <Save size={18} /> Save {label.toLowerCase()}
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
                <DocumentActions invoiceId={s.id} refreshKey={saveTick} />
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

      <div className={cn(styles.mobileBar, 'no-print')}>
        <div>
          <span>Total</span>
          <strong>{formatCurrency(s.total, s.currency)}</strong>
        </div>
        <button type="button" className={controls.btnOutline} onClick={() => setPreviewOpen(true)} aria-label="Preview">
          <Eye size={16} />
        </button>
        <button type="button" className={controls.btnPrimary} onClick={() => save()}>
          <Save size={16} /> Save
        </button>
      </div>

      <InvoicePreviewModal isOpen={previewOpen} onClose={() => setPreviewOpen(false)} />
      <ClientSearchModal isOpen={clientsOpen} onClose={() => setClientsOpen(false)} />
      <ItemSearchModal isOpen={!!itemTarget} onClose={() => setItemTarget(null)} targetItemId={itemTarget ?? ''} />
      {toastNode}
    </div>
  );
}

import { useId, useMemo, useState, type ReactNode } from 'react';
import { Download, FileJson, Truck, Upload } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/useToast';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './einvoice.module.css';
import type { InvoiceRecord } from '../../types/invoice';
import { getTable } from '../../lib/storage';
import { localDb } from '../../lib/localDb';
import { readLinks } from '../../lib/documents';
import { MAX_IMPORT_BYTES } from '../../lib/csv';
import { getAllEInvoiceMeta } from '../../lib/einvoice';
import type { EwayTransMode } from '../../lib/eway';
import {
  buildBulkEInvoice,
  buildBulkEway,
  bulkCandidates,
  importIrpResponse,
  type BulkBlocked,
  type IrpImportResult,
  type ParsedIrpResponse,
} from '../../lib/einvoice-bulk';
import { formatDate, formatMoney } from '../../lib/utils';

export interface BulkEInvoiceModalProps {
  open: boolean;
  onClose: () => void;
  /** Issue-date range offered for selection (local YYYY-MM-DD). */
  from: string;
  to: string;
  periodLabel: string;
}

type Tab = 'generate' | 'import';

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className={controls.field}>
      <span className={controls.label}>{label}</span>
      {children}
      {hint && <span className={controls.hint}>{hint}</span>}
    </label>
  );
}

function BlockedList({ title, rows }: { title: string; rows: BulkBlocked[] }) {
  if (!rows.length) return null;
  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <ul className={styles.checklist}>
        {rows.map((b) => (
          <li key={b.invoiceId} className={styles.statusLine}>
            <span className={styles.pillBad}>{b.number}</span>
            <span>{b.reasons.join(' · ')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Bulk e-Invoice / e-Way JSON for many invoices, and bulk import of the IRP response
 * (roadmap 6.24). Lazy-loaded from the GST reports page. Offline: nothing is uploaded.
 */
export default function BulkEInvoiceModal(props: BulkEInvoiceModalProps) {
  if (!props.open) return null;
  return <BulkBody {...props} />;
}

function BulkBody({ onClose, from, to, periodLabel }: BulkEInvoiceModalProps) {
  const { notify, toastNode } = useToast();
  const tabsId = useId();
  const [tab, setTab] = useState<Tab>('generate');
  const [now] = useState(() => new Date());
  const [version, setVersion] = useState(0);

  const data = useMemo(() => {
    void version;
    return { invoices: getTable<InvoiceRecord>('invoices'), meta: getAllEInvoiceMeta(), links: readLinks() };
  }, [version]);
  const candidates = useMemo(() => bulkCandidates(data.invoices, { from, to }, data.meta), [data, from, to]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(candidates.filter((c) => c.preselect).map((c) => c.invoice.id)));
  const [includeDone, setIncludeDone] = useState(false);
  const [transport, setTransport] = useState<{ mode: EwayTransMode; vehicle: string; distance: string; transporterId: string }>({ mode: 'ROAD', vehicle: '', distance: '', transporterId: '' });

  const selected = useMemo(() => candidates.filter((c) => picked.has(c.invoice.id)).map((c) => c.invoice), [candidates, picked]);
  const fallbackSender = useMemo(() => localDb.settings.activeProfile(), []);
  const ctx = useMemo(
    () => ({ now, fallbackSender, meta: data.meta, links: data.links, allInvoices: data.invoices, includeDone }),
    [now, fallbackSender, data, includeDone],
  );
  const einv = useMemo(() => buildBulkEInvoice(selected, ctx), [selected, ctx]);
  const eway = useMemo(
    () =>
      buildBulkEway(selected, {
        ...ctx,
        transport: {
          mode: transport.mode,
          vehicle: transport.vehicle,
          distance: transport.distance === '' ? undefined : Number(transport.distance),
          transporterId: transport.transporterId,
        },
      }),
    [selected, ctx, transport],
  );

  const toggle = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allOn = candidates.length > 0 && candidates.every((c) => picked.has(c.invoice.id));
  const stamp = `${from}_${to}`;

  /* ── import ── */
  const [text, setText] = useState('');
  const [overwrite, setOverwrite] = useState(false);
  const [result, setResult] = useState<{ parsed: ParsedIrpResponse; result: IrpImportResult } | null>(null);

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > MAX_IMPORT_BYTES) {
      notify('That file is too large to be an IRP response.', 'error');
      return;
    }
    try {
      setText(await file.text());
      setResult(null);
    } catch {
      notify('Could not read that file.', 'error');
    }
  };
  const runImport = () => {
    try {
      const r = importIrpResponse(text, { overwrite });
      setResult(r);
      setVersion((v) => v + 1);
      if (r.parsed.errors.length) notify(r.parsed.errors[0], 'error');
      else notify(`${r.result.written.length} invoice(s) updated with IRN details`);
    } catch (err) {
      notify((err as Error).message || 'Import failed', 'error');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={<><FileJson size={18} aria-hidden="true" /> Bulk e-Invoice / e-Way</>}
      subtitle={`${periodLabel} · generated offline — nothing is sent to any portal`}
      footer={
        <button type="button" className={controls.btnOutline} onClick={onClose}>
          Close
        </button>
      }
    >
      <div className={styles.stack}>
        <div className={styles.tabs} role="tablist" aria-label="Bulk e-Invoice sections">
          <div className={controls.segment}>
            {([['generate', 'Generate files'], ['import', 'Import IRP response']] as const).map(([id, label]) => (
              <button key={id} type="button" role="tab" id={`${tabsId}-${id}`} aria-selected={tab === id} aria-controls={`${tabsId}-panel`}
                className={tab === id ? `${controls.segmentBtn} ${controls.segmentBtnActive}` : controls.segmentBtn} onClick={() => setTab(id)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${tab}`} className={styles.stack}>
          {tab === 'generate' && (
            <>
              {candidates.length === 0 ? (
                <p className={styles.note}>No finalised tax invoices, credit or debit notes in {periodLabel}. Pick another period on the GST page.</p>
              ) : (
                <div className={surface.tableWrap} style={{ maxHeight: 280 }}>
                  <table className={surface.table}>
                    <caption className={surface.srOnly}>Documents to include</caption>
                    <thead>
                      <tr>
                        <th scope="col">
                          <input type="checkbox" aria-label="Select all" checked={allOn}
                            onChange={() => setPicked(allOn ? new Set() : new Set(candidates.map((c) => c.invoice.id)))} />
                        </th>
                        <th scope="col">Number</th><th scope="col">Date</th><th scope="col">Client</th>
                        <th scope="col" className={surface.numeric}>Total</th><th scope="col">Portal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {candidates.map(({ invoice: i, hasIrn, hasEwb }) => (
                        <tr key={i.id}>
                          <td><input type="checkbox" aria-label={`Include ${i.invoice_number}`} checked={picked.has(i.id)} onChange={() => toggle(i.id)} /></td>
                          <td className={surface.mono}>{i.invoice_number}</td>
                          <td>{formatDate(i.issue_date)}</td>
                          <td>{i.client?.company || i.client?.name || '—'}{i.client?.gstin ? '' : ' (no GSTIN)'}</td>
                          <td className={surface.numeric}>{formatMoney(i.total, i.currency)}</td>
                          <td>{hasIrn && <span className={styles.pillOk}>IRN</span>} {hasEwb && <span className={styles.pillOk}>EWB</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <label className={styles.statusLine}>
                <input type="checkbox" checked={includeDone} onChange={(e) => setIncludeDone(e.target.checked)} />
                Include documents that already have an IRN / e-Way Bill (the portal rejects duplicates)
              </label>

              <div className={styles.section}>
                <h3 className={styles.sectionTitle}><FileJson size={14} aria-hidden="true" /> e-Invoice (IRP) bulk file</h3>
                <div className={styles.summary}>
                  <span className={einv.included.length ? styles.pillOk : styles.pill}>{einv.included.length} in file</span>
                  <span className={einv.blocked.length ? styles.pillBad : styles.pill}>{einv.blocked.length} blocked</span>
                </div>
                <div className={styles.actions}>
                  <button type="button" className={controls.btnPrimary} disabled={!einv.included.length}
                    onClick={() => download(`einvoice_bulk_${stamp}.json`, einv.json)}>
                    <Download size={16} aria-hidden="true" /> Download e-Invoice JSON
                  </button>
                </div>
                <p className={styles.note}>Upload on the IRP under e-Invoice → Bulk Generation. Each invoice passed the same offline checks as the single e-Invoice dialog.</p>
              </div>
              <BlockedList title="Left out of the e-Invoice file" rows={einv.blocked} />

              <div className={styles.section}>
                <h3 className={styles.sectionTitle}><Truck size={14} aria-hidden="true" /> e-Way Bill bulk file</h3>
                <div className={styles.grid3}>
                  <Field label="Mode">
                    <select className={controls.select} value={transport.mode} onChange={(e) => setTransport({ ...transport, mode: e.target.value as EwayTransMode })}>
                      <option value="ROAD">Road</option><option value="RAIL">Rail</option><option value="AIR">Air</option><option value="SHIP">Ship</option>
                    </select>
                  </Field>
                  <Field label="Vehicle no. (all)">
                    <input className={`${controls.input} ${controls.inputMono}`} value={transport.vehicle} placeholder="MH12AB1234"
                      onChange={(e) => setTransport({ ...transport, vehicle: e.target.value })} />
                  </Field>
                  <Field label="Distance (km)" hint="0 = portal calculates">
                    <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="numeric" value={transport.distance}
                      onChange={(e) => setTransport({ ...transport, distance: e.target.value.replace(/\D/g, '') })} />
                  </Field>
                </div>
                <Field label="Transporter GSTIN (instead of a vehicle)">
                  <input className={`${controls.input} ${controls.inputMono}`} maxLength={15} value={transport.transporterId}
                    onChange={(e) => setTransport({ ...transport, transporterId: e.target.value.toUpperCase() })} />
                </Field>
                <p className={styles.note}>Transport saved with an invoice (single e-Invoice dialog → e-Way tab) is used for that invoice; the details above fill the rest.</p>
                <div className={styles.summary}>
                  <span className={eway.included.length ? styles.pillOk : styles.pill}>{eway.included.length} in file</span>
                  <span className={eway.blocked.length ? styles.pillBad : styles.pill}>{eway.blocked.length} blocked</span>
                </div>
                <div className={styles.actions}>
                  <button type="button" className={controls.btnPrimary} disabled={!eway.included.length}
                    onClick={() => download(`ewaybill_bulk_${stamp}.json`, eway.json)}>
                    <Download size={16} aria-hidden="true" /> Download e-Way JSON
                  </button>
                </div>
              </div>
              <BlockedList title="Left out of the e-Way file" rows={eway.blocked} />
            </>
          )}

          {tab === 'import' && (
            <>
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}><Upload size={14} aria-hidden="true" /> IRP bulk response</h3>
                <p className={styles.note}>
                  Load the JSON the IRP returned, or the bulk tool&rsquo;s result sheet saved as CSV. Rows are matched to your
                  invoices by document number; IRN, Ack No / date, signed QR and e-Way Bill no. are saved with each invoice and
                  print on every template. Nothing leaves this device.
                </p>
                <input type="file" accept=".json,.csv,.txt,application/json,text/csv" aria-label="IRP response file"
                  onChange={(e) => void readFile(e.target.files?.[0])} />
                <Field label="…or paste it here">
                  <textarea className={controls.textarea} rows={5} spellCheck={false} value={text}
                    onChange={(e) => { setText(e.target.value); setResult(null); }} />
                </Field>
                <label className={styles.statusLine}>
                  <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                  Replace an IRN already saved on an invoice
                </label>
                <div className={styles.actions}>
                  <button type="button" className={controls.btnPrimary} disabled={!text.trim()} onClick={runImport}>
                    <Upload size={16} aria-hidden="true" /> Import
                  </button>
                </div>
              </div>
              {result && (
                <div className={styles.section} aria-live="polite">
                  <h3 className={styles.sectionTitle}>Result</h3>
                  <div className={styles.summary}>
                    <span className={styles.pillOk}>{result.result.written.length} saved</span>
                    <span className={result.result.unmatched.length ? styles.pillWarn : styles.pill}>{result.result.unmatched.length} not matched</span>
                    <span className={result.result.failed.length ? styles.pillBad : styles.pill}>{result.result.failed.length} rejected / skipped</span>
                  </div>
                  {result.parsed.errors.map((e) => <p key={e} className={styles.note}>{e}</p>)}
                  <ul className={styles.checklist}>
                    {result.result.written.map((w) => (
                      <li key={`w${w.line}`} className={styles.statusLine}>
                        <span className={styles.pillOk}>{w.number}</span>
                        <span className={styles.mono}>{w.irn.slice(0, 16)}…{w.replaced ? ' (replaced)' : ''}</span>
                      </li>
                    ))}
                    {[...result.result.unmatched, ...result.result.failed].map((u) => (
                      <li key={`u${u.line}`} className={styles.statusLine}>
                        <span className={styles.pillWarn}>Row {u.line}{u.docNo ? ` · ${u.docNo}` : ''}</span>
                        <span>{u.reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>
      {toastNode}
    </Modal>
  );
}

import { useId, useMemo, useState, type ReactNode } from 'react';
import { ClipboardCopy, Download, FileJson, QrCode, Save, Truck } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { useToast } from '../ui/useToast';
import controls from '../../styles/controls.module.css';
import styles from './einvoice.module.css';
import { ReadinessList } from './ReadinessList';
import type { InvoiceRecord } from '../../types/invoice';
import {
  getEInvoiceMeta,
  saveEInvoiceMeta,
  sanitiseFileStem,
  stringifyEInvoice,
  validateMeta,
  type EInvoiceMeta,
  type EInvoiceSupplyType,
} from '../../lib/einvoice';
import { stringifyEway, type EwayTransMode } from '../../lib/eway';
import { preflightEInvoice, preflightEway } from '../../lib/einvoice-validate';
import { localDb } from '../../lib/localDb';

export interface EInvoiceModalProps {
  invoice: InvoiceRecord;
  open: boolean;
  onClose: () => void;
}

type Tab = 'einvoice' | 'eway' | 'portal';

const TABS: { id: Tab; label: string }[] = [
  { id: 'einvoice', label: 'e-Invoice' },
  { id: 'eway', label: 'e-Way Bill' },
  { id: 'portal', label: 'Portal details' },
];

const SUPPLY_TYPES: { value: '' | EInvoiceSupplyType; label: string }[] = [
  { value: '', label: 'Automatic (B2B / Export)' },
  { value: 'B2B', label: 'B2B' },
  { value: 'SEZWP', label: 'SEZ with payment' },
  { value: 'SEZWOP', label: 'SEZ without payment' },
  { value: 'EXPWP', label: 'Export with payment' },
  { value: 'EXPWOP', label: 'Export without payment' },
  { value: 'DEXP', label: 'Deemed export' },
];

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

/**
 * e-Invoice / e-Way Bill helper for one invoice. Everything is generated
 * offline; the user uploads the JSON on the GST portals themselves and then
 * records what came back under "Portal details".
 */
export function EInvoiceModal({ invoice, open, onClose }: EInvoiceModalProps) {
  if (!open) return null;
  return <EInvoiceModalBody invoice={invoice} onClose={onClose} />;
}

function EInvoiceModalBody({ invoice, onClose }: { invoice: InvoiceRecord; onClose: () => void }) {
  const { notify, toastNode } = useToast();
  const tabsId = useId();
  const [tab, setTab] = useState<Tab>('einvoice');
  const [now] = useState(() => new Date());
  const [meta, setMeta] = useState<EInvoiceMeta>(
    () => getEInvoiceMeta(invoice.id) ?? { invoice_id: invoice.id },
  );
  const [supplyType, setSupplyType] = useState<'' | EInvoiceSupplyType>('');
  const [precNo, setPrecNo] = useState('');
  const [precDate, setPrecDate] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [portCode, setPortCode] = useState('');
  const [dirty, setDirty] = useState(false);

  const fallbackSender = useMemo(() => (invoice.sender ? null : localDb.settings.activeProfile()), [invoice.sender]);
  const isExport = (invoice.place_of_supply ?? '') === '99';
  const isNote = invoice.doc_type === 'CREDIT_NOTE';

  const patch = (p: Partial<EInvoiceMeta>) => {
    setMeta((m) => ({ ...m, ...p }));
    setDirty(true);
  };

  const einv = useMemo(
    () =>
      preflightEInvoice(invoice, {
        now,
        fallbackSender,
        supplyType: supplyType || undefined,
        preceding: isNote && precNo && precDate ? [{ no: precNo, date: precDate }] : undefined,
        export: isExport ? { countryCode, portCode } : undefined,
      }),
    [invoice, now, fallbackSender, supplyType, isNote, precNo, precDate, isExport, countryCode, portCode],
  );

  const eway = useMemo(
    () =>
      preflightEway(invoice, {
        now,
        fallbackSender,
        transport: {
          mode: (meta.transport ?? 'ROAD') as EwayTransMode,
          vehicle: meta.vehicle,
          vehicleType: meta.vehicle_type,
          distance: meta.distance,
          transporterId: meta.transporter_id,
          transporterName: meta.transporter_name,
          docNo: meta.transport_doc_no,
          docDate: meta.transport_doc_date,
        },
      }),
    [invoice, now, fallbackSender, meta],
  );

  const metaIssues = useMemo(() => validateMeta(meta), [meta]);
  const stem = sanitiseFileStem(invoice.invoice_number || invoice.id);

  const einvText = useMemo(() => stringifyEInvoice(einv.payload), [einv.payload]);
  const ewayText = useMemo(() => stringifyEway({ version: '1.0.0621', billLists: [eway.bill] }), [eway.bill]);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(`${what} copied to clipboard`);
    } catch {
      notify('Could not access the clipboard — use Download instead', 'error');
    }
  };

  const save = () => {
    const blocking = metaIssues.filter((i) => i.severity === 'error');
    if (blocking.length) {
      notify(blocking[0].message, 'error');
      return;
    }
    try {
      const trimmed: EInvoiceMeta = { ...meta, irn: meta.irn?.trim().toLowerCase(), signed_qr: meta.signed_qr?.trim() };
      setMeta(saveEInvoiceMeta(trimmed));
      setDirty(false);
      notify('Portal details saved');
    } catch (err) {
      notify((err as Error).message || 'Could not save', 'error');
    }
  };

  const inputProps = (key: keyof EInvoiceMeta) => ({
    className: controls.input,
    value: String(meta[key] ?? ''),
    onChange: (e: { target: { value: string } }) => patch({ [key]: e.target.value } as Partial<EInvoiceMeta>),
  });

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={
        <>
          <FileJson size={18} aria-hidden="true" /> e-Invoice / e-Way
        </>
      }
      subtitle={`${invoice.invoice_number || 'Unnumbered'} · generated offline — nothing is sent to any portal`}
      footer={
        <div className={styles.footerRow}>
          <span className={styles.note}>{dirty ? 'You have unsaved portal details.' : 'Saved on this device only.'}</span>
          <div className={styles.actions}>
            <button type="button" className={controls.btnPrimary} onClick={save} disabled={!dirty}>
              <Save size={16} aria-hidden="true" /> Save details
            </button>
            <button type="button" className={controls.btnOutline} onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      }
    >
      <div className={styles.stack}>
        <div className={styles.tabs} role="tablist" aria-label="e-Invoice sections">
          <div className={controls.segment}>
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`${tabsId}-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`${tabsId}-panel`}
                className={tab === t.id ? `${controls.segmentBtn} ${controls.segmentBtnActive}` : controls.segmentBtn}
                onClick={() => setTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          {meta.irn && <span className={styles.pillOk}>IRN recorded</span>}
        </div>

        <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${tab}`} className={styles.stack}>
          {tab === 'einvoice' && (
            <>
              <ReadinessList result={einv} okText="Ready — this invoice passes every offline IRP check." />
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>Options</h3>
                <div className={styles.grid2}>
                  <Field label="Supply type">
                    <select
                      className={controls.select}
                      value={supplyType}
                      onChange={(e) => setSupplyType(e.target.value as '' | EInvoiceSupplyType)}
                    >
                      {SUPPLY_TYPES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {isExport && (
                    <Field label="Country code" hint="Two-letter, e.g. US">
                      <input className={controls.input} maxLength={2} value={countryCode} onChange={(e) => setCountryCode(e.target.value.toUpperCase())} />
                    </Field>
                  )}
                </div>
                {isExport && (
                  <Field label="Port code" hint="Optional, e.g. INBOM4">
                    <input className={controls.input} maxLength={6} value={portCode} onChange={(e) => setPortCode(e.target.value.toUpperCase())} />
                  </Field>
                )}
                {isNote && (
                  <div className={styles.grid2}>
                    <Field label="Original invoice no.">
                      <input className={controls.input} value={precNo} onChange={(e) => setPrecNo(e.target.value)} placeholder="INV/FY25-26/0001" />
                    </Field>
                    <Field label="Original invoice date">
                      <input className={controls.input} type="date" value={precDate} onChange={(e) => setPrecDate(e.target.value)} />
                    </Field>
                  </div>
                )}
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={controls.btnPrimary}
                  disabled={!einv.ready}
                  onClick={() => download(`einvoice_${stem}.json`, einvText)}
                >
                  <Download size={16} aria-hidden="true" /> Download e-Invoice JSON
                </button>
                <button type="button" className={controls.btnOutline} onClick={() => copy(einvText, 'e-Invoice JSON')}>
                  <ClipboardCopy size={16} aria-hidden="true" /> Copy JSON
                </button>
              </div>
              {!einv.ready && (
                <p className={styles.note}>Download is enabled once blocking issues are fixed. You can still copy the draft JSON to inspect it.</p>
              )}
              <pre className={styles.preview} tabIndex={0} aria-label="e-Invoice JSON preview">{einvText}</pre>
              <p className={styles.note}>
                Upload on the IRP portal under e-Invoice → Generate → Bulk Generation. Only taxpayers over the
                notified turnover limit need e-Invoicing, and only for B2B, SEZ and export supplies.
              </p>
            </>
          )}

          {tab === 'eway' && (
            <>
              <ReadinessList result={eway} okText="Ready — this e-Way Bill file passes every offline check." />
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>
                  <Truck size={14} aria-hidden="true" /> Transport (Part B)
                </h3>
                <div className={styles.grid3}>
                  <Field label="Mode">
                    <select
                      className={controls.select}
                      value={meta.transport ?? 'ROAD'}
                      onChange={(e) => patch({ transport: e.target.value as EInvoiceMeta['transport'] })}
                    >
                      <option value="ROAD">Road</option>
                      <option value="RAIL">Rail</option>
                      <option value="AIR">Air</option>
                      <option value="SHIP">Ship</option>
                    </select>
                  </Field>
                  <Field label="Vehicle no.">
                    <input {...inputProps('vehicle')} className={`${controls.input} ${controls.inputMono}`} placeholder="MH12AB1234" />
                  </Field>
                  <Field label="Vehicle type">
                    <select
                      className={controls.select}
                      value={meta.vehicle_type ?? 'R'}
                      onChange={(e) => patch({ vehicle_type: e.target.value as 'R' | 'O' })}
                    >
                      <option value="R">Regular</option>
                      <option value="O">Over-dimensional cargo</option>
                    </select>
                  </Field>
                </div>
                <div className={styles.grid3}>
                  <Field label="Distance (km)" hint="0 = portal calculates it">
                    <input
                      className={`${controls.input} ${controls.inputNumeric}`}
                      type="number"
                      min={0}
                      max={4000}
                      inputMode="numeric"
                      value={meta.distance ?? ''}
                      onChange={(e) => patch({ distance: e.target.value === '' ? undefined : Number(e.target.value) })}
                    />
                  </Field>
                  <Field label="Transporter GSTIN">
                    <input {...inputProps('transporter_id')} className={`${controls.input} ${controls.inputMono}`} maxLength={15} />
                  </Field>
                  <Field label="Transporter name">
                    <input {...inputProps('transporter_name')} />
                  </Field>
                </div>
                <div className={styles.grid2}>
                  <Field label="Transport doc no." hint="LR / RR / airway bill no.">
                    <input {...inputProps('transport_doc_no')} />
                  </Field>
                  <Field label="Transport doc date">
                    <input className={controls.input} type="date" value={meta.transport_doc_date ?? ''} onChange={(e) => patch({ transport_doc_date: e.target.value })} />
                  </Field>
                </div>
              </div>
              <div className={styles.actions}>
                <button
                  type="button"
                  className={controls.btnPrimary}
                  disabled={!eway.ready}
                  onClick={() => download(`ewaybill_${stem}.json`, ewayText)}
                >
                  <Download size={16} aria-hidden="true" /> Download e-Way JSON
                </button>
                <button type="button" className={controls.btnOutline} onClick={() => copy(ewayText, 'e-Way Bill JSON')}>
                  <ClipboardCopy size={16} aria-hidden="true" /> Copy JSON
                </button>
              </div>
              <pre className={styles.preview} tabIndex={0} aria-label="e-Way Bill JSON preview">{ewayText}</pre>
              <p className={styles.note}>
                Upload on the e-Way Bill portal under e-Waybill → Generate (Bulk). Transport details are kept with
                this invoice when you press Save details.
              </p>
            </>
          )}

          {tab === 'portal' && (
            <>
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>
                  <QrCode size={14} aria-hidden="true" /> Returned by the IRP
                </h3>
                <Field label="IRN" hint="64-character hash">
                  <input {...inputProps('irn')} className={`${controls.input} ${controls.inputMono}`} spellCheck={false} />
                </Field>
                <div className={styles.grid2}>
                  <Field label="Ack No.">
                    <input {...inputProps('ack_no')} inputMode="numeric" />
                  </Field>
                  <Field label="Ack date">
                    <input
                      className={controls.input}
                      type="datetime-local"
                      value={(meta.ack_date ?? '').replace(' ', 'T').slice(0, 16)}
                      onChange={(e) => patch({ ack_date: e.target.value.replace('T', ' ') })}
                    />
                  </Field>
                </div>
                <Field label="Signed QR code" hint="Paste the long signed token; templates can render it as a QR.">
                  <textarea
                    className={controls.textarea}
                    rows={3}
                    spellCheck={false}
                    value={meta.signed_qr ?? ''}
                    onChange={(e) => patch({ signed_qr: e.target.value })}
                  />
                </Field>
              </div>
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>
                  <Truck size={14} aria-hidden="true" /> Returned by the e-Way portal
                </h3>
                <div className={styles.grid3}>
                  <Field label="e-Way Bill no." hint="12 digits">
                    <input {...inputProps('eway_no')} inputMode="numeric" maxLength={12} />
                  </Field>
                  <Field label="Generated on">
                    <input className={controls.input} type="date" value={meta.eway_date ?? ''} onChange={(e) => patch({ eway_date: e.target.value })} />
                  </Field>
                  <Field label="Valid until">
                    <input className={controls.input} type="date" value={meta.eway_valid_upto ?? ''} onChange={(e) => patch({ eway_valid_upto: e.target.value })} />
                  </Field>
                </div>
              </div>
              {metaIssues.length > 0 && (
                <ReadinessList
                  result={{
                    errors: metaIssues.filter((i) => i.severity === 'error'),
                    warnings: metaIssues.filter((i) => i.severity === 'warning'),
                    ready: !metaIssues.some((i) => i.severity === 'error'),
                  }}
                  okText=""
                />
              )}
            </>
          )}
        </div>
      </div>
      {toastNode}
    </Modal>
  );
}

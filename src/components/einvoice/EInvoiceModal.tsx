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
import { unitsDb } from '../../lib/units';
import { readLinks } from '../../lib/documents';
import { useT } from '../../i18n';
import { einvT } from '../../i18n/areas/einvoice';

export interface EInvoiceModalProps {
  invoice: InvoiceRecord;
  open: boolean;
  onClose: () => void;
}

type Tab = 'einvoice' | 'eway' | 'portal';

/** Tab / supply-type names: portal terms stay Latin, the rest go through the area translator. */
const TABS: { id: Tab; label: () => string }[] = [
  { id: 'einvoice', label: () => 'e-Invoice' },
  { id: 'eway', label: () => 'e-Way Bill' },
  { id: 'portal', label: () => einvT('tabPortal') },
];

const SUPPLY_TYPES: { value: '' | EInvoiceSupplyType; label: () => string }[] = [
  { value: '', label: () => einvT('stAuto') },
  { value: 'B2B', label: () => 'B2B' },
  { value: 'SEZWP', label: () => einvT('stSezwp') },
  { value: 'SEZWOP', label: () => einvT('stSezwop') },
  { value: 'EXPWP', label: () => einvT('stExpwp') },
  { value: 'EXPWOP', label: () => einvT('stExpwop') },
  { value: 'DEXP', label: () => einvT('stDexp') },
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
  useT();
  const { notify, toastNode } = useToast();
  const tabsId = useId();
  // A Bill of Supply is outside e-invoicing: only the e-Way Bill and portal tabs apply.
  const bos = invoice.doc_type === 'BILL_OF_SUPPLY';
  const tabs = bos ? TABS.filter((t) => t.id !== 'einvoice') : TABS;
  const [tab, setTab] = useState<Tab>(bos ? 'eway' : 'einvoice');
  const [now] = useState(() => new Date());
  const [meta, setMeta] = useState<EInvoiceMeta>(
    () => getEInvoiceMeta(invoice.id) ?? { invoice_id: invoice.id },
  );
  const [supplyType, setSupplyType] = useState<'' | EInvoiceSupplyType>('');
  // A note linked to its original invoice pre-fills the preceding-document details.
  const original = useMemo(() => {
    const link = readLinks().find((l) => l.to_id === invoice.id && (l.relation === 'credit_note' || l.relation === 'debit_note'));
    return link ? localDb.invoices.getById(link.from_id) : undefined;
  }, [invoice.id]);
  const [precNo, setPrecNo] = useState(original?.invoice_number ?? '');
  const [precDate, setPrecDate] = useState(original?.issue_date?.slice(0, 10) ?? '');
  const [countryCode, setCountryCode] = useState('');
  const [portCode, setPortCode] = useState(invoice.port_code ?? '');
  const [dirty, setDirty] = useState(false);

  const fallbackSender = useMemo(() => (invoice.sender ? null : localDb.settings.activeProfile()), [invoice.sender]);
  // WP-8: user-defined units carry their own UQC (units master).
  const units = useMemo(() => unitsDb.stored(), []);
  const isExport = (invoice.place_of_supply ?? '') === '99';
  const isNote = invoice.doc_type === 'CREDIT_NOTE' || invoice.doc_type === 'DEBIT_NOTE';

  const patch = (p: Partial<EInvoiceMeta>) => {
    setMeta((m) => ({ ...m, ...p }));
    setDirty(true);
  };

  const einv = useMemo(
    () =>
      preflightEInvoice(invoice, {
        now,
        fallbackSender,
        units,
        supplyType: supplyType || undefined,
        preceding: isNote && precNo && precDate ? [{ no: precNo, date: precDate }] : undefined,
        export: isExport ? { countryCode, portCode } : undefined,
      }),
    [invoice, now, fallbackSender, units, supplyType, isNote, precNo, precDate, isExport, countryCode, portCode],
  );

  const eway = useMemo(
    () =>
      preflightEway(invoice, {
        now,
        fallbackSender,
        units,
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
    [invoice, now, fallbackSender, units, meta],
  );

  const metaIssues = useMemo(() => validateMeta(meta), [meta]);
  const stem = sanitiseFileStem(invoice.invoice_number || invoice.id);

  const einvText = useMemo(() => stringifyEInvoice(einv.payload), [einv.payload]);
  const ewayText = useMemo(() => stringifyEway({ version: '1.0.0621', billLists: [eway.bill] }), [eway.bill]);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(einvT('copied', { what }));
    } catch {
      notify(einvT('clipboardFailed'), 'error');
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
      notify(einvT('detailsSaved'));
    } catch (err) {
      notify((err as Error).message || einvT('saveFailed'), 'error');
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
      subtitle={einvT('offlineSubtitle', { doc: invoice.invoice_number || einvT('unnumbered') })}
      footer={
        <div className={styles.footerRow}>
          <span className={styles.note}>{dirty ? einvT('unsaved') : einvT('savedLocal')}</span>
          <div className={styles.actions}>
            <button type="button" className={controls.btnPrimary} onClick={save} disabled={!dirty}>
              <Save size={16} aria-hidden="true" /> {einvT('saveDetails')}
            </button>
            <button type="button" className={controls.btnOutline} onClick={onClose}>
              {einvT('close')}
            </button>
          </div>
        </div>
      }
    >
      <div className={styles.stack}>
        <div className={styles.tabs} role="tablist" aria-label={einvT('sections')}>
          <div className={controls.segment}>
            {tabs.map((t) => (
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
                {t.label()}
              </button>
            ))}
          </div>
          {meta.irn && <span className={styles.pillOk}>{einvT('irnRecorded')}</span>}
        </div>

        <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${tab}`} className={styles.stack}>
          {tab === 'einvoice' && (
            <>
              <ReadinessList result={einv} okText={einvT('einvReady')} />
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>{einvT('options')}</h3>
                <div className={styles.grid2}>
                  <Field label={einvT('supplyType')}>
                    <select
                      className={controls.select}
                      value={supplyType}
                      onChange={(e) => setSupplyType(e.target.value as '' | EInvoiceSupplyType)}
                    >
                      {SUPPLY_TYPES.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label()}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {isExport && (
                    <Field label={einvT('countryCode')} hint={einvT('countryHint')}>
                      <input className={controls.input} maxLength={2} value={countryCode} onChange={(e) => setCountryCode(e.target.value.toUpperCase())} />
                    </Field>
                  )}
                </div>
                {isExport && (
                  <Field label={einvT('portCode')} hint={einvT('portHint')}>
                    <input className={controls.input} maxLength={6} value={portCode} onChange={(e) => setPortCode(e.target.value.toUpperCase())} />
                  </Field>
                )}
                {isNote && (
                  <div className={styles.grid2}>
                    <Field label={einvT('origNo')}>
                      <input className={controls.input} value={precNo} onChange={(e) => setPrecNo(e.target.value)} placeholder="INV/FY25-26/0001" />
                    </Field>
                    <Field label={einvT('origDate')}>
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
                  <Download size={16} aria-hidden="true" /> {einvT('downloadEinv')}
                </button>
                <button type="button" className={controls.btnOutline} onClick={() => copy(einvText, 'e-Invoice JSON')}>
                  <ClipboardCopy size={16} aria-hidden="true" /> {einvT('copyJson')}
                </button>
              </div>
              {!einv.ready && (
                <p className={styles.note}>{einvT('downloadDisabled')}</p>
              )}
              <pre className={styles.preview} tabIndex={0} aria-label={einvT('einvPreview')}>{einvText}</pre>
              <p className={styles.note}>
                {einvT('einvUploadNote')}
              </p>
            </>
          )}

          {tab === 'eway' && (
            <>
              <ReadinessList result={eway} okText={einvT('ewayReady')} />
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>
                  <Truck size={14} aria-hidden="true" /> {einvT('transportPartB')}
                </h3>
                <div className={styles.grid3}>
                  <Field label={einvT('mode')}>
                    <select
                      className={controls.select}
                      value={meta.transport ?? 'ROAD'}
                      onChange={(e) => patch({ transport: e.target.value as EInvoiceMeta['transport'] })}
                    >
                      <option value="ROAD">{einvT('road')}</option>
                      <option value="RAIL">{einvT('rail')}</option>
                      <option value="AIR">{einvT('air')}</option>
                      <option value="SHIP">{einvT('ship')}</option>
                    </select>
                  </Field>
                  <Field label={einvT('vehicleNo')}>
                    <input {...inputProps('vehicle')} className={`${controls.input} ${controls.inputMono}`} placeholder="MH12AB1234" />
                  </Field>
                  <Field label={einvT('vehicleType')}>
                    <select
                      className={controls.select}
                      value={meta.vehicle_type ?? 'R'}
                      onChange={(e) => patch({ vehicle_type: e.target.value as 'R' | 'O' })}
                    >
                      <option value="R">{einvT('regular')}</option>
                      <option value="O">{einvT('odc')}</option>
                    </select>
                  </Field>
                </div>
                <div className={styles.grid3}>
                  <Field label={einvT('distance')} hint={einvT('distanceHint')}>
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
                  <Field label={einvT('transporterGstin')}>
                    <input {...inputProps('transporter_id')} className={`${controls.input} ${controls.inputMono}`} maxLength={15} />
                  </Field>
                  <Field label={einvT('transporterName')}>
                    <input {...inputProps('transporter_name')} />
                  </Field>
                </div>
                <div className={styles.grid2}>
                  <Field label={einvT('transportDocNo')} hint={einvT('transportDocHint')}>
                    <input {...inputProps('transport_doc_no')} />
                  </Field>
                  <Field label={einvT('transportDocDate')}>
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
                  <Download size={16} aria-hidden="true" /> {einvT('downloadEway')}
                </button>
                <button type="button" className={controls.btnOutline} onClick={() => copy(ewayText, 'e-Way Bill JSON')}>
                  <ClipboardCopy size={16} aria-hidden="true" /> {einvT('copyJson')}
                </button>
              </div>
              <pre className={styles.preview} tabIndex={0} aria-label={einvT('ewayPreview')}>{ewayText}</pre>
              <p className={styles.note}>
                {einvT('ewayUploadNote')}
              </p>
            </>
          )}

          {tab === 'portal' && (
            <>
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}>
                  <QrCode size={14} aria-hidden="true" /> {einvT('returnedIrp')}
                </h3>
                <Field label="IRN" hint={einvT('irnHint')}>
                  <input {...inputProps('irn')} className={`${controls.input} ${controls.inputMono}`} spellCheck={false} />
                </Field>
                <div className={styles.grid2}>
                  <Field label="Ack No.">
                    <input {...inputProps('ack_no')} inputMode="numeric" />
                  </Field>
                  <Field label={einvT('ackDate')}>
                    <input
                      className={controls.input}
                      type="datetime-local"
                      value={(meta.ack_date ?? '').replace(' ', 'T').slice(0, 16)}
                      onChange={(e) => patch({ ack_date: e.target.value.replace('T', ' ') })}
                    />
                  </Field>
                </div>
                <Field label={einvT('signedQr')} hint={einvT('signedQrHint')}>
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
                  <Truck size={14} aria-hidden="true" /> {einvT('returnedEway')}
                </h3>
                <div className={styles.grid3}>
                  <Field label={einvT('ewayNo')} hint={einvT('ewayNoHint')}>
                    <input {...inputProps('eway_no')} inputMode="numeric" maxLength={12} />
                  </Field>
                  <Field label={einvT('generatedOn')}>
                    <input className={controls.input} type="date" value={meta.eway_date ?? ''} onChange={(e) => patch({ eway_date: e.target.value })} />
                  </Field>
                  <Field label={einvT('validUntil')}>
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

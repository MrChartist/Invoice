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
import { unitsDb } from '../../lib/units';
import type { EwayTransMode } from '../../lib/eway';
import {
  buildBulkEInvoice,
  buildBulkEway,
  bulkCandidates,
  isEwayOnly,
  importIrpResponse,
  type BulkBlocked,
  type IrpImportResult,
  type ParsedIrpResponse,
} from '../../lib/einvoice-bulk';
import { formatDate, formatMoney } from '../../lib/utils';
import { useT } from '../../i18n';
import { einvT } from '../../i18n/areas/einvoice';
import { plural } from '../../i18n/areas/plural';
import { IrpWindowPill } from './IrpWindowNote';

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
  useT();
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
  useT();
  const { notify, toastNode } = useToast();
  const tabsId = useId();
  const [tab, setTab] = useState<Tab>('generate');
  const [now] = useState(() => new Date());
  const [version, setVersion] = useState(0);

  const data = useMemo(() => {
    void version;
    return { invoices: getTable<InvoiceRecord>('invoices'), meta: getAllEInvoiceMeta(), links: readLinks(), units: unitsDb.stored() };
  }, [version]);
  // Bills of Supply move goods on an e-Way Bill (NIC type BIL) but have no e-Invoice: offered on request.
  const [withBos, setWithBos] = useState(false);
  const candidates = useMemo(() => bulkCandidates(data.invoices, { from, to }, data.meta, { billsOfSupply: withBos }), [data, from, to, withBos]);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(candidates.filter((c) => c.preselect).map((c) => c.invoice.id)));
  const [includeDone, setIncludeDone] = useState(false);
  const [transport, setTransport] = useState<{ mode: EwayTransMode; vehicle: string; distance: string; transporterId: string }>({ mode: 'ROAD', vehicle: '', distance: '', transporterId: '' });

  const selected = useMemo(() => candidates.filter((c) => picked.has(c.invoice.id)).map((c) => c.invoice), [candidates, picked]);
  const fallbackSender = useMemo(() => localDb.settings.activeProfile(), []);
  const ctx = useMemo(
    () => ({ now, fallbackSender, meta: data.meta, links: data.links, allInvoices: data.invoices, includeDone, units: data.units }),
    [now, fallbackSender, data, includeDone],
  );
  const einv = useMemo(() => buildBulkEInvoice(selected.filter((i) => !isEwayOnly(i)), ctx), [selected, ctx]);
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
      notify(einvT('tooLarge'), 'error');
      return;
    }
    try {
      setText(await file.text());
      setResult(null);
    } catch {
      notify(einvT('readFailed'), 'error');
    }
  };
  const runImport = () => {
    try {
      const r = importIrpResponse(text, { overwrite });
      setResult(r);
      setVersion((v) => v + 1);
      if (r.parsed.errors.length) notify(r.parsed.errors[0], 'error');
      else notify(plural(einvT, 'importedOne', 'importedMany', r.result.written.length));
    } catch (err) {
      notify((err as Error).message || einvT('importFailed'), 'error');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={<><FileJson size={18} aria-hidden="true" /> {einvT('bulkTitle')}</>}
      subtitle={einvT('offlineSubtitle', { doc: periodLabel })}
      footer={
        <button type="button" className={controls.btnOutline} onClick={onClose}>
          {einvT('close')}
        </button>
      }
    >
      <div className={styles.stack}>
        <div className={styles.tabs} role="tablist" aria-label={einvT('bulkSections')}>
          <div className={controls.segment}>
            {([['generate', einvT('tabGenerate')], ['import', einvT('tabImport')]] as const).map(([id, label]) => (
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
                <p className={styles.note}>{einvT('noCandidates', { period: periodLabel })}</p>
              ) : (
                <div className={surface.tableWrap} style={{ maxHeight: 280 }}>
                  <table className={surface.table}>
                    <caption className={surface.srOnly}>{einvT('docsCaption')}</caption>
                    <thead>
                      <tr>
                        <th scope="col">
                          <input type="checkbox" aria-label={einvT('selectAll')} checked={allOn}
                            onChange={() => setPicked(allOn ? new Set() : new Set(candidates.map((c) => c.invoice.id)))} />
                        </th>
                        <th scope="col">{einvT('colNumber')}</th><th scope="col">{einvT('colDate')}</th><th scope="col">{einvT('colClient')}</th>
                        <th scope="col" className={surface.numeric}>{einvT('colTotal')}</th><th scope="col">{einvT('colPortal')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {candidates.map(({ invoice: i, hasIrn, hasEwb }) => (
                        <tr key={i.id}>
                          <td><input type="checkbox" aria-label={einvT('includeDoc', { number: i.invoice_number })} checked={picked.has(i.id)} onChange={() => toggle(i.id)} /></td>
                          <td className={surface.mono}>{i.invoice_number}</td>
                          <td>{formatDate(i.issue_date)} <IrpWindowPill invoice={i} hasIrn={hasIrn} /></td>
                          <td>{i.client?.company || i.client?.name || '—'}{i.client?.gstin ? '' : einvT('noGstin')}</td>
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
                {einvT('includeDone')}
              </label>
              <label className={styles.statusLine}>
                <input type="checkbox" checked={withBos} onChange={(e) => setWithBos(e.target.checked)} />
                Include Bills of Supply (e-Way Bill only, document type BIL)
              </label>

              <div className={styles.section}>
                <h3 className={styles.sectionTitle}><FileJson size={14} aria-hidden="true" /> {einvT('einvBulkFile')}</h3>
                <div className={styles.summary}>
                  <span className={einv.included.length ? styles.pillOk : styles.pill}>{einvT('inFile', { n: einv.included.length })}</span>
                  <span className={einv.blocked.length ? styles.pillBad : styles.pill}>{einvT('blockedCount', { n: einv.blocked.length })}</span>
                </div>
                <div className={styles.actions}>
                  <button type="button" className={controls.btnPrimary} disabled={!einv.included.length}
                    onClick={() => download(`einvoice_bulk_${stamp}.json`, einv.json)}>
                    <Download size={16} aria-hidden="true" /> {einvT('downloadEinv')}
                  </button>
                </div>
                <p className={styles.note}>{einvT('einvBulkNote')}</p>
              </div>
              <BlockedList title={einvT('leftOutEinv')} rows={einv.blocked} />

              <div className={styles.section}>
                <h3 className={styles.sectionTitle}><Truck size={14} aria-hidden="true" /> {einvT('ewayBulkFile')}</h3>
                <div className={styles.grid3}>
                  <Field label={einvT('mode')}>
                    <select className={controls.select} value={transport.mode} onChange={(e) => setTransport({ ...transport, mode: e.target.value as EwayTransMode })}>
                      <option value="ROAD">{einvT('road')}</option><option value="RAIL">{einvT('rail')}</option><option value="AIR">{einvT('air')}</option><option value="SHIP">{einvT('ship')}</option>
                    </select>
                  </Field>
                  <Field label={einvT('vehicleAll')}>
                    <input className={`${controls.input} ${controls.inputMono}`} value={transport.vehicle} placeholder="MH12AB1234"
                      onChange={(e) => setTransport({ ...transport, vehicle: e.target.value })} />
                  </Field>
                  <Field label={einvT('distance')} hint={einvT('distanceHintShort')}>
                    <input className={`${controls.input} ${controls.inputNumeric}`} inputMode="numeric" value={transport.distance}
                      onChange={(e) => setTransport({ ...transport, distance: e.target.value.replace(/\D/g, '') })} />
                  </Field>
                </div>
                <Field label={einvT('transporterInstead')}>
                  <input className={`${controls.input} ${controls.inputMono}`} maxLength={15} value={transport.transporterId}
                    onChange={(e) => setTransport({ ...transport, transporterId: e.target.value.toUpperCase() })} />
                </Field>
                <p className={styles.note}>{einvT('transportNote')}</p>
                <div className={styles.summary}>
                  <span className={eway.included.length ? styles.pillOk : styles.pill}>{einvT('inFile', { n: eway.included.length })}</span>
                  <span className={eway.blocked.length ? styles.pillBad : styles.pill}>{einvT('blockedCount', { n: eway.blocked.length })}</span>
                </div>
                <div className={styles.actions}>
                  <button type="button" className={controls.btnPrimary} disabled={!eway.included.length}
                    onClick={() => download(`ewaybill_bulk_${stamp}.json`, eway.json)}>
                    <Download size={16} aria-hidden="true" /> {einvT('downloadEway')}
                  </button>
                </div>
              </div>
              <BlockedList title={einvT('leftOutEway')} rows={eway.blocked} />
            </>
          )}

          {tab === 'import' && (
            <>
              <div className={styles.section}>
                <h3 className={styles.sectionTitle}><Upload size={14} aria-hidden="true" /> {einvT('irpResponse')}</h3>
                <p className={styles.note}>
                  {einvT('irpNote')}
                </p>
                <input type="file" accept=".json,.csv,.txt,application/json,text/csv" aria-label={einvT('irpFile')}
                  onChange={(e) => void readFile(e.target.files?.[0])} />
                <Field label={einvT('orPaste')}>
                  <textarea className={controls.textarea} rows={5} spellCheck={false} value={text}
                    onChange={(e) => { setText(e.target.value); setResult(null); }} />
                </Field>
                <label className={styles.statusLine}>
                  <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} />
                  {einvT('replaceIrn')}
                </label>
                <div className={styles.actions}>
                  <button type="button" className={controls.btnPrimary} disabled={!text.trim()} onClick={runImport}>
                    <Upload size={16} aria-hidden="true" /> {einvT('import')}
                  </button>
                </div>
              </div>
              {result && (
                <div className={styles.section} aria-live="polite">
                  <h3 className={styles.sectionTitle}>{einvT('result')}</h3>
                  <div className={styles.summary}>
                    <span className={styles.pillOk}>{einvT('saved', { n: result.result.written.length })}</span>
                    <span className={result.result.unmatched.length ? styles.pillWarn : styles.pill}>{einvT('notMatched', { n: result.result.unmatched.length })}</span>
                    <span className={result.result.failed.length ? styles.pillBad : styles.pill}>{einvT('rejected', { n: result.result.failed.length })}</span>
                  </div>
                  {result.parsed.errors.map((e) => <p key={e} className={styles.note}>{e}</p>)}
                  <ul className={styles.checklist}>
                    {result.result.written.map((w) => (
                      <li key={`w${w.line}`} className={styles.statusLine}>
                        <span className={styles.pillOk}>{w.number}</span>
                        <span className={styles.mono}>{w.irn.slice(0, 16)}…{w.replaced ? einvT('replaced') : ''}</span>
                      </li>
                    ))}
                    {[...result.result.unmatched, ...result.result.failed].map((u) => (
                      <li key={`u${u.line}`} className={styles.statusLine}>
                        <span className={styles.pillWarn}>{einvT('row', { n: u.line })}{u.docNo ? ` · ${u.docNo}` : ''}</span>
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

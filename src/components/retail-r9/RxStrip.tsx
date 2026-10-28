/**
 * RT-B lazy counter parts (one chunk):
 *  - default `RxStrip`: the POS prescription strip — shown while the cart holds a Schedule H / H1 / X item (doctor,
 *    patient, age, gender, address, Rx no. / date, "prescription retained" for X, Rx photo); its errors stop the save
 *    (Pos.tsx) with "Require prescription" on. Also the red strip for an expired drug licence and the ceiling-price
 *    warning. Mounted by the POS only with the pharma pack switched on.
 *  - `RxEditorExtra`: the same fields in the editor summary (EditorExtras), store-connected.
 *  - `CeilingNotice`: the supplier bill modal's warning when a batch MRP is above ceiling + GST (RT-B3).
 * The Rx photo is an attachment on the bill (`attachments` ref, `rx.image_id`); templates never print it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, ShieldAlert } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { useT } from '../../i18n';
import { rtbT } from '../../i18n/areas/retail-r9b';
import { getTable } from '../../lib/storage';
import { liveScheduleIndex } from '../../lib/pharma';
import { doctorsDb, pickDoctor, readRxSettings, rxIssues, scheduledLines, type RxIssue } from '../../lib/retail/rt-pharmacy-rx';
import { ceilingIssues } from '../../lib/retail/rt-pharmacy-prices';
import type { StockItem } from '../../lib/inventory';
import type { AttachmentRef } from '../../lib/attachments';
import type { InvoiceItem, InvoiceRecord } from '../../types/invoice';
import type { PosRx } from '../../types/retail-r9';
import { NumberInput } from '../ui/NumberInput';
import controls from '../../styles/controls.module.css';

type Rx = NonNullable<InvoiceRecord['rx']>;
const EMPTY: Rx = { patient: '', prescriber: '' };
const stockItems = () => getTable<StockItem>('stock_items');

/** Issue → translated message. */
const issueText = (i: RxIssue): string => rtbT(`i.${i.code}`, { items: i.items.join(', ') });

/** The prescription fields (controlled). `x` = the bill has a Schedule X line. */
function RxFields({ rx, onRx, x, onImage }: { rx: Rx; onRx: (r: Rx) => void; x: boolean; onImage?: (ref: AttachmentRef) => void }) {
  const doctors = useMemo(() => doctorsDb.all().filter((d) => d.active !== false || d.id === rx.doctor_id), [rx.doctor_id]);
  const [busy, setBusy] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const set = (p: Partial<Rx>) => onRx({ ...rx, ...p });
  const snap = async (f: File | undefined) => {
    if (!f || !onImage) return;
    setBusy('…');
    try {
      const { attachFile } = await import('../../lib/attachment-upload');
      const ref = await attachFile(f);
      onImage(ref);
      setBusy('✓');
    } catch (err) {
      setBusy((err as Error).message);
    }
  };
  return (
    <div className={controls.row} style={{ flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end' }} data-rx-fields>
      <label className={controls.field}><span className={controls.label}>{rtbT('doctor')}</span>
        <select className={controls.select} value={rx.doctor_id ?? ''} onChange={(e) => onRx(pickDoctor(rx, doctors.find((d) => d.id === e.target.value)))} data-rx-doctor>
          <option value="">{rtbT('doctorTyped')}</option>
          {doctors.map((d) => <option key={d.id} value={d.id}>{d.name}{d.reg_no ? ` (${d.reg_no})` : ''}</option>)}
        </select></label>
      {!rx.doctor_id && (
        <>
          <label className={controls.field}><span className={controls.label}>{rtbT('prescriber')}</span>
            <input className={controls.input} value={rx.prescriber} onChange={(e) => set({ prescriber: e.target.value })} data-rx-prescriber /></label>
          <label className={controls.field}><span className={controls.label}>{rtbT('regNo')}</span>
            <input className={controls.input} value={rx.prescriber_reg ?? ''} onChange={(e) => set({ prescriber_reg: e.target.value })} /></label>
        </>
      )}
      <label className={controls.field}><span className={controls.label}>{rtbT('patient')}</span>
        <input className={controls.input} value={rx.patient} onChange={(e) => set({ patient: e.target.value })} data-rx-patient /></label>
      <label className={controls.field} style={{ maxWidth: 80 }}><span className={controls.label}>{rtbT('age')}</span>
        <NumberInput className={controls.input} value={rx.age ?? 0} onChange={(age) => set({ age: age > 0 ? Math.round(age) : undefined })} /></label>
      <label className={controls.field} style={{ maxWidth: 110 }}><span className={controls.label}>{rtbT('gender')}</span>
        <select className={controls.select} value={rx.gender ?? ''} onChange={(e) => set({ gender: (e.target.value || undefined) as Rx['gender'] })}>
          <option value="">—</option><option value="F">{rtbT('g.F')}</option><option value="M">{rtbT('g.M')}</option><option value="O">{rtbT('g.O')}</option>
        </select></label>
      <label className={controls.field}><span className={controls.label}>{x ? rtbT('addressX') : rtbT('address')}</span>
        <input className={controls.input} value={rx.patient_address ?? ''} onChange={(e) => set({ patient_address: e.target.value })} data-rx-address /></label>
      <label className={controls.field} style={{ maxWidth: 120 }}><span className={controls.label}>{rtbT('rxNo')}</span>
        <input className={controls.input} value={rx.rx_no ?? ''} onChange={(e) => set({ rx_no: e.target.value || undefined })} /></label>
      <label className={controls.field} style={{ maxWidth: 150 }}><span className={controls.label}>{rtbT('rxDate')}</span>
        <input type="date" className={controls.input} value={rx.rx_date ?? ''} onChange={(e) => set({ rx_date: e.target.value || undefined })} /></label>
      {x && <label className={controls.check}><input type="checkbox" checked={!!rx.retained} onChange={(e) => set({ retained: e.target.checked || undefined })} data-rx-retained /> {rtbT('retained')}</label>}
      {onImage && (
        <>
          <input ref={file} type="file" accept="image/*,application/pdf" capture="environment" hidden onChange={(e) => void snap(e.target.files?.[0])} />
          <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => file.current?.click()}><Camera size={14} aria-hidden="true" /> {rtbT('rxPhoto')}{rx.image_id ? ' ✓' : ''}</button>
          {busy && <span className={controls.hint}>{busy}</span>}
        </>
      )}
    </div>
  );
}

function Messages({ issues, ceiling }: { issues: readonly RxIssue[]; ceiling: readonly string[] }) {
  if (!issues.length && !ceiling.length) return null;
  return (
    <>
      {issues.map((i) => <p key={i.code} className={i.error || i.code === 'licenceExpired' ? controls.error : controls.hint} data-rx-issue={i.code}><ShieldAlert size={14} aria-hidden="true" /> {issueText(i)}</p>)}
      {ceiling.map((c) => <p key={c} className={controls.hint} data-ceiling-warn>{c}</p>)}
    </>
  );
}

// A counter line carries no MRP of its own: the catalogue's (per base unit) is checked.
const ceilingText = (lines: InvoiceRecord['items'], day: string, cat = getTable<InvoiceItem>('items_catalog')) =>
  ceilingIssues(lines.map((l) => (l.mrp ? l : { ...l, mrp: cat.find((c) => c.name.trim().toLowerCase() === l.name.trim().toLowerCase())?.mrp })), stockItems(), day).map((c) => rtbT('ceilingWarn', { name: c.name, mrp: c.mrp.toFixed(2), limit: c.limit.toFixed(2), date: c.from }));

/** POS strip (controlled by the counter: `value` is merged into the bill; `errors` stop the save). */
export default function RxStrip({ record, value, onChange }: { record: InvoiceRecord; value: PosRx | null; onChange: (v: PosRx | null) => void }) {
  useT();
  const index = useMemo(() => liveScheduleIndex(), []);
  const settings = useMemo(() => readRxSettings(), []);
  const lines = scheduledLines(record.items, index);
  const issues = rxIssues(record, index, settings);
  const ceiling = ceilingText(record.items, record.issue_date);
  const errors = issues.filter((i) => i.error).map(issueText);
  const key = JSON.stringify(errors);
  useEffect(() => {
    if (key !== JSON.stringify(value?.errors ?? [])) onChange({ ...(value ?? {}), errors });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!lines.length && !issues.length && !ceiling.length) return null;
  const rx = value?.rx ?? EMPTY;
  return (
    <div data-rx-strip style={{ display: 'grid', gap: '0.35rem' }}>
      {lines.length > 0 && (
        <>
          <strong>{rtbT('stripTitle', { s: [...new Set(lines.map((l) => l.schedule))].join(' / ') })}</strong>
          <RxFields rx={rx} x={lines.some((l) => l.schedule === 'X')} onRx={(r) => onChange({ ...(value ?? { errors: [] }), rx: r })}
            onImage={(ref) => onChange({ ...(value ?? { errors: [] }), rx: { ...rx, image_id: ref.id }, att: [...(value?.att ?? []).filter((a) => a.id !== rx.image_id), ref] })} />
        </>
      )}
      <Messages issues={issues} ceiling={ceiling} />
    </div>
  );
}

/** Editor summary (replaces the 7U prescription inputs): the same fields on the open document (store-connected). */
export function RxEditorExtra() {
  useT();
  const s = useInvoiceStore(useShallow((st) => ({ rx: st.rx, items: st.items, issue_date: st.issue_date, doc_type: st.doc_type, attachments: st.attachments, patch: st.patch })));
  const index = useMemo(() => liveScheduleIndex(), []);
  const settings = useMemo(() => readRxSettings(), []);
  const lines = scheduledLines(s.items, index);
  const issues = rxIssues(s, index, settings).filter((i) => i.code !== 'needRx'); // the 7U box shows the missing-Rx line
  const rx = s.rx ?? EMPTY;
  const setRx = (r: Rx) => s.patch({ rx: Object.values(r).some((v) => v !== undefined && v !== '') ? r : undefined });
  return (
    <div data-rx-editor>
      <RxFields rx={rx} x={lines.some((l) => l.schedule === 'X')} onRx={setRx}
        onImage={(ref) => { setRx({ ...rx, image_id: ref.id }); s.patch({ attachments: [...(s.attachments ?? []), ref] }); }} />
      <Messages issues={issues} ceiling={ceilingText(s.items, s.issue_date)} />
    </div>
  );
}

/** Supplier bill modal: batch MRP above the ceiling + GST (warning only). */
export function CeilingNotice({ lines, date }: { lines: readonly { name: string; mrp?: number; tax_rate?: number; unit_factor?: number; item_id?: string }[]; date: string }) {
  useT();
  const items = useMemo(() => stockItems(), []);
  const rows = ceilingIssues(lines, items, date);
  if (!rows.length) return null;
  return (
    <div data-ceiling-notice>
      {rows.map((c) => <p key={c.name} className={controls.error}><ShieldAlert size={14} aria-hidden="true" /> {rtbT('ceilingWarn', { name: c.name, mrp: c.mrp.toFixed(2), limit: c.limit.toFixed(2), date: c.from })}</p>)}
      <p className={controls.hint}>{rtbT('ceilingNote')}</p>
    </div>
  );
}

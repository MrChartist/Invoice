import { useMemo, useState } from 'react';
import { Pencil, Plus, Printer, Truck, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { cn, formatDate, todayInput } from '../../lib/utils';
import { num } from '../../lib/invoice-calc';
import { localDb } from '../../lib/localDb';
import { downloadText } from '../../lib/download';
import { printHtmlDocument } from '../../lib/voucher-print';
import { godownName, godownsDb } from '../../lib/godowns';
import { transferIssues } from '../../lib/stock-tracking';
import { ensureJobWorkerGodown, findJobWorkerGodown, materialOutDb, validateMaterialOut } from '../../lib/job-work';
import { materialOutChallanHtml } from '../../lib/job-work-challan';
import { MAIN_GODOWN_ID } from '../../types/stock';
import type { MaterialOut } from '../../types/job-work';
import { jwT } from '../../i18n/areas/job-work';
import { PartyField } from './shared';
import { JwLinesGrid } from './JwLinesGrid';
import { blankJwLine, cleanJw, qtyText, type JwData, type JwGridLine, type PartyValue } from './lines';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import styles from './job-work.module.css';

/** Material Out: delivery challans (Rule 55) sending inputs / capital goods to a job worker. */
export function MaterialOutPanel({ data }: { data: JwData }) {
  const { ctx } = data;
  const [editing, setEditing] = useState<MaterialOut | 'new' | null>(null);
  const [deleting, setDeleting] = useState<MaterialOut | null>(null);
  const rows = [...data.outs].sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number, undefined, { numeric: true }));
  const byId = new Map(ctx.items.map((i) => [i.id, i]));
  const pendingByOut = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of data.balances.lines) m.set(l.outId, (m.get(l.outId) ?? 0) + l.pending);
    return m;
  }, [data.balances]);

  const print = (o: MaterialOut) => {
    const p = localDb.settings.activeProfile();
    const html = materialOutChallanHtml(o, ctx.items, { name: p?.companyName ?? '', address: p?.companyAddress, gstin: p?.companyGstin, stateCode: p?.stateCode });
    printHtmlDocument(html, (h) => {
      downloadText(`challan-${o.number.replace(/[^\w-]+/g, '-')}.html`, h, 'text/html');
      ctx.error(jwT('printBlocked'));
    });
  };

  return (
    <>
      <div className={styles.bar}>
        <span className={styles.muted}>{data.jwGodowns.length ? jwT('challanTitle') : jwT('noJobWorkers')}</span>
        {ctx.canBooks && (
          <button type="button" className={cn(controls.btnPrimary, controls.btnSm)} onClick={() => setEditing('new')}>
            <Plus size={14} aria-hidden="true" /> {jwT('newOut')}
          </button>
        )}
      </div>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead>
            <tr><th>{jwT('number')}</th><th>{jwT('date')}</th><th>{jwT('jobWorker')}</th><th>{jwT('items')}</th><th className={styles.num}>{jwT('pending')}</th><th><span className={surface.srOnly}>{jwT('actions')}</span></th></tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr key={o.id}>
                <td className={styles.mono}>{o.number}</td>
                <td>{formatDate(o.date)}</td>
                <td>{o.party_name}<div className={styles.muted}>{godownName(ctx.godowns, o.job_worker_godown)}</div></td>
                <td>{o.lines.map((l) => `${byId.get(l.item_id)?.name ?? '?'} × ${qtyText(num(l.qty))}${l.unit ? ` ${l.unit}` : ''}`).join(', ')}</td>
                <td className={styles.num}>{qtyText(pendingByOut.get(o.id) ?? 0)}</td>
                <td className={surface.rowActions}>
                  <button type="button" className={controls.btnIcon} aria-label={`${jwT('printChallan')} ${o.number}`} title={jwT('printChallan')} onClick={() => print(o)}><Printer size={15} /></button>
                  {ctx.canBooks && (
                    <>
                      <button type="button" className={controls.btnIcon} aria-label={`${jwT('edit')} ${o.number}`} onClick={() => setEditing(o)}><Pencil size={15} /></button>
                      <button type="button" className={controls.btnDanger} aria-label={`${jwT('delete')} ${o.number}`} onClick={() => setDeleting(o)}><Trash2 size={15} /></button>
                    </>
                  )}
                </td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td colSpan={6} className={styles.muted}>{jwT('empty')}</td></tr>}
          </tbody>
        </table>
      </div>
      {editing && <OutModal data={data} doc={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onPrint={print} />}
      <ConfirmDialog
        open={!!deleting} destructive title={jwT('delete')} message={jwT('confirmDelete', { number: deleting?.number ?? '' })} confirmLabel={jwT('delete')}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          try {
            materialOutDb.remove(deleting.id);
            ctx.changed(jwT('deleted', { number: deleting.number }));
          } catch (e) {
            ctx.error((e as Error).message);
          }
        }}
      />
    </>
  );
}

function OutModal({ data, doc, onClose, onPrint }: { data: JwData; doc: MaterialOut | null; onClose: () => void; onPrint: (o: MaterialOut) => void }) {
  const { ctx } = data;
  const [date, setDate] = useState(doc?.date ?? todayInput());
  const [party, setParty] = useState<PartyValue>({ party_name: doc?.party_name ?? '', vendor_id: doc?.vendor_id, party_gstin: doc?.party_gstin, party_state_code: doc?.party_state_code });
  const [orderId, setOrderId] = useState(doc?.order_id ?? '');
  const [process, setProcess] = useState(doc?.process ?? '');
  const [lines, setLines] = useState<JwGridLine[]>(() => doc?.lines.map((l) => ({ ...l })) ?? [blankJwLine()]);
  const [eway, setEway] = useState(doc?.eway_bill_no ?? '');
  const [extended, setExtended] = useState(doc?.extended_until ?? '');
  const [narration, setNarration] = useState(doc?.narration ?? '');
  const [error, setError] = useState('');
  const tracked = useMemo(() => ctx.items.filter((i) => i.track_stock && !i.track_serials).sort((a, b) => a.name.localeCompare(b.name)), [ctx.items]);
  const orders = data.orders.filter((o) => o.direction === 'out' && !o.closed);
  const existingGodown = doc ? ctx.godowns.find((g) => g.id === doc.job_worker_godown) : party.party_name.trim() ? findJobWorkerGodown(ctx.godowns, { vendor_id: party.vendor_id, name: party.party_name }) : undefined;

  // Availability in each source godown on the date (a warning: Tally allows negative stock).
  const warnings = useMemo(() => {
    const clean = cleanJw(lines);
    const groups = new Map<string, JwGridLine[]>();
    for (const l of clean) groups.set(l.godown_id || MAIN_GODOWN_ID, [...(groups.get(l.godown_id || MAIN_GODOWN_ID) ?? []), l]);
    const out: string[] = [];
    const others = { ...ctx.inputs, jobWorkDocs: ctx.inputs.jobWorkDocs ? { ...ctx.inputs.jobWorkDocs, outs: ctx.inputs.jobWorkDocs.outs.filter((o) => o.id !== doc?.id) } : undefined };
    for (const [from, ls] of groups) {
      try {
        out.push(...transferIssues({ id: '__jw__', date, from_godown: from, to_godown: existingGodown?.id ?? '__new_jw__', lines: ls.map((l) => ({ id: l.id, item_id: l.item_id, qty: l.qty, unit_factor: l.unit_factor, ...(l.batch_no ? { batch_no: l.batch_no } : {}) })) }, others));
      } catch {
        /* availability is advisory */
      }
    }
    return out;
  }, [lines, date, ctx.inputs, existingGodown, doc]);

  const pickOrder = (id: string) => {
    setOrderId(id);
    const o = data.orders.find((x) => x.id === id);
    if (!o) return;
    setParty({ party_name: o.party_name, vendor_id: o.vendor_id, party_gstin: o.party_gstin, party_state_code: o.party_state_code });
    if (o.process) setProcess(o.process);
  };

  const submit = (print = false) => {
    try {
      // Validate before the job worker's godown is created, so a refused challan leaves nothing behind.
      const pre = validateMaterialOut({ date, party_name: party.party_name, job_worker_godown: '__jw__', lines: cleanJw(lines) }, ctx.items, [...godownsDb.list(), { id: '__jw__', name: party.party_name, job_worker: true }]);
      if (pre) return setError(pre);
      const g = doc ? { id: doc.job_worker_godown } : ensureJobWorkerGodown({ vendor_id: party.vendor_id, name: party.party_name });
      const saved = materialOutDb.save({
        id: doc?.id, number: doc?.number, date, ...party, party_name: party.party_name, job_worker_godown: g.id,
        order_id: orderId || undefined, process: process.trim() || undefined, lines: cleanJw(lines),
        eway_bill_no: eway.trim() || undefined, extended_until: extended || undefined, narration: narration.trim() || undefined,
      }, ctx.items, godownsDb.list());
      onClose();
      ctx.changed(jwT('saved', { number: saved.number }));
      if (print) onPrint(saved);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <Modal open onClose={onClose} size="xl" title={doc ? `${jwT('secOut')} ${doc.number}` : jwT('newOut')}
      subtitle={doc ? jwT('challanTitle') : `${jwT('nextNumber', { number: materialOutDb.nextNumber(date) })} · ${jwT('challanTitle')}`}
      footer={<>
        <button type="button" className={controls.btnOutline} onClick={onClose}>{jwT('cancel')}</button>
        <button type="button" className={controls.btnOutline} onClick={() => submit(true)}><Printer size={16} aria-hidden="true" /> {jwT('printChallan')}</button>
        <button type="button" className={controls.btnPrimary} onClick={() => submit()}><Truck size={16} aria-hidden="true" /> {jwT('save')}</button>
      </>}>
      <form className={styles.form} noValidate onSubmit={(e) => { e.preventDefault(); submit(); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }}>
        <div className={controls.row3}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="jwc-date">{jwT('date')}</label>
            <input id="jwc-date" type="date" className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="jwc-order">{jwT('order')}</label>
            <select id="jwc-order" className={controls.select} value={orderId} onChange={(e) => pickOrder(e.target.value)}>
              <option value="">{jwT('noOrder')}</option>
              {orders.map((o) => <option key={o.id} value={o.id}>{o.number} · {o.party_name}</option>)}
            </select>
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="jwc-proc">{jwT('process')}</label>
            <input id="jwc-proc" className={controls.input} value={process} onChange={(e) => setProcess(e.target.value)} />
          </div>
        </div>
        <div className={controls.row3}>
          {doc ? (
            <div className={controls.field}>
              <span className={controls.label}>{jwT('jobWorker')}</span>
              <strong>{doc.party_name}</strong>
            </div>
          ) : (
            <PartyField label={jwT('jobWorker')} value={party} onChange={setParty} parties={data.parties} hint={jwT('vendorHint')} />
          )}
          <div className={controls.field}>
            <label className={controls.label} htmlFor="jwc-state">{jwT('stateCode')}</label>
            <input id="jwc-state" className={controls.input} inputMode="numeric" maxLength={2} value={party.party_state_code ?? ''} onChange={(e) => setParty({ ...party, party_state_code: e.target.value.replace(/\D/g, '') || undefined })} />
          </div>
        </div>
        <p className={styles.muted}>{jwT('jwGodown')}: <strong>{existingGodown?.name ?? (party.party_name.trim() ? `${party.party_name.trim()} (job worker)` : '—')}</strong></p>
        <p className={styles.section}>{jwT('sendLabel')}</p>
        <JwLinesGrid lines={lines} items={tracked} onChange={setLines} opts={{ label: jwT('sendLabel'), godowns: data.ownGodowns, batch: tracked.some((i) => i.track_batches), value: true, units: data.units }} />
        {warnings.length > 0 && <div className={styles.notice} role="status"><ul>{warnings.map((w) => <li key={w}>{w}</li>)}</ul></div>}
        <div className={controls.row3}>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="jwc-eway">{jwT('ewayNo')}</label>
            <input id="jwc-eway" className={controls.input} value={eway} onChange={(e) => setEway(e.target.value)} />
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="jwc-ext">{jwT('extendedUntil')}</label>
            <input id="jwc-ext" type="date" className={controls.input} value={extended} onChange={(e) => setExtended(e.target.value)} />
            <span className={styles.muted}>{jwT('extendedHint')}</span>
          </div>
          <div className={controls.field}>
            <label className={controls.label} htmlFor="jwc-narr">{jwT('narration')}</label>
            <input id="jwc-narr" className={controls.input} value={narration} onChange={(e) => setNarration(e.target.value)} />
          </div>
        </div>
        {error && <p className={cn(styles.notice, styles.danger)} role="alert">{error}</p>}
      </form>
    </Modal>
  );
}

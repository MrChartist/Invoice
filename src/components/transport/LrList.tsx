/** R5-B1: the LR register — book, POD, cancel, print (three copies), share, collect freight, e-way Part B. */
import { useMemo, useState } from 'react';
import { ClipboardList, Download, Plus, Truck } from 'lucide-react';
import { twT } from '../../i18n/areas/packs-transport-works-r5';
import type { ConsignmentNote } from '../../types/transport-works-r5';
import { cancelLr, effectiveStatus, ewayPartB, freightOf, loadLrs, recordPod } from '../../lib/transport/consignment-notes';
import { lrHtml, lrShareText } from '../../lib/transport/lr-print';
import { collectFreight } from '../../lib/transport/freight-bill';
import { loadGtaOptions } from '../../lib/transport/gta-option';
import { localDb } from '../../lib/localDb';
import { downloadText } from '../../lib/download';
import { LrForm } from './LrForm';
import { B, errText, fmtMoney, printHtml, today, type PanelProps } from './shared';
import { F } from './Field';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './transport.module.css';

type Act = { kind: 'pod' | 'cancel' | 'collect'; lr: ConsignmentNote } | null;

export function LrList({ notify, refresh, tick }: PanelProps) {
  const lrs = useMemo(() => [...loadLrs()].sort((a, b) => b.date.localeCompare(a.date) || b.number.localeCompare(a.number, undefined, { numeric: true })), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const invoices = useMemo(() => localDb.invoices.getAll(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const clients = useMemo(() => localDb.clients.getAll(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const [edit, setEdit] = useState<ConsignmentNote | 'new' | null>(null);
  const [act, setAct] = useState<Act>(null);
  const [v, setV] = useState({ day: today(), by: '', shortage: '', damage: '', detention: '', reason: '', method: 'Cash' });
  const name = (id?: string) => clients.find((c) => c.id === id)?.name ?? '-';
  const party = (id?: string) => {
    const c = clients.find((x) => x.id === id);
    return c ? { name: c.name, gstin: c.gstin, address: c.address } : undefined;
  };
  const run = (fn: () => unknown, msg: string) => {
    try {
      fn();
      notify(msg);
      setAct(null);
      refresh();
    } catch (e) {
      notify(errText(e), 'error');
    }
  };
  const company = () => {
    const p = localDb.settings.activeProfile();
    return { name: p?.companyName ?? '', address: p?.companyAddress, gstin: p?.companyGstin };
  };
  const print = (lr: ConsignmentNote) => printHtml(lrHtml(lr, { company: company(), consignor: party(lr.consignor_id) ?? { name: '-' }, consignee: party(lr.consignee_id) ?? { name: '-' }, billingParty: party(lr.billing_party_id), options: loadGtaOptions() }), lr.number);
  const share = (lr: ConsignmentNote) => {
    const text = lrShareText(lr, { company: company(), consignee: party(lr.consignee_id) ?? { name: '-' } });
    if (navigator.share) void navigator.share({ text }).catch(() => undefined);
    else window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
  };
  const partB = async (lr: ConsignmentNote) => {
    try {
      const r = await ewayPartB(lr, invoices);
      if (r.json) downloadText(`${lr.number.replace(/\//g, '-')}-partB.json`, r.json, 'application/json');
      notify(r.json ? twT('partBJson') : twT('partBDone', { n: r.updated }));
    } catch (e) {
      notify(errText(e), 'error');
    }
  };
  const fld = (k: keyof typeof v, label: string, type = 'text') => (
    <F l={label}><input className={controls.input} type={type} value={v[k]} onChange={(e) => setV((x) => ({ ...x, [k]: e.target.value }))} /></F>
  );

  if (edit) return <LrForm lr={edit === 'new' ? undefined : edit} notify={notify} onSaved={() => { setEdit(null); refresh(); }} onCancel={() => setEdit(null)} />;
  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <button type="button" className={B.p} onClick={() => setEdit('new')} data-lr-new><Plus size={16} aria-hidden="true" /> {twT('lrNew')}</button>
      </div>
      {act && (
        <div className={styles.box}>
          <strong>{act.lr.number} · {twT(`act.${act.kind}`)}</strong>
          <div className={styles.grid}>
            {fld('day', twT('date'), 'date')}
            {act.kind === 'pod' && <>{fld('by', twT('receivedBy'))}{fld('shortage', twT('shortage'), 'number')}{fld('damage', twT('damage'), 'number')}{fld('detention', twT('detentionDays'), 'number')}</>}
            {act.kind === 'cancel' && fld('reason', twT('reason'))}
            {act.kind === 'collect' && fld('method', twT('method'))}
          </div>
          <div className={styles.toolbar}>
            <button type="button" className={B.p} onClick={() => {
              if (act.kind === 'pod') run(() => recordPod(act.lr.id, { delivered_on: v.day, received_by: v.by, ...(v.shortage ? { shortage_qty: Number(v.shortage) } : {}), ...(v.damage ? { damage_qty: Number(v.damage) } : {}), ...(v.detention ? { detention_days: Number(v.detention) } : {}) }), twT('podSaved'));
              else if (act.kind === 'cancel') run(() => cancelLr(act.lr.id, v.reason, invoices), twT('lrCancelled'));
              else run(() => collectFreight(act.lr.id, { date: v.day, method: v.method || 'Cash' }), twT('collected'));
            }}>{twT('save')}</button>
            <button type="button" className={B.g} onClick={() => setAct(null)}>{twT('cancel')}</button>
          </div>
        </div>
      )}
      {lrs.length === 0 ? <p className={styles.note}><ClipboardList size={14} aria-hidden="true" /> {twT('lrEmpty')}</p> : (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th>{twT('lrNo')}</th><th>{twT('date')}</th><th>{twT('route')}</th><th>{twT('consignor')} → {twT('consignee')}</th><th className={surface.numeric}>{twT('freightTotal')}</th><th>{twT('payBasis')}</th><th>{twT('liable')}</th><th>{twT('status')}</th><th /></tr></thead>
            <tbody>
              {lrs.map((lr) => {
                const st = effectiveStatus(lr, invoices);
                return (
                  <tr key={lr.id} data-lr-row={lr.number}>
                    <td className={surface.mono}>{lr.number}</td>
                    <td>{lr.date}</td>
                    <td>{lr.from.place} → {lr.to.place}</td>
                    <td>{name(lr.consignor_id)} → {name(lr.consignee_id)}</td>
                    <td className={surface.numeric}>{fmtMoney(freightOf(lr).total)}</td>
                    <td>{twT(`pay.${lr.payment_basis}`)}</td>
                    <td>{twT(`liable.${lr.liable}`)}</td>
                    <td data-lr-status>{twT(`st.${st}`)}</td>
                    <td className={surface.rowActions}>
                      {st === 'booked' && !lr.trip_id && <button type="button" className={B.gs} onClick={() => setEdit(lr)}>{twT('edit')}</button>}
                      {(st === 'booked' || st === 'in_transit') && <button type="button" className={B.gs} onClick={() => setAct({ kind: 'pod', lr })}>{twT('act.pod')}</button>}
                      {lr.payment_basis !== 'tbb' && st !== 'billed' && st !== 'cancelled' && <button type="button" className={B.os} onClick={() => setAct({ kind: 'collect', lr })}>{twT('act.collect')}</button>}
                      <button type="button" className={B.gs} onClick={() => print(lr)}><Download size={14} aria-hidden="true" /> {twT('print')}</button>
                      <button type="button" className={B.gs} onClick={() => share(lr)}>{twT('share')}</button>
                      {st !== 'cancelled' && <button type="button" className={B.gs} onClick={() => void partB(lr)}><Truck size={14} aria-hidden="true" /> {twT('partB')}</button>}
                      {st !== 'billed' && st !== 'cancelled' && <button type="button" className={B.gs} onClick={() => setAct({ kind: 'cancel', lr })}>{twT('act.cancel')}</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

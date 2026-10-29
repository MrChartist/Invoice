/**
 * R14 PS-C2 / C3 realisation view: services exports with the clock from the invoice date (9 months from 1 Oct 2026, 15
 * before, INR 12), IRMs, FIRA / e-FIRC, e-BRC, realised FC and ₹, charges deducted abroad and the unrealised rest. IRMs
 * are entered on GST → Exports (R4-C2); the FIRA reference is added here (`ExportIrm.ps.fira_no`).
 */
import { useMemo, useState } from 'react';
import type { InvoiceRecord, Payment } from '../../types/invoice';
import type { ExportIrm } from '../../types/trade-r4';
import { localDb } from '../../lib/localDb';
import { getTable } from '../../lib/storage';
import { todayInput } from '../../lib/utils';
import { irmsDb, liveRegister } from '../../lib/trade/export-register';
import { servicesRows } from '../../lib/prof/ps-fema';
import { brcRows, type PsIrm } from '../../lib/prof/ps-brc';
import { pcT } from '../../i18n/areas/prof-r14c-export';
import { Tbl } from './pc-ui';
import { Field } from './ps-ui';
import { runner, type Notify } from './pc-run';
import controls from '../../styles/controls.module.css';
import css from './exportsvc.module.css';

type Irm = ExportIrm & { ps?: PsIrm };

export default function RealisationSvcView({ notify }: { notify: Notify }) {
  const [tick, setTick] = useState(0);
  const run = runner(notify, () => setTick((n) => n + 1));
  const [f, setF] = useState({ irm: '', fira: '' });
  /* eslint-disable react-hooks/exhaustive-deps */
  const d = useMemo(() => {
    const day = todayInput();
    const invoices = localDb.invoices.getAll() as InvoiceRecord[];
    const irms = irmsDb.all() as Irm[];
    const rows = servicesRows(liveRegister(day), invoices, day);
    return { rows, brc: brcRows(rows, invoices, getTable<Payment>('transactions'), irms), irms };
  }, [tick]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const byId = new Map(d.rows.map((r) => [r.invoiceId, r]));
  return (
    <>
      <Tbl tag="real" head={[pcT('invoice'), pcT('date'), pcT('party'), pcT('value'), pcT('realised'), pcT('charges'), pcT('unrealised'), pcT('due'), pcT('status'), pcT('fira'), 'e-BRC']}
        rows={d.brc.map((b) => {
          const r = byId.get(b.invoiceId)!;
          return [b.number, b.date, b.party, `${b.currency} ${b.fcy}`, `${b.realisedFcy} · ₹${b.realisedInr}`, b.chargesFcy ? `${b.chargesFcy} (${pcT(`ch.${b.chargesReason || 'bank'}`)})${b.chargesOver ? ' ⚠' : ''}` : '-', b.unrealisedFcy,
            <span key="d" data-ps-real-due={b.dueDate}>{b.dueDate} · {pcT('months', { n: r.months })}{r.inrRule ? ` · ${pcT('inrRule')}` : ''}</span>, b.status, b.fira.join(', '), b.ebrc.map((e) => e.no).join(', ')];
        })} />
      <div className={css.bar}>
        <Field label="IRM"><select className={controls.select} value={f.irm} onChange={(e) => setF({ irm: e.target.value, fira: d.irms.find((m) => m.id === e.target.value)?.ps?.fira_no ?? '' })}><option value="">-</option>{d.irms.map((m) => <option key={m.id} value={m.id}>{`${m.irm_no} · ${m.currency} ${m.fcy}`}</option>)}</select></Field>
        <Field label={pcT('fira')}><input className={controls.input} value={f.fira} onChange={(e) => setF({ ...f, fira: e.target.value.slice(0, 40) })} /></Field>
        <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} disabled={!f.irm} onClick={() => run(() => {
          const m = d.irms.find((x) => x.id === f.irm)!;
          irmsDb.save({ ...m, ps: { ...m.ps, fira_no: f.fira.trim() || undefined } } as Irm);
        })}>{pcT('save')}</button>
      </div>
      <p className={controls.hint}>{pcT('irmDesk')}</p>
    </>
  );
}

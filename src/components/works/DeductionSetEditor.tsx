/** R5-B5: the BOQ's deduction set (defaults for its RA bills), DLP, mobilisation advance, project and cess mode. */
import { useMemo, useState } from 'react';
import { Percent } from 'lucide-react';
import { twT } from '../../i18n/areas/packs-transport-works-r5';
import type { InvoiceRecord } from '../../types/invoice';
import type { DeductionRule, RaDeductionKind } from '../../types/transport-works-r5';
import { DEDUCTION_KINDS, saveBoqTerms } from '../../lib/works/boq';
import { loadAdvances, samePartyAs } from '../../lib/advances';
import { loadCostCentres } from '../../lib/cost-centres';
import { localDb } from '../../lib/localDb';
import { B, errText, numIn, type PanelProps } from '../transport/shared';
import { F } from '../transport/Field';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from '../transport/transport.module.css';

type Row = { on: boolean; rate: string; amount: string; extra: string };
const EXTRA: Partial<Record<RaDeductionKind, keyof DeductionRule>> = { retention: 'cap_pct', advance_recovery: 'start_after_pct', it_tds: 'section' };

export function DeductionSetEditor({ boq, notify, refresh }: PanelProps & { boq: InvoiceRecord }) {
  const terms = boq.boq_terms ?? {};
  const client = localDb.clients.getById(boq.client?.id ?? '');
  const advances = useMemo(() => loadAdvances().filter((a) => samePartyAs(a.client, boq.client)), [boq]);
  const projects = useMemo(() => loadCostCentres().filter((c) => c.kind === 'project' && c.active), []);
  const [rows, setRows] = useState<Record<string, Row>>(() => Object.fromEntries(DEDUCTION_KINDS.map((k) => {
    const r = terms.deductions?.find((d) => d.kind === k);
    const extraKey = EXTRA[k];
    return [k, { on: !!r, rate: String(r?.rate ?? ''), amount: String(r?.amount ?? ''), extra: String((extraKey && r?.[extraKey]) ?? '') }];
  })));
  const [gross, setGross] = useState(terms.deductions?.find((d) => d.kind === 'retention')?.basis === 'gross');
  const [f, setF] = useState({ dlp: String(terms.dlp_months ?? ''), release: terms.release_on ?? '', done: terms.completed_on ?? '', adv: terms.advance_id ?? '', cc: terms.cost_centre_id ?? '', cess: terms.cess_mode ?? 'expense', deductor: !!client?.gst_tds_deductor });
  const setRow = (k: string, p: Partial<Row>) => setRows((r) => ({ ...r, [k]: { ...r[k], ...p } }));
  const save = () => {
    try {
      const deductions: DeductionRule[] = DEDUCTION_KINDS.filter((k) => rows[k].on).map((k) => {
        const r = rows[k];
        const extraKey = EXTRA[k];
        return {
          kind: k, ...(numIn(r.rate) ? { rate: Number(r.rate) } : {}), ...(numIn(r.amount) ? { amount: Number(r.amount) } : {}),
          ...(extraKey && r.extra.trim() ? { [extraKey]: extraKey === 'section' ? r.extra.trim() : Number(r.extra) } : {}),
          ...(k === 'retention' && gross ? { basis: 'gross' as const } : {}),
        };
      });
      saveBoqTerms(boq.id, { ...terms, deductions, dlp_months: Number(f.dlp) || undefined, release_on: f.release || undefined, completed_on: f.done || undefined, advance_id: f.adv || undefined, cost_centre_id: f.cc || undefined, cess_mode: f.cess as 'expense' | 'recoverable' });
      if (client && !!client.gst_tds_deductor !== f.deductor) localDb.clients.upsert({ ...client, gst_tds_deductor: f.deductor || undefined });
      notify(twT('termsSaved'));
      refresh();
    } catch (e) {
      notify(errText(e), 'error');
    }
  };
  return (
    <section className={styles.box} data-ded-editor>
      <h4 className={styles.toolbar}><Percent size={16} aria-hidden="true" /> {twT('deductionSet')}</h4>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <thead><tr><th>{twT('deduction')}</th><th>{twT('ratePct')}</th><th>{twT('amountFixed')}</th><th>{twT('dedExtra')}</th></tr></thead>
          <tbody>
            {DEDUCTION_KINDS.map((k) => (
              <tr key={k}>
                <td><label className={controls.check}><input type="checkbox" checked={rows[k].on} onChange={(e) => setRow(k, { on: e.target.checked })} data-ded-on={k} /> {twT(`ded.${k}`)}</label></td>
                <td><input className={controls.input} type="number" value={rows[k].rate} onChange={(e) => setRow(k, { rate: e.target.value, on: true })} aria-label={`${twT(`ded.${k}`)} %`} data-ded-rate={k} /></td>
                <td><input className={controls.input} type="number" value={rows[k].amount} onChange={(e) => setRow(k, { amount: e.target.value, on: true })} aria-label={`${twT(`ded.${k}`)} ₹`} /></td>
                <td>{EXTRA[k] && <input className={controls.input} value={rows[k].extra} placeholder={twT(`extra.${k}`)} onChange={(e) => setRow(k, { extra: e.target.value })} aria-label={twT(`extra.${k}`)} />}
                  {k === 'retention' && <label className={controls.check}><input type="checkbox" checked={gross} onChange={(e) => setGross(e.target.checked)} /> {twT('inclGst')}</label>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.grid}>
        <F l={twT('dlpMonths')}><input className={controls.input} type="number" value={f.dlp} onChange={(e) => setF({ ...f, dlp: e.target.value })} data-ded-dlp /></F>
        <F l={twT('completedOn')}><input className={controls.input} type="date" value={f.done} onChange={(e) => setF({ ...f, done: e.target.value })} /></F>
        <F l={twT('releaseOn')}><input className={controls.input} type="date" value={f.release} onChange={(e) => setF({ ...f, release: e.target.value })} /></F>
        <F l={twT('mobAdvance')}>
          <select className={controls.select} value={f.adv} onChange={(e) => setF({ ...f, adv: e.target.value })}><option value="">-</option>{advances.map((a) => <option key={a.id} value={a.id}>{a.number} · {a.amount}</option>)}</select></F>
        <F l={twT('project')}>
          <select className={controls.select} value={f.cc} onChange={(e) => setF({ ...f, cc: e.target.value })}><option value="">-</option>{projects.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></F>
        <F l={twT('cessMode')}>
          <select className={controls.select} value={f.cess} onChange={(e) => setF({ ...f, cess: e.target.value as 'expense' | 'recoverable' })}><option value="expense">{twT('cess.expense')}</option><option value="recoverable">{twT('cess.recoverable')}</option></select></F>
        <label className={controls.check}><input type="checkbox" checked={f.deductor} onChange={(e) => setF({ ...f, deductor: e.target.checked })} /> {twT('gstTdsDeductor')}</label>
      </div>
      <p className={styles.note}>{twT('deductionHint')}</p>
      <div className={styles.toolbar}><button type="button" className={B.p} onClick={save} data-ded-save>{twT('save')}</button></div>
    </section>
  );
}

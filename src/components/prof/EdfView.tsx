/**
 * R14 PS-C2 EDF view: "Prepare EDF for <month>" (the month's services exports by kind and currency → draft rows), the
 * register (EDF no. and date typed after the AD bank / STPI files it, authority, small-value declaration). Months before
 * 1 Oct 2026 were SOFTEX (history rows only, `edfDb.addSoftex`). No portal.
 */
import { useMemo, useState } from 'react';
import { localDb } from '../../lib/localDb';
import { formatCurrency, todayInput } from '../../lib/utils';
import { shiftDay } from '../../lib/dates';
import { edfDb, edfRule, prepareEdf, type EdfRow } from '../../lib/prof/ps-edf';

import { pcT } from '../../i18n/areas/prof-r14c-export';
import { Tbl } from './pc-ui';
import { Field } from './ps-ui';
import { runner, type Notify } from './pc-run';
import controls from '../../styles/controls.module.css';
import css from './exportsvc.module.css';
import { DateField } from '../ui/DateField';
import { SelectField } from '../ui/SelectField';

const sm = `${controls.btnOutline} ${controls.btnSm}`;

export default function EdfView({ notify }: { notify: Notify }) {
  const [tick, setTick] = useState(0);
  const run = runner(notify, () => setTick((n) => n + 1));
  const [month, setMonth] = useState(() => shiftDay(`${todayInput().slice(0, 7)}-01`, -1).slice(0, 7));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rows = useMemo(() => edfDb.all().sort((a, b) => b.period.localeCompare(a.period)), [tick]);
  const drafts = useMemo(() => prepareEdf(month, localDb.invoices.getAll()), [month]);
  return (
    <>
      <div className={css.bar}>
        <Field label={pcT('month')}><DateField mode="month" className={controls.input} value={month} onChange={(e) => setMonth(e.target.value)} data-ps-edf-month /></Field>
        <button type="button" className={controls.btnPrimary} disabled={!drafts.length} onClick={() => run(() => String(edfDb.saveDrafts(month, drafts).length))} data-ps-edf-save>{pcT('toRegister')}</button>
      </div>
      <p className={controls.label}>{pcT('prepare', { month })}</p>
      {!edfRule(`${month}-28`) ? <p className={controls.hint}>{pcT('edfBefore')}</p> : (
        <Tbl tag="edf-draft" head={[pcT('kind'), pcT('currency'), pcT('invoices'), pcT('value'), '₹', pcT('due')]} rows={drafts.map((d) => [pcT(`k.${d.kind}`), d.currency, d.numbers.join(', '), d.value_fc, formatCurrency(d.value_inr, 'INR'), <span key="d" data-ps-edf-due={d.due}>{d.due}{d.small ? ` · ${pcT('small')}` : ''}</span>])} />
      )}
      <Tbl tag="edf" head={[pcT('month'), pcT('kind'), pcT('value'), pcT('due'), pcT('status'), '']} rows={rows.map((r) => [r.period, pcT(`k.${r.kind}`), `${r.currency} ${r.value_fc}`, r.due, pcT(`st.${r.status}`), <RowEdit key={`${r.id}${tick}`} r={r} run={run} />])} />
    </>
  );
}

function RowEdit({ r, run }: { r: EdfRow; run: (fn: () => string | void) => boolean }) {
  const [f, setF] = useState({ edf_no: r.edf_no ?? '', filed_on: r.filed_on ?? '', authority: r.authority, small: !!r.small_value_declared });
  if (r.kind === 'softex') return <span>{r.edf_no}</span>;
  return (
    <span className={css.bar}>
      <input className={controls.input} placeholder={pcT('edfNo')} aria-label={pcT('edfNo')} value={f.edf_no} onChange={(e) => setF({ ...f, edf_no: e.target.value })} data-ps-edf-no />
      <DateField className={controls.input} aria-label={pcT('filedOn')} value={f.filed_on} onChange={(e) => setF({ ...f, filed_on: e.target.value })} />
      <SelectField className={controls.select} aria-label={pcT('authority')} value={f.authority} onChange={(e) => setF({ ...f, authority: e.target.value as EdfRow['authority'] })}>{(['ad_bank', 'stpi', 'sez'] as const).map((a) => <option key={a} value={a}>{pcT(`au.${a}`)}</option>)}</SelectField>
      {r.small_value_ok && <label className={controls.check}><input type="checkbox" checked={f.small} onChange={(e) => setF({ ...f, small: e.target.checked })} /> {pcT('small')}</label>}
      <button type="button" className={sm} onClick={() => run(() => void edfDb.save({ id: r.id, edf_no: f.edf_no.trim() || undefined, filed_on: f.filed_on || undefined, authority: f.authority, small_value_declared: f.small || undefined }))} data-ps-edf-row-save>{pcT('save')}</button>
      <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => window.confirm(pcT('remove')) && run(() => edfDb.remove(r.id))}>{pcT('remove')}</button>
    </span>
  );
}

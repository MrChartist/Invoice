/**
 * R14 PS-C1 checker: every issued export document (supply type export / place of supply 96–97) with its Sec 2(6) result,
 * the five conditions and their reasons, the party's facts (`Client.ps`: country, Indian establishment, relation) and
 * the document's facts (`ps.export`: place-of-supply class, property State, performed abroad, INR route). Soft only.
 */
import { useMemo, useState } from 'react';
import type { Client, InvoiceRecord, Payment } from '../../types/invoice';
import { localDb } from '../../lib/localDb';
import { getTable } from '../../lib/storage';
import { formatCurrency, todayInput } from '../../lib/utils';
import { exportInvoices, IRMS_TABLE } from '../../lib/trade/export-register';
import { exportCheck, verdict, type PsExport, type PsExportParty } from '../../lib/prof/ps-export-check';
import { POS_CLASSES } from '../../lib/prof/ps-pos';
import type { ExportIrm } from '../../types/trade-r4';
import { pcT, type PcKey } from '../../i18n/areas/prof-r14c-export';
import { Tbl } from './pc-ui';
import { Field } from './ps-ui';
import { runner, type Notify } from './pc-run';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import css from './exportsvc.module.css';
import { SelectField } from '../ui/SelectField';

type Doc = InvoiceRecord;
type Party = Client;
const badge = { export: surface.badgePaid, pending: surface.badgePartial, unknown: surface.badgePartial, not: surface.badgeOverdue } as const;

export default function ExportCheckView({ notify }: { notify: Notify }) {
  const [tick, setTick] = useState(0);
  const [open, setOpen] = useState('');
  const run = runner(notify, () => setTick((n) => n + 1));
  /* eslint-disable react-hooks/exhaustive-deps */
  const d = useMemo(() => ({
    docs: exportInvoices(localDb.invoices.getAll()) as Doc[], clients: localDb.clients.getAll() as Party[],
    receipts: getTable<Payment>('transactions'), irms: getTable<ExportIrm>(IRMS_TABLE),
  }), [tick]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const day = todayInput();
  const rows = [...d.docs].sort((a, b) => b.issue_date.localeCompare(a.issue_date)).flatMap((inv) => {
    const client = d.clients.find((c) => c.id && c.id === inv.client?.id) ?? null;
    const c = exportCheck({ invoice: inv, client: client ?? inv.client, receipts: d.receipts, irms: d.irms, date: inv.issue_date || day });
    const v = verdict(c);
    const row = [inv.invoice_number, inv.issue_date, inv.client?.name ?? '', formatCurrency(inv.total, inv.currency || 'INR'),
      <span key="b" className={`${surface.badge} ${badge[v]}`} data-ps-verdict={v}>{pcT('chip', { ok: c.ok })}</span>,
      <button key="o" type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setOpen(open === inv.id ? '' : inv.id)}>{pcT('open')}</button>];
    if (open !== inv.id) return [row];
    return [row, [<div key="m" data-ps-check={inv.id}>
      <ul>{c.items.map((i) => <li key={i.id} className={i.state === 'ok' ? css.ok : i.state === 'fail' ? css.bad : undefined}>{pcT(`c.${i.id}`)} : {pcT(`s.${i.state}`)}: {pcT(`r.${i.reason}` as PcKey)}</li>)}</ul>
      <p className={controls.hint}>{pcT('soft')}</p>
      {client && <PartyFacts key={`p${tick}`} client={client} run={run} />}
      <DocFacts key={`d${tick}`} inv={inv} run={run} />
    </div>]];
  });
  return <Tbl tag="check" head={[pcT('invoice'), pcT('date'), pcT('party'), pcT('value'), pcT('result'), '']} rows={rows} />;
}

function PartyFacts({ client, run }: { client: Party; run: (fn: () => string | void) => boolean }) {
  const [f, setF] = useState<PsExportParty>(client.ps ?? {});
  return (
    <div className={css.bar}>
      <Field label={pcT('country')}><input className={controls.input} value={f.country ?? ''} onChange={(e) => setF({ ...f, country: e.target.value.slice(0, 40) })} data-ps-country /></Field>
      <Field label={pcT('relation')}><SelectField className={controls.select} value={f.relation ?? 'unrelated'} onChange={(e) => setF({ ...f, relation: e.target.value as PsExportParty['relation'] })}>{(['unrelated', 'group', 'distinct_person'] as const).map((r) => <option key={r} value={r}>{pcT(`rel.${r}`)}</option>)}</SelectField></Field>
      <label className={controls.check}><input type="checkbox" checked={!!f.fixed_estab_in_india} onChange={(e) => setF({ ...f, fixed_estab_in_india: e.target.checked })} /> {pcT('estab')}</label>
      <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => run(() => void localDb.clients.upsert({ ...client, ps: { ...client.ps, ...f } } ))} data-ps-party-save>{pcT('save')}</button>
    </div>
  );
}

function DocFacts({ inv, run }: { inv: Doc; run: (fn: () => string | void) => boolean }) {
  const [f, setF] = useState<PsExport>(inv.ps?.export ?? {});
  const box = (k: 'abroad' | 'inr_permitted' | 'inr_settled', l: PcKey) => <label className={controls.check}><input type="checkbox" checked={!!f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} /> {pcT(l)}</label>;
  return (
    <div className={css.bar}>
      <Field label={pcT('posClass')}><SelectField className={controls.select} value={f.pos_class ?? 'general'} onChange={(e) => setF({ ...f, pos_class: e.target.value as PsExport['pos_class'] })} data-ps-posclass>{POS_CLASSES.map((p) => <option key={p} value={p}>{pcT(`pc.${p}`)}</option>)}</SelectField></Field>
      {f.pos_class === 'property' && <Field label={pcT('propState')}><input className={controls.input} value={f.property_state ?? ''} onChange={(e) => setF({ ...f, property_state: e.target.value.replace(/\D/g, '').slice(0, 2) })} /></Field>}
      {(f.pos_class === 'physical' || f.pos_class === 'event') && box('abroad', 'abroad')}
      {box('inr_permitted', 'inrPermitted')}
      {box('inr_settled', 'inrSettled')}
      <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => run(() => void localDb.invoices.save({ ...inv, ps: { ...inv.ps, export: { ...inv.ps?.export, ...f } } } ))} data-ps-doc-save>{pcT('save')}</button>
    </div>
  );
}

/** MF-D4 Advance Authorisation / EPCG register: obligation, exports and imports tagged to it, EO balance, at-risk memo, ANF 4F CSV. */
import { useMemo, useState } from 'react';
import { sdT } from '../../i18n/areas/mfg-r13d-stat';
import { localDb } from '../../lib/localDb';
import { purchasesDb } from '../../lib/purchases';
import { todayInput } from '../../lib/utils';
import { toCsv } from '../../lib/csv';
import { downloadText } from '../../lib/download';
import { anf4fSheet, authorisationsDb, billAuthorisationOf, defaultDates, eoStatus, exportAaOf, exportsAgainst, importsAgainst, shortfallNote, withExportAa, type AuthorisationKind, type AuthorisationStatus, type ExportAuthorisation } from '../../lib/mfg/mf-authorisations';
import { NumberInput } from '../ui/NumberInput';
import type { MfgContext } from '../manufacturing/context';
import { Fld, Tbl } from './mfd-ui';
import { row, rs, run, sm } from './mfd-util';
import controls from '../../styles/controls.module.css';

const STATUSES: AuthorisationStatus[] = ['open', 'eodc_applied', 'redeemed', 'lapsed'];

export default function AuthorisationsView({ ctx }: { ctx: MfgContext }) {
  const today = todayInput();
  const data = useMemo(() => { void ctx.version; return { rows: authorisationsDb.all(), invoices: localDb.invoices.getAll(), bills: purchasesDb.all() }; }, [ctx.version]);
  const [f, setF] = useState({ kind: 'aa' as AuthorisationKind, number: '', date: today, sion: '', duty: 0, multiple: 6, exp: '', expQty: 0, fob: 0, imp: '', impQty: 0, cif: 0 });
  const [tag, setTag] = useState({ inv: '', bill: '' });
  const byName = useMemo(() => new Map(ctx.items.map((i) => [i.name.trim().toLowerCase(), i.id])), [ctx.items]);
  const idOf = (n: string) => byName.get(n.trim().toLowerCase());
  const add = () => run(ctx, () => {
    authorisationsDb.save({
      kind: f.kind, number: f.number, date: f.date, ...defaultDates(f.kind, f.date), norm: f.sion ? 'sion' : 'self', ...(f.sion ? { sion_ref: f.sion } : {}), duty_saved: f.duty, status: 'open',
      ...(f.kind === 'epcg' ? { eo_multiple: f.multiple } : {}),
      items_export: f.exp ? [{ item_id: f.exp, qty: f.expQty, fob_value: f.fob }] : [], items_import: f.imp ? [{ item_id: f.imp, qty: f.impQty, cif_value: f.cif }] : [],
    });
    return sdT('saved');
  });
  const itemSel = (k: 'exp' | 'imp') => (
    <select className={controls.select} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} data-mfd={`aa-${k}`}>
      <option value="">—</option>
      {ctx.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
    </select>
  );
  const num = (k: 'duty' | 'multiple' | 'expQty' | 'fob' | 'impQty' | 'cif') => <NumberInput className={controls.input} style={{ maxWidth: 110 }} value={f[k]} onChange={(v) => setF({ ...f, [k]: v })} data-mfd={`aa-${k}`} />;
  const tagInvoice = (a: ExportAuthorisation) => run(ctx, () => {
    const inv = data.invoices.find((i) => i.id === tag.inv);
    if (!inv) return;
    localDb.invoices.save({ ...inv, mf: withExportAa(inv.mf as Record<string, unknown> | undefined, a) as never });
    return sdT('tagged');
  });
  const tagBill = (a: ExportAuthorisation) => run(ctx, () => {
    const b = data.bills.find((x) => x.id === tag.bill);
    if (!b) return;
    purchasesDb.save({ ...b, mf: { ...b.mf, authorisation_id: a.id } });
    return sdT('tagged');
  });
  return (
    <>
      <div style={row}>
        <Fld l={sdT('kind')}>
          <select className={controls.select} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as AuthorisationKind })} data-mfd="aa-kind">
            <option value="aa">{sdT('kindAa')}</option>
            <option value="epcg">{sdT('kindEpcg')}</option>
          </select>
        </Fld>
        <Fld l={sdT('number')}><input className={controls.input} value={f.number} onChange={(e) => setF({ ...f, number: e.target.value })} data-mfd="aa-number" /></Fld>
        <Fld l={sdT('issued')}><input type="date" className={controls.input} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} data-mfd="aa-date" /></Fld>
        <Fld l={sdT('sion')}><input className={controls.input} value={f.sion} onChange={(e) => setF({ ...f, sion: e.target.value })} /></Fld>
        <Fld l={sdT('dutySaved')}>{num('duty')}</Fld>
        {f.kind === 'epcg' && <Fld l="×">{num('multiple')}</Fld>}
      </div>
      <div style={row}>
        <Fld l={sdT('expItem')}>{itemSel('exp')}</Fld>
        <Fld l={sdT('expQty')}>{num('expQty')}</Fld>
        <Fld l={sdT('fob')}>{num('fob')}</Fld>
        <Fld l={sdT('impItem')}>{itemSel('imp')}</Fld>
        <Fld l={sdT('impQty')}>{num('impQty')}</Fld>
        <Fld l={sdT('cif')}>{num('cif')}</Fld>
        <button type="button" className={controls.btnPrimary} disabled={!ctx.canBooks} onClick={add} data-mfd-b="aa-add">{sdT('add')}</button>
      </div>
      <div style={row}>
        <Fld l={sdT('tagInv')}>
          <select className={controls.select} value={tag.inv} onChange={(e) => setTag({ ...tag, inv: e.target.value })} data-mfd="aa-inv">
            <option value="">—</option>
            {data.invoices.filter((i) => i.doc_type === 'INVOICE' || i.doc_type === 'TAX_INVOICE').slice(-200).map((i) => <option key={i.id} value={i.id}>{i.invoice_number} · {i.client?.name}</option>)}
          </select>
        </Fld>
        <Fld l={sdT('tagBill')}>
          <select className={controls.select} value={tag.bill} onChange={(e) => setTag({ ...tag, bill: e.target.value })} data-mfd="aa-bill">
            <option value="">—</option>
            {data.bills.slice(-200).map((b) => <option key={b.id} value={b.id}>{b.bill_number} · {b.vendor_name}</option>)}
          </select>
        </Fld>
      </div>
      <Tbl empty={sdT('none')} head={[sdT('number'), sdT('eoDue'), sdT('done'), sdT('daysLeft'), sdT('atRisk'), sdT('status'), '']} rows={data.rows.map((a) => {
        const ex = exportsAgainst(data.invoices, a.id, idOf);
        const im = importsAgainst(data.bills, a.id, idOf);
        const s = eoStatus(a, ex, im, today);
        const tagged = data.invoices.filter((i) => exportAaOf(i)?.authorisation_id === a.id).length + data.bills.filter((b) => billAuthorisationOf(b) === a.id).length;
        return [`${a.kind === 'aa' ? 'AA' : 'EPCG'} ${a.number}`, a.eo_extended_to || a.eo_due,
          a.kind === 'aa' ? `${rs(s.qtyDone)} / ${rs(s.qtyRequired)} · ₹${rs(s.valueDone)} / ${rs(s.valueRequired)}` : `₹${rs(s.valueDone)} / ${rs(s.valueRequired)} · ${s.blocks.map((b) => `${b.year}y ${b.met ? '✓' : '✗'}`).join(' ')}`,
          `${s.daysLeft}${s.bell ? ' !' : ''}`, <span key="r" title={shortfallNote(a)}>{rs(s.atRisk)}</span>,
          <select key="s" className={controls.select} value={a.status} disabled={!ctx.canBooks} onChange={(e) => run(ctx, () => { authorisationsDb.save({ ...a, status: e.target.value as AuthorisationStatus }); return sdT('saved'); })}>{STATUSES.map((x) => <option key={x} value={x}>{x}</option>)}</select>,
          <span key="b">
            <button type="button" className={sm} disabled={!tag.inv || !ctx.canBooks} onClick={() => tagInvoice(a)} data-mfd-b="aa-tag-inv">{sdT('tagInv')}</button>{' '}
            <button type="button" className={sm} disabled={!tag.bill || !ctx.canBooks} onClick={() => tagBill(a)} data-mfd-b="aa-tag-bill">{sdT('tagBill')}</button>{' '}
            <button type="button" className={sm} onClick={() => downloadText(`ANF4F-${a.number}.csv`, toCsv(anf4fSheet(a, ex, im)), 'text/csv')}>{sdT('anf')}</button>{' '}
            <button type="button" className={sm} disabled={!ctx.canBooks} onClick={() => run(ctx, () => { authorisationsDb.remove(a.id, tagged); return sdT('saved'); })}>×</button>
          </span>];
      })} />
      <p className={controls.hint}>{data.rows[0] ? shortfallNote(data.rows[0]) : ''}</p>
    </>
  );
}

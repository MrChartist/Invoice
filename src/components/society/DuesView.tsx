/**
 * R18-C dues view (`&view=dues`): every unit's open dues on a date — months overdue, billed interest still open,
 * interest to date, the last promise (R2-A4) — filtered by wing / ageing; per unit a receipt split interest first
 * (editable), an interest waiver (financial credit note with the GB resolution), a dues certificate (logged on the
 * unit), a transfer of membership, the member statement (Receivables) and a WhatsApp reminder in the society wording.
 * The notice-board list prints unit and amount only. Working papers — verify with your CA.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../../i18n';
import { hsT } from '../../i18n/areas/society-r18a';
import { hscT } from '../../i18n/areas/society-r18c';
import { localDb } from '../../lib/localDb';
import { formatCurrency, todayInput } from '../../lib/utils';
import { wingsOf } from '../../lib/society/hs-units';
import { issueCertificate, loadDues, printText, receiptSplit, recordUnitReceipt, reminderLink, transferMembership, applySocietyWording, waiveInterest } from '../../lib/society/hs-dues-io';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Field as F, type HsViewProps } from './hs-ui';
import { numIn, row } from './hs-form';
import { DateField } from '../ui/DateField';
import { SelectField } from '../ui/SelectField';

type Mode = 'receipt' | 'cert' | 'transfer' | 'waive';

export default function DuesView({ notify }: HsViewProps) {
  useT();
  const [asOf, setAsOf] = useState(todayInput());
  const [wing, setWing] = useState('');
  const [age, setAge] = useState(0);
  const [tick, setTick] = useState(0);
  const [sel, setSel] = useState<{ id: string; mode: Mode } | null>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const [split, setSplit] = useState<{ bill_id: string; ref: string; amount: number }[]>([]);
  const [cert, setCert] = useState('');
  const all = useMemo(() => { void tick; return loadDues(asOf); }, [asOf, tick]);
  const lines = all.filter((l) => l.open > 0.004 && (!wing || l.unit.wing === wing) && l.months >= age);
  const clients = useMemo(() => localDb.clients.getAll(), []);
  const v = (k: string) => f[k] ?? '';
  const set = (k: string, x: string) => setF((o) => ({ ...o, [k]: x }));
  const act = (fn: () => string) => { try { notify(fn()); setTick((t) => t + 1); setSel(null); } catch (e) { notify((e as Error).message, 'error'); } };
  const open = (id: string, mode: Mode) => { setSel({ id, mode }); setF({ date: asOf }); setSplit([]); setCert(''); };
  const amt = (x: string) => { set('amount', x); const n = numIn(x) ?? 0; setSplit(sel && n > 0 ? receiptSplit(sel.id, n, v('date') || asOf) : []); };
  const sm = `${controls.btnGhost} ${controls.btnSm}`;
  return (
    <section data-hs-dues>
      <div style={row}>
        <F label={hscT('asOf')}><DateField className={controls.input} value={asOf} onChange={(e) => setAsOf(e.target.value)} data-hs-asof /></F>
        <F label={hsT('wing')}><SelectField className={controls.select} value={wing} onChange={(e) => setWing(e.target.value)}><option value="">{hsT('all')}</option>{wingsOf(all.map((l) => l.unit)).map((w) => <option key={w}>{w}</option>)}</SelectField></F>
        <F label={hscT('overdue')}><SelectField className={controls.select} value={age} onChange={(e) => setAge(Number(e.target.value))}><option value={0}>{hsT('all')}</option><option value={1}>{hscT('m1')}</option><option value={3}>{hscT('m3')}</option></SelectField></F>
        <button type="button" className={controls.btnOutline} onClick={() => printText(hscT('notice'), lines.map((l) => `${l.unit.code}: ${formatCurrency(l.open)}`))}>{hscT('notice')}</button>
        <button type="button" className={controls.btnOutline} onClick={() => act(() => { applySocietyWording(); return hscT('worded'); })}>{hscT('wording')}</button>
      </div>
      {!lines.length ? <p className={controls.hint}>{hscT('none')}</p> : (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th>{hsT('unit')}</th><th>{hsT('member')}</th><th className={surface.numeric}>{hscT('months')}</th><th className={surface.numeric}>{hscT('open')}</th><th className={surface.numeric}>{hscT('interest')}</th><th className={surface.numeric}>{hscT('accrued')}</th><th>{hscT('promise')}</th><th /></tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.unit.id} data-hs-due={l.unit.code} data-hs-open={l.open}>
                  <td>{l.unit.code}</td><td>{l.member?.name}</td><td className={surface.numeric}>{l.months}</td><td className={surface.numeric}>{formatCurrency(l.open)}</td>
                  <td className={surface.numeric}>{formatCurrency(l.billed)}</td><td className={surface.numeric}>{formatCurrency(l.accrued)}</td><td>{l.promise}</td>
                  <td>
                    {(['receipt', 'cert', 'transfer', 'waive'] as const).map((m) => <button key={m} type="button" className={sm} data-hs-act={m} onClick={() => open(l.unit.id, m)}>{hscT(m)}</button>)}
                    {l.member?.id && <Link className={sm} to={`/receivables?tab=statements&party=${l.member.id}`}>{hscT('statement')}</Link>}
                    {l.first && <a className={sm} href={reminderLink(l)} target="_blank" rel="noreferrer">{hscT('remind')}</a>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sel && (
        <div style={row} data-hs-form={sel.mode}>
          {sel.mode !== 'cert' && <F label={hscT('date')}><DateField className={controls.input} value={v('date')} onChange={(e) => set('date', e.target.value)} /></F>}
          {(sel.mode === 'receipt' || sel.mode === 'waive') && <F label={hscT('amount')}><input type="number" min={0} className={controls.input} value={v('amount')} onChange={(e) => (sel.mode === 'receipt' ? amt(e.target.value) : set('amount', e.target.value))} data-hs-amount /></F>}
          {sel.mode === 'receipt' && (
            <>
              {split.map((a, k) => <F key={a.bill_id} label={a.ref}><input type="number" className={controls.input} value={a.amount} data-hs-split={a.ref} onChange={(e) => setSplit((s) => s.map((x, j) => (j === k ? { ...x, amount: numIn(e.target.value) ?? 0 } : x)))} /></F>)}
              <p className={controls.hint}>{hscT('alloc')}</p>
              <button type="button" className={controls.btnPrimary} data-hs-save-receipt onClick={() => act(() => { recordUnitReceipt(sel.id, numIn(v('amount')) ?? 0, v('date'), 'Bank transfer', split); return hscT('saved'); })}>{hscT('save')}</button>
            </>
          )}
          {sel.mode === 'waive' && (
            <>
              <F label={hscT('reason')}><input className={controls.input} value={v('reason')} onChange={(e) => set('reason', e.target.value)} /></F>
              <F label={hscT('resolution')}><input className={controls.input} value={v('res')} onChange={(e) => set('res', e.target.value)} /></F>
              <button type="button" className={controls.btnPrimary} onClick={() => act(() => { waiveInterest(sel.id, numIn(v('amount')) ?? 0, v('reason'), v('res'), v('date')); return hscT('waived'); })}>{hscT('waive')}</button>
            </>
          )}
          {sel.mode === 'transfer' && (
            <>
              <F label={hscT('to')}><SelectField className={controls.select} value={v('to')} onChange={(e) => set('to', e.target.value)}><option value="" />{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</SelectField></F>
              <F label={hscT('premium')}><input type="number" min={0} className={controls.input} value={v('premium')} onChange={(e) => set('premium', e.target.value)} /></F>
              <label className={controls.check}><input type="checkbox" checked={v('settled') === '1'} onChange={(e) => set('settled', e.target.checked ? '1' : '')} /> {hscT('settled')}</label>
              <button type="button" className={controls.btnPrimary} onClick={() => act(() => { transferMembership(sel.id, { date: v('date'), to_id: v('to'), premium: numIn(v('premium')), dues_settled: v('settled') === '1' }); return hscT('done'); })}>{hscT('transfer')}</button>
            </>
          )}
          {sel.mode === 'cert' && (
            cert ? <><p data-hs-cert>{cert}</p><button type="button" className={controls.btnOutline} onClick={() => printText(hscT('cert'), [cert])}>{hscT('print')}</button></>
              : <button type="button" className={controls.btnPrimary} data-hs-issue-cert onClick={() => { try { setCert(issueCertificate(sel.id, asOf)); setTick((t) => t + 1); } catch (e) { notify((e as Error).message, 'error'); } }}>{hscT('cert')}</button>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * R18-D3 / D4 registers view (`&view=registers`): the List of members (MH Form J; elsewhere a register of members),
 * the I register (MH), the share and nomination registers — printed (`escHtml`), State-labelled — with each member's
 * admission date, share certificate and nominees edited on the unit; the audit tracker per FY (due date from the State
 * row or typed, status, bell notices); and the income-tax working paper (mutual / non-mutual, deduction lines by date).
 * Working papers — verify with your CA.
 */
import { useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { hsT } from '../../i18n/areas/society-r18a';
import { hsdT } from '../../i18n/areas/society-r18d';
import { localDb } from '../../lib/localDb';
import { formatCurrency, todayInput } from '../../lib/utils';
import { fyStartYearOf } from '../../lib/books';
import { auditDue, auditStatus, memberRows, nomineesText, parseNominees } from '../../lib/society/hs-registers';
import { itaxFigures, saveAudit } from '../../lib/society/hs-books-io';
import { printText } from '../../lib/society/hs-dues-io';
import { stateRule } from '../../lib/society/hs-tariff';
import { loadUnits, saveUnit } from '../../lib/society/hs-units-save';
import { readSocietySettings } from '../../lib/society/hs-settings';
import type { HsAudit } from '../../types/society-r18';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Field as F, type HsViewProps } from './hs-ui';
import { row } from './hs-form';

type Reg = 'j' | 'iReg' | 'share' | 'nomination';

export default function RegistersView({ notify }: HsViewProps) {
  useT();
  const today = todayInput();
  const [tick, setTick] = useState(0);
  const s = useMemo(() => { void tick; return readSocietySettings(); }, [tick]);
  const rule = stateRule(s.state, today, s.confirmed);
  const formJ = rule?.registers === 'form_j';
  const units = useMemo(() => { void tick; return loadUnits(); }, [tick]);
  const rows = useMemo(() => memberRows(units, localDb.clients.getAll()), [units]);
  const [reg, setReg] = useState<Reg>('j');
  const [edit, setEdit] = useState<{ id: string; admitted: string; cert: string; nom: string } | null>(null);
  const fy0 = fyStartYearOf(today) - 1;
  const [fy, setFy] = useState(`${fy0}-${String(fy0 + 1).slice(2)}`);
  const a: HsAudit = s.audit?.find((x) => x.fy === fy) ?? { fy };
  const [au, setAu] = useState<HsAudit | null>(null);
  const cur = au?.fy === fy ? au : a;
  const due = auditDue(cur, rule?.audit_due_months ?? null), st = auditStatus(cur, due, today);
  const tx = useMemo(() => itaxFigures(Number(fy.slice(0, 4))), [fy]);
  const act = (fn: () => void) => { try { fn(); notify(hsdT('saved')); setTick((t) => t + 1); } catch (e) { notify((e as Error).message, 'error'); } };
  const title = reg === 'j' ? (formJ ? hsdT('j') : hsdT('members')) : hsdT(reg);
  const line = (r: (typeof rows)[number]) => reg === 'share' ? `${r.no}. ${r.name} — ${r.unit} — ${r.cert ?? ''}` : reg === 'nomination' ? `${r.no}. ${r.name} — ${r.unit} — ${nomineesText(r.nominees)}` : `${r.no}. ${r.name} — ${r.unit} — ${r.admitted ?? ''} — ${r.cert ?? ''}${reg === 'iReg' ? ` — ${hsdT('transfers')}: ${r.transfers}` : ''}`;
  const set = (k: keyof HsAudit, x: string) => setAu({ ...cur, [k]: x || undefined });
  return (
    <section data-hs-registers>
      <div style={row}>
        <select className={controls.select} value={reg} onChange={(e) => setReg(e.target.value as Reg)} data-hs-reg>
          {(['j', ...(formJ ? ['iReg'] : []), 'share', 'nomination'] as Reg[]).map((k) => <option key={k} value={k}>{k === 'j' ? (formJ ? hsdT('j') : hsdT('members')) : hsdT(k)}</option>)}
        </select>
        <button type="button" className={controls.btnOutline} data-hs-print-reg onClick={() => printText(title, rows.map(line))}>{hsdT('print')}</button>
      </div>
      <div className={surface.tableWrap}>
        <table className={surface.table} data-hs-members={rows.length}>
          <thead><tr><th>{hsdT('no')}</th><th>{hsT('member')}</th><th>{hsT('unit')}</th><th>{hsdT('admitted')}</th><th>{hsdT('cert')}</th><th>{hsdT('nominees')}</th><th /></tr></thead>
          <tbody>
            {rows.map((r) => <tr key={r.id}><td>{r.no}</td><td>{r.name}</td><td>{r.unit}</td><td>{r.admitted}</td><td>{r.cert}</td><td>{nomineesText(r.nominees)}</td>
              <td><button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => setEdit({ id: r.id, admitted: r.admitted ?? '', cert: r.cert ?? '', nom: nomineesText(r.nominees) })}>{hsT('open')}</button></td></tr>)}
          </tbody>
        </table>
      </div>
      {edit && (
        <div style={row}>
          <F label={hsdT('admitted')}><input type="date" className={controls.input} value={edit.admitted} onChange={(e) => setEdit({ ...edit, admitted: e.target.value })} /></F>
          <F label={hsdT('cert')}><input className={controls.input} value={edit.cert} onChange={(e) => setEdit({ ...edit, cert: e.target.value })} /></F>
          <F label={hsdT('nominees')}><input className={controls.input} value={edit.nom} onChange={(e) => setEdit({ ...edit, nom: e.target.value })} /></F>
          <button type="button" className={controls.btnPrimary} onClick={() => act(() => { const u = units.find((x) => x.id === edit.id)!; saveUnit({ ...u, admitted_on: edit.admitted || undefined, share_cert: edit.cert.trim() || undefined, nominees: parseNominees(edit.nom) }); setEdit(null); })}>{hsdT('save')}</button>
        </div>
      )}
      <h3>{hsdT('audit')}</h3>
      <div style={row} data-hs-audit={st.code}>
        <F label={hsdT('fy')}><input className={controls.input} value={fy} onChange={(e) => setFy(e.target.value.trim())} placeholder="2025-26" /></F>
        <F label={hsdT('auditor')}><input className={controls.input} value={cur.auditor ?? ''} onChange={(e) => set('auditor', e.target.value)} data-hs-auditor /></F>
        {(['appointed_on', 'due_on', 'report_on', ...(formJ ? ['rectified_on'] : [])] as (keyof HsAudit)[]).map((k) => (
          <F key={k} label={hsdT(({ appointed_on: 'appointed', due_on: 'dueOn', report_on: 'report', rectified_on: 'rectified' } as const)[k as 'due_on'])}><input type="date" className={controls.input} value={k === 'due_on' ? cur.due_on ?? due : (cur[k] as string) ?? ''} onChange={(e) => set(k, e.target.value)} data-hs-audit-field={k} /></F>
        ))}
        {st.code && <span className={controls.hint}>{hsdT(st.code, { n: st.n ?? 0 })}</span>}
        <button type="button" className={controls.btnPrimary} data-hs-save-audit onClick={() => act(() => saveAudit(cur))}>{hsdT('save')}</button>
      </div>
      <h3>{hsdT('itax')}</h3>
      <div data-hs-itax>
        <p>{hsdT('mutual')}: {formatCurrency(tx.mutual)} · {hsdT('nonMutual')}: {formatCurrency(round(tx.outsider + tx.other))}</p>
        {tx.rule && <p>{hsdT('ded')} ({tx.rule.act}): {tx.rule.lines.map((l) => `Sec ${l.code} — ${l.text}${l.cap ? ` (up to ${formatCurrency(l.cap)})` : ''}`).join('; ')}. {hsdT('bank')}</p>}
        <p className={controls.hint}>{hsdT('tdsNote')} {hsdT('wp')}</p>
      </div>
    </section>
  );
}
const round = (n: number) => Math.round(n * 100) / 100;

/**
 * R18-B3 GST view: FY-to-date turnover (exempt maintenance and non-member income in, pure-agent dues out) against the
 * registration threshold, the units above the ₹7,500 limit in the last run's period, the Circular 109 Q2
 * both-conditions table with the society's position, the registration hint (never a block), the period's exempt /
 * taxable turnover with the link to the Rule 42 / 43 split (GST reports → Common credit, which reads the same bills),
 * and the pending Madras HC note on the whole-amount rule (HS2). Working papers — verify with your CA.
 */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../../i18n';
import { hsbT } from '../../i18n/areas/society-r18b';
import { localDb } from '../../lib/localDb';
import { formatCurrency, todayInput } from '../../lib/utils';
import { recoveryValue } from '../../lib/trade/pure-agent';
import { periodOf, periodRange } from '../../lib/society/hs-tariff';
import { fyTurnover, position, regThreshold, unitsAbove } from '../../lib/society/hs-turnover';
import { loadRuns, societySettings } from '../../lib/society/hs-issue-io';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import type { HsViewProps } from './hs-ui';

export default function GstView(_: HsViewProps) {
  useT();
  const [note, setNote] = useState('');
  useEffect(() => { void import('../../lib/pending-changes').then((m) => setNote(m.pendingFor('society', todayInput()).map(m.pendingLine).join(' ')), () => undefined); }, []);
  const d = useMemo(() => {
    const today = todayInput(), s = societySettings(), inv = localDb.invoices.getAll();
    const run = loadRuns().filter((r) => !r.undone && !r.levy).sort((a, b) => b.date.localeCompare(a.date))[0];
    const p = run?.period ?? periodOf(today, s.cycle), pr = periodRange(p)!;
    const y = Number(today.slice(0, 4)), rec = recoveryValue;
    const t = fyTurnover(inv, `${Number(today.slice(5, 7)) >= 4 ? y : y - 1}-04-01`, today, rec);
    const thr = regThreshold(s.state, today), above = unitsAbove(inv, p);
    return { t, thr, above, p, pt: fyTurnover(inv, pr.from, pr.to, rec), pos: position(t.total, thr, above.length), registered: !!localDb.settings.activeProfile()?.companyGstin?.trim() };
  }, []);
  const m = (n: number) => formatCurrency(n);
  const yn = (b: boolean) => hsbT(b ? 'yes' : 'no');
  return (
    <section data-hs-gst data-hs-turnover={d.t.total}>
      <div className={surface.tableWrap}>
        <table className={surface.table}>
          <tbody>
            <tr><th>{hsbT('turnover')}</th><td className={surface.numeric}>{m(d.t.total)}</td><td>{hsbT('exempt')} {m(d.t.exempt)} · {hsbT('taxable')} {m(d.t.taxable)}</td></tr>
            <tr><th>{hsbT('threshold')}</th><td className={surface.numeric}>{m(d.thr)}</td><td /></tr>
            <tr><th>{hsbT('above', { p: d.p, n: d.above.length })}</th><td className={surface.numeric} data-hs-above={d.above.length}>{d.above.length}</td><td>{d.above.slice(0, 20).join(', ')}</td></tr>
          </tbody>
        </table>
      </div>
      <p className={controls.hint}>{hsbT('both')}</p>
      <table className={surface.table} data-hs-position={`${d.pos.big}-${d.pos.above}`}>
        <thead><tr><th>{hsbT('threshold')}</th><th>{hsbT('test')}</th><th>GST</th></tr></thead>
        <tbody>
          {[[false, false], [false, true], [true, false], [true, true]].map(([big, ab]) => (
            <tr key={`${big}${ab}`} style={big === d.pos.big && ab === d.pos.above ? { fontWeight: 700, outline: '2px solid var(--accent)' } : undefined}>
              <td>{yn(big)}</td><td>{yn(ab)}</td><td>{yn(big && ab)}{big === d.pos.big && ab === d.pos.above ? ` — ${hsbT('you')}` : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!d.registered && d.pos.hint && <p className={controls.hint} style={{ color: 'var(--warning)' }} data-hs-reg-hint>{hsbT('regHint')}</p>}
      <p className={controls.hint}>
        {d.p}: {hsbT('exempt')} {m(d.pt.exempt)} · {hsbT('taxable')} {m(d.pt.taxable)} · <Link to={`/gst-reports?tab=common-credit`}>{hsbT('itc')}</Link>
      </p>
      {note && <p className={controls.hint} role="note" data-pending="society">{note}</p>}
    </section>
  );
}

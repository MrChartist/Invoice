/**
 * R18-D1 funds view (`&view=funds`): "Map funds" (the three fund cost centres and reserve ledgers), the transfer mode
 * (each period / at the year end), "Transfer for <period>" (one journal of the contributions billed and not moved yet),
 * the FY's funds — opening, billed, transferred, spent, closing — the State minimum hints, and the link to Books → Funds
 * (the R5-C4 fund statements). Working papers — verify with your CA.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../../i18n';
import { hsbT } from '../../i18n/areas/society-r18b';
import { hsdT } from '../../i18n/areas/society-r18d';
import { formatCurrency, todayInput } from '../../lib/utils';
import { fyStartYearOf } from '../../lib/books';
import { fundsView, mapFunds, postFundTransfer } from '../../lib/society/hs-books-io';
import { FUND_NAMES } from '../../lib/society/hs-funds';
import { periodOf } from '../../lib/society/hs-tariff';
import { readSocietySettings, saveSocietySettings } from '../../lib/society/hs-settings';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Field as F, type HsViewProps } from './hs-ui';
import { row } from './hs-form';

export default function FundsView({ notify }: HsViewProps) {
  useT();
  const [tick, setTick] = useState(0);
  const s = useMemo(() => { void tick; return readSocietySettings(); }, [tick]);
  const [fy, setFy] = useState(() => fyStartYearOf(todayInput()));
  const yearEnd = s.fund_transfer === 'year_end';
  const [p, setP] = useState(() => periodOf(todayInput(), s.cycle));
  const v = useMemo(() => { void tick; return fundsView(fy); }, [fy, tick]);
  const act = (fn: () => string) => { try { notify(fn()); setTick((t) => t + 1); } catch (e) { notify((e as Error).message, 'error'); } };
  const per = yearEnd ? `FY${fy}` : p;
  return (
    <section data-hs-funds>
      <div style={row}>
        <button type="button" className={s.funds ? controls.btnOutline : controls.btnPrimary} data-hs-map onClick={() => act(() => { mapFunds(); return hsdT('mapped'); })}>{hsdT('map')}</button>
        <label className={controls.check}><input type="checkbox" checked={yearEnd} onChange={(e) => act(() => { saveSocietySettings({ fund_transfer: e.target.checked ? 'year_end' : 'period' }); return hsdT('saved'); })} /> {hsdT('yearEnd')}</label>
        {!yearEnd && <F label={hsbT('period')}><input className={controls.input} value={p} onChange={(e) => setP(e.target.value.trim())} data-hs-fund-period /></F>}
        <button type="button" className={controls.btnPrimary} disabled={!s.funds} data-hs-transfer onClick={() => act(() => (postFundTransfer(per) ? hsdT('posted') : hsdT('nothing')))}>{hsdT('transfer', { p: per })}</button>
      </div>
      <div style={row}>
        <F label={hsdT('fy')}><input type="number" className={controls.input} value={fy} onChange={(e) => setFy(Number(e.target.value) || fy)} /></F>
        <Link to="/books?tab=funds">{hsdT('statement')}</Link>
      </div>
      {v.low.map((l) => <p key={l.fund} className={controls.hint} data-hs-fund-low={l.fund}>{hsdT('fundLow', { f: FUND_NAMES[l.fund], b: formatCurrency(l.billed), m: formatCurrency(l.min) })}</p>)}
      {v.rows.length > 0 && (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th /><th className={surface.numeric}>{hsdT('opening')}</th><th className={surface.numeric}>{hsdT('billed')}</th><th className={surface.numeric}>{hsdT('moved')}</th><th className={surface.numeric}>{hsdT('spent')}</th><th className={surface.numeric}>{hsdT('closing')}</th></tr></thead>
            <tbody>
              {v.rows.map((r) => (
                <tr key={r.key} data-hs-fund={r.key} data-hs-moved={r.transferred}>
                  <td>{r.name}</td>{[r.opening, r.billed, r.transferred, r.spent, r.closing].map((x, i) => <td key={i} className={surface.numeric}>{formatCurrency(x)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

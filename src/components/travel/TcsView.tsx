/**
 * R15-D1 view `tcs`: TCS collected on overseas tour packages per buyer for an FY, buyers without a PAN, buyers near
 * the old threshold (slab years 2023-26), the quarter totals for Form 27EQ / 143 and a link to the challans and
 * returns (TDS & TCS page). The TCS base setting (TV6) is the owner's. Only the invoices are read.
 */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useT } from '../../i18n';
import { tvT } from '../../i18n/areas/travel-r15b';
import { tvdList, tvdT } from '../../i18n/areas/travel-r15d';
import { localDb } from '../../lib/localDb';
import { can } from '../../lib/access';
import { formatCurrency, todayInput } from '../../lib/utils';
import { fyOf, tcsRegister, type BuyerRow } from '../../lib/travel/tv-tcs';
import { readTravelSettings, saveTravelSettings } from '../../lib/travel/tv-settings';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import { Field } from './tv-ui';
import { runWith, type TvViewProps } from './tv-run';

const BASES = ['total', 'taxable'] as const;
const money = (n: number) => formatCurrency(n);
const fyText = (y: number) => `${y}-${String(y + 1).slice(2)}`;

export default function TcsView({ notify }: TvViewProps) {
  useT();
  const [fy, setFy] = useState(fyOf(todayInput()));
  const [base, setBase] = useState(readTravelSettings().tcs?.base ?? 'total');
  const reg = useMemo(() => tcsRegister(localDb.invoices.getAll(), fy), [fy]);
  const list = (title: string, rows: BuyerRow[], attr: string) => rows.length > 0 && <p className={controls.hint} {...{ [attr]: '' }}>{title}: {rows.map((r) => `${r.name} (${money(r.base)})`).join(', ')}</p>;
  return (
    <section data-tv-tcs-view>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', marginBottom: '0.75rem' }}>
        <Field label={tvdT('fy')}>
          <select className={controls.select} value={fy} onChange={(e) => setFy(Number(e.target.value))}>
            {[0, 1, 2, 3].map((d) => fyOf(todayInput()) - d).map((y) => <option key={y} value={y}>{fyText(y)}</option>)}
          </select>
        </Field>
        {can('settings.manage') && (
          <Field label={tvdT('tcsBase')}>
            <select className={controls.select} value={base} onChange={(e) => { const b = e.target.value as typeof base; setBase(b); runWith(notify)(() => saveTravelSettings({ tcs: { base: b } })); }} data-tv-tcs-base>
              {BASES.map((b) => <option key={b} value={b}>{tvdList('bases', BASES, b)}</option>)}
            </select>
          </Field>
        )}
        <Link to="/tds" className={`${controls.btnOutline} ${controls.btnSm}`}>{tvdT('challans')}</Link>
      </div>
      {reg.buyers.length ? (
        <div className={surface.tableWrap}>
          <table className={surface.table} data-tv-tcs-register>
            <thead><tr><th>{tvdT('buyer')}</th><th>{tvdT('pan')}</th><th className={surface.numeric}>{tvdT('docs')}</th><th className={surface.numeric}>{tvdT('base')}</th><th className={surface.numeric}>{tvdT('collected')}</th></tr></thead>
            <tbody>
              {reg.buyers.map((b) => <tr key={b.key}><td>{b.name}</td><td>{b.pan || '—'}</td><td className={surface.numeric}>{b.count}</td><td className={surface.numeric}>{money(b.base)}</td><td className={surface.numeric}>{money(b.tcs)}</td></tr>)}
              <tr>{reg.quarters.map((q, i) => <th key={i} className={surface.numeric}>{tvdT('quarter')} {i + 1}: {money(q)}</th>)}<th className={surface.numeric}>{tvT('total')}: {money(reg.total)}</th></tr>
            </tbody>
          </table>
        </div>
      ) : <p className={controls.hint}>{tvdT('noTcs')}</p>}
      {list(tvdT('panMissing'), reg.noPan, 'data-tv-tcs-nopan')}
      {list(tvdT('near'), reg.near, 'data-tv-tcs-near')}
    </section>
  );
}

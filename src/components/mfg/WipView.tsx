/**
 * MF-D5 Floor → WIP: the dated, audited "absorb conversion" switch (off by default), conversion spent on each open order
 * (job-card hours × rate, AS 2 cap), what is already in stock, the memo WIP and unabsorbed overhead; WIP statement CSV.
 */
import { useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { sdT } from '../../i18n/areas/mfg-r13d-stat';
import { todayInput } from '../../lib/utils';
import { absorbOn, absorbPatch, auditAbsorb, liveMemoConversion } from '../../lib/mfg/mf-conversion';
import { readMfgSettings, saveMfgSettings } from '../../lib/mfg/mf-settings';
import { downloadWipStatement } from '../../lib/mfg/mf-wip-csv';
import type { MfgContext } from '../manufacturing/context';
import { Fld, Tbl } from './mfd-ui';
import { row, rs, run, sm } from './mfd-util';
import controls from '../../styles/controls.module.css';
import { DateField } from '../ui/DateField';

export default function WipView({ ctx }: { ctx: MfgContext }) {
  useT();
  const today = todayInput();
  const [from, setFrom] = useState(today);
  const { s, m } = useMemo(() => { void ctx.version; return { s: readMfgSettings(), m: liveMemoConversion(today) }; }, [ctx.version, today]);
  const flip = (on: boolean) => run(ctx, () => { saveMfgSettings(absorbPatch(s, on, from)); auditAbsorb(on, from); return sdT('saved'); });
  return (
    <section data-wip-view>
      <p data-mfd-absorb>{sdT('absorbState', { s: absorbOn(s, today) ? sdT('on') : sdT('off') })}</p>
      <div style={row}>
        <Fld l={sdT('absorb')}><DateField className={controls.input} value={from} onChange={(e) => setFrom(e.target.value)} data-mfd="absorb-from" /></Fld>
        <button type="button" className={sm} onClick={() => flip(true)} data-mfd-b="absorb-on">{sdT('absorbOn')}</button>
        <button type="button" className={sm} onClick={() => flip(false)} data-mfd-b="absorb-off">{sdT('absorbOff')}</button>
        <button type="button" className={sm} onClick={() => downloadWipStatement(today)}>{sdT('wipCsv')}</button>
      </div>
      <p className={controls.hint}>{sdT('absorbNote')}</p>
      <Tbl empty={sdT('none')} head={[sdT('order'), sdT('spent'), sdT('absorbedCol'), sdT('memoCol')]} rows={m.rows.map((r) => [r.number, rs(r.spent), rs(r.absorbed), rs(r.memo)])} />
      {m.unabsorbed > 0 && <p className={controls.hint}>{sdT('unabsorbed', { v: rs(m.unabsorbed) })}</p>}
    </section>
  );
}

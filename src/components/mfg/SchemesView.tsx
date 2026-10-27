/** MF-D2 food / FMCG scheme presets for the R8 scheme engine (data only) and the Circular 251/08/2025 note. */
import { useState } from 'react';
import { fdT } from '../../i18n/areas/mfg-r13d-food';
import { schemesDb } from '../../lib/pricing';
import { todayInput } from '../../lib/utils';
import { CIRCULAR_251_NOTE, FOOD_SCHEME_PRESETS, presetScheme } from '../../lib/mfg/mf-shelf';
import type { MfgContext } from '../manufacturing/context';
import { Fld, Tbl } from './mfd-ui';
import { row, run, sm } from './mfd-util';
import controls from '../../styles/controls.module.css';

export default function SchemesView({ ctx }: { ctx: MfgContext }) {
  const [item, setItem] = useState('');
  const create = (id: string) => run(ctx, () => {
    const p = FOOD_SCHEME_PRESETS.find((x) => x.id === id)!;
    const it = ctx.items.find((i) => i.id === item);
    const s = it ? presetScheme(p, it, todayInput()) : null;
    if (!s) return;
    schemesDb.save({ id: '', ...s });
    return fdT('schemeSaved');
  });
  return (
    <>
      <div style={row}>
        <Fld l={fdT('item')}>
          <select className={controls.select} value={item} onChange={(e) => setItem(e.target.value)} data-mfd="scheme-item">
            <option value="">—</option>
            {ctx.items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
          </select>
        </Fld>
      </div>
      <Tbl empty="" head={[fdT('preset'), '', '']} rows={FOOD_SCHEME_PRESETS.map((p) => [p.label, p.note, p.id === 'display_claim' ? fdT('fcnNote') : <button key="u" type="button" className={sm} disabled={!item || !ctx.canMasters} onClick={() => create(p.id)} data-mfd-b={`scheme-${p.id}`}>{fdT('use')}</button>])} />
      <p className={controls.hint}>{CIRCULAR_251_NOTE}</p>
    </>
  );
}

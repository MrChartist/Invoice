/** MF-D5 Schedule III inventories split (valuer positions + WIP godowns), memo conversion, item classes, WIP statement CSV. */
import { useMemo, useState } from 'react';
import { sdT, type SdKey } from '../../i18n/areas/mfg-r13d-stat';
import { stockDb } from '../../lib/inventory';
import { bomsDb } from '../../lib/manufacturing';
import { todayInput } from '../../lib/utils';
import { liveMemo, liveSplit } from '../../lib/mfg/mf-inventories-live';
import { defaultClasses, INV_CLASSES } from '../../lib/mfg/mf-inventories';
import { downloadWipStatement } from '../../lib/mfg/mf-wip-csv';
import type { MfgContext } from '../manufacturing/context';
import { Fld, Tbl } from './mfd-ui';
import { row, rs, run, sm } from './mfd-util';
import controls from '../../styles/controls.module.css';
import { DateField } from '../ui/DateField';
import { SelectField } from '../ui/SelectField';

export default function InventoriesView({ ctx }: { ctx: MfgContext }) {
  const [date, setDate] = useState(todayInput());
  const { split, memo } = useMemo(() => { void ctx.version; const m = liveMemo(date); return { split: liveSplit(date, m.total), memo: m }; }, [ctx.version, date]);
  const defaults = useMemo(() => defaultClasses(ctx.items, bomsDb.all()), [ctx.items]);
  const p = (v: number) => rs(v / 100);
  return (
    <>
      <div style={row}>
        <Fld l={sdT('asOf')}><DateField className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} data-mfd="inv-date" /></Fld>
        <button type="button" className={sm} onClick={() => downloadWipStatement(date)} data-mfd-b="wip-csv">{sdT('wipCsv')}</button>
      </div>
      <h3>{sdT('split')}</h3>
      <Tbl empty={sdT('none')} head={[sdT('head'), sdT('value')]} rows={[...split.rows.filter((r) => r.value).map((r) => [r.label, p(r.value)]), [<b key="t">{sdT('total')}</b>, <b key="v" data-mfd-inv-total>{p(split.total)}</b>]]} />
      {split.memoConversion > 0 && <p className={controls.hint}>{sdT('memo', { v: p(split.memoConversion) })}</p>}
      {memo.unabsorbed > 0 && <p className={controls.hint}>{sdT('unabsorbed', { v: p(memo.unabsorbed) })}</p>}
      <h3>{sdT('cls')}</h3>
      <Tbl empty={sdT('none')} head={[sdT('head'), sdT('cls')]} rows={ctx.items.filter((i) => i.track_stock).map((i) => [i.name,
        <SelectField key="c" className={controls.select} value={i.mf_inv_class ?? ''} disabled={!ctx.canMasters} onChange={(e) => run(ctx, () => { stockDb.saveItem({ ...i, mf_inv_class: e.target.value || undefined }); return sdT('saved'); })} data-mfd="inv-class">
          <option value="">{sdT('auto')}: {sdT(`c.${defaults.get(i.id) ?? 'traded'}` as SdKey)}</option>
          {INV_CLASSES.map((c) => <option key={c} value={c}>{sdT(`c.${c}` as SdKey)}</option>)}
        </SelectField>])} />
    </>
  );
}

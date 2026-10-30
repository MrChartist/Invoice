/** MF-D2 shelf life: near-expiry stock by batch and godown (buckets, actions), shelf-life days per item, client minimum. */
import { useMemo, useState } from 'react';
import { fdT, type FdKey } from '../../i18n/areas/mfg-r13d-food';
import { localDb } from '../../lib/localDb';
import { stockDb } from '../../lib/inventory';
import { computeTracking } from '../../lib/stock-tracking';
import { godownName } from '../../lib/godowns';
import { todayInput } from '../../lib/utils';
import { BUCKET_ACTION, bucketTotals, LIFE_BUCKETS, nearExpiry } from '../../lib/mfg/mf-shelf';
import { NumberInput } from '../ui/NumberInput';
import type { MfgContext } from '../manufacturing/context';
import { Fld, Tbl } from './mfd-ui';
import { row, rs, run, sm } from './mfd-util';
import controls from '../../styles/controls.module.css';
import { SelectField } from '../ui/SelectField';

export default function ShelfLifeView({ ctx }: { ctx: MfgContext }) {
  const today = todayInput();
  const rows = useMemo(() => nearExpiry(computeTracking(ctx.inputs).values(), today), [ctx.inputs, today]);
  const totals = bucketTotals(rows);
  const clients = useMemo(() => { void ctx.version; return localDb.clients.getAll(); }, [ctx.version]);
  const [f, setF] = useState({ client: '', pct: 0, days: 0 });
  const pickClient = (id: string) => {
    const fl = clients.find((c) => c.id === id)?.mf;
    setF({ client: id, pct: fl?.min_shelf_pct ?? 0, days: fl?.min_shelf_days ?? 0 });
  };
  const saveFloor = () => run(ctx, () => {
    const c = clients.find((x) => x.id === f.client);
    if (!c) return;
    localDb.clients.upsert({ ...c, mf: { ...c.mf, min_shelf_pct: f.pct || undefined, min_shelf_days: f.days || undefined } });
    return fdT('floorSaved');
  });
  return (
    <>
      <p data-mfd-buckets>{LIFE_BUCKETS.filter((b) => totals[b]).map((b) => `${fdT(`b.${b}` as FdKey)}: ${rs(totals[b])}`).join(' · ') || fdT('none')}</p>
      <Tbl empty={fdT('none')} head={[fdT('item'), fdT('batch'), fdT('godown'), fdT('qty'), fdT('expiry'), fdT('life'), fdT('action')]}
        rows={rows.filter((r) => r.bucket !== 'ok').map((r) => [r.item, r.batch, godownName(ctx.godowns, r.godown), rs(r.qty), r.expiry ?? '', r.pct === null ? `${r.days ?? '-'} ${fdT('days')}` : `${r.pct}% · ${r.days} ${fdT('days')}`, BUCKET_ACTION[r.bucket]])} />
      <h3>{fdT('clientFloor')}</h3>
      <div style={row}>
        <Fld l={fdT('client')}>
          <SelectField className={controls.select} value={f.client} onChange={(e) => pickClient(e.target.value)} data-mfd="floor-client">
            <option value="">-</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </SelectField>
        </Fld>
        <Fld l={fdT('minPct')}><NumberInput className={controls.input} style={{ maxWidth: 90 }} value={f.pct} onChange={(v) => setF({ ...f, pct: v })} data-mfd="floor-pct" /></Fld>
        <Fld l={fdT('minDays')}><NumberInput className={controls.input} style={{ maxWidth: 90 }} value={f.days} onChange={(v) => setF({ ...f, days: v })} data-mfd="floor-days" /></Fld>
        <button type="button" className={sm} disabled={!f.client} onClick={saveFloor} data-mfd-b="floor">{fdT('setFloor')}</button>
      </div>
      <h3>{fdT('shelfDays')}</h3>
      <Tbl empty={fdT('none')} head={[fdT('item'), fdT('days')]} rows={ctx.items.filter((i) => i.track_batches).map((i) => [i.name,
        <NumberInput key="d" className={controls.input} style={{ maxWidth: 90 }} value={i.shelf_life_days ?? 0} disabled={!ctx.canMasters} onChange={(v) => run(ctx, () => { stockDb.saveItem({ ...i, shelf_life_days: v > 0 ? Math.round(v) : undefined }); return fdT('itemSaved'); })} data-mfd="shelf-days" />])} />
    </>
  );
}

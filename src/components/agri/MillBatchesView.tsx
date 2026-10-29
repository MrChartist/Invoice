/** AG-C2 Mill → Milling batches: starter BOMs by mill kind; production orders with outturn vs standard (flagged). */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { MillKind } from '../../types/agri-r12';
import { localDb } from '../../lib/localDb';
import { stockDb } from '../../lib/inventory';
import { manufacturingDb } from '../../lib/manufacturing';
import { productionOrdersDb } from '../../lib/production/orders';
import { MILL_STARTERS, installMillStarter } from '../../lib/agri/ag-mill-bom';
import { batchYield } from '../../lib/agri/ag-yield';
import { B } from '../transport/shared';
import { Sel, Table } from './mill-ui';
import { T, W, q, row, useRun, type Done } from './mill-kit';
import controls from '../../styles/controls.module.css';

const KINDS = Object.keys(MILL_STARTERS) as MillKind[];

export default function MillBatchesView({ onDone }: { onDone: Done }) {
  const [tick, run] = useRun(onDone);
  const [kind, setKind] = useState<MillKind>(() => localDb.settings.get().mill_kind ?? 'rice');
  const rows = useMemo(() => {
    const items = stockDb.items();
    const mfg = manufacturingDb.all();
    return productionOrdersDb.all().sort((a, b) => b.date.localeCompare(a.date)).map((o) => ({ o, y: batchYield(o, mfg, items), name: items.find((i) => i.id === o.item_id)?.name ?? '?' }));
  }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div data-ml-view="batches">
      <div style={row}>
        <Sel l={T('starter')} v={kind} set={(x) => setKind(x as MillKind)} o={KINDS.map((k) => [k, T(`mk.${k}`)] as const)} x={220} />
        <button type="button" className={B.o} data-ml-starter onClick={() => run(() => T('starterAdded', { n: installMillStarter(kind).bom.name }))}>{T('installStarter')}</button>
        <Link className={B.p} to="/manufacturing?tab=orders">{T('newBatch')}</Link>
      </div>
      <p className={controls.hint}>{T('starterNote')}</p>
      <Table d="batches" head={[T('order'), W('date'), W('item'), `${T('input')} (${T('qtl')})`, T('outturn'), T('standard'), T('byPct'), T('loss'), '', '']} rows={rows.map(({ o, y, name }) => [
        o.number, o.date, name, y.input ? q(y.input) : '-', y.input ? y.outturnPct : '-', y.standard || '-', y.input ? y.byPct : '-', y.input ? y.lossPct : '-',
        <span key="f" data-ml-flag={y.flag ?? ''}>{y.flag ? T(`f.${y.flag}`) : ''}</span>,
        <Link key="l" className={B.gs} to={`/manufacturing?tab=orders&order=${o.id}`}>{W('open')}</Link>,
      ])} />
    </div>
  );
}

/** MF-B5 Press → Job tickets: a won estimate → production order (paper as material); the ticket print with actual sheets issued. */
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { MfgContext } from '../manufacturing/context';
import { productionOrdersDb } from '../../lib/production/orders';
import { actualPaper, estimateBreaks, loadEstimates, makeJobTicket, ticketHtml } from '../../lib/mfg/mf-estimates';
import { prT as P } from '../../i18n/areas/mfg-r13b-press';
import { B, printHtml } from '../transport/shared';
import controls from '../../styles/controls.module.css';
import { Table, fmt, row, useRun, type Done } from './mfb-ui';

export default function TicketsView({ ctx, done }: { ctx: MfgContext; done: Done }) {
  const [tick, run] = useRun(done, P('saved'));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const est = useMemo(() => loadEstimates().filter((e) => e.status !== 'lost'), [tick, ctx.version]);
  const [qty, setQty] = useState<Record<string, string>>({});
  return (
    <div data-mfb-view="tickets">
      <Table d="tickets" empty={P('noEstimates')} head={[P('number'), P('job'), P('qty'), P('ticket'), P('sheets'), '']} rows={est.map((e) => {
        const bs = estimateBreaks(e);
        const o = e.order_id ? productionOrdersDb.get(e.order_id) : undefined;
        const b = o ? bs.find((x) => x.qty === o.planned_qty) ?? bs[0] : bs.find((x) => String(x.qty) === (qty[e.id] ?? String(bs[0]?.qty))) ?? bs[0];
        const actual = o ? actualPaper(e) : undefined;
        return [
          e.number, e.job,
          o ? fmt(o.planned_qty) : <select key="q" className={controls.select} aria-label={P('qty')} value={qty[e.id] ?? String(bs[0]?.qty ?? '')} onChange={(x) => setQty({ ...qty, [e.id]: x.target.value })}>{bs.map((x) => <option key={x.qty} value={x.qty}>{x.qty}</option>)}</select>,
          o ? <Link key="o" to={`/manufacturing?tab=orders&order=${o.id}`}>{o.number}</Link> : '—',
          b ? `${fmt(b.sheets)}${actual !== undefined ? ` · ${P('issued', { n: fmt(actual) })}` : ''}` : '—',
          <span key="a" style={row}>
            {!o && <button type="button" className={B.ps} data-mfb-make-ticket onClick={() => run(() => P('ticketMade', { n: makeJobTicket(e.id, b?.qty ?? 0, ctx.items).number }))}>{P('makeTicket')}</button>}
            {b && <button type="button" className={B.gs} onClick={() => printHtml(ticketHtml(e, b, o, actual), o?.number ?? e.number)}>{P('print')}</button>}
          </span>,
        ];
      })} />
    </div>
  );
}

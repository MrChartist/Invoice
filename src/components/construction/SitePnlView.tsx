/** CN-D5 Works → Site P&L: revenue, costs by source, margin; unbilled work, cost to complete; held amounts; CSV / print. */
import { useMemo, useState } from 'react';
import type { InvoiceRecord } from '../../types/invoice';
import { gatherSitePnl, pnlCsvRows, saveSitePnlInputs, sitePnl } from '../../lib/construction/cn-site-pnl';
import { boqMargins, loadWorkOrders } from '../../lib/construction/cn-subcon';
import { loadSubBills } from '../../lib/construction/cn-subcon-bill';
import { B, csvDownload, fmtMoney, printHtml, today, type Notify } from '../transport/shared';
import { Num, T, Table, Txt, n, row, useRun } from './site-ui';
import controls from '../../styles/controls.module.css';
import type { SdKey } from '../../i18n/areas/construction-r11d';

export default function SitePnlView({ boq, notify }: { boq: InvoiceRecord; notify: Notify }) {
  const [tick, run] = useRun(notify);
  const [p, setP] = useState({ from: `${+today().slice(5, 7) >= 4 ? today().slice(0, 4) : +today().slice(0, 4) - 1}-04-01`, to: today() });
  const inputs = boq.boq_terms?.site_pnl;
  const [w, setW] = useState({ unmeasured: String(inputs?.unmeasured ?? ''), ctc: (inputs?.ctc ?? []).map((x) => `${x.group}: ${x.amount}`).join(', ') });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const r = useMemo(() => sitePnl(gatherSitePnl(boq, { start: p.from, end: p.to })), [boq, p, tick]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const margins = useMemo(() => boqMargins(boq, loadWorkOrders(), loadSubBills()), [boq, tick]);
  const L = (k: string) => T(k as SdKey);
  const rows = pnlCsvRows(r, L);
  const save = () => run(() => {
    const ctc = w.ctc.split(',').map((s) => s.split(':')).filter((x) => x.length === 2).map(([group, amount]) => ({ group: group.trim(), amount: n(amount) }));
    saveSitePnlInputs(boq, { unmeasured: n(w.unmeasured), ctc });
  });
  const html = () => `<!doctype html><meta charset="utf-8"><title>Site P&amp;L</title><style>body{font:12px sans-serif;margin:24px}td{border-bottom:1px solid #ccc;padding:3px 8px}</style><h2>${L('title')} — ${boq.invoice_number} · ${boq.client?.name ?? ''}</h2><p>${p.from} – ${p.to}</p><table>${rows.slice(1).map(([a, b]) => `<tr><td>${a}</td><td>${typeof b === 'number' ? b.toFixed(2) : b}</td></tr>`).join('')}</table><p><small>${L('memoNote')}</small></p>`;
  return (
    <div data-sd-view="pnl">
      <div style={row}>
        <Txt l={T('from')} v={p.from} set={(v) => setP({ ...p, from: v })} type="date" n={160} />
        <Txt l={T('to')} v={p.to} set={(v) => setP({ ...p, to: v })} type="date" n={160} />
        <button type="button" className={B.os} onClick={() => csvDownload(`site-pnl_${boq.invoice_number}_${p.to}.csv`, rows)}>CSV</button>
        <button type="button" className={B.os} onClick={() => printHtml(html(), `site-pnl_${boq.invoice_number}`)}>{T('print')}</button>
      </div>
      {!boq.boq_terms?.cost_centre_id && <p className={controls.hint}>{T('noCc')}</p>}
      <Table d="pnl" head={[T('head'), T('amount')]} rows={[
        [T('revenue'), fmtMoney(r.revenue.taxable)], [T('grossNet'), `${fmtMoney(r.revenue.gross)} / ${fmtMoney(r.revenue.net)}`], [T('credit'), fmtMoney(-r.revenue.credit)],
        ...Object.entries(r.costs).map(([k, v]) => [L(`c.${k}`), fmtMoney(-v)]),
        [<strong key="m">{T('margin')}</strong>, <strong key="v" data-sd-margin>{fmtMoney(r.margin)}{r.marginPct !== null ? ` (${r.marginPct}%)` : ''}</strong>],
      ]} />
      <h4>{T('wip')}</h4>
      <Table d="wip" head={[T('head'), T('amount')]} rows={[[T('unbilled'), fmtMoney(r.wip.unbilled)], [T('unmeasured'), fmtMoney(r.wip.unmeasured)], [T('contractValue'), fmtMoney(r.contract.value)], [T('billed'), fmtMoney(r.contract.billed)], [T('remaining'), fmtMoney(r.contract.remaining)], [T('ctc'), fmtMoney(r.contract.ctc)], [<strong key="e">{T('expected')}</strong>, <strong key="x">{fmtMoney(r.contract.expected)}</strong>]]} />
      <div style={row} data-sd-wip>
        <Num l={T('unmeasured')} v={w.unmeasured} set={(v) => setW({ ...w, unmeasured: v })} n={180} />
        <Txt l={T('ctcGroups')} v={w.ctc} set={(v) => setW({ ...w, ctc: v })} n={420} />
        <button type="button" className={B.o} onClick={save}>{T('save')}</button>
      </div>
      <h4>{T('heldHead')}</h4>
      <Table d="held" head={[T('head'), T('amount')]} rows={[...r.held.map((h) => [h.label, fmtMoney(h.amount)]), [T('retPayable'), fmtMoney(r.retentionPayable)]]} />
      <h4>{T('margins')}</h4>
      <Table d="margins" head={[T('desc'), T('ourRate'), T('subRate'), T('qty'), T('margin')]} rows={margins.map((m) => [`${m.ref} ${m.description}`, m.ours, m.sub, m.qty, fmtMoney(m.margin)])} />
      <p className={controls.hint}>{T('memoNote')}</p>
    </div>
  );
}

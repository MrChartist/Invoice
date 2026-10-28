/** R14 PS-B3 client statements: the period's entries and balance per client / matter; print and WhatsApp (BCI Rule 28). */
import { useMemo, useState } from 'react';
import { cmT } from '../../i18n/areas/prof-r14b-cm';
import { localDb } from '../../lib/localDb';
import { downloadText } from '../../lib/download';
import { todayInput } from '../../lib/utils';
import { cmStatement } from '../../lib/prof/ps-client-money';
import { cmDb } from '../../lib/prof/ps-cm-post';
import { Fld, Tbl } from '../mfg/mfd-ui';
import { row, rs, sm } from '../mfg/mfd-util';
import type { CmCtx } from './ClientMoneyDesk';
import controls from '../../styles/controls.module.css';
import { escHtml as esc } from '../../lib/html-esc';


export default function CmStatementsView({ ctx }: { ctx: CmCtx }) {
  const [client, setClient] = useState(ctx.clients[0]?.id ?? '');
  const [matter, setMatter] = useState('');
  const [from, setFrom] = useState(`${todayInput().slice(0, 8)}01`);
  const [to, setTo] = useState(todayInput());
  const st = useMemo(() => { void ctx.version; return cmStatement(cmDb.all(), client, from, to, matter || undefined); }, [ctx.version, client, from, to, matter]);
  const who = ctx.clients.find((c) => c.id === client)?.name ?? '';
  const body = st.rows.map((x) => [x.v.date, x.v.number, cmT(`k.${x.v.kind}` as 'k.receipt'), x.v.narration || x.v.ref, rs(x.amount), rs(x.balance)]);
  const print = () => {
    const firm = localDb.settings.activeProfile()?.companyName ?? '';
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>${esc(cmT('stmtTitle'))}</title><style>body{font:13px sans-serif;margin:24px}table{border-collapse:collapse;width:100%}td,th{border:1px solid gray;padding:4px 6px;text-align:left}</style></head><body><h2>${esc(cmT('stmtTitle'))} — ${esc(who)}</h2><p>${esc(firm)} · ${esc(from)} – ${esc(to)}</p><p>${esc(cmT('opening'))}: ₹${rs(st.opening)}</p><table><tr>${[cmT('date'), cmT('number'), cmT('kind'), cmT('narration'), cmT('amount'), cmT('held')].map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${body.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table><p><b>${esc(cmT('closing'))}: ₹${rs(st.closing)}</b></p><p>${esc(cmT('copyNote'))}</p></body></html>`;
    const w = window.open('', '_blank'); // script-free HTML; a blocked pop-up saves the file instead
    if (!w) return downloadText('client-money-statement.html', html, 'text/html');
    w.document.write(html);
    w.document.close();
    w.print();
  };
  const phone = String(localDb.clients.getById(client)?.phone ?? '').replace(/\D/g, '');
  const wa = `https://wa.me/${phone}?text=${encodeURIComponent(`${cmT('stmtTitle')} (${from} – ${to}): ${cmT('opening')} ₹${rs(st.opening)}, ${cmT('closing')} ₹${rs(st.closing)}.`)}`;
  return (
    <>
      <div style={row}>
        <Fld l={cmT('client')}>
          <select className={controls.select} value={client} onChange={(e) => setClient(e.target.value)} data-cm="st-client">{ctx.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </Fld>
        <Fld l={cmT('matter')}>
          <select className={controls.select} value={matter} onChange={(e) => setMatter(e.target.value)}><option value="">—</option>{ctx.matters.filter((m) => !m.client_id || m.client_id === client).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
        </Fld>
        <Fld l={cmT('from')}><input type="date" className={controls.input} value={from} onChange={(e) => setFrom(e.target.value)} data-cm="st-from" /></Fld>
        <Fld l={cmT('to')}><input type="date" className={controls.input} value={to} onChange={(e) => setTo(e.target.value)} /></Fld>
        <button type="button" className={sm} onClick={print}>{cmT('print')}</button>
        <a className={sm} href={wa} target="_blank" rel="noreferrer">{cmT('share')}</a>
      </div>
      <p className={controls.hint}>{cmT('opening')}: ₹{rs(st.opening)}</p>
      <Tbl empty={cmT('none')} head={[cmT('date'), cmT('number'), cmT('kind'), cmT('narration'), cmT('amount'), cmT('held')]} rows={body} />
      <p className={controls.hint} data-cm-closing={st.closing}><strong>{cmT('closing')}: ₹{rs(st.closing)}</strong> · {cmT('copyNote')}</p>
    </>
  );
}

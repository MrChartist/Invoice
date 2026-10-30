/** PS-D5 work to bill: the month's events per linked client (read-only peek), typed work, "Bill from the board". */
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { caT } from '../../i18n/areas/prof-r14d-ca';
import { todayInput } from '../../lib/utils';
import { localDb } from '../../lib/localDb';
import type { PracticeTables } from '../../lib/practice';
import { caEvents, type CaEvent } from '../../lib/prof/ps-ca-events';
import { CA_FEE_EVENTS, billFromBoard, loadLinkedPeeks, retainerClients, typedEvent } from '../../lib/prof/ps-ca-bill';
import { loadUdins } from '../../lib/prof/ps-udin';
import { readCaSettings } from '../../lib/prof/ps-d-settings';
import type { CaFeeEvent } from '../../types/prof-r14';
import type { InvoiceRecord } from '../../types/invoice';
import { Fld, Tbl } from './ps-d-ui';
import { sm, type PsDeskCtx, row } from './ps-desk';
import controls from '../../styles/controls.module.css';

export default function CaEventsView({ ctx }: { ctx: PsDeskCtx }) {
  const [month, setMonth] = useState(todayInput().slice(0, 7));
  const settings = useMemo(() => readCaSettings(), []);
  const [peeks, setPeeks] = useState<Map<string, PracticeTables | undefined> | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [typed, setTyped] = useState<CaEvent[]>([]);
  const [t, setT] = useState({ client: '', kind: 'roc_annual' as CaFeeEvent, label: '' });
  const [disb, setDisb] = useState(true);
  const [last, setLast] = useState<InvoiceRecord | null>(null);
  useEffect(() => {
    let live = true;
    void loadLinkedPeeks(settings).then((m) => { if (live) setPeeks(m); });
    return () => { live = false; };
  }, [settings]);
  const clients = useMemo(() => localDb.clients.getAll(), []);
  const events = useMemo(() => { void ctx.tick; return peeks ? caEvents({ settings, peeks, udins: loadUdins(), month, invoices: localDb.invoices.getAll(), retainerClients: retainerClients() }) : []; }, [ctx.tick, peeks, settings, month]);
  const all = [...events, ...typed.filter((e) => e.period.startsWith(month))];
  const byClient = [...new Set(all.map((e) => e.client_id))];
  const name = (id: string) => clients.find((c) => c.id === id)?.name ?? id;
  return (
    <>
      {!settings.company_clients?.length && <p className={controls.hint}>{caT('linkFirst')}</p>}
      <div style={row}>
        <Fld l={caT('month')}><input type="month" className={controls.input} value={month} onChange={(e) => setMonth(e.target.value)} data-ps="ev-month" /></Fld>
        <label className={controls.check}><input type="checkbox" checked={disb} onChange={(e) => setDisb(e.target.checked)} /> {caT('disb')}</label>
      </div>
      <div style={row}>
        <Fld l={caT('client')}>
          <select className={controls.select} value={t.client} onChange={(e) => setT({ ...t, client: e.target.value })}><option value="">-</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
        </Fld>
        <Fld l={caT('event')}>
          <select className={controls.select} value={t.kind} onChange={(e) => setT({ ...t, kind: e.target.value as CaFeeEvent })}>{CA_FEE_EVENTS.map((k) => <option key={k} value={k}>{caT(`e.${k}`)}</option>)}</select>
        </Fld>
        <Fld l={caT('label')}><input className={controls.input} value={t.label} onChange={(e) => setT({ ...t, label: e.target.value })} /></Fld>
        <button type="button" className={sm} disabled={!t.client || !t.label} onClick={() => setTyped([...typed, typedEvent(t.client, t.kind, `${month}:${typed.length + 1}`, t.label)])}>{caT('typed')}</button>
      </div>
      {byClient.length === 0 && <p className={controls.hint}>{caT('none')}</p>}
      {byClient.map((cid) => {
        const list = all.filter((e) => e.client_id === cid);
        const chosen = list.filter((e) => !e.billedBy && picked[e.key] !== false);
        return (
          <div key={cid} data-ps-client={cid}>
            <p className={controls.label}>{name(cid)}</p>
            <Tbl empty="" head={['', caT('event'), caT('period'), caT('date')]} rows={list.map((e) => [
              e.billedBy ? caT('billed') : <input key="c" type="checkbox" checked={picked[e.key] !== false} onChange={(x) => setPicked({ ...picked, [e.key]: x.target.checked })} aria-label={e.label} />,
              `${caT(`e.${e.kind}`)}: ${e.label}`, e.period, e.date])} />
            <button type="button" className={controls.btnPrimary} disabled={!chosen.length && !disb} onClick={() => ctx.run(() => { const inv = billFromBoard(cid, chosen, { disbursements: disb }); setLast(inv); return caT('made', { number: inv.invoice_number }); })} data-ps-b="ca-bill">{caT('bill')}</button>
          </div>
        );
      })}
      {last && <p className={controls.hint}><Link to={`/invoice/${last.id}`}>{caT('open')} {last.invoice_number}</Link></p>}
    </>
  );
}

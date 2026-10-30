import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Download, Plus, Share2, Trash2 } from 'lucide-react';
import { Page } from '../components/ui/Page';
import { useToast } from '../components/ui/useToast';
import { ORDER_FILE_EXT, outboxDb, signOrderFile, type PadLine } from '../lib/order-pad';
import { beatsDb } from '../lib/distribution';
import { getTable } from '../lib/storage';
import { downloadText } from '../lib/download';
import { todayInput } from '../lib/utils';
import type { Client } from '../types/invoice';
import { useT } from '../i18n';
import { distT } from '../i18n/areas/distribution';
import surface from '../styles/surface.module.css';
import controls from '../styles/controls.module.css';
import own from '../components/distribution/dist.module.css';
import { SelectField } from '../components/ui/SelectField';

interface ItemRow { id: string; name: string; unit?: string; sale_rate?: number; rate?: number }

/** 8.81 salesman mode: book orders offline, then hand the office ONE signed order file (share / file / QR). */
export function OrderPad() {
  useT();
  const { notify, toastNode } = useToast();
  const [tick, setTick] = useState(0);
  const agents = useMemo(() => getTable<{ id: string; name: string }>('sales_agents').filter((a) => a?.id), []);
  const beats = useMemo(() => beatsDb.all(), []);
  const clients = useMemo(() => getTable<Client>('clients').filter((c) => c?.name), []);
  const items: ItemRow[] = useMemo(() => {
    const stock = getTable<ItemRow>('stock_items');
    const names = new Set(stock.map((s) => s.name.trim().toLowerCase()));
    return [...stock, ...getTable<ItemRow>('items_catalog').filter((c) => c?.name && !names.has(c.name.trim().toLowerCase()))].sort((a, b) => a.name.localeCompare(b.name));
  }, []);
  const outbox = useMemo(() => outboxDb.all(), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const pending = outbox.filter((o) => !o.exported_at);
  const [agentId, setAgentId] = useState('');
  const [salesman, setSalesman] = useState('');
  const [beat, setBeat] = useState('');
  const [client, setClient] = useState('');
  const [lines, setLines] = useState<PadLine[]>([{ name: '', qty: 0 }]);
  const [note, setNote] = useState('');
  const [pass, setPass] = useState('');
  const [file, setFile] = useState<{ name: string; text: string; ids: string[] } | null>(null);
  const partyList = clients.filter((c) => !beat || c.beat_id === beat);

  const addOrder = () => {
    try {
      const c = clients.find((x) => (x.id ?? x.name) === client);
      outboxDb.save({ date: todayInput(), client_id: c?.id, client_name: c?.name ?? '', ...(c?.beat_id ? { beat_id: c.beat_id } : {}), lines, note });
      setLines([{ name: '', qty: 0 }]);
      setNote('');
      setClient('');
      setTick((t) => t + 1);
      notify(distT('orderBooked'));
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  const makeFile = async () => {
    try {
      const name = agents.find((a) => a.id === agentId)?.name ?? salesman.trim();
      const f = await signOrderFile({ salesman: { name, ...(agentId ? { agent_id: agentId } : {}) }, created_at: new Date().toISOString(), orders: pending }, pass);
      const text = JSON.stringify(f);
      setFile({ name: `orders-${(name || 'salesman').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${todayInput()}${ORDER_FILE_EXT}`, text, ids: pending.map((o) => o.id) });
    } catch (err) {
      notify((err as Error).message, 'error');
    }
  };

  const sent = () => {
    if (!file) return;
    outboxDb.markExported(file.ids);
    setTick((t) => t + 1);
  };

  const share = async () => {
    if (!file) return;
    const blob = new File([file.text], file.name, { type: 'application/json' });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (nav.share && nav.canShare?.({ files: [blob] })) {
      try {
        await nav.share({ files: [blob], title: file.name });
        sent();
        return;
      } catch {
        /* cancelled: fall back to the download */
      }
    }
    downloadText(file.name, file.text, 'application/json');
    sent();
  };

  return (
    <Page title={distT('padTitle')} subtitle={distT('padSubtitle')} actions={<Link to="/distribution?tab=orders" className={controls.btnOutline}>{distT('officeImport')}</Link>} data-order-pad>
      <section className={surface.card}>
        <div className={`${surface.cardBody} ${own.stack}`}>
          <div className={own.row}>
            {agents.length > 0 ? (
              <label className={controls.field}><span className={controls.label}>{distT('salesman')}</span>
                <SelectField className={controls.select} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                  <option value="">{distT('choose')}</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </SelectField></label>
            ) : (
              <label className={controls.field}><span className={controls.label}>{distT('salesman')}</span>
                <input className={controls.input} value={salesman} onChange={(e) => setSalesman(e.target.value)} /></label>
            )}
            <label className={controls.field}><span className={controls.label}>{distT('beat')}</span>
              <SelectField className={controls.select} value={beat} onChange={(e) => setBeat(e.target.value)}>
                <option value="">{distT('allBeats')}</option>
                {beats.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </SelectField></label>
            <label className={controls.field}><span className={controls.label}>{distT('party')}</span>
              <SelectField className={controls.select} value={client} onChange={(e) => setClient(e.target.value)} data-pad-party>
                <option value="">{distT('choose')}</option>
                {partyList.map((c) => <option key={c.id ?? c.name} value={c.id ?? c.name}>{c.name}</option>)}
              </SelectField></label>
          </div>
          <datalist id="pad-items">{items.map((i) => <option key={i.id ?? i.name} value={i.name} />)}</datalist>
          {lines.map((l, i) => (
            <div key={i} className={own.row}>
              <input className={controls.input} list="pad-items" aria-label={distT('item')} placeholder={distT('item')} value={l.name} onChange={(e) => {
                const hit = items.find((x) => x.name === e.target.value);
                setLines(lines.map((x, j) => (j === i ? { ...x, name: e.target.value, ...(hit?.id ? { item_id: hit.id } : {}), ...(hit?.unit ? { unit: hit.unit } : {}) } : x)));
              }} data-pad-item />
              <input type="number" min={0} className={controls.input} aria-label={distT('qty')} placeholder={distT('qty')} value={l.qty || ''} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: Number(e.target.value) || 0 } : x)))} data-pad-qty />
              <button type="button" className={controls.btnIcon} aria-label={distT('removeLine')} onClick={() => setLines(lines.length > 1 ? lines.filter((_, j) => j !== i) : [{ name: '', qty: 0 }])}><Trash2 size={14} /></button>
            </div>
          ))}
          <div className={own.row}>
            <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setLines([...lines, { name: '', qty: 0 }])}><Plus size={14} aria-hidden="true" /> {distT('addLine')}</button>
            <input className={controls.input} value={note} placeholder={distT('noteOptional')} aria-label={distT('noteOptional')} onChange={(e) => setNote(e.target.value)} />
            <button type="button" className={controls.btnPrimary} onClick={addOrder} data-pad-add>{distT('bookOrder')}</button>
          </div>
        </div>
      </section>

      <section className={surface.card}>
        <div className={`${surface.cardBody} ${own.stack}`}>
          <h3>{distT('outbox', { n: pending.length })}</h3>
          <ul>{pending.map((o) => (
            <li key={o.id}>{o.date} · {o.client_name} · {o.lines.map((l) => `${l.name} × ${l.qty}`).join(', ')}{' '}
              <button type="button" className={controls.btnIcon} aria-label={distT('removeLine')} onClick={() => { outboxDb.remove(o.id); setTick((t) => t + 1); }}><Trash2 size={12} /></button></li>
          ))}</ul>
          <p className={own.muted}>{distT('padSignNote')}</p>
          <div className={own.row}>
            <label className={controls.field}><span className={controls.label}>{distT('passphrase')}</span>
              <input type="password" autoComplete="off" className={controls.input} value={pass} onChange={(e) => setPass(e.target.value)} data-pad-pass /></label>
            <button type="button" className={controls.btnPrimary} disabled={!pending.length || !pass} onClick={() => void makeFile()} data-pad-sign>{distT('makeFile')}</button>
          </div>
          {file && (
            <div className={own.stack} data-pad-file>
              <div className={own.row}>
                <button type="button" className={controls.btnOutline} onClick={() => void share()}><Share2 size={14} aria-hidden="true" /> {distT('shareFile')}</button>
                <button type="button" className={controls.btnOutline} onClick={() => { downloadText(file.name, file.text, 'application/json'); sent(); }}><Download size={14} aria-hidden="true" /> {distT('saveFile')}</button>
              </div>
              {file.text.length <= 2300 ? (
                <div className={own.qr}><QRCodeSVG value={file.text} size={260} level="L" /></div>
              ) : <p className={own.muted}>{distT('tooBigForQr')}</p>}
              <textarea readOnly className={`${controls.input} ${own.textarea}`} value={file.text} aria-label={distT('orderFile')} data-pad-text />
            </div>
          )}
        </div>
      </section>
      {toastNode}
    </Page>
  );
}

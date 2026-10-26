/** R5-A2: channel SKU → item map — rows, a listing-file match (title matches are suggestions) and the unmapped list. */
import { useMemo, useState, type ChangeEvent } from 'react';
import { FileUp } from 'lucide-react';
import { mT } from '../../i18n/areas/packs-marketplace-r5';
import { loadSkuMap, matchListing, removeSkuRow, saveSkuRows, type CatalogueRow, type ListingMatch } from '../../lib/marketplace/sku-map';
import { cellOf, guessColumns } from '../../lib/marketplace/file-map';
import { localDb } from '../../lib/localDb';
import { peekTable } from '../../lib/storage';
import { ChannelPicker } from './ChannelsPanel';
import { errText, readFileTables, type PanelProps } from './file-read';
import type { Unmapped } from './MarketplaceTab';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './marketplace.module.css';

const LISTING_FIELDS = { sku: ['seller sku', 'sku', 'sku id', 'sku code'], listing_id: ['asin', 'fsn', 'listing id', 'product id'], title: ['item name', 'product title', 'title', 'product name'] };

export function SkuMapPanel(props: PanelProps & { unmapped: Unmapped }) {
  const { channel, notify, unmapped } = props;
  const [tick, setTick] = useState(0);
  const catalogue = useMemo(() => peekTable<CatalogueRow>('items_catalog').filter((c) => c.id && c.name), [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  const byId = useMemo(() => new Map(catalogue.map((c) => [c.id, c])), [catalogue]);
  const rows = useMemo(() => (channel ? loadSkuMap(channel.id) : []), [channel, tick]); // eslint-disable-line react-hooks/exhaustive-deps -- tick re-reads storage
  const [form, setForm] = useState({ sku: '', listing: '', item: '', qty: '1' });
  const [matches, setMatches] = useState<(ListingMatch & { pick: boolean })[]>([]);
  if (!channel) return <ChannelPicker {...props} />;

  const add = () => {
    try {
      saveSkuRows([{ channel_id: channel.id, channel_sku: form.sku, listing_id: form.listing, item_id: form.item, qty_per_unit: Number(form.qty) }]);
      setForm({ sku: '', listing: '', item: '', qty: '1' });
      setTick((n) => n + 1);
      notify(mT('saved'));
    } catch (err) {
      notify(errText(err), 'error');
    }
  };
  const onListing = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const [first] = await readFileTables(file);
      if (!first) return;
      const cols = guessColumns(first.table.headers, LISTING_FIELDS);
      const list = first.table.rows.map((r) => ({ sku: cellOf(r, cols, 'sku'), listing_id: cellOf(r, cols, 'listing_id') || undefined, title: cellOf(r, cols, 'title') || undefined })).filter((r) => r.sku);
      const m = matchListing(list, catalogue).map((x) => ({ ...x, pick: !!x.item_id && !x.suggestion }));
      setMatches(m);
      notify(mT('skuMatched', { n: m.filter((x) => x.item_id).length }));
    } catch (err) {
      notify(errText(err), 'error');
    }
  };
  const saveTicked = () => {
    try {
      saveSkuRows(matches.filter((m) => m.pick && m.item_id).map((m) => ({ channel_id: channel.id, channel_sku: m.sku, listing_id: m.listing_id, item_id: m.item_id!, qty_per_unit: 1 })));
      setMatches([]);
      setTick((n) => n + 1);
      notify(mT('saved'));
    } catch (err) {
      notify(errText(err), 'error');
    }
  };
  const createItem = (u: Unmapped[number]) => {
    const name = (u.title || u.sku).slice(0, 120);
    localDb.items.upsert({ name, sku: u.sku, type: 'Product' });
    setTick((n) => n + 1);
    const made = peekTable<CatalogueRow>('items_catalog').find((c) => c.name === name);
    setForm({ sku: u.sku, listing: u.listingId ?? '', item: made?.id ?? '', qty: '1' });
    notify(mT('itemCreated', { name }));
  };
  const itemSelect = (value: string, onChange: (v: string) => void) => (
    <select className={controls.select} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {catalogue.map((c) => <option key={c.id} value={c.id}>{c.name}{c.sku ? ` (${c.sku})` : ''}</option>)}
    </select>
  );

  return (
    <div className={styles.stack}>
      <div className={styles.toolbar}>
        <ChannelPicker {...props} />
        <label className={`${controls.btn} ${controls.btnOutline}`}>
          <FileUp size={16} aria-hidden="true" /> {mT('skuImportListing')}
          <input type="file" accept=".csv,.txt,.xlsx,.xlsm" hidden onChange={onListing} />
        </label>
      </div>
      {unmapped.length > 0 && (
        <section>
          <h4>{mT('unmappedTitle')}</h4>
          <ul className={styles.list}>
            {unmapped.map((u) => (
              <li key={u.sku || u.listingId}>
                <span className={surface.mono}>{u.sku || u.listingId}</span> {u.title ? `— ${u.title}` : ''} ×{u.count}{' '}
                <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={() => setForm({ sku: u.sku, listing: u.listingId ?? '', item: '', qty: '1' })}>{mT('map')}</button>
                <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={() => createItem(u)}>{mT('createItem')}</button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className={styles.grid}>
        <label className={controls.field}><span className={controls.label}>{mT('skuChannelSku')}</span>
          <input className={controls.input} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} data-mkt-sku /></label>
        <label className={controls.field}><span className={controls.label}>{mT('skuListing')}</span>
          <input className={controls.input} value={form.listing} onChange={(e) => setForm({ ...form, listing: e.target.value })} /></label>
        <label className={controls.field}><span className={controls.label}>{mT('skuItem')}</span>
          {itemSelect(form.item, (v) => setForm({ ...form, item: v }))}</label>
        <label className={controls.field}><span className={controls.label}>{mT('skuQty')}</span>
          <input className={controls.input} inputMode="decimal" value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} /></label>
      </div>
      <div className={styles.toolbar}><button type="button" className={`${controls.btn} ${controls.btnPrimary}`} onClick={add} data-mkt-sku-add>{mT('skuAdd')}</button></div>
      {matches.length > 0 && (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th /><th>{mT('skuChannelSku')}</th><th>{mT('skuListing')}</th><th>{mT('skuItem')}</th><th>{mT('skuHow')}</th></tr></thead>
            <tbody>
              {matches.map((m, i) => (
                <tr key={`${m.sku}-${i}`}>
                  <td><input type="checkbox" checked={m.pick} disabled={!m.item_id} onChange={() => setMatches(matches.map((x, j) => (j === i ? { ...x, pick: !x.pick } : x)))} /></td>
                  <td className={surface.mono}>{m.sku}</td>
                  <td className={surface.mono}>{m.listing_id ?? ''}</td>
                  <td>{m.item_id ? byId.get(m.item_id)?.name : '—'}</td>
                  <td>{m.how ? mT(`how.${m.how}`) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button type="button" className={`${controls.btn} ${controls.btnPrimary}`} onClick={saveTicked}>{mT('skuSaveTicked')}</button>
        </div>
      )}
      {rows.length === 0 ? <p className={styles.note}>{mT('skuEmpty')}</p> : (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead><tr><th>{mT('skuChannelSku')}</th><th>{mT('skuListing')}</th><th>{mT('skuItem')}</th><th className={surface.numeric}>{mT('skuQty')}</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className={surface.mono}>{r.channel_sku}</td>
                  <td className={surface.mono}>{r.listing_id ?? ''}</td>
                  <td>{byId.get(r.item_id)?.name ?? '—'}</td>
                  <td className={surface.numeric}>{r.qty_per_unit}</td>
                  <td><button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={() => { try { removeSkuRow(r.id); setTick((n) => n + 1); } catch (err) { notify(errText(err), 'error'); } }}>{mT('remove')}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

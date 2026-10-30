import { lazy, Suspense, useMemo, useState } from 'react';
import { Printer, Wand2 } from 'lucide-react';
import { Modal } from '../ui/Modal';

const RawLabelButtons = lazy(() => import('../distribution/RawLabelButtons')); // 8.87 thermal rolls
import { NumberInput } from '../ui/NumberInput';
import { barRuns, encodeBarcode, nextInStoreEan, pickSymbology } from '../../lib/barcode';
import { LABEL_LAYOUTS, attrLine, expandLabels, labelSheetHtml, layoutById, sheetCount, type LabelItem, type PriceShown } from '../../lib/label-sheet';
import { listCatalog } from '../../lib/catalog';
import { KEYS, getTable, setTable } from '../../lib/storage';
import { TABLES, type StockItem } from '../../lib/inventory';
import { localDb } from '../../lib/localDb';
import { downloadText } from '../../lib/download';
import { cn, formatCurrency } from '../../lib/utils';
import type { InvoiceItem } from '../../types/invoice';
import { useT } from '../../i18n';
import { setT } from '../../i18n/areas/settings';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './CatalogPanel.module.css';
import { printWhenReady } from '../../lib/print-fonts';
import { SelectField } from '../ui/SelectField';

interface Row {
  key: string;
  /** Catalogue id when the row is a catalogue item (codes can be assigned to it). */
  catalogId?: string;
  name: string;
  code: string;
  rate: number;
  mrp: number;
  attrs?: string; // R9 (RT-C2) variant attributes
}

/** Catalogue items plus stock items with a code that are not in the catalogue. */
function labelRows(): Row[] {
  const cat = listCatalog();
  const names = new Set(cat.map((i) => i.name.trim().toLowerCase()));
  const stock = getTable<StockItem>(TABLES.items);
  const attrs = new Map(stock.filter((s) => s.variant_attrs).map((s) => [s.name.trim().toLowerCase(), attrLine(s.variant_attrs)])); // R9 (RT-C2)
  const rows: Row[] = cat.map((i) => ({ key: i.id, catalogId: i.id, name: i.name, code: i.barcode || i.sku || '', rate: i.rate ?? 0, mrp: i.mrp ?? 0, attrs: attrs.get(i.name.trim().toLowerCase()) }));
  for (const s of stock) {
    if (names.has(s.name.trim().toLowerCase()) || !(s.barcode || s.sku)) continue;
    rows.push({ key: `stock-${s.id}`, name: s.name, code: s.barcode || s.sku || '', rate: s.sale_rate ?? 0, mrp: 0, attrs: attrLine(s.variant_attrs) });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name));
}

/** Barcode drawn with React rects (same encoder as the printed sheet). */
function BarcodePreview({ code }: { code: string }) {
  const enc = useMemo(() => {
    try {
      return encodeBarcode(code);
    } catch {
      return null;
    }
  }, [code]);
  if (!enc) return null;
  const quiet = enc.symbology === 'EAN13' ? 11 : 10;
  const w = enc.modules.length + quiet * 2;
  return (
    <svg viewBox={`0 0 ${w} 30`} className={styles.preview} role="img" aria-label={`Barcode ${code}`} shapeRendering="crispEdges">
      <rect width={w} height={30} className={styles.previewBg} />
      {barRuns(enc.modules).map(([x, bw]) => (
        <rect key={x} x={x + quiet} y={0} width={bw} height={30} className={styles.previewBar} />
      ))}
    </svg>
  );
}

/** Pick items and copies, then print an A4 label sheet (6.7). */
export function LabelSheetModal({ open, onClose, onChanged, preselected }: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
  preselected: ReadonlySet<string>;
}) {
  useT(); // re-render on a language switch (5.4)
  const [rows, setRows] = useState<Row[]>(labelRows);
  const [copies, setCopies] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {};
    for (const r of labelRows()) init[r.key] = preselected.size ? (preselected.has(r.key) ? 1 : 0) : r.code ? 1 : 0;
    return init;
  });
  const [layoutId, setLayoutId] = useState(LABEL_LAYOUTS[0].id);
  const [price, setPrice] = useState<PriceShown>('sale');
  const [skip, setSkip] = useState(0);
  const [message, setMessage] = useState('');
  const layout = layoutById(layoutId);

  const chosen: LabelItem[] = rows.map((r) => ({ name: r.name, code: r.code, rate: r.rate, mrp: r.mrp, attrs: r.attrs, copies: copies[r.key] ?? 0 }));
  const { labels, skipped } = expandLabels(chosen);
  const pages = sheetCount(layout, labels.length, skip);
  const missing = rows.filter((r) => (copies[r.key] ?? 0) > 0 && r.catalogId && !pickSymbology(r.code));

  const assignCodes = () => {
    const items = getTable<InvoiceItem>(KEYS.items);
    const taken = new Set<string>([...items.map((i) => i.barcode ?? ''), ...getTable<StockItem>(TABLES.items).map((s) => s.barcode ?? '')]);
    let seed = items.length + 1;
    const ids = new Set(missing.map((r) => r.catalogId));
    let n = 0;
    const next = items.map((i) => {
      if (!ids.has(i.id) || i.barcode) return i;
      const code = nextInStoreEan(taken, seed);
      taken.add(code);
      seed = Number(code.slice(1, 12)) + 1;
      n++;
      return { ...i, barcode: code };
    });
    setTable(KEYS.items, next);
    setRows(labelRows());
    onChanged();
    setMessage(setT(n === 1 ? 'assignedOne' : 'assignedMany', { n }));
  };

  const print = () => {
    const html = labelSheetHtml(chosen, { layout, price, skip, business: localDb.settings.activeProfile()?.companyName });
    // R9 (RT-A2): stamp the print (and the price shown) so the relabel queue knows what is current.
    const printed = rows.filter((r) => (copies[r.key] ?? 0) > 0).map((r) => r.key);
    void import('../../lib/retail/rt-mrp-store').then((m) => m.stampLabelsPrinted(printed) && onChanged()).catch(() => undefined);
    const w = window.open('', '_blank');
    if (w) {
      w.document.open();
      w.document.write(html);
      w.document.close();
      w.focus();
      printWhenReady(w);
    } else {
      downloadText('barcode-labels.html', html, 'text/html');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={setT('labelsTitle')}
      subtitle={setT('labelsSub', { labels: labels.length, pages })}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>{setT('close')}</button>
          <Suspense fallback={null}><RawLabelButtons items={chosen} layout={layout} onMessage={setMessage} /></Suspense>
          <button type="button" className={controls.btnPrimary} onClick={print} disabled={labels.length === 0}>
            <Printer size={16} /> {setT('printLabels')}
          </button>
        </>
      }
    >
      <div className={styles.form}>
        <div className={controls.row3}>
          <label className={controls.field}>
            <span className={controls.label}>{setT('labelSheet')}</span>
            <SelectField className={controls.select} value={layoutId} onChange={(e) => setLayoutId(e.target.value)}>
              {LABEL_LAYOUTS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </SelectField>
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{setT('priceOnLabel')}</span>
            <SelectField className={controls.select} value={price} onChange={(e) => setPrice(e.target.value as PriceShown)}>
              <option value="sale">{setT('priceSale')}</option>
              <option value="mrp">{setT('priceMrp')}</option>
              <option value="both">{setT('priceBoth')}</option>
              <option value="none">{setT('priceNone')}</option>
            </SelectField>
          </label>
          <label className={controls.field}>
            <span className={controls.label}>{setT('skipUsed')}</span>
            <NumberInput className={cn(controls.input, controls.inputNumeric)} value={skip} onChange={(n) => setSkip(Math.max(0, Math.floor(n)))} placeholder="0" />
          </label>
        </div>

        {missing.length > 0 && (
          <p className={controls.hint}>
            {setT('missingCodes', { n: missing.length })}{' '}
            <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={assignCodes}>
              <Wand2 size={14} /> {setT('assignCodes')}
            </button>
          </p>
        )}
        {skipped.length > 0 && missing.length === 0 && <p className={controls.hint}>{setT('skippedNoCode', { list: skipped.join(', ') })}</p>}
        {message && <p className={controls.hint} role="status">{message}</p>}

        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead>
              <tr>
                <th>{setT('thItem')}</th>
                <th>{setT('thCode')}</th>
                <th className={surface.numeric}>{setT('thPrice')}</th>
                <th className={surface.numeric}>{setT('thCopies')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key}>
                  <td>{r.name}</td>
                  <td>
                    {r.code ? (
                      <div className={styles.codeCell}>
                        <BarcodePreview code={r.code} />
                        <span className={surface.mono}>{r.code}</span>
                      </div>
                    ) : (
                      <span className={styles.sub}>-</span>
                    )}
                  </td>
                  <td className={surface.numeric}>{formatCurrency(r.rate)}{r.mrp ? <div className={styles.sub}>{setT('mrpN', { amount: formatCurrency(r.mrp) })}</div> : null}</td>
                  <td className={surface.numeric}>
                    <NumberInput
                      className={cn(controls.input, controls.inputNumeric, styles.small)}
                      value={copies[r.key] ?? 0}
                      onChange={(n) => setCopies((c) => ({ ...c, [r.key]: Math.max(0, Math.floor(n)) }))}
                      aria-label={setT('copiesOf', { name: r.name })}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={controls.hint}>
          {setT('labelsHint')}
        </p>
      </div>
    </Modal>
  );
}

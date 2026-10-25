import { useMemo, useState } from 'react';
import { Printer, Wand2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { NumberInput } from '../ui/NumberInput';
import { barRuns, encodeBarcode, nextInStoreEan, pickSymbology } from '../../lib/barcode';
import { LABEL_LAYOUTS, expandLabels, labelSheetHtml, layoutById, sheetCount, type LabelItem, type PriceShown } from '../../lib/label-sheet';
import { listCatalog } from '../../lib/catalog';
import { KEYS, getTable, setTable } from '../../lib/storage';
import { TABLES, type StockItem } from '../../lib/inventory';
import { localDb } from '../../lib/localDb';
import { downloadText } from '../../lib/download';
import { cn, formatCurrency } from '../../lib/utils';
import type { InvoiceItem } from '../../types/invoice';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './CatalogPanel.module.css';

interface Row {
  key: string;
  /** Catalogue id when the row is a catalogue item (codes can be assigned to it). */
  catalogId?: string;
  name: string;
  code: string;
  rate: number;
  mrp: number;
}

/** Catalogue items plus stock items with a code that are not in the catalogue. */
function labelRows(): Row[] {
  const cat = listCatalog();
  const names = new Set(cat.map((i) => i.name.trim().toLowerCase()));
  const rows: Row[] = cat.map((i) => ({ key: i.id, catalogId: i.id, name: i.name, code: i.barcode || i.sku || '', rate: i.rate ?? 0, mrp: i.mrp ?? 0 }));
  for (const s of getTable<StockItem>(TABLES.items)) {
    if (names.has(s.name.trim().toLowerCase()) || !(s.barcode || s.sku)) continue;
    rows.push({ key: `stock-${s.id}`, name: s.name, code: s.barcode || s.sku || '', rate: s.sale_rate ?? 0, mrp: 0 });
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

  const chosen: LabelItem[] = rows.map((r) => ({ name: r.name, code: r.code, rate: r.rate, mrp: r.mrp, copies: copies[r.key] ?? 0 }));
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
    setMessage(`Assigned in-store barcodes to ${n} item${n === 1 ? '' : 's'}.`);
  };

  const print = () => {
    const html = labelSheetHtml(chosen, { layout, price, skip, business: localDb.settings.activeProfile()?.companyName });
    const w = window.open('', '_blank');
    if (w) {
      w.document.open();
      w.document.write(html);
      w.document.close();
      w.focus();
      w.print();
    } else {
      downloadText('barcode-labels.html', html, 'text/html');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title="Print barcode labels"
      subtitle={`${labels.length} label${labels.length === 1 ? '' : 's'} · ${pages} A4 sheet${pages === 1 ? '' : 's'}`}
      footer={
        <>
          <button type="button" className={controls.btnOutline} onClick={onClose}>Close</button>
          <button type="button" className={controls.btnPrimary} onClick={print} disabled={labels.length === 0}>
            <Printer size={16} /> Print labels
          </button>
        </>
      }
    >
      <div className={styles.form}>
        <div className={controls.row3}>
          <label className={controls.field}>
            <span className={controls.label}>Label sheet</span>
            <select className={controls.select} value={layoutId} onChange={(e) => setLayoutId(e.target.value)}>
              {LABEL_LAYOUTS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
            </select>
          </label>
          <label className={controls.field}>
            <span className={controls.label}>Price on label</span>
            <select className={controls.select} value={price} onChange={(e) => setPrice(e.target.value as PriceShown)}>
              <option value="sale">Sale price</option>
              <option value="mrp">MRP</option>
              <option value="both">MRP and sale price</option>
              <option value="none">No price</option>
            </select>
          </label>
          <label className={controls.field}>
            <span className={controls.label}>Skip used labels</span>
            <NumberInput className={cn(controls.input, controls.inputNumeric)} value={skip} onChange={(n) => setSkip(Math.max(0, Math.floor(n)))} placeholder="0" />
          </label>
        </div>

        {missing.length > 0 && (
          <p className={controls.hint}>
            {missing.length} chosen item{missing.length === 1 ? ' has' : 's have'} no barcode or SKU.{' '}
            <button type="button" className={cn(controls.btnGhost, controls.btnSm)} onClick={assignCodes}>
              <Wand2 size={14} /> Assign in-store EAN-13 codes
            </button>
          </p>
        )}
        {skipped.length > 0 && missing.length === 0 && <p className={controls.hint}>Skipped (no printable code): {skipped.join(', ')}</p>}
        {message && <p className={controls.hint} role="status">{message}</p>}

        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <thead>
              <tr>
                <th>Item</th>
                <th>Code</th>
                <th className={surface.numeric}>Price</th>
                <th className={surface.numeric}>Copies</th>
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
                      <span className={styles.sub}>—</span>
                    )}
                  </td>
                  <td className={surface.numeric}>{formatCurrency(r.rate)}{r.mrp ? <div className={styles.sub}>MRP {formatCurrency(r.mrp)}</div> : null}</td>
                  <td className={surface.numeric}>
                    <NumberInput
                      className={cn(controls.input, controls.inputNumeric, styles.small)}
                      value={copies[r.key] ?? 0}
                      onChange={(n) => setCopies((c) => ({ ...c, [r.key]: Math.max(0, Math.floor(n)) }))}
                      aria-label={`Copies of ${r.name}`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className={controls.hint}>
          13-digit codes with a valid check digit print as EAN-13; anything else prints as Code 128. Print at 100% (&quot;Actual size&quot;) on A4 label stationery.
        </p>
      </div>
    </Modal>
  );
}

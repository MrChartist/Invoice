/**
 * Packing list from an invoice / delivery challan (R2-C4): packages with type, size, tare, count,
 * marks & numbers, line quantities per package, weights and CBM; print (A4) and Excel.
 * Lazy-loaded from Document actions. The document snapshot is never changed.
 */
import { useMemo, useState } from 'react';
import { Package, Plus, Printer, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import type { InvoiceRecord } from '../../types/invoice';
import type { PackingList, PackingPackage } from '../../types/books-r2';
import {
  autoPackages,
  blankPackage,
  boxRange,
  deletePackingList,
  loadWeightIndex,
  packageFigures,
  packageTypesDb,
  packedQty,
  packingFromDocument,
  packingListsFor,
  packingSheetRows,
  packingTotals,
  renumber,
  savePackingList,
  validatePacking,
  type AutoFill,
  type PackingInput,
} from '../../lib/packing';
import { packingExportMeta, packingListHtml } from '../../lib/packing-print';
import { printHtmlDocument } from '../../lib/voucher-print';
import { downloadText } from '../../lib/download';
import { resolve as resolveDesign } from '../../lib/design-prefs';
import { safeStem } from '../../lib/pdf-batch';
import { todayIso } from '../../lib/tax-rules';
import { useT } from '../../i18n';
import { pkT } from '../../i18n/areas/dispatch-r2';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './dispatch.module.css';

type Notify = (msg: string, tone?: 'success' | 'error' | 'info') => void;
const n3 = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

export function PackingListDialog({ invoice, onClose, notify }: { invoice: InvoiceRecord; onClose: () => void; notify?: Notify }) {
  useT();
  const say: Notify = notify ?? (() => undefined);
  const [rev, setRev] = useState(0);
  const saved = useMemo(() => (rev >= 0 ? packingListsFor(invoice.id) : []), [invoice.id, rev]);
  const types = useMemo(() => packageTypesDb.all(), []);
  const [draft, setDraft] = useState<PackingInput | null>(null);
  const [typeId, setTypeId] = useState('');
  const [error, setError] = useState('');

  const company = useMemo(() => {
    const s = invoice.sender;
    return { name: s?.companyName ?? '', address: s?.companyAddress, gstin: s?.companyGstin };
  }, [invoice.sender]);
  const accent = useMemo(() => resolveDesign(invoice.sender?.id).accent, [invoice.sender?.id]);
  const type = types.find((t) => t.id === typeId);

  const startNew = () => {
    const base = packingFromDocument(invoice, loadWeightIndex(), todayIso());
    // R4-C1: the invoice's marks & numbers seed the packages' marks.
    setDraft({ ...base, packages: autoPackages(base.lines, 'per-line', type).map((p) => (p.marks || !invoice.marks_numbers ? p : { ...p, marks: invoice.marks_numbers })) });
    setError('');
  };
  const edit = (pl: PackingList) => {
    setDraft({ ...pl });
    setError('');
  };
  const print = (pl: PackingList) => {
    // R4-C1: ports, destination and marks of the source export invoice (read only; no packing-list schema change).
    const html = packingListHtml(pl, company, accent, packingExportMeta(invoice));
    printHtmlDocument(html, (h) => downloadText(`${safeStem(pl.number)}.html`, h, 'text/html'));
  };
  const excel = async (pl: PackingList) => {
    const { downloadXlsx } = await import('../../lib/xlsx');
    await downloadXlsx(`${safeStem(pl.number)}.xlsx`, [{ name: 'Packing list', rows: packingSheetRows(pl), header: false }]);
  };
  const remove = (pl: PackingList) => {
    try {
      deletePackingList(pl.id);
      setRev((r) => r + 1);
      say(pkT('deleted', { number: pl.number }));
    } catch (err) {
      say((err as Error).message, 'error');
    }
  };

  const setPackages = (fn: (p: PackingPackage[]) => PackingPackage[]) => setDraft((d) => (d ? { ...d, packages: renumber(fn(d.packages)) } : d));
  const patchPkg = (id: string, patch: Partial<PackingPackage>) => setPackages((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const setQty = (id: string, lineId: string, qty: number) =>
    setPackages((ps) => ps.map((p) => (p.id !== id ? p : { ...p, contents: [...p.contents.filter((c) => c.line_id !== lineId), ...(qty > 0 ? [{ line_id: lineId, qty }] : [])] })));
  const auto = (mode: AutoFill) => setDraft((d) => (d ? { ...d, packages: autoPackages(d.lines, mode, type) } : d));

  const save = () => {
    if (!draft) return;
    try {
      const row = savePackingList(draft);
      setDraft(null);
      setRev((r) => r + 1);
      say(pkT('saved', { number: row.number }));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const issues = draft ? validatePacking(draft.lines, draft.packages) : [];
  const totals = draft ? packingTotals(draft.packages, draft.lines) : null;
  const packed = draft ? packedQty(draft.packages) : new Map<string, number>();
  const unweighed = draft ? draft.lines.filter((l) => !l.net_kg).map((l) => l.name) : [];
  const num = (v: string) => (Number.isFinite(Number(v)) ? Number(v) : 0);

  return (
    <Modal open onClose={onClose} title={pkT('title', { number: invoice.invoice_number })} subtitle={pkT('subtitle')} size="xl">
      <div className={styles.stack} data-packing-dialog>
        {saved.length > 0 && (
          <section aria-label={pkT('existing')}>
            <h3 className={controls.label}>{pkT('existing')}</h3>
            <ul className={styles.list}>
              {saved.map((pl) => {
                const t = packingTotals(pl.packages, pl.lines);
                return (
                  <li key={pl.id} className={styles.listItem}>
                    <strong>{pl.number}</strong>
                    <span className={`${styles.muted} ${styles.grow}`}>{pkT('totals', { n: t.packages, net: n3(t.net_kg), gross: n3(t.gross_kg), cbm: n3(t.cbm) })}</span>
                    <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => edit(pl)}>{pkT('edit')}</button>
                    <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => print(pl)}><Printer size={14} aria-hidden /> {pkT('print')}</button>
                    <button type="button" className={`${controls.btnGhost} ${controls.btnSm}`} onClick={() => void excel(pl)}>{pkT('excel')}</button>
                    <button type="button" className={controls.btnIcon} aria-label={`${pkT('delete')} ${pl.number}`} onClick={() => remove(pl)}><Trash2 size={14} /></button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {!draft && (
          <div className={styles.row}>
            {types.length > 0 && (
              <label className={controls.field}>
                <span className={controls.label}>{pkT('packageType')}</span>
                <select className={controls.select} value={typeId} onChange={(e) => setTypeId(e.target.value)}>
                  <option value="">{pkT('customType')}</option>
                  {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            )}
            <button type="button" className={controls.btnPrimary} onClick={startNew} data-packing-new>
              <Package size={15} aria-hidden /> {pkT('newList')}
            </button>
          </div>
        )}

        {draft && draft.lines.length === 0 && <p className={styles.warn}>{pkT('nothing')}</p>}
        {draft && draft.lines.length > 0 && (
          <>
            <div className={styles.row}>
              <label className={controls.field}>
                <span className={controls.label}>{pkT('date')}</span>
                <input type="date" className={controls.input} value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
              </label>
              <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => auto('per-line')}>{pkT('autoPerLine')}</button>
              <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => auto('all-in-one')}>{pkT('autoAllInOne')}</button>
              <button type="button" className={`${controls.btnOutline} ${controls.btnSm}`} onClick={() => setPackages((ps) => [...ps, blankPackage(ps.length + 1, type)])}>
                <Plus size={14} aria-hidden /> {pkT('addPackage')}
              </button>
            </div>

            <div className={surface.tableWrap}>
              <table className={surface.table}>
                <thead>
                  <tr>
                    <th scope="col">{pkT('boxNo')}</th>
                    <th scope="col">{pkT('packageType')}</th>
                    <th scope="col">{pkT('count')}</th>
                    <th scope="col">{pkT('length')}</th>
                    <th scope="col">{pkT('breadth')}</th>
                    <th scope="col">{pkT('height')}</th>
                    <th scope="col">{pkT('tare')}</th>
                    <th scope="col">{pkT('marks')}</th>
                    {draft.lines.map((l) => <th key={l.line_id} scope="col">{l.name}{l.unit ? ` (${l.unit})` : ''}</th>)}
                    <th scope="col" className={surface.numeric}>{pkT('net')}</th>
                    <th scope="col" className={surface.numeric}>{pkT('gross')}</th>
                    <th scope="col" className={surface.numeric}>{pkT('cbm')}</th>
                    <th scope="col"><span className={surface.srOnly}>{pkT('delete')}</span></th>
                  </tr>
                </thead>
                <tbody>
                  {draft.packages.map((p) => {
                    const f = packageFigures(p, draft.lines);
                    const box = boxRange(p);
                    return (
                      <tr key={p.id}>
                        <td className={surface.mono}>{box}</td>
                        <td>
                          <input className={`${controls.input} ${styles.wide}`} value={p.type_name} onChange={(e) => {
                              const hit = types.find((t) => t.name.toLowerCase() === e.target.value.trim().toLowerCase());
                              patchPkg(p.id, hit ? { type_name: hit.name, type_id: hit.id, length_cm: hit.length_cm, breadth_cm: hit.breadth_cm, height_cm: hit.height_cm, tare_kg: hit.tare_kg } : { type_name: e.target.value, type_id: undefined });
                            }} list="packing-types" aria-label={`${pkT('packageType')} ${box}`} />
                        </td>
                        <td><input className={`${controls.input} ${styles.narrow}`} inputMode="numeric" value={p.count} onChange={(e) => patchPkg(p.id, { count: Math.max(1, Math.floor(num(e.target.value)) || 1) })} aria-label={`${pkT('count')} ${box}`} /></td>
                        <td><input className={`${controls.input} ${styles.narrow}`} inputMode="decimal" value={p.length_cm} onChange={(e) => patchPkg(p.id, { length_cm: num(e.target.value) })} aria-label={`${pkT('length')} ${box}`} /></td>
                        <td><input className={`${controls.input} ${styles.narrow}`} inputMode="decimal" value={p.breadth_cm} onChange={(e) => patchPkg(p.id, { breadth_cm: num(e.target.value) })} aria-label={`${pkT('breadth')} ${box}`} /></td>
                        <td><input className={`${controls.input} ${styles.narrow}`} inputMode="decimal" value={p.height_cm} onChange={(e) => patchPkg(p.id, { height_cm: num(e.target.value) })} aria-label={`${pkT('height')} ${box}`} /></td>
                        <td><input className={`${controls.input} ${styles.narrow}`} inputMode="decimal" value={p.tare_kg} onChange={(e) => patchPkg(p.id, { tare_kg: num(e.target.value) })} aria-label={`${pkT('tare')} ${box}`} /></td>
                        <td><input className={`${controls.input} ${styles.wide}`} value={p.marks ?? ''} onChange={(e) => patchPkg(p.id, { marks: e.target.value })} aria-label={`${pkT('marks')} ${box}`} /></td>
                        {draft.lines.map((l) => (
                          <td key={l.line_id}>
                            <input
                              className={`${controls.input} ${styles.num}`}
                              inputMode="decimal"
                              value={p.contents.find((c) => c.line_id === l.line_id)?.qty ?? ''}
                              onChange={(e) => setQty(p.id, l.line_id, num(e.target.value))}
                              aria-label={pkT('qtyAria', { item: l.name, box })}
                            />
                          </td>
                        ))}
                        <td className={surface.numeric}>{n3(f.net_kg)}</td>
                        <td className={surface.numeric}>{n3(f.gross_kg)}</td>
                        <td className={surface.numeric}>{n3(f.cbm)}</td>
                        <td>
                          <button type="button" className={controls.btnIcon} aria-label={pkT('remove', { box })} onClick={() => setPackages((ps) => ps.filter((x) => x.id !== p.id))}>
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <datalist id="packing-types">{types.map((t) => <option key={t.id} value={t.name} />)}</datalist>
            </div>

            <div className={surface.tableWrap}>
              <table className={surface.table}>
                <thead>
                  <tr>
                    <th scope="col">{pkT('line')}</th>
                    <th scope="col" className={surface.numeric}>{pkT('onDoc')}</th>
                    <th scope="col" className={surface.numeric}>{pkT('packed')}</th>
                  </tr>
                </thead>
                <tbody>
                  {draft.lines.map((l) => {
                    const q = packed.get(l.line_id) ?? 0;
                    const ok = Math.abs(q - l.quantity) < 1e-6;
                    return (
                      <tr key={l.line_id}>
                        <td>{l.name}</td>
                        <td className={surface.numeric}>{n3(l.quantity)} {l.unit ?? ''}</td>
                        <td className={`${surface.numeric} ${ok ? styles.ok : styles.bad}`} data-packed-ok={ok ? 'yes' : 'no'}>{n3(q)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {totals && <p className={styles.totals} data-packing-totals>{pkT('totals', { n: totals.packages, net: n3(totals.net_kg), gross: n3(totals.gross_kg), cbm: n3(totals.cbm) })}</p>}
            {unweighed.length > 0 && <p className={styles.muted}>{pkT('noWeight', { items: unweighed.join(', ') })}</p>}
            {issues.length > 0 && (
              <ul className={styles.warn} role="status">
                {issues.slice(0, 8).map((i, k) => <li key={k}>{i.message}</li>)}
              </ul>
            )}
            <label className={controls.field}>
              <span className={controls.label}>{pkT('notes')}</span>
              <input className={controls.input} value={draft.notes ?? ''} maxLength={300} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} />
            </label>
            {error && <p className={controls.error} role="alert">{error}</p>}
            <div className={styles.row}>
              <button type="button" className={controls.btnPrimary} onClick={save} disabled={issues.length > 0} data-packing-save>{pkT('save')}</button>
              <button type="button" className={controls.btnGhost} onClick={() => setDraft(null)}>{pkT('cancel')}</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

export default PackingListDialog;

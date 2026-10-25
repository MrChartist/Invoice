/** HSN / SAC master with rate history (WP-6). Lazy-loaded tab of the GST reports page. */
import { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2, Wand2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import {
  addSuggested,
  deleteHsn,
  loadHsnMaster,
  offSlabRates,
  rateOn,
  saveHsn,
  suggestFromLines,
  type HsnInput,
  type HsnMasterRow,
} from '../../lib/hsn-master';
import { readPurchase, readPurchaseLines } from '../../lib/purchase-normalize';
import { getTable } from '../../lib/storage';
import { todayIso } from '../../lib/tax-rules';
import { formatDate } from '../../lib/utils';
import type { InvoiceRecord } from '../../types/invoice';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import local from './gst-reports.module.css';
import styles from './gst-setoff.module.css';
import { useT } from '../../i18n';
import { soT } from '../../i18n/areas/gst-setoff';

export interface HsnMasterPanelProps {
  notify: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}

const blank = (): HsnInput => ({ code: '', description: '', uqc: '', kind: 'goods', rates: [{ from: '2017-07-01', rate: 18 }] });

/** Every HSN-coded line on invoices, the catalogue and purchase bills. */
function usedLines() {
  const out: { hsn?: string; name?: string; unit?: string; rate?: number; date?: string }[] = [];
  for (const inv of getTable<InvoiceRecord>('invoices')) {
    for (const it of inv?.items ?? []) out.push({ hsn: it.hsn, name: it.name, unit: it.unit, rate: it.tax_rate, date: inv.issue_date });
  }
  for (const it of getTable<{ hsn?: string; name?: string; unit?: string; tax_rate?: number }>('items_catalog')) {
    out.push({ hsn: it?.hsn, name: it?.name, unit: it?.unit, rate: it?.tax_rate });
  }
  for (const raw of getTable<unknown>('purchases')) {
    const c = readPurchase(raw);
    for (const l of readPurchaseLines(raw)) out.push({ hsn: l.hsn, name: l.name, unit: l.unit, rate: l.taxRate, date: c?.date });
  }
  return out;
}

export function HsnMasterPanel({ notify }: HsnMasterPanelProps) {
  useT();
  const [version, setVersion] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `version` re-reads the table after a change
  const rows = useMemo(() => loadHsnMaster(), [version]);
  const [draft, setDraft] = useState<HsnInput | null>(null);
  const [toDelete, setToDelete] = useState<HsnMasterRow | null>(null);
  const today = todayIso();

  const importUsed = () => {
    try {
      const n = addSuggested(suggestFromLines(usedLines(), rows));
      notify(soT('hsnImported', { n }), n ? 'success' : 'info');
      setVersion((v) => v + 1);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  return (
    <div className={local.tabBody} style={{ padding: 0 }} data-gst-hsn-master>
      <p className={styles.muted}>{soT('hsnIntro')}</p>
      <div className={styles.actions}>
        <button type="button" className={`${controls.btn} ${controls.btnPrimary} ${controls.btnSm}`} onClick={() => setDraft(blank())}>
          <Plus size={14} aria-hidden /> {soT('hsnAdd')}
        </button>
        <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={importUsed}>
          <Wand2 size={14} aria-hidden /> {soT('hsnImport')}
        </button>
      </div>
      {rows.length === 0 ? (
        <p className={surface.sectionNote}>{soT('hsnEmpty')}</p>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.grid} aria-label={soT('hsnTitle')}>
            <thead>
              <tr>
                <th scope="col">{soT('hsnCode')}</th>
                <th scope="col">{soT('hsnDesc')}</th>
                <th scope="col">{soT('hsnUqc')}</th>
                <th scope="col">{soT('hsnKind')}</th>
                <th scope="col">{soT('hsnCurrent')}</th>
                <th scope="col">{soT('hsnHistory')}</th>
                <th scope="col">{soT('thActions')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const cur = rateOn(r, today);
                return (
                  <tr key={r.id}>
                    <td className={surface.mono}>{r.code}</td>
                    <td style={{ textAlign: 'left', whiteSpace: 'normal' }}>{r.description}</td>
                    <td>{r.uqc ?? '—'}</td>
                    <td>{r.kind === 'services' ? soT('hsnServices') : soT('hsnGoods')}</td>
                    <td>{cur ? `${cur.rate}%${cur.cess_rate ? ` + ${cur.cess_rate}%` : ''}` : '—'}</td>
                    <td style={{ textAlign: 'left' }}>
                      <ul className={styles.history}>
                        {r.rates.map((x) => <li key={x.from}>{formatDate(x.from)}: {x.rate}%{x.cess_rate ? ` + ${x.cess_rate}%` : ''}</li>)}
                      </ul>
                    </td>
                    <td>
                      <span className={surface.rowActions}>
                        <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} aria-label={soT('edit')} onClick={() => setDraft({ ...r, rates: r.rates.map((x) => ({ ...x })) })}>
                          <Pencil size={14} aria-hidden />
                        </button>
                        <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} aria-label={soT('remove')} onClick={() => setToDelete(r)}>
                          <Trash2 size={14} aria-hidden />
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {draft && (
        <HsnDialog
          draft={draft}
          onClose={() => setDraft(null)}
          onSave={(d) => {
            try {
              const r = saveHsn(d);
              notify(soT('hsnSaved', { code: r.code }), 'success');
              setDraft(null);
              setVersion((v) => v + 1);
            } catch (e) {
              notify(e instanceof Error ? e.message : String(e), 'error');
            }
          }}
        />
      )}
      <ConfirmDialog
        open={!!toDelete}
        title={soT('remove')}
        message={soT('hsnConfirmDelete', { code: toDelete?.code ?? '' })}
        confirmLabel={soT('remove')}
        destructive
        onConfirm={() => {
          if (toDelete) {
            try {
              deleteHsn(toDelete.id);
              notify(soT('hsnDeleted', { code: toDelete.code }), 'success');
              setVersion((v) => v + 1);
            } catch (e) {
              notify(e instanceof Error ? e.message : String(e), 'error');
            }
          }
          setToDelete(null);
        }}
        onClose={() => setToDelete(null)}
      />
    </div>
  );
}

function HsnDialog({ draft, onClose, onSave }: { draft: HsnInput; onClose: () => void; onSave: (d: HsnInput) => void }) {
  useT();
  const [d, setD] = useState<HsnInput>(draft);
  const setRate = (i: number, patch: Partial<HsnInput['rates'][number]>) =>
    setD((x) => ({ ...x, rates: x.rates.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const off = offSlabRates({ rates: d.rates.map((r) => ({ ...r, rate: Number(r.rate) || 0 })) });
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={d.id ? `${soT('hsnTitle')} · ${d.code}` : soT('hsnAdd')}
      footer={
        <>
          <button type="button" className={`${controls.btn} ${controls.btnOutline}`} onClick={onClose}>{soT('dlgCancel')}</button>
          <button type="button" className={`${controls.btn} ${controls.btnPrimary}`} onClick={() => onSave(d)}>{soT('hsnSave')}</button>
        </>
      }
    >
      <div className={styles.formGrid}>
        <label className={controls.field}>
          <span className={controls.label}>{soT('hsnCode')}</span>
          <input className={`${controls.input} ${controls.inputMono}`} inputMode="numeric" maxLength={8} value={d.code} onChange={(e) => setD({ ...d, code: e.target.value.replace(/\D/g, '') })} />
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{soT('hsnDesc')}</span>
          <input className={controls.input} value={d.description} onChange={(e) => setD({ ...d, description: e.target.value })} />
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{soT('hsnUqc')}</span>
          <input className={controls.input} maxLength={8} value={d.uqc ?? ''} onChange={(e) => setD({ ...d, uqc: e.target.value.toUpperCase() })} />
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{soT('hsnKind')}</span>
          <select className={controls.select} value={d.kind} onChange={(e) => setD({ ...d, kind: e.target.value === 'services' ? 'services' : 'goods' })}>
            <option value="goods">{soT('hsnGoods')}</option>
            <option value="services">{soT('hsnServices')}</option>
          </select>
        </label>
      </div>
      <h4 className={local.tbHeading}>{soT('hsnHistory')}</h4>
      <table className={styles.grid}>
        <thead>
          <tr>
            <th scope="col">{soT('hsnFrom')}</th>
            <th scope="col">{soT('hsnRate')}</th>
            <th scope="col">{soT('hsnCess')}</th>
          </tr>
        </thead>
        <tbody>
          {d.rates.map((r, i) => (
            <tr key={i}>
              <td><input type="date" className={controls.input} aria-label={soT('hsnFrom')} value={r.from} onChange={(e) => setRate(i, { from: e.target.value })} /></td>
              <td><input type="number" min={0} max={100} step="0.01" className={`${controls.input} ${styles.cellInput}`} aria-label={soT('hsnRate')} value={r.rate} onChange={(e) => setRate(i, { rate: Number(e.target.value) })} /></td>
              <td><input type="number" min={0} step="0.01" className={`${controls.input} ${styles.cellInput}`} aria-label={soT('hsnCess')} value={r.cess_rate ?? ''} onChange={(e) => setRate(i, { cess_rate: Number(e.target.value) || undefined })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.actions}>
        <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => setD((x) => ({ ...x, rates: [...x.rates, { from: todayIso(), rate: x.rates[x.rates.length - 1]?.rate ?? 18 }] }))}>
          <Plus size={14} aria-hidden /> {soT('hsnAddRate')}
        </button>
      </div>
      {off.length > 0 && <div className={styles.warn} role="status">{soT('hsnOffSlab', { rates: off.join(', ') })}</div>}
      <p className={styles.muted}>{soT('disclaimer')}</p>
    </Modal>
  );
}

export default HsnMasterPanel;

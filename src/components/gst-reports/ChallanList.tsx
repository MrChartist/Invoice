/** PMT-06 challan register + edit dialog (WP-6). A paid challan posts Dr GST electronic cash ledger / Cr bank. */
import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import {
  CHALLAN_MODES,
  CHALLAN_MODE_LABELS,
  GST_HEADS,
  GST_HEAD_LABELS,
  MINOR_HEADS,
  MINOR_HEAD_LABELS,
  challanTotal,
  challanWarnings,
  cleanAmounts,
  deleteGstChallan,
  emptyAmounts,
  headTotal,
  minorTotal,
  saveGstChallan,
  type ChallanAmounts,
  type ChallanMode,
  type GstChallan,
} from '../../lib/gst-setoff';
import { A, chartOf, loadUserAccounts } from '../../lib/ledger/accounts';
import { isCashOrBankLedger } from '../../lib/bank-ledgers';
import { todayIso } from '../../lib/tax-rules';
import { formatDate, formatMoney } from '../../lib/utils';
import surface from '../../styles/surface.module.css';
import controls from '../../styles/controls.module.css';
import local from './gst-reports.module.css';
import styles from './gst-setoff.module.css';
import { useT } from '../../i18n';
import { soT } from '../../i18n/areas/gst-setoff';

export interface ChallanListProps {
  challans: GstChallan[];
  gstin: string;
  defaultPeriodKey: string;
  /** Pre-filled amounts for a new challan (from the set-off plan). */
  seed: { amounts: ChallanAmounts; periodKey: string } | null;
  onSeedUsed: () => void;
  onChanged: () => void;
  notify: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}

type Draft = Omit<GstChallan, 'id' | 'amounts'> & { id?: string; amounts: ChallanAmounts };

export function ChallanList({ challans, gstin, defaultPeriodKey, seed, onSeedUsed, onChanged, notify }: ChallanListProps) {
  useT();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [toDelete, setToDelete] = useState<GstChallan | null>(null);

  const blank = (amounts: ChallanAmounts = emptyAmounts(), periodKey = defaultPeriodKey): Draft => ({
    cpin: '', generated_on: todayIso(), amounts, period_key: periodKey, gstin, mode: 'E_PAYMENT', bank_ledger_id: A.bank,
  });

  useEffect(() => {
    if (!seed) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- opening the dialog from a parent action
    setDraft(blank(seed.amounts, seed.periodKey));
    onSeedUsed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed]);

  const remove = () => {
    if (!toDelete) return;
    try {
      deleteGstChallan(toDelete.id);
      notify(soT('chDeleted'), 'success');
      onChanged();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'error');
    }
    setToDelete(null);
  };

  return (
    <section aria-label={soT('challans')}>
      <div className={local.toolbar}>
        <h3 className={local.tbHeading}>{soT('challans')}</h3>
        <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => setDraft(blank())}>
          <Plus size={14} aria-hidden /> {soT('newChallan')}
        </button>
      </div>
      {challans.length === 0 ? (
        <p className={surface.sectionNote}>{soT('challansEmpty')}</p>
      ) : (
        <div className={styles.scroll}>
          <table className={styles.grid} data-gst-challans>
            <thead>
              <tr>
                <th scope="col">{soT('thCpin')}</th>
                <th scope="col">{soT('thGenerated')}</th>
                <th scope="col">{soT('thPeriod')}</th>
                {GST_HEADS.map((h) => <th key={h} scope="col">{GST_HEAD_LABELS[h]}</th>)}
                <th scope="col">{soT('thAmount')}</th>
                <th scope="col">{soT('thStatus')}</th>
                <th scope="col">{soT('thActions')}</th>
              </tr>
            </thead>
            <tbody>
              {challans.map((c) => (
                <tr key={c.id}>
                  <td className={surface.mono}>{c.cpin}</td>
                  <td>{formatDate(c.generated_on)}</td>
                  <td>{c.period_key ?? '-'}</td>
                  {GST_HEADS.map((h) => <td key={h}>{formatMoney(headTotal(c.amounts, h))}</td>)}
                  <td><strong>{formatMoney(challanTotal(c))}</strong></td>
                  <td>
                    {c.deposited_on ? (
                      <span className={styles.ok}>{soT('statusPaid', { date: formatDate(c.deposited_on) })}{c.voucher_number ? ` · ${c.voucher_number}` : ''}</span>
                    ) : (
                      <span className={styles.bad}>{soT('statusUnpaid')}</span>
                    )}
                  </td>
                  <td>
                    <span className={surface.rowActions}>
                      <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} aria-label={soT('edit')} onClick={() => setDraft({ ...c })}>
                        <Pencil size={14} aria-hidden />
                      </button>
                      <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} aria-label={soT('remove')} onClick={() => setToDelete(c)}>
                        <Trash2 size={14} aria-hidden />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {draft && (
        <ChallanDialog
          draft={draft}
          onClose={() => setDraft(null)}
          onSaved={(c) => {
            setDraft(null);
            notify(soT('chSaved', { cpin: c.cpin }), 'success');
            onChanged();
          }}
          notify={notify}
        />
      )}
      <ConfirmDialog
        open={!!toDelete}
        title={soT('remove')}
        message={soT('chConfirmDelete', { cpin: toDelete?.cpin ?? '' })}
        confirmLabel={soT('remove')}
        destructive
        onConfirm={remove}
        onClose={() => setToDelete(null)}
      />
    </section>
  );
}

function ChallanDialog({ draft, onClose, onSaved, notify }: { draft: Draft; onClose: () => void; onSaved: (c: GstChallan) => void; notify: ChallanListProps['notify'] }) {
  useT();
  const [d, setD] = useState<Draft>(draft);
  const banks = useMemo(() => chartOf(loadUserAccounts()).filter((a) => isCashOrBankLedger(a)), []);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const setAmt = (h: (typeof GST_HEADS)[number], mh: (typeof MINOR_HEADS)[number], v: string) =>
    setD((x) => {
      const a = cleanAmounts(x.amounts);
      a[h][mh] = Number(v) || 0;
      return { ...x, amounts: a };
    });
  const warnings = challanWarnings(d);

  const save = () => {
    try {
      onSaved(saveGstChallan(d));
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'error');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      title={d.id ? soT('chTitleEdit', { cpin: d.cpin }) : soT('chTitleNew')}
      footer={
        <>
          <button type="button" className={`${controls.btn} ${controls.btnOutline}`} onClick={onClose}>{soT('dlgCancel')}</button>
          <button type="button" className={`${controls.btn} ${controls.btnPrimary}`} onClick={save}>{soT('chSave')}</button>
        </>
      }
    >
      <div className={styles.formGrid}>
        <label className={controls.field}>
          <span className={controls.label}>{soT('chCpin')}</span>
          <input className={`${controls.input} ${controls.inputMono}`} inputMode="numeric" maxLength={14} value={d.cpin} onChange={(e) => set('cpin', e.target.value.replace(/\D/g, ''))} />
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{soT('chGenerated')}</span>
          <input type="date" className={controls.input} value={d.generated_on} onChange={(e) => set('generated_on', e.target.value)} />
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{soT('chPeriod')}</span>
          <input className={controls.input} value={d.period_key ?? ''} placeholder="2025-05 / 2025-Q1" onChange={(e) => set('period_key', e.target.value)} />
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{soT('chMode')}</span>
          <select className={controls.select} value={d.mode ?? 'E_PAYMENT'} onChange={(e) => set('mode', e.target.value as ChallanMode)}>
            {CHALLAN_MODES.map((mo) => <option key={mo} value={mo}>{CHALLAN_MODE_LABELS[mo]}</option>)}
          </select>
        </label>
      </div>

      <div className={styles.scroll}>
        <table className={styles.grid}>
          <thead>
            <tr>
              <th scope="col">{soT('chMajor')}</th>
              {MINOR_HEADS.map((mh) => <th key={mh} scope="col">{MINOR_HEAD_LABELS[mh]}</th>)}
              <th scope="col">{soT('chTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {GST_HEADS.map((h) => (
              <tr key={h}>
                <th scope="row">{GST_HEAD_LABELS[h]}</th>
                {MINOR_HEADS.map((mh) => (
                  <td key={mh}>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className={`${controls.input} ${styles.cellInput}`}
                      aria-label={`${GST_HEAD_LABELS[h]} ${MINOR_HEAD_LABELS[mh]}`}
                      value={d.amounts[h][mh] || ''}
                      onChange={(e) => setAmt(h, mh, e.target.value)}
                    />
                  </td>
                ))}
                <td>{formatMoney(headTotal(d.amounts, h))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>{soT('chTotal')}</td>
              {MINOR_HEADS.map((mh) => <td key={mh}>{formatMoney(minorTotal(d.amounts, mh))}</td>)}
              <td>{formatMoney(challanTotal(d))}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <p className={styles.muted}>{soT('chPayHint')}</p>
      <div className={styles.formGrid}>
        <label className={controls.field}>
          <span className={controls.label}>{soT('chDeposited')}</span>
          <input type="date" className={controls.input} value={d.deposited_on ?? ''} onChange={(e) => set('deposited_on', e.target.value)} />
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{soT('chCin')}</span>
          <input className={`${controls.input} ${controls.inputMono}`} maxLength={18} value={d.cin ?? ''} onChange={(e) => set('cin', e.target.value.toUpperCase())} />
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{soT('chBrn')}</span>
          <input className={controls.input} value={d.brn ?? ''} onChange={(e) => set('brn', e.target.value)} />
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{soT('chBank')}</span>
          <select className={controls.select} value={d.bank_ledger_id ?? A.bank} onChange={(e) => set('bank_ledger_id', e.target.value)}>
            {banks.map((b) => <option key={b.id} value={b.id}>{b.code} · {b.name}</option>)}
          </select>
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{soT('chNotes')}</span>
          <input className={controls.input} value={d.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
        </label>
      </div>
      {warnings.map((w) => (
        <div key={w} className={styles.warn} role="status">{soT(`w${w}` as 'wCPIN_EXPIRED')}</div>
      ))}
      <p className={styles.muted}>{soT('disclaimer')}</p>
    </Modal>
  );
}

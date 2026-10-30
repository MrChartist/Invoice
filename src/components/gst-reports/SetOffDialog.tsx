/** Preview + confirm of the GST set-off journal (WP-6). Posts through `postSetOff` → `saveVoucher`. */
import { useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { GST_LEDGERS, postSetOff, setOffVoucherLines, type SetOffPlan } from '../../lib/gst-setoff';
import { chartOf, loadUserAccounts } from '../../lib/ledger/accounts';
import { formatMoney } from '../../lib/utils';
import controls from '../../styles/controls.module.css';
import styles from './gst-setoff.module.css';
import { useT } from '../../i18n';
import { soT } from '../../i18n/areas/gst-setoff';
import { DateField } from '../ui/DateField';

export interface SetOffDialogProps {
  plan: SetOffPlan;
  periodText: string;
  gstin: string;
  defaultDate: string;
  onClose: () => void;
  onPosted: (voucherNumber: string) => void;
  notify: (msg: string, tone?: 'success' | 'error' | 'info') => void;
}

export function SetOffDialog({ plan, periodText, gstin, defaultDate, onClose, onPosted, notify }: SetOffDialogProps) {
  useT();
  const [date, setDate] = useState(defaultDate);
  const [narration, setNarration] = useState('');
  const [busy, setBusy] = useState(false);
  const lines = useMemo(() => setOffVoucherLines(plan), [plan]);
  const names = useMemo(() => {
    const map = new Map(chartOf(loadUserAccounts()).map((a) => [a.id, `${a.code} · ${a.name}`]));
    for (const l of Object.values(GST_LEDGERS)) if (!map.has(l.id)) map.set(l.id, `${l.code} · ${l.name}`);
    return map;
  }, []);
  const total = lines.reduce((s, l) => s + l.dr, 0) / 100;

  const post = () => {
    setBusy(true);
    try {
      const rec = postSetOff(plan, { date, gstin, narration });
      onPosted(rec.voucher_number);
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), 'error');
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={soT('dlgTitle', { period: periodText })}
      subtitle={soT('dlgSubtitle')}
      footer={
        <>
          <button type="button" className={`${controls.btn} ${controls.btnOutline}`} onClick={onClose}>{soT('dlgCancel')}</button>
          <button type="button" className={`${controls.btn} ${controls.btnPrimary}`} onClick={post} disabled={busy || !date}>{soT('dlgConfirm')}</button>
        </>
      }
    >
      <div className={styles.formGrid}>
        <label className={controls.field}>
          <span className={controls.label}>{soT('dlgDate')}</span>
          <DateField className={controls.input} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className={controls.field}>
          <span className={controls.label}>{soT('dlgNarration')}</span>
          <input className={controls.input} value={narration} onChange={(e) => setNarration(e.target.value)} placeholder={`GST set-off ${plan.periodKey}`} />
        </label>
      </div>
      <div className={styles.scroll}>
        <table className={styles.grid}>
          <thead>
            <tr>
              <th scope="col">{soT('dlgAccount')}</th>
              <th scope="col">{soT('dlgDr')}</th>
              <th scope="col">{soT('dlgCr')}</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={`${l.account_id}-${i}`}>
                <td>{names.get(l.account_id) ?? l.account_id}</td>
                <td>{l.dr ? formatMoney(l.dr / 100) : ''}</td>
                <td>{l.cr ? formatMoney(l.cr / 100) : ''}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td />
              <td>{formatMoney(total)}</td>
              <td>{formatMoney(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className={styles.muted}>{soT('dlgCashNote')}</p>
      <p className={styles.muted}>{soT('disclaimer')}</p>
    </Modal>
  );
}

export default SetOffDialog;

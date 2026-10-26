import { useMemo, useState } from 'react';
import { Download, FileSpreadsheet, RotateCcw, Undo2 } from 'lucide-react';
import { can } from '../../lib/access';
import { localDb } from '../../lib/localDb';
import { loadRecoveries, registerTotals, reverseWriteOff, writeOffRegister, writeOffRegisterCsv, type WriteOffRegisterRow } from '../../lib/write-off';
import { formatDate, formatMoney, todayInput } from '../../lib/utils';
import { downloadTextFile } from '../receivables/exportUtils';
import { Modal } from '../ui/Modal';
import { RecoveryForm } from './RecoveryOffer';
import { useT } from '../../i18n';
import { colT } from '../../i18n/areas/collections';
import controls from '../../styles/controls.module.css';
import surface from '../../styles/surface.module.css';
import styles from './collections.module.css';

/**
 * R2-A3 write-off register (Receivables → Collections): party, bill, amount written off, date, reason and what
 * was recovered since; CSV / Excel export; owner-only recovery and undo.
 */
export function WriteOffRegister({ notify, onChanged }: { notify: (m: string, tone?: 'success' | 'error' | 'info') => void; onChanged?: () => void }) {
  useT();
  const [version, setVersion] = useState(0);
  const [recover, setRecover] = useState<WriteOffRegisterRow | null>(null);
  const rows = useMemo(
    () => writeOffRegister(localDb.invoices.getAll(), localDb.payments.getAll(), loadRecoveries()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version],
  );
  const totals = registerTotals(rows);
  const owner = can('doc.deleteIssued');
  const changed = (m: string) => {
    notify(m);
    setVersion((v) => v + 1);
    onChanged?.();
  };
  const exportXlsx = async () => {
    const { downloadXlsx } = await import('../../lib/xlsx');
    await downloadXlsx(`Write-off_register_${todayInput()}.xlsx`, [{
      name: 'Write-offs',
      rows: [[colT('regParty'), colT('regBill'), colT('regDate'), colT('regReason'), colT('regAmount'), colT('regRecovered'), colT('regNet')],
        ...rows.map((r) => [r.party, r.number, r.date, r.reason, r.writtenOff, r.recovered, r.net])],
    }]);
  };

  return (
    <div className={surface.card} data-writeoff-register>
      <div className={surface.cardHead}>
        <h2 className={styles.boxHead}>{colT('regTitle')}</h2>
        {rows.length > 0 && (
          <div className={surface.pageActions}>
            <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => downloadTextFile(`Write-off_register_${todayInput()}.csv`, writeOffRegisterCsv(rows))}>
              <Download size={14} /> {colT('regCsv')}
            </button>
            <button type="button" className={`${controls.btn} ${controls.btnOutline} ${controls.btnSm}`} onClick={() => void exportXlsx()}>
              <FileSpreadsheet size={14} /> {colT('regXlsx')}
            </button>
          </div>
        )}
      </div>
      {rows.length === 0 ? (
        <div className={surface.cardBody}><p className={styles.note}>{colT('regEmpty')}</p></div>
      ) : (
        <div className={surface.tableWrap}>
          <table className={surface.table}>
            <caption className={surface.srOnly}>{colT('regTitle')}</caption>
            <thead>
              <tr>
                <th scope="col">{colT('regParty')}</th><th scope="col">{colT('regBill')}</th><th scope="col">{colT('regDate')}</th><th scope="col">{colT('regReason')}</th>
                <th scope="col" className={surface.numeric}>{colT('regAmount')}</th>
                <th scope="col" className={surface.numeric}>{colT('regRecovered')}</th>
                <th scope="col" className={surface.numeric}>{colT('regNet')}</th>
                {owner && <th scope="col"><span className={surface.srOnly}>{colT('regRecover')}</span></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.invoiceId}>
                  <td>{r.party}</td>
                  <td className={surface.mono}>{r.number}</td>
                  <td>{r.date ? formatDate(r.date) : '—'}</td>
                  <td>{r.reason || '—'}</td>
                  <td className={surface.numeric}>{formatMoney(r.writtenOff, 'INR')}</td>
                  <td className={surface.numeric}>{r.recovered ? formatMoney(r.recovered, 'INR') : '—'}</td>
                  <td className={surface.numeric}><strong>{formatMoney(r.net, 'INR')}</strong></td>
                  {owner && (
                    <td>
                      <span className={styles.inlineActions}>
                        {r.net > 0.004 && (
                          <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`} onClick={() => setRecover(r)}>
                            <RotateCcw size={14} /> {colT('regRecover')}
                          </button>
                        )}
                        {r.paymentIds.length > 0 && r.recovered === 0 && (
                          <button type="button" className={`${controls.btn} ${controls.btnGhost} ${controls.btnSm}`}
                            onClick={() => {
                              if (!window.confirm(colT('regReverseAsk', { number: r.number }))) return;
                              try {
                                for (const id of r.paymentIds) reverseWriteOff(id);
                                changed(colT('regReversed'));
                              } catch (err) {
                                notify((err as Error).message, 'error');
                              }
                            }}>
                            <Undo2 size={14} /> {colT('regReverse')}
                          </button>
                        )}
                      </span>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={4}>{colT('regTotal')}</th>
                <td className={surface.numeric}>{formatMoney(totals.writtenOff, 'INR')}</td>
                <td className={surface.numeric}>{formatMoney(totals.recovered, 'INR')}</td>
                <td className={surface.numeric}>{formatMoney(totals.net, 'INR')}</td>
                {owner && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {recover && (
        <Modal open onClose={() => setRecover(null)} size="md" title={colT('recTitle', { number: recover.number })}>
          <RecoveryForm invoice={{ id: recover.invoiceId, invoice_number: recover.number }} max={recover.net} onCancel={() => setRecover(null)}
            onDone={(m) => { setRecover(null); changed(m); }} />
        </Modal>
      )}
    </div>
  );
}

export default WriteOffRegister;

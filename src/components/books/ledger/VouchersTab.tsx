import { Fragment, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, ChevronRight, FilePlus2, NotebookPen, Pencil, Trash2 } from 'lucide-react';
import { deleteVoucher, loadVouchers, type Ledger, type LedgerVoucher, type ManualVoucher } from '../../../lib/ledger';
import type { Period } from '../../../lib/books';
import { removeVoucherReceipts } from '../../../lib/bill-allocation';
import { toCsv } from '../../../lib/csv';
import { formatDate } from '../../../lib/utils';
import { todayIso } from '../../../lib/tax-rules';
import { EmptyState } from '../../ui/EmptyState';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { VoucherEditor } from './VoucherEditor';
import { money } from './format';
import { PrintTitle, StatementToolbar } from './shared';
import surface from '../../../styles/surface.module.css';
import controls from '../../../styles/controls.module.css';
import books from '../books.module.css';
import styles from './ledger.module.css';
import { useT } from '../../../i18n';
import { ledgerT } from '../../../i18n/areas/books-ledger';
import { voucherTypeLabel } from '../../../i18n/areas/books';

type Source = 'all' | 'manual' | 'auto';

interface Props {
  ledger: Ledger;
  period: Period;
  onChanged: () => void;
  onOpenAccount: (id: string, party?: string) => void;
  notify: (msg: string, tone?: 'success' | 'error') => void;
}

const total = (v: LedgerVoucher) => v.lines.reduce((s, l) => s + l.dr, 0);

export function VouchersTab({ ledger, period, onChanged, onOpenAccount, notify }: Props) {
  useT();
  const [source, setSource] = useState<Source>('all');
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<ManualVoucher | null | 'new'>(null);
  const [deleting, setDeleting] = useState<ManualVoucher | null>(null);

  const list = useMemo(
    () => ledger.vouchers.filter((v) => v.date >= period.start && v.date <= period.end && (source === 'all' || v.source === source)),
    [ledger, period, source],
  );

  const today = todayIso();
  const manualById = (id?: string) => (id ? loadVouchers().find((v) => v.id === id) ?? null : null);

  const csv = () =>
    toCsv([
      ['Vouchers', `${period.start} to ${period.end}`, 'Working paper — verify with your CA'],
      ['Date', 'Type', 'Vch no.', 'Party', 'Narration', 'Account', 'Line party', 'Debit', 'Credit'],
      ...list.flatMap((v) =>
        v.lines.map((l) => [v.date, v.kind, v.number, v.party, v.narration, ledger.byId.get(l.account)?.name ?? l.account, l.party ?? '', l.dr / 100, l.cr / 100]),
      ),
    ]);

  const confirmDelete = () => {
    if (!deleting) return;
    try {
      deleteVoucher(deleting.id);
      removeVoucherReceipts(deleting.id); // P0-11: its bill-wise receipt rows go with it
      notify(ledgerT('voucherDeleted', { number: deleting.number }));
      onChanged();
    } catch (err) {
      notify((err as Error).message, 'error');
    }
    setDeleting(null);
  };

  return (
    <div className={books.stack}>
      <StatementToolbar csv={csv} filename={`vouchers-${period.start}_to_${period.end}.csv`}>
        <div className={books.presets} role="group" aria-label={ledgerT('filterVouchers')}>
          {(['all', 'manual', 'auto'] as Source[]).map((s) => (
            <button key={s} type="button" className={source === s ? books.chipActive : books.chip} aria-pressed={source === s} onClick={() => setSource(s)}>
              {s === 'all' ? ledgerT('all') : s === 'manual' ? ledgerT('manual') : ledgerT('fromDocs')}
            </button>
          ))}
        </div>
        <button type="button" className={controls.btnPrimary} onClick={() => setEditing('new')}>
          <FilePlus2 size={16} /> {ledgerT('newVoucher')}
        </button>
      </StatementToolbar>
      <PrintTitle title={ledgerT('vouchersTitle')} sub={`${formatDate(period.start)} – ${formatDate(period.end)}`} />

      {ledger.warnings.length > 0 && (
        <div className={books.noticeWarn} role="note">
          <span>{ledger.warnings.slice(0, 3).join(' ')}{ledger.warnings.length > 3 ? ` ${ledgerT('more', { n: ledger.warnings.length - 3 })}` : ''}</span>
        </div>
      )}

      <div className={surface.card}>
        {list.length === 0 ? (
          <EmptyState icon={NotebookPen} title={ledgerT('noVouchersTitle')} text={ledgerT('noVouchersText')} />
        ) : (
          <div className={`${surface.tableWrap} ${styles.wrap}`}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>{ledgerT('vouchersTitle')}</caption>
              <thead>
                <tr>
                  <th scope="col"><span className={surface.srOnly}>{ledgerT('expand')}</span></th>
                  <th scope="col">{ledgerT('colDate')}</th>
                  <th scope="col">{ledgerT('colType')}</th>
                  <th scope="col">{ledgerT('colVchNo')}</th>
                  <th scope="col">{ledgerT('colPartyNarration')}</th>
                  <th scope="col" className={surface.numeric}>{ledgerT('colAmount')}</th>
                  <th scope="col" className="no-print"><span className={surface.srOnly}>{ledgerT('actions')}</span></th>
                </tr>
              </thead>
              <tbody>
                {list.map((v) => {
                  const isOpen = open === v.id;
                  return (
                    <Fragment key={v.id}>
                      <tr>
                        <td>
                          <button type="button" className={controls.btnIcon} aria-expanded={isOpen} aria-label={ledgerT(isOpen ? 'hideLines' : 'showLines', { name: v.number || voucherTypeLabel(v.kind) })} onClick={() => setOpen(isOpen ? null : v.id)}>
                            {isOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                          </button>
                        </td>
                        <td>{formatDate(v.date)}</td>
                        <td><span className={v.source === 'manual' ? styles.badgeManual : styles.badge}>{voucherTypeLabel(v.kind)}</span></td>
                        <td>
                          {v.link ? <Link className={books.link} to={v.link}>{v.number || ledgerT('open')}</Link> : <span className={surface.mono}>{v.number || '—'}</span>}
                        </td>
                        <td>
                          {v.party && <div>{v.party}</div>}
                          {v.narration && <div className={books.narration}>{v.narration}</div>}
                        </td>
                        <td className={surface.numeric}>{money(total(v))}</td>
                        <td className="no-print">
                          {v.source === 'manual' && (
                            <div className={books.toolbarGroup}>
                              <button type="button" className={controls.btnIcon} aria-label={ledgerT('editName', { name: v.number })} onClick={() => setEditing(manualById(v.manualId))}>
                                <Pencil size={16} />
                              </button>
                              <button type="button" className={controls.btnIcon} aria-label={ledgerT('deleteName', { name: v.number })} onClick={() => setDeleting(manualById(v.manualId))}>
                                <Trash2 size={16} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                      {isOpen && (
                        <tr className={styles.detail}>
                          <td />
                          <td colSpan={6}>
                            <ul className={styles.subLines}>
                              {v.lines.map((l, i) => (
                                <li key={i} className={styles.subLine}>
                                  <span>
                                    <button type="button" className={styles.rowButton} onClick={() => onOpenAccount(l.account, l.party)}>
                                      {l.dr ? '' : ledgerT('toPrefix')}{ledger.byId.get(l.account)?.name ?? l.account}
                                    </button>
                                    {l.party ? <span className={books.muted}> · {l.party}</span> : null}
                                  </span>
                                  <span className={surface.numeric}>{l.dr ? `${money(l.dr)} Dr` : ''}</span>
                                  <span className={surface.numeric}>{l.cr ? `${money(l.cr)} Cr` : ''}</span>
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing !== null && (
        <VoucherEditor
          accounts={ledger.accounts}
          voucher={editing === 'new' ? null : editing}
          defaultDate={today >= period.start && today <= period.end ? today : period.end}
          onClose={() => setEditing(null)}
          onSaved={(v) => {
            setEditing(null);
            notify(ledgerT('voucherSaved', { number: v.number }));
            onChanged();
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title={ledgerT('deleteVoucherTitle', { number: deleting?.number ?? '' })}
        message={ledgerT('deleteVoucherMsg')}
        confirmLabel={ledgerT('deleteVoucher')}
        destructive
        onConfirm={confirmDelete}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

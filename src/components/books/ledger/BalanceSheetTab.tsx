import { useMemo, useState } from 'react';
import { Info, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  balanceSheetLedgerCsv,
  blockSummary,
  deleteAsset,
  depreciationSchedule,
  fyLabelOf,
  ledgerBalanceSheet,
  type BsSection,
  type FixedAsset,
  type Ledger,
} from '../../../lib/ledger';
import { fyStartYearOf } from '../../../lib/books';
import { DEPRECIATION_BLOCK_LABELS } from '../../../lib/tax-rules';
import { formatDate } from '../../../lib/utils';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { AssetModal } from './AssetModal';
import { money } from './format';
import { PrintTitle, StatementToolbar } from './shared';
import surface from '../../../styles/surface.module.css';
import controls from '../../../styles/controls.module.css';
import books from '../books.module.css';
import styles from './ledger.module.css';

interface Props {
  ledger: Ledger;
  asOf: string;
  assets: FixedAsset[];
  today: string;
  onChanged: () => void;
  onOpenAccount: (id: string) => void;
  notify: (msg: string, tone?: 'success' | 'error') => void;
}

function Side({ title, sections, total, onOpenAccount }: { title: string; sections: BsSection[]; total: number; onOpenAccount: (id: string) => void }) {
  return (
    <div className={surface.card}>
      <div className={surface.cardHead}>{title}</div>
      <ul className={books.statement}>
        {sections.map((s) => (
          <li key={s.key} className={books.statement}>
            <div className={books.stmtHead}><span>{s.label}</span><span /></div>
            {s.items.map((i) => (
              <details key={i.label}>
                <summary className={`${books.stmtRow} ${styles.summary}`}>
                  <span>{i.label}</span>
                  <span className={books.amt}>{money(i.amount)}</span>
                </summary>
                {i.detail.map((d, n) => (
                  <div key={n} className={books.stmtSub}>
                    {d.accountId ? (
                      <button type="button" className={styles.rowButton} onClick={() => onOpenAccount(d.accountId!)}>{d.label}</button>
                    ) : (
                      <span>{d.label}</span>
                    )}
                    <span className={books.amt}>{money(d.amount)}</span>
                  </div>
                ))}
              </details>
            ))}
            <div className={books.stmtRow}><span className={books.muted}>Total {s.label.toLowerCase()}</span><span className={books.amt}>{money(s.total)}</span></div>
          </li>
        ))}
        <li className={books.stmtTotal}>
          <span>TOTAL</span>
          <span className={books.amt}>{money(total)}</span>
        </li>
      </ul>
    </div>
  );
}

export function BalanceSheetTab({ ledger, asOf, assets, today, onChanged, onOpenAccount, notify }: Props) {
  const bs = useMemo(() => ledgerBalanceSheet(ledger, asOf), [ledger, asOf]);
  const fy = fyStartYearOf(asOf);
  const blocks = useMemo(() => blockSummary(assets, fy, today), [assets, fy, today]);
  const [editing, setEditing] = useState<FixedAsset | null | 'new'>(null);
  const [deleting, setDeleting] = useState<FixedAsset | null>(null);

  const remove = () => {
    if (!deleting) return;
    try {
      deleteAsset(deleting.id);
      notify(`${deleting.name} removed from the register`);
      onChanged();
    } catch (err) {
      notify((err as Error).message, 'error');
    }
    setDeleting(null);
  };

  return (
    <div className={books.stack}>
      <StatementToolbar csv={() => balanceSheetLedgerCsv(bs)} filename={`balance-sheet-${asOf}.csv`}>
        <span className={bs.difference === 0 ? styles.tieOk : styles.tieBad}>
          {bs.difference === 0 ? 'Assets = liabilities + equity' : `Difference ${money(bs.difference)}`}
        </span>
      </StatementToolbar>
      <PrintTitle title="Balance sheet (Schedule III format)" sub={`As at ${formatDate(asOf)}`} />

      <div className={books.notice} role="note">
        <Info size={16} className={books.noticeIcon} aria-hidden="true" />
        <span>
          Balance sheet as at {formatDate(asOf)} from the double-entry ledger: documents post automatically, and capital, loans,
          drawings, GST payments and other adjustments come from your vouchers. Profit for the year ({money(bs.profitForYear)}) flows to
          reserves. Closing stock is not valued automatically — post it with a journal. Verify with your CA.
        </span>
      </div>

      <div className={books.twoCol}>
        <Side title="I. Equity and liabilities" sections={bs.equityAndLiabilities} total={bs.totalEquityAndLiabilities} onOpenAccount={onOpenAccount} />
        <Side title="II. Assets" sections={bs.assets} total={bs.totalAssets} onOpenAccount={onOpenAccount} />
      </div>

      <div className={surface.card}>
        <div className={`${surface.cardHead} ${books.toolbar}`}>
          <span>Fixed-asset register &amp; depreciation ({fyLabelOf(fy)})</span>
          <button type="button" className={`${controls.btnOutline} no-print`} onClick={() => setEditing('new')}>
            <Plus size={16} /> Add asset
          </button>
        </div>
        {assets.length === 0 ? (
          <p className={surface.cardBody}>
            <span className={books.muted}>No fixed assets yet. Add laptops, furniture, vehicles and so on to depreciate them every year.</span>
          </p>
        ) : (
          <div className={`${surface.tableWrap} ${styles.wrap}`}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>Fixed-asset register</caption>
              <thead>
                <tr>
                  <th scope="col">Asset</th>
                  <th scope="col">Block</th>
                  <th scope="col">Put to use</th>
                  <th scope="col" className={surface.numeric}>Cost</th>
                  <th scope="col" className={surface.numeric}>Rate</th>
                  <th scope="col" className={surface.numeric}>Depreciation {fyLabelOf(fy)}</th>
                  <th scope="col" className={surface.numeric}>WDV 31 Mar</th>
                  <th scope="col" className="no-print"><span className={surface.srOnly}>Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {assets.map((a) => {
                  const row = depreciationSchedule(a, today).find((r) => r.fyStartYear === fy);
                  return (
                    <tr key={a.id}>
                      <td>{a.name}</td>
                      <td>{DEPRECIATION_BLOCK_LABELS[a.block]}</td>
                      <td>{formatDate(a.put_to_use)}</td>
                      <td className={surface.numeric}>{money(Math.round(a.cost * 100))}</td>
                      <td className={surface.numeric}>{row ? `${row.ratePct}%${row.halfRate ? ' (half)' : ''}` : '—'}</td>
                      <td className={surface.numeric}>{row ? money(row.depreciation) : '—'}</td>
                      <td className={surface.numeric}>{row ? money(row.closingWdv) : '—'}</td>
                      <td className="no-print">
                        <div className={books.toolbarGroup}>
                          <button type="button" className={controls.btnIcon} aria-label={`Edit ${a.name}`} onClick={() => setEditing(a)}><Pencil size={16} /></button>
                          <button type="button" className={controls.btnIcon} aria-label={`Delete ${a.name}`} onClick={() => setDeleting(a)}><Trash2 size={16} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {blocks.length > 0 && (
          <div className={`${surface.tableWrap} ${styles.wrap}`}>
            <table className={surface.table}>
              <caption className={styles.sectionTitle}>Block-wise summary (Income-tax Act) — {fyLabelOf(fy)}</caption>
              <thead>
                <tr>
                  <th scope="col">Block</th>
                  <th scope="col" className={surface.numeric}>Rate</th>
                  <th scope="col" className={surface.numeric}>Opening WDV</th>
                  <th scope="col" className={surface.numeric}>Additions</th>
                  <th scope="col" className={surface.numeric}>Depreciation</th>
                  <th scope="col" className={surface.numeric}>Closing WDV</th>
                </tr>
              </thead>
              <tbody>
                {blocks.map((b) => (
                  <tr key={b.block}>
                    <td>{b.label}</td>
                    <td className={surface.numeric}>{b.ratePct}%</td>
                    <td className={surface.numeric}>{money(b.openingWdv)}</td>
                    <td className={surface.numeric}>{money(b.additions)}</td>
                    <td className={surface.numeric}>{money(b.depreciation)}</td>
                    <td className={surface.numeric}>{money(b.closingWdv)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {editing !== null && (
        <AssetModal
          accounts={ledger.accounts}
          asset={editing === 'new' ? null : editing}
          defaultDate={asOf}
          onClose={() => setEditing(null)}
          onSaved={(a) => {
            setEditing(null);
            notify(`${a.name} saved`);
            onChanged();
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title={`Remove ${deleting?.name ?? 'asset'}?`}
        message="Its purchase entry and depreciation are removed from every statement. This is recorded in the activity log."
        confirmLabel="Remove asset"
        destructive
        onConfirm={remove}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

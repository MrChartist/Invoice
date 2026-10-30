import { useMemo, useState } from 'react';
import { Info, Pencil, Plus, Trash2 } from 'lucide-react';
import {
  balanceSheetLedgerCsv,
  blockSummary,
  bsPreviousAmounts,
  previousPeriod,
  deleteAsset,
  depreciationSchedule,
  fyLabelOf,
  ledgerBalanceSheet,
  type BsItem,
  type BsSection,
  type FixedAsset,
  type Ledger,
  type StockValuer,
} from '../../../lib/ledger';
import type { Period } from '../../../lib/books';
import { reportsT } from '../../../i18n/areas/reports-engine';
import { DrillStack } from './DrillStack';
import { useDrill, useDrillRows, useReportPrefs } from './drill-hooks';
import { groupFrame, ledgerFrame } from './report-frames';
import { fyStartYearOf } from '../../../lib/books';
import { DEPRECIATION_BLOCK_LABELS } from '../../../lib/tax-rules';
import { formatDate } from '../../../lib/utils';
import { ConfirmDialog } from '../../ui/ConfirmDialog';
import { AssetModal } from './AssetModal';
import { StockJournalNotice } from './StockJournalNotice';
import { money } from './format';
import { PrintTitle, StatementToolbar } from './shared';
import surface from '../../../styles/surface.module.css';
import controls from '../../../styles/controls.module.css';
import books from '../books.module.css';
import styles from './ledger.module.css';
import { useT } from '../../../i18n';
import { ledgerT } from '../../../i18n/areas/books-ledger';

interface Props {
  ledger: Ledger;
  asOf: string;
  /** Period whose end is `asOf` (drill-down screens use it). */
  period: Period;
  stock?: StockValuer;
  assets: FixedAsset[];
  today: string;
  onChanged: () => void;
  notify: (msg: string, tone?: 'success' | 'error') => void;
}

function Side({ title, sections, total, index, row, onItem, onAccount, prev, totalKey }: {
  /** PENDING 37: previous balance sheet amounts (`bsPreviousAmounts`); absent = one column. */
  prev?: ReadonlyMap<string, number>;
  totalKey: string;
  title: string;
  sections: BsSection[];
  total: number;
  /** Position of this side's first item in the keyboard list. */
  index: number;
  row: (i: number) => Record<string, unknown>;
  onItem: (i: BsItem) => void;
  onAccount: (accountId: string, party?: string) => void;
}) {
  let k = index;
  return (
    <div className={surface.card}>
      <div className={surface.cardHead}>{title}</div>
      <ul className={books.statement}>
        {sections.map((s) => (
          <li key={s.key} className={books.statement}>
            <div className={books.stmtHead}><span>{s.label}</span><span /></div>
            {s.items.map((i) => (
              <details key={i.label} {...row(k++)}>
                <summary className={`${books.stmtRow} ${styles.summary}`}>
                  {i.groupId ? (
                    <button type="button" className={styles.rowButton} onClick={(e) => { e.preventDefault(); onItem(i); }}>{i.label}</button>
                  ) : (
                    <span>{i.label}</span>
                  )}
                  <span className={books.amt}>{money(i.amount)}{prev && <span className={styles.prevAmt}>{money(prev.get(`${s.key}|${i.label}`) ?? 0)}</span>}</span>
                </summary>
                {i.detail.map((d, n) => (
                  <div key={n} className={books.stmtSub}>
                    {d.accountId ? (
                      <button type="button" className={styles.rowButton} onClick={() => onAccount(d.accountId!, d.party)}>{d.label}</button>
                    ) : (
                      <span>{d.label}</span>
                    )}
                    <span className={books.amt}>{money(d.amount)}</span>
                  </div>
                ))}
              </details>
            ))}
            <div className={books.stmtRow}><span className={books.muted}>{ledgerT('sectionTotal', { section: s.label.toLowerCase() })}</span><span className={books.amt}>{money(s.total)}{prev && <span className={styles.prevAmt}>{money(prev.get(s.key) ?? 0)}</span>}</span></div>
          </li>
        ))}
        <li className={books.stmtTotal}>
          <span>{ledgerT('TOTAL')}</span>
          <span className={books.amt}>{money(total)}{prev && <span className={styles.prevAmt}>{money(prev.get(totalKey) ?? 0)}</span>}</span>
        </li>
      </ul>
    </div>
  );
}

export function BalanceSheetTab(props: Props) {
  useT();
  return (
    <DrillStack rootTitle={reportsT('balanceSheet')} resetKey={props.asOf}>
      <BalanceSheetRoot {...props} />
    </DrillStack>
  );
}

function BalanceSheetRoot({ ledger, asOf, period, stock, assets, today, onChanged, notify }: Props) {
  useT();
  const drill = useDrill();
  const bs = useMemo(() => ledgerBalanceSheet(ledger, asOf, stock), [ledger, asOf, stock]);
  // The drill period runs to the balance-sheet date so ledgers show their closing as at that date.
  const drillPeriod = useMemo(() => ({ start: period.start <= asOf ? period.start : asOf, end: asOf }), [period.start, asOf]);
  // PENDING 37: the balance sheet at the end of the comparable previous period, side by side.
  const [prefs, setPrefs] = useReportPrefs('bs');
  const compare = prefs.columns === 'previous';
  const prevAsOf = useMemo(() => previousPeriod(drillPeriod).end, [drillPeriod]);
  const prevBs = useMemo(() => (compare ? ledgerBalanceSheet(ledger, prevAsOf, stock) : null), [compare, ledger, prevAsOf, stock]);
  const prevAmounts = useMemo(() => (prevBs ? bsPreviousAmounts(prevBs) : undefined), [prevBs]);
  const items = useMemo(() => [...bs.equityAndLiabilities, ...bs.assets].flatMap((s) => s.items), [bs]);
  const onItem = (i: BsItem) => i.groupId && drill.push(groupFrame(ledger, i.groupId, drillPeriod));
  const onAccount = (id: string, party?: string) => drill.push(ledgerFrame(ledger, id, drillPeriod, party));
  const nav = useDrillRows(items.length, (n) => onItem(items[n]));
  const liabCount = bs.equityAndLiabilities.reduce((s, x) => s + x.items.length, 0);
  // Clicking a line toggles its break-up (the label button drills); Enter on the selected line drills.
  const rowProps = (i: number) => {
    const { onClick, ...rest } = nav.row(i);
    void onClick;
    return rest;
  };
  const fy = fyStartYearOf(asOf);
  const blocks = useMemo(() => blockSummary(assets, fy, today), [assets, fy, today]);
  const [editing, setEditing] = useState<FixedAsset | null | 'new'>(null);
  const [deleting, setDeleting] = useState<FixedAsset | null>(null);

  const remove = () => {
    if (!deleting) return;
    try {
      deleteAsset(deleting.id);
      notify(ledgerT('assetRemoved', { name: deleting.name }));
      onChanged();
    } catch (err) {
      notify((err as Error).message, 'error');
    }
    setDeleting(null);
  };

  return (
    <div className={books.stack}>
      <StatementToolbar csv={() => balanceSheetLedgerCsv(bs, prevBs ?? undefined)} filename={`balance-sheet-${asOf}.csv`}>
        <label className={styles.inlineField}>
          <input type="checkbox" checked={compare} onChange={(e) => setPrefs({ columns: e.target.checked ? 'previous' : 'none' })} data-bs-compare />
          <span>{reportsT('comparePrevious')}{compare ? ` (${formatDate(prevAsOf)})` : ''}</span>
        </label>
        <span className={bs.difference === 0 ? styles.tieOk : styles.tieBad}>
          {bs.difference === 0 ? ledgerT('bsTie') : ledgerT('difference', { amount: money(bs.difference) })}
        </span>
      </StatementToolbar>
      <PrintTitle title={ledgerT('bsTitle')} sub={ledgerT('asAt', { date: formatDate(asOf) })} />

      <div className={books.notice} role="note">
        <Info size={16} className={books.noticeIcon} aria-hidden="true" />
        <span>
          {ledgerT('bsNotice', { date: formatDate(asOf), profit: money(bs.profitForYear) })}{' '}
          {stock ? reportsT('bsStockNote', { method: stock.label }) : reportsT('bsNoStockNote')}
        </span>
      </div>

      <StockJournalNotice stock={stock} onChanged={onChanged} notify={notify} />

      <div className={`${books.twoCol} ${styles.drillTable}`} tabIndex={0} onKeyDown={nav.table.onKeyDown} id={nav.bodyId}>
        <Side title={ledgerT('bsEquity')} sections={bs.equityAndLiabilities} total={bs.totalEquityAndLiabilities} index={0} row={rowProps} onItem={onItem} onAccount={onAccount} prev={prevAmounts} totalKey="TOTAL:EL" />
        <Side title={ledgerT('bsAssets')} sections={bs.assets} total={bs.totalAssets} index={liabCount} row={rowProps} onItem={onItem} onAccount={onAccount} prev={prevAmounts} totalKey="TOTAL:A" />
      </div>
      <p className={books.muted}>{reportsT('drillHint')}</p>

      <div className={surface.card}>
        <div className={`${surface.cardHead} ${books.toolbar}`}>
          <span>{ledgerT('registerTitle', { fy: fyLabelOf(fy) })}</span>
          <button type="button" className={`${controls.btnOutline} no-print`} onClick={() => setEditing('new')}>
            <Plus size={16} /> {ledgerT('addAsset')}
          </button>
        </div>
        {assets.length === 0 ? (
          <p className={surface.cardBody}>
            <span className={books.muted}>{ledgerT('noAssets')}</span>
          </p>
        ) : (
          <div className={`${surface.tableWrap} ${styles.wrap}`}>
            <table className={surface.table}>
              <caption className={surface.srOnly}>{ledgerT('registerCaption')}</caption>
              <thead>
                <tr>
                  <th scope="col">{ledgerT('colAsset')}</th>
                  <th scope="col">{ledgerT('colBlock')}</th>
                  <th scope="col">{ledgerT('colPutToUse')}</th>
                  <th scope="col" className={surface.numeric}>{ledgerT('colCost')}</th>
                  <th scope="col" className={surface.numeric}>{ledgerT('colRate')}</th>
                  <th scope="col" className={surface.numeric}>{ledgerT('colDepFy', { fy: fyLabelOf(fy) })}</th>
                  <th scope="col" className={surface.numeric}>{ledgerT('colWdv')}</th>
                  <th scope="col" className="no-print"><span className={surface.srOnly}>{ledgerT('actions')}</span></th>
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
                      <td className={surface.numeric}>{row ? `${row.ratePct}%${row.halfRate ? ledgerT('half') : ''}` : '-'}</td>
                      <td className={surface.numeric}>{row ? money(row.depreciation) : '-'}</td>
                      <td className={surface.numeric}>{row ? money(row.closingWdv) : '-'}</td>
                      <td className="no-print">
                        <div className={books.toolbarGroup}>
                          <button type="button" className={controls.btnIcon} aria-label={ledgerT('editName', { name: a.name })} onClick={() => setEditing(a)}><Pencil size={16} /></button>
                          <button type="button" className={controls.btnIcon} aria-label={ledgerT('deleteName', { name: a.name })} onClick={() => setDeleting(a)}><Trash2 size={16} /></button>
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
              <caption className={styles.sectionTitle}>{ledgerT('blockSummary', { fy: fyLabelOf(fy) })}</caption>
              <thead>
                <tr>
                  <th scope="col">{ledgerT('colBlock')}</th>
                  <th scope="col" className={surface.numeric}>{ledgerT('colRate')}</th>
                  <th scope="col" className={surface.numeric}>{ledgerT('colOpeningWdv')}</th>
                  <th scope="col" className={surface.numeric}>{ledgerT('colAdditions')}</th>
                  <th scope="col" className={surface.numeric}>{ledgerT('colDepreciation')}</th>
                  <th scope="col" className={surface.numeric}>{ledgerT('colClosingWdv')}</th>
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
            notify(ledgerT('assetSaved', { name: a.name }));
            onChanged();
          }}
        />
      )}
      <ConfirmDialog
        open={!!deleting}
        title={ledgerT('removeAssetTitle', { name: deleting?.name ?? ledgerT('assetWord') })}
        message={ledgerT('removeAssetMsg')}
        confirmLabel={ledgerT('removeAsset')}
        destructive
        onConfirm={remove}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}

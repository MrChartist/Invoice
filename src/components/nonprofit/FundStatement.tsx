/** R5-C4 fund statement for the Books period: opening, receipts, utilisation by ledger, transfers, closing. CSV + print. */
import type { Period } from '../../lib/books';
import type { Ledger } from '../../lib/ledger/postings';
import { fundStatement, fundStatementCsv } from '../../lib/nonprofit/fund-statement';
import type { Fund } from '../../lib/nonprofit/funds';
import { iT } from '../../i18n/areas/packs-institutions-r5';
import styles from '../institutions/institutions.module.css';
import { B, Tbl } from '../institutions/Views';
import { csv, rs } from '../institutions/ui';

export function FundStatement({ ledger, fund, period }: { ledger: Ledger; fund: Fund; period: Period }) {
  const s = fundStatement(ledger, fund, period);
  const h = { opening: iT('opening'), receipts: iT('receipts'), utilisation: iT('used'), tin: iT('tIn'), tout: iT('tOut'), closing: iT('closing') };
  return (
    <div className={styles.stack} data-fund-statement>
      <div className={styles.toolbar}>
        <strong>{fund.name} · {iT(`nature.${fund.fund.nature}`)} · {period.start} – {period.end}</strong>
        <B l={iT('csv')} on={() => csv(`fund-${fund.name}.csv`, fundStatementCsv(s, h))} />
        <B l={iT('print')} on={() => window.print()} />
      </div>
      <Tbl h={['', iT('amount')]} rows={[
        [h.opening, rs(s.opening)], ...s.receipts.map((x) => [`${h.receipts}: ${x.account.name}`, rs(x.amount)]), [h.tin, rs(s.transfersIn)],
        ...s.utilisation.map((x) => [`${h.utilisation}: ${x.account.name}`, rs(-x.amount)]), [h.tout, rs(-s.transfersOut)], [h.closing, rs(s.closing)],
      ]} />
      {s.negative && <p className={styles.warn}>{iT(fund.fund.nature === 'unrestricted' ? 'negativeOk' : 'overspent')}</p>}
      {fund.fund.budget ? <p className={styles.note}>{iT('budget')} {rs(fund.fund.budget)} · {iT('used')} {rs(s.utilisationTotal)}</p> : null}
    </div>
  );
}

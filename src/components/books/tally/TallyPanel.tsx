/**
 * Tally-parity Books tabs (lazy chunk loaded by Books.tsx): bill-wise payables, voucher registers
 * (optional / memorandum / post-dated / reversing) and ratio analysis.
 */
import { useMemo, useState } from 'react';
import { buildLedger, loadLedgerInput } from '../../../lib/ledger';
import type { BooksData, Period } from '../../../lib/books';
import { todayIso } from '../../../lib/tax-rules';
import { BillwiseTab } from './BillwiseTab';
import { VoucherRegistersTab } from './VoucherRegistersTab';
import { RatioTab } from './RatioTab';

export type TallyTabId = 'billwise' | 'vreg' | 'ratio';

export interface TallyPanelProps {
  tab: TallyTabId;
  data: BooksData;
  period: Period;
  asOf: string;
  onOpenAccount: (id: string, party?: string) => void;
  onChanged: () => void;
  notify: (msg: string, tone?: 'success' | 'error') => void;
}

export default function TallyPanel({ tab, data, period, asOf, onOpenAccount, onChanged, notify }: TallyPanelProps) {
  const [version, setVersion] = useState(0);
  const today = todayIso();
  const ledger = useMemo(() => {
    void version;
    return buildLedger(loadLedgerInput(data, today));
  }, [data, today, version]);
  const changed = () => {
    setVersion((v) => v + 1);
    onChanged();
  };
  return (
    <>
      {tab === 'billwise' && <BillwiseTab asOf={asOf} notify={notify} onChanged={changed} />}
      {tab === 'vreg' && <VoucherRegistersTab today={today} notify={notify} onChanged={changed} />}
      {tab === 'ratio' && <RatioTab ledger={ledger} period={period} asOf={asOf} onOpenAccount={onOpenAccount} />}
    </>
  );
}

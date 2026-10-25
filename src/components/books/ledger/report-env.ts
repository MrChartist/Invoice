/**
 * Report environment (WP-2): the ledger, the closing-stock valuer and how to open a voucher, shared by
 * every drill-down screen. `ReportEnvProvider` (ReportViews.tsx) supplies it.
 */
import { createContext, useContext } from 'react';
import { useNavigate } from 'react-router-dom';
import { voucherTarget, type Ledger, type LedgerVoucher, type StockValuer } from '../../../lib/ledger';

export interface ReportEnv {
  ledger: Ledger;
  stock?: StockValuer;
  /** Open a manual voucher in the editor (automatic ones with a page navigate there). */
  onOpenManual?: (v: LedgerVoucher) => void;
}

export const EnvContext = createContext<ReportEnv | null>(null);

export function useReportEnv(): ReportEnv {
  const env = useContext(EnvContext);
  if (!env) throw new Error('ReportEnvProvider missing');
  return env;
}

/** Open a voucher the Tally way: its document, its editor, or nothing for read-only postings. */
export function useOpenVoucher(): (v: LedgerVoucher) => void {
  const navigate = useNavigate();
  const { onOpenManual } = useReportEnv();
  return (v) => {
    const t = voucherTarget(v);
    if (t.type === 'manual') onOpenManual?.(v);
    else if (t.type === 'link') navigate(t.to);
  };
}


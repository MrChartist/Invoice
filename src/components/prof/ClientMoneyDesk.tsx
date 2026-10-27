/**
 * R14 PS-B3 client-money desk on `/time?tab=clientmoney&view=ledger|reconcile|statements` (packs `legal`, `cafirm`).
 * Each view is its own lazy chunk; they share the context below. Working paper — verify with your CA (PS27).
 */
import { Suspense, lazy, useCallback, useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { cmT } from '../../i18n/areas/prof-r14b-cm';
import { bankAccountsDb, isClientMoneyAccount, type BankAccount } from '../../lib/bank-accounts';
import { localDb } from '../../lib/localDb';
import { loadCostCentres } from '../../lib/cost-centres';
import { useToast } from '../ui/useToast';
import { Views } from '../mfg/mfd-ui';
import controls from '../../styles/controls.module.css';

const VIEWS = ['ledger', 'reconcile', 'statements'] as const;
const LedgerView = lazy(() => import('./CmLedgerView'));
const ReconcileView = lazy(() => import('./CmReconcileView'));
const StatementsView = lazy(() => import('./CmStatementsView'));

export interface CmCtx {
  version: number;
  accounts: BankAccount[];
  clients: { id: string; name: string }[];
  matters: { id: string; name: string; client_id?: string }[];
  /** Run a data-layer call; report its message or error. */
  run: (fn: () => string | void) => void;
}

type Notify = (m: string, tone?: 'success' | 'error' | 'info') => void;

export default function ClientMoneyDesk({ view, notify: outer }: { view?: string; notify?: Notify }) {
  useT();
  const v = (VIEWS as readonly string[]).includes(view ?? '') ? view! : 'ledger';
  const own = useToast();
  const notify: Notify = outer ?? ((m, tone) => own.notify(m, tone === 'info' ? 'success' : tone));
  const [version, setVersion] = useState(0);
  const run = useCallback((fn: () => string | void) => {
    try {
      const m = fn();
      if (m) notify(m);
      setVersion((x) => x + 1);
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  }, [notify]);
  const ctx = useMemo<CmCtx>(() => ({
    version,
    run,
    accounts: bankAccountsDb.active().filter((a) => isClientMoneyAccount(a)),
    clients: localDb.clients.getAll().filter((c) => c.id && c.name?.trim()).map((c) => ({ id: c.id!, name: c.name })),
    matters: loadCostCentres().filter((c) => c.active && c.kind === 'project').map((c) => ({ id: c.id, name: c.name, client_id: c.client_id })),
  }), [version, run]);
  return (
    <div data-ps-desk="clientmoney">
      <Views tab="clientmoney" views={VIEWS} view={v} label={(k) => cmT(`view.${k}` as 'view.ledger')} />
      {!ctx.accounts.length && <p className={controls.hint} role="status">{cmT('noAccount')}</p>}
      <Suspense fallback={null}>
        {v === 'ledger' && <LedgerView ctx={ctx} />}
        {v === 'reconcile' && <ReconcileView ctx={ctx} />}
        {v === 'statements' && <StatementsView ctx={ctx} />}
      </Suspense>
      <p className={controls.hint}>{cmT('wp')}</p>
      {!outer && own.toastNode}
    </div>
  );
}

/**
 * R14 PS-B3 client-money desk on `/time?tab=clientmoney&view=ledger|reconcile|statements` (packs `legal`, `cafirm`),
 * mounted by `Time.tsx` by file name. One lazy chunk with its views. Working paper — verify with your CA (PS27).
 */
import { useCallback, useMemo, useState } from 'react';
import { useT } from '../../i18n';
import { cmT } from '../../i18n/areas/prof-r14b-cm';
import { bankAccountsDb, isClientMoneyAccount, type BankAccount } from '../../lib/bank-accounts';
import { localDb } from '../../lib/localDb';
import { loadCostCentres } from '../../lib/cost-centres';
import { Views } from './ps-ui';
import type { PsDeskProps } from './ps-run';
import LedgerView from './CmLedgerView';
import ReconcileView from './CmReconcileView';
import StatementsView from './CmStatementsView';
import controls from '../../styles/controls.module.css';

const VIEWS = ['ledger', 'reconcile', 'statements'] as const;
type View = (typeof VIEWS)[number];

export interface CmCtx {
  version: number;
  accounts: BankAccount[];
  clients: { id: string; name: string }[];
  matters: { id: string; name: string; client_id?: string }[];
  /** Run a data-layer call; report its message or error. */
  run: (fn: () => string | void) => void;
}

export default function ClientMoneyDesk({ view, notify }: PsDeskProps) {
  useT();
  const v: View = (VIEWS as readonly string[]).includes(view ?? '') ? (view as View) : 'ledger';
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
    <section data-ps-desk="clientmoney">
      <Views tab="clientmoney" views={VIEWS} value={v} label={(k) => cmT(`view.${k}`)} />
      {!ctx.accounts.length && <p className={controls.hint} role="status">{cmT('noAccount')}</p>}
      {v === 'ledger' && <LedgerView ctx={ctx} />}
      {v === 'reconcile' && <ReconcileView ctx={ctx} />}
      {v === 'statements' && <StatementsView ctx={ctx} />}
      <p className={controls.hint}>{cmT('wp')}</p>
    </section>
  );
}

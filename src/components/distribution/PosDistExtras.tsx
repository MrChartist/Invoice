import { useMemo } from 'react';
import { ShieldAlert } from 'lucide-react';
import type { Client, InvoiceRecord } from '../../types/invoice';
import { getTable } from '../../lib/storage';
import { creditStatus } from '../../lib/credit-policy';
import { useT } from '../../i18n';
import { crT } from '../../i18n/areas/credit';
import { distT } from '../../i18n/areas/distribution';
import controls from '../../styles/controls.module.css';
import own from './dist.module.css';

interface AgentRow { id: string; name: string; active?: boolean }

/**
 * 8F POS additions (lazy): the sales agent on the bill and the credit notice for a saved customer
 * (the unpaid part is what adds credit). The save-time check lives in the POS save (`creditStatus`).
 */
export default function PosDistExtras({ client, record, unpaid, agentId, onAgent }: {
  client: Client | null;
  record: InvoiceRecord;
  unpaid: number;
  agentId: string;
  onAgent: (id: string) => void;
}) {
  useT();
  const agents = useMemo(() => getTable<AgentRow>('sales_agents').filter((a) => a && a.id && (a.active !== false || a.id === agentId)), [agentId]);
  const status = useMemo(() => (client ? creditStatus(record, { unpaid }) : null), [client, record, unpaid]);
  return (
    <>
      {agents.length > 0 && (
        <label className={controls.field}>
          <span className={controls.label}>{distT('salesman')}</span>
          <select className={controls.select} value={agentId} onChange={(e) => onAgent(e.target.value)} data-pos-agent>
            <option value="">{distT('noSalesman')}</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
      )}
      {status && status.check.warnings.length > 0 && (
        <div className={`${own.notice} ${status.blocked ? own.danger : ''}`} role="status" data-pos-credit={status.mode}>
          {status.check.warnings.map((w) => <p key={w} className={own.muted}><ShieldAlert size={12} aria-hidden="true" /> {w}</p>)}
          {status.blocked && <p className={own.muted}>{crT('posBlocked')}</p>}
        </div>
      )}
    </>
  );
}

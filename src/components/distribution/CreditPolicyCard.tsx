import { useState } from 'react';
import { readCreditPolicy, saveCreditPolicy, type CreditMode, type CreditPolicy } from '../../lib/credit-policy';
import { can } from '../../lib/access';
import { useT } from '../../i18n';
import { crT } from '../../i18n/areas/credit';
import controls from '../../styles/controls.module.css';
import own from './dist.module.css';

/** 8.80: the company credit policy (owner only). Per-party overrides live in Masters → Parties. */
export default function CreditPolicyCard({ onDone }: { onDone: (msg: string, error?: boolean) => void }) {
  useT();
  const [p, setP] = useState<CreditPolicy>(readCreditPolicy);
  const owner = can('settings.manage');
  const save = () => {
    try {
      saveCreditPolicy(p);
      onDone(crT('saved'));
    } catch (err) {
      onDone((err as Error).message, true);
    }
  };
  return (
    <div className={own.stack} data-credit-policy>
      <h3>{crT('policyTitle')}</h3>
      <p className={own.muted}>{crT('policyIntro')}</p>
      <div className={controls.segment} role="radiogroup" aria-label={crT('mode')}>
        {(['off', 'warn', 'block'] as CreditMode[]).map((m) => (
          <button key={m} type="button" role="radio" aria-checked={p.mode === m} disabled={!owner} className={p.mode === m ? controls.segmentBtnActive : controls.segmentBtn} onClick={() => setP({ ...p, mode: m })} data-credit-mode-btn={m}>
            {crT(m)}
          </button>
        ))}
      </div>
      <label className={controls.check}><input type="checkbox" disabled={!owner} checked={p.include_orders} onChange={(e) => setP({ ...p, include_orders: e.target.checked })} /> {crT('includeOrders')}</label>
      <label className={controls.check}><input type="checkbox" disabled={!owner} checked={p.block_overdue} onChange={(e) => setP({ ...p, block_overdue: e.target.checked })} /> {crT('blockOverdue')}</label>
      <div><button type="button" className={controls.btnPrimary} disabled={!owner} onClick={save} data-credit-save>{crT('save')}</button></div>
    </div>
  );
}

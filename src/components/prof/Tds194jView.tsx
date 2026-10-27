/**
 * PS-D3 194J by client: each client's default section (fills the expected TDS on new fee notes once the FY total passes
 * the threshold) and the certificates to chase (Form 131 / 16A) with a chase letter (print, `wa.me`, `mailto:`). The
 * chase panel (`TdsChasePanel.tsx`) is also mounted lazily in Receivables → TDS.
 */
import { useMemo } from 'react';
import { fdT } from '../../i18n/areas/prof-r14d-firm';
import { localDb } from '../../lib/localDb';
import { clientTdsDefault } from '../../lib/prof/ps-tds-recv';
import { patchClientPs } from '../../lib/prof/ps-ca-bill';
import { profKind } from '../../lib/prof/ps-d-settings';
import type { ClientTdsDefault } from '../../types/prof-r14d';
import { Tbl } from '../mfg/mfd-ui';
import type { PsDeskCtx } from './ps-desk';
import ChasePanel from './TdsChasePanel';
import controls from '../../styles/controls.module.css';

const SECTIONS: ClientTdsDefault['section'][] = ['194J', '194J-T', '194C', '194H', 'none'];

export default function Tds194jView({ ctx }: { ctx: PsDeskCtx }) {
  const clients = useMemo(() => { void ctx.tick; return localDb.clients.getAll(); }, [ctx.tick]);
  const kind = profKind();
  return (
    <>
      <p className={controls.label}>{fdT('defaults')}</p>
      <Tbl empty={fdT('none')} head={[fdT('client'), fdT('section')]} rows={clients.map((c) => {
        const d = clientTdsDefault(c, kind);
        return [c.name, (
          <select key="s" className={controls.select} value={d?.section ?? ''} onChange={(e) => ctx.run(() => patchClientPs(c.id!, { tds: e.target.value ? { section: e.target.value as ClientTdsDefault['section'] } : undefined }))} data-ps="j-section">
            <option value="">—</option>{SECTIONS.map((s) => <option key={s} value={s}>{s === 'none' ? fdT('noTds') : s}</option>)}
          </select>
        )];
      })} />
      <ChasePanel clients={clients} />
    </>
  );
}

/** MF-B4 Moulding → Balance: per run — input kg = good + rejects + runners + purge + loss; yield; regrind % against the item's limit. */
import { useMemo } from 'react';
import type { MfgContext } from '../manufacturing/context';
import { loadMoulds, loadRuns, regrindWarning, runBalance } from '../../lib/mfg/mf-runs';
import { moT as M } from '../../i18n/areas/mfg-r13b-mould';
import { Table, fmt } from './mfb-ui';

export default function BalanceView({ ctx }: { ctx: MfgContext }) {
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const d = useMemo(() => ({ runs: loadRuns(), moulds: loadMoulds() }), [ctx.version]);
  return (
    <div data-mfb-view="balance">
      <Table d="balance" empty={M('none')} head={[M('date'), M('part'), M('inputKg'), M('goodKg'), M('rejectKg'), M('runnerKg'), M('purgeKg'), M('lossKg'), M('yield'), M('regrindPct'), M('efficiency')]} rows={[...d.runs].reverse().map((r) => {
        const b = runBalance(r, d.moulds.find((m) => m.id === r.mould_id));
        const it = ctx.items.find((i) => i.id === r.item_id);
        const w = regrindWarning(b, it);
        return [r.date, it?.name ?? '—', fmt(b.input_kg), fmt(b.good_kg), fmt(b.reject_kg), fmt(b.runner_kg), fmt(b.purge_kg), <span key="l" data-mfb-loss>{fmt(b.loss_kg)}</span>, `${b.yield_pct}%`, <span key="g" title={w} data-mfb-regrind-warn={w ? '1' : undefined}>{b.regrind_pct}%{w ? ' ⚠' : ''}</span>, `${b.efficiency_pct}%`];
      })} />
    </div>
  );
}

/**
 * R17 sample rows of the manpower profile (Demo company only, R6-B4). Dispatched by the Demo company's packs
 * (`manpower` / `security`); one block per package (§6 of docs/prd/round-17.md). Pure.
 */
import type { DemoExtras } from '../demo-data';
import type { MpPost } from '../../types/manpower-r17';
import type { ProfileContext } from './profiles';

export function manpowerExtras(ctx: ProfileContext): DemoExtras {
  const { today, base } = ctx;
  const at = `${today}T09:00:00.000Z`;
  const p = (id: string, name: string, sac: string, heads: number, shift: number, rate: number): MpPost => ({ id, name, sac, heads, shift_hours: shift, basis: 'duty', rate });
  const site = (id: string, name: string, code: string, client: number, posts: MpPost[]) => ({ id, demo: true, name, kind: 'project', client_id: base.clients[client]?.id, active: true, status: 'active', start: today, created_at: at, mp: { code, contract: { from: today }, posts, status: 'active' } });
  // R17-A: a registered client's guarded tower (reverse charge for a proprietor) and a housing society (guards + housekeeping).
  const tables: NonNullable<DemoExtras['tables']> = {
    cost_centres: [
      site('demo-site-1', 'Sunrise Towers (demo)', 'S-001', 0, [p('dp1', 'Guard (12 h)', '998525', 4, 12, 800), p('dp2', 'Supervisor', '998525', 1, 12, 1000)]),
      site('demo-site-2', 'Green Park RWA (demo)', 'S-002', 1, [p('dp3', 'Guard', '998525', 2, 12, 750), p('dp4', 'Housekeeper', '998533', 1, 8, 600)]),
    ] as never[],
  };
  return { tables };
}

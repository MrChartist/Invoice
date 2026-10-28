/** R17-B fixtures: the Sunrise Towers site (4 guards 12 h at ₹800 / duty + 1 supervisor at ₹1,000) and its staff. */
import { clientMH, clientRetail } from './world.ts';
import { localDb } from '../../src/lib/localDb.ts';
import { setTable } from '../../src/lib/storage.ts';
import { saveSite } from '../../src/lib/manpower/mp-sites-io.ts';
import type { MpPost, SiteInfo } from '../../src/types/manpower-r17.ts';
import type { Site } from '../../src/lib/manpower/mp-sites.ts';

export const post = (o: Partial<MpPost> = {}): MpPost => ({ id: 'g', name: 'Guard (12 h)', sac: '998525', heads: 4, shift_hours: 12, basis: 'duty', rate: 800, ...o });
export const info = (o: Partial<SiteInfo> = {}): SiteInfo => ({ code: 'S-001', contract: { from: '2026-01-01' }, posts: [post(), post({ id: 's', name: 'Supervisor', heads: 1, rate: 1000 })], status: 'active', ...o });

/** Sunrise (registered client → RCM for a proprietor) and Green Park (unregistered → forward 18 %). */
export function world(): { sunrise: Site; green: Site } {
  localDb.clients.upsert(clientMH);
  localDb.clients.upsert({ ...clientRetail, id: 'c-rwa', name: 'Green Park RWA' });
  const sunrise = saveSite({ name: 'Sunrise Towers', client_id: clientMH.id, mp: info() });
  const green = saveSite({ name: 'Green Park RWA', client_id: 'c-rwa', mp: info({ code: 'S-002', posts: [post({ heads: 2, rate: 750 }), post({ id: 'h', name: 'Housekeeper', sac: '998533', heads: 1, shift_hours: 8, rate: 600 })] }) });
  const e = (id: string, code: string, name: string, cc?: string, postId?: string) => ({ id, code, name, tax_regime: 'new', pf: true, esi: true, pt: true, active: true, created_at: '2026-01-01', ...(cc ? { cost_centre_id: cc, mp: { post_id: postId } } : {}) });
  setTable('employees', [e('e1', 'G01', 'Ramesh', sunrise.id, 'g'), e('e2', 'G02', 'Mahesh', sunrise.id, 'g'), e('e3', 'G03', 'Dinesh', sunrise.id, 'g'), e('e4', 'G04', 'Naresh', sunrise.id, 'g'), e('e5', 'S01', 'Vikram', sunrise.id, 's'), e('e6', 'R01', 'Suresh')]);
  return { sunrise, green };
}

/** The October 2026 rows of the PRD: 30 / 30 / 31 / 28 + reliever 3 (12 h OT) and the supervisor 31. */
export const OCT_ROWS = [
  { employee_id: 'e1', post_id: 'g', duties: 30 },
  { employee_id: 'e2', post_id: 'g', duties: 30 },
  { employee_id: 'e3', post_id: 'g', duties: 31 },
  { employee_id: 'e4', post_id: 'g', duties: 28 },
  { employee_id: 'e6', post_id: 'g', duties: 3, ot_hours: 12, relief: true },
  { employee_id: 'e5', post_id: 's', duties: 31 },
];

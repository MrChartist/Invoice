/**
 * R14 sample rows of the professional profile (Demo company only, R6-B4). Dispatched by the Demo company's packs
 * (`practice` — the professional kind writes them); one block per package (§6 of docs/prd/round-14.md). Pure.
 */
import type { DemoExtras } from '../demo-data';
import type { ConflictCheck, Engagement } from '../../types/prof-r14';
import type { ServiceStaff } from '../../types/services-r10';
import type { TimeEntry } from '../../types/time';
import { shiftDay } from '../dates';
import { getIndianFY } from '../invoice-number';
import type { ProfileContext } from './profiles';

export function profExtras(ctx: ProfileContext): DemoExtras {
  const { today, packs, base } = ctx;
  const tables: NonNullable<DemoExtras['tables']> = {};
  // PS-A (practice): two timekeepers, two matters (one capped, one fixed fee over budget), a waived conflict, 14.5 h of WIP.
  if (packs.includes('practice')) {
    const client = base.clients[0];
    const fy = getIndianFY(today).label;
    const from = shiftDay(today, -60);
    const staff = (id: string, name: string, std: number, cost: number): ServiceStaff & { demo: true } => ({ id, demo: true, name, role: 'other', employment: 'employee', bookable: false, active: true, created_at: `${from}T09:00:00.000Z`, ps: { capacity_hours_week: 40, target_pct: 70, rates: [{ from, standard_rate: std, cost_rate: cost }] } });
    tables.service_staff = [staff('demo-tk-1', 'Asha (partner, demo)', 4000, 1500), staff('demo-tk-2', 'Ravi (associate, demo)', 2000, 700)];
    const code = 'DEMO/001';
    const matter = (id: string, c: string, name: string, extra: object = {}) => ({ id, demo: true, name, kind: 'project', client_id: client?.id, active: true, status: 'active', start: from, created_at: `${from}T09:00:00.000Z`, ps: { code: c, kind: 'matter', opened: from, parties: [{ name: client?.name ?? 'Client', role: 'client' }], responsible_id: 'demo-tk-1', ...extra } });
    tables.cost_centres = [matter('demo-mt-1', code, 'Sec 138 NI Act — Delhi (demo)', { court: 'Saket District Court', case_no: 'CC 1412/2026', conflict_id: 'demo-cc-1', parties: [{ name: client?.name ?? 'Client', role: 'client' }, { name: 'Shree Traders (demo)', role: 'opposite' }] }), matter('demo-mt-2', 'DEMO/002', 'Annual compliance retainer (demo)')] as never;
    const eng = (id: string, n: number, m: string, title: string, model: Engagement['model'], extra: Partial<Engagement>): Engagement & { demo: true } => ({ id, demo: true, number: `ENG/${fy}/${String(9000 + n).padStart(4, '0')}`, client_id: client?.id ?? '', matter_ids: [m], title, model, currency: 'INR', disb_policy: 'agent', start: from, status: 'active', created_at: `${from}T09:00:00.000Z`, ...extra });
    tables.engagements = [eng('demo-eng-1', 1, 'demo-mt-1', 'Cheque-bounce defence (demo)', 'capped', { cap: 40000 }), eng('demo-eng-2', 2, 'demo-mt-2', 'Compliance retainer (demo)', 'fixed', { fee: 30000 })];
    const check: ConflictCheck & { demo: true } = { id: 'demo-cc-1', demo: true, date: from, terms: ['Shree Traders'], hits: [], result: 'waived', reason: 'Unrelated matter advised in 2024 (demo)', consent_note: 'Consent letter on file', created_at: `${from}T09:00:00.000Z` };
    tables.conflict_checks = [check];
    const te = (id: string, d: number, mins: number, staffId: string, rate: number, cc: string, desc: string): TimeEntry & { demo: true } => ({ id, demo: true, client_id: client?.id, client_name: client?.name ?? '', description: desc, date: shiftDay(today, -d), minutes: mins, hourly_rate: rate, billable: true, cost_centre_id: cc, staff_id: staffId });
    tables.time_entries = [te('demo-pt-1', 20, 300, 'demo-tk-1', 4000, 'demo-mt-1', 'Drafting the reply (demo)'), te('demo-pt-2', 12, 330, 'demo-tk-1', 4000, 'demo-mt-1', 'Hearing (demo)'), te('demo-pt-3', 5, 240, 'demo-tk-1', 4000, 'demo-mt-1', 'Written arguments (demo)'), te('demo-pt-4', 8, 600, 'demo-tk-2', 2000, 'demo-mt-2', 'Monthly returns (demo)')];
  }
  // PS-B (design): a ₹4.2 crore house at 6 % in the five example stages, property in Pune.
  if (packs.includes('design') && base.clients[0]) {
    const from = shiftDay(today, -90);
    const stage = { fee_pct: 6, cost_basis: 'estimate' as const, revisions: [{ date: from, cost: 42000000 }], stages: [['s1', 'Concept design', 10], ['s2', 'Preliminary drawings and estimate', 30], ['s3', 'Working drawings and tender', 50], ['s4', 'Construction stage', 75], ['s5', 'Completion', 100]].map(([id, label, cum_pct]) => ({ id: id as string, label: label as string, cum_pct: cum_pct as number })), property: { state: 'Maharashtra', city: 'Pune', country: 'India' } };
    tables.engagements = [...(tables.engagements ?? []), { id: 'demo-eng-st', demo: true, number: `ENG/${getIndianFY(today).label}/9003`, client_id: base.clients[0].id ?? '', matter_ids: [], title: 'House at Baner, Pune (demo)', model: 'milestone', currency: 'INR', disb_policy: 'agent', start: from, status: 'active', created_at: `${from}T09:00:00.000Z`, stage } as Engagement & { demo: true }];
  }
  // PS-D (cafirm): one UDIN of a certificate this month, not yet billed (CA desk → Work to bill / UDIN register).
  if (packs.includes('cafirm') && base.clients[0]) {
    const day = shiftDay(today, -3);
    tables.udin_register = [{ id: 'demo-udin-1', demo: true, udin: `${day.slice(2, 4)}123456DEMO000001`, date: day, client_id: base.clients[0].id, client_name: base.clients[0].name, kind: 'certificate', description: 'Net worth certificate (demo)', member_no: '123456', created_at: `${day}T09:00:00.000Z` }] as never;
  }
  // PS-C: add its block here.
  return { tables };
}

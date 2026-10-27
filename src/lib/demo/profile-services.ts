/**
 * R6-B4 services profile: unbilled time on a sample project for two clients and a monthly retainer (the recurring
 * schedule is in the base dataset). Pure.
 */
import type { TimeEntry } from '../../types/time';
import type { Retainer } from '../retainers';
import type { Demo, DemoExtras } from '../demo-data';
import { shiftDay } from '../dates';
import type { ProfileContext } from './profiles';
import type { Appointment, CheckinDay, ClassSchedule, CommissionPlan, MemberPlan, Membership, ServiceStaff } from '../../types/services-r10';

const TASKS = ['Wireframes', 'Client call', 'Homepage design', 'Copy review', 'Landing page build', 'Analytics setup', 'Bug fixes', 'Handover notes'];

export function servicesExtras(ctx: ProfileContext): DemoExtras {
  const { today, base } = ctx;
  const [a, b] = base.clients;
  const entries: Demo<TimeEntry>[] = TASKS.map((task, i) => {
    const c = i % 3 === 2 ? b : a;
    return {
      id: `demo-time-${i + 1}`,
      demo: true,
      client_id: c.id,
      client_name: c.name,
      project: i % 3 === 2 ? 'Brand refresh (demo)' : 'Website revamp (demo)',
      description: task,
      date: shiftDay(today, -(20 - i * 2)),
      minutes: 60 + ((i * 45) % 180),
      hourly_rate: 3000,
      billable: i !== 1,
      created_at: `${shiftDay(today, -(20 - i * 2))}T12:00:00.000Z`,
    };
  });
  const [y, m] = shiftDay(today, -62).split('-');
  const retainer: Demo<Retainer> = {
    id: 'demo-retainer-1',
    demo: true,
    client_key: b.id!,
    client_name: b.name,
    hours_per_period: 20,
    period: 'month',
    fee: 50000,
    start: `${y}-${m}-01`,
    rollover_cap: 5,
    overage_rate: 3000,
    closes: [],
    created_at: `${y}-${m}-01T00:00:00.000Z`,
  };
  const sv = ctx.packs.some((p) => p === 'salon' || p === 'clinic' || p === 'fitness' || p === 'workshop') ? frontDeskBlock(ctx) : {}; // R10 (SV-A)
  const mc = ctx.packs.some((p) => p === 'fitness' || p === 'salon') ? membersBlock(ctx) : {}; // R10 (SV-C)
  return { tables: { time_entries: entries, retainers: [retainer], ...sv, ...mc } };
}

/* ── R10 (SV-A): the shared front desk — three staff with a commission plan and a day of appointments. SV-B … SV-D add
 * their own blocks (clinic, members, workshop) dispatched by the Demo company's packs. ── */
function frontDeskBlock({ today, base }: ProfileContext) {
  const at = `${today}T09:00:00.000Z`;
  const plan: Demo<CommissionPlan> = { id: 'demo-sv-plan', demo: true, name: 'Stylist standard (demo)', basis: 'invoice', rules: [{ kind: 'service', pct: 10 }, { kind: 'product', pct: 5 }], slab: { target: 150000, base: 'service', pct: 2, mode: 'add' }, created_at: at };
  const staff: Demo<ServiceStaff>[] = ['Priya', 'Arjun', 'Meena'].map((name, i) => ({ id: `demo-sv-staff-${i + 1}`, demo: true, name: `${name} (demo)`, role: 'stylist', employment: i === 2 ? 'freelance' : 'employee', bookable: true, active: true, plan_id: plan.id, created_at: at }));
  const svc = [{ name: 'Haircut', minutes: 30, price: 500 }, { name: 'Hair colour', minutes: 60, price: 2500 }, { name: 'Facial', minutes: 45, price: 1500 }];
  const appts: Demo<Appointment>[] = [['10:00', 0, [0]], ['11:00', 0, [0, 1]], ['10:30', 1, [2]], ['12:00', 2, [0]]].map(([start, s, list], i) => {
    const c = base.clients[i % base.clients.length];
    const services = (list as number[]).map((k) => ({ ...svc[k], tax_rate: 5, hsn: '999721', sv_class: 'beauty_9997' as const }));
    return { id: `demo-sv-appt-${i + 1}`, demo: true, date: today, start: start as string, minutes: services.reduce((n, x) => n + x.minutes, 0), client_id: c.id, client_name: c.name, services, staff_id: staff[s as number].id, status: i === 0 ? 'arrived' : 'booked', source: 'call', created_at: at };
  });
  return { appointments: appts, service_staff: staff, commission_plans: [plan] };
}

/* ── R10 (SV-C): members desk — three plans, members (one frozen, one expiring), a week of check-ins, a yoga class. ── */
function membersBlock({ today, base }: ProfileContext) {
  const at = `${today}T09:00:00.000Z`;
  const plans: Demo<MemberPlan>[] = [
    { id: 'demo-mp-1', demo: true, name: '3 months gym (demo)', kind: 'membership', months: 3, price: 4500, cls: 'fitness_9997', freeze: { max_days: 30, max_times: 2, min_days: 7 }, refund: 'pro_rata', created_at: at },
    { id: 'demo-mp-2', demo: true, name: '6 facials (demo)', kind: 'package', sessions: 6, validity_days: 180, covers: ['Facial'], price: 7500, cls: 'beauty_9997', created_at: at },
    { id: 'demo-mp-3', demo: true, name: 'PT 12 sessions (demo)', kind: 'package', sessions: 12, price: 12000, cls: 'fitness_9997', redeem_on_checkin: true, created_at: at },
  ];
  const { created_at: _c, ...p0 } = plans[0];
  void _c;
  const members: Demo<Membership>[] = base.clients.slice(0, 4).map((c, i) => {
    const start = shiftDay(today, -[20, 60, 85, 10][i]);
    return { id: `demo-mem-${i + 1}`, demo: true, number: `MEM/DEMO/${i + 1}`, client_id: c.id, client_name: c.name, plan: p0, start, end: shiftDay(start, 89 + (i === 1 ? 14 : 0)), ...(i === 1 ? { freezes: [{ from: shiftDay(today, -3), to: shiftDay(today, 10) }] } : {}), invoice_ids: [], created_at: at };
  });
  const checkins: Demo<CheckinDay>[] = [1, 2, 3, 4, 5, 6].map((d) => ({ id: `demo-ci-${d}`, demo: true, date: shiftDay(today, -d), entries: members.filter((_m, i) => i !== 1 && (d + i) % 2 === 0).map((m) => ({ client_id: m.client_id, name: m.client_name, time: `0${6 + (d % 3)}:15`, membership_id: m.id })) }));
  const yoga: Demo<ClassSchedule> = { id: 'demo-class-1', demo: true, name: 'Morning Hatha (demo)', kind: 'class', days: [0, 1, 2, 3, 4], start: '06:30', minutes: 60, capacity: 20, members: members.map((m) => m.client_id!), created_at: at };
  return { member_plans: plans, memberships: members, checkins, class_schedules: [yoga] };
}

/**
 * R6-B4 services profile: unbilled time on a sample project for two clients and a monthly retainer (the recurring
 * schedule is in the base dataset). Pure.
 */
import type { TimeEntry } from '../../types/time';
import type { Retainer } from '../retainers';
import type { Demo, DemoExtras } from '../demo-data';
import { shiftDay } from '../dates';
import type { ProfileContext } from './profiles';

const TASKS = ['Wireframes', 'Client call', 'Homepage design', 'Copy review', 'Landing page build', 'Analytics setup', 'Bug fixes', 'Handover notes'];

export function servicesExtras({ today, base }: ProfileContext): DemoExtras {
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
  return { tables: { time_entries: entries, retainers: [retainer] } };
}

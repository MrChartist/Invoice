/**
 * R5-C bell notices (fees, non-profit, leases). Loaded lazily by the notification bell (`ensureR5cAlerts`) only when
 * one of the three packs is on and its table has rows; each provider re-checks its pack on every run, so turning a
 * pack off silences it (nothing is deleted).
 */
import { registerNotificationProvider, type AppNotification } from '../notifications';
import { localDayOf } from '../dates';
import { memoOnTables } from '../table-memo';
import { peekTable } from '../storage';
import { localDb } from '../localDb';
import { isPackOn } from '../industry-packs';
import type { Client, InvoiceRecord } from '../../types/invoice';
import type { TdsCertificate } from '../tds-register';
import { iT } from '../../i18n/areas/packs-institutions-r5';
import { getLanguage } from '../../i18n/index';
import { DONATIONS_TABLE, FEE_PLANS_TABLE, FORM_10BD_TABLE, FORM_10BE_TABLE, LEASES_TABLE } from './r5c';
import { loadPlans } from './fee-plans';
import { feeNotices } from './fee-dues';
import { loadDonations } from '../nonprofit/donations';
import { loadFilings, load10be } from '../nonprofit/form-10bd';
import { npoNotices } from '../nonprofit/nonprofit-alerts';
import { tenBdText, tenBeText } from '../nonprofit/donation-receipt';
import { loadLeases } from '../property/leases';
import { leaseNotices } from '../property/lease-alerts';

let unregister: (() => void) | null = null;

export function r5cNotices(today: string, at: string): AppNotification[] {
  const s = localDb.settings.get();
  const out: AppNotification[] = [];
  const invoices = peekTable<InvoiceRecord>('invoices');
  const clients = peekTable<Client>('clients');
  if (isPackOn(s, 'fees')) {
    const f = feeNotices(loadPlans(), clients, invoices, today);
    for (const x of f.soon) out.push({ id: `fee:soon:${x.plan.id}:${x.date}`, severity: 'info', title: iT('bell.feeSoon', { plan: x.plan.name, inst: x.label, date: x.date }), detail: iT('bell.feeSoonD', { n: x.count }), href: '/recurring?tab=fees&view=bill', cta: iT('fees.bill'), at });
    if (f.overdue) out.push({ id: `fee:overdue:${f.overdue}`, severity: 'warning', title: iT('bell.feeOverdue', { n: f.overdue }), detail: iT('bell.feeOverdueD'), href: '/recurring?tab=fees&view=dues', cta: iT('fees.dues'), at });
  }
  if (isPackOn(s, 'nonprofit')) {
    const npo = localDb.settings.activeProfile()?.npo;
    for (const n of npoNotices(loadDonations(), loadFilings(), load10be(), npo, today)) {
      const d = `${n.fy ?? 0}-04-01`;
      const title = n.kind === '10bd' ? iT('bell.10bd', { form: tenBdText(d), date: n.date }) : n.kind === '10be' ? iT('bell.10be', { form: tenBeText(d), n: n.count ?? 0 }) : iT('bell.expiry', { what: n.what ?? '', date: n.date });
      out.push({ id: `npo:${n.id}`, severity: n.days < 0 ? 'critical' : 'warning', title, detail: iT('verify'), href: n.kind === 'expiry' ? '/settings' : '/receivables?tab=donations&view=form10bd', cta: iT('open'), at });
    }
  }
  if (isPackOn(s, 'leases')) {
    const names = new Map(clients.map((c) => [c.id, c.name]));
    for (const n of leaseNotices(loadLeases(), invoices, peekTable<TdsCertificate>('tds_certificates'), today)) {
      const who = n.lease ? names.get(n.lease.tenant_id) ?? '' : '';
      const title = n.kind === 'escalation' ? iT('bell.esc', { who, from: n.from ?? 0, to: n.to ?? 0, date: n.date }) : n.kind === 'lockin' ? iT('bell.lockin', { who, date: n.date }) : n.kind === 'expiry' ? iT('bell.leaseEnd', { who, date: n.date, days: n.days }) : iT('bell.cert', { n: n.count ?? 0 });
      out.push({ id: `lease:${n.id}`, severity: n.kind === 'expiry' && n.days <= 30 ? 'warning' : 'info', title, detail: iT('leasesNote'), href: n.kind === 'cert' ? '/receivables?tab=tds' : '/recurring?tab=leases&view=rentroll', cta: iT('open'), at });
    }
  }
  return out;
}

export function registerR5cAlerts(): void {
  if (unregister) return;
  unregister = registerNotificationProvider((ctx) => {
    const s = localDb.settings.get();
    const tables = [
      ...(isPackOn(s, 'fees') ? [FEE_PLANS_TABLE] : []),
      ...(isPackOn(s, 'nonprofit') ? [DONATIONS_TABLE, FORM_10BD_TABLE, FORM_10BE_TABLE] : []),
      ...(isPackOn(s, 'leases') ? [LEASES_TABLE, 'tds_certificates'] : []),
    ];
    // Pack off → nothing of this package is read.
    if (!tables.length) return [];
    const today = localDayOf(ctx.now);
    const at = ctx.now.toISOString();
    return memoOnTables('r5c:alerts', [...tables, 'invoices', 'clients', 'transactions', 'settings'], () => r5cNotices(today, at), `${today}|${getLanguage()}`) as AppNotification[];
  });
}

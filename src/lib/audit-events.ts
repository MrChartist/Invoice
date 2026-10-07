/**
 * Builders that turn a client / settings mutation into audit rows.
 * Pure (no storage); `localDb` feeds the result to `audit.record`.
 */

import type { AuditChange } from '../types/audit';
import type { Client, SenderProfile } from '../types/invoice';
import { diffClient, diffProfile, summarizeChanges, type AuditInput } from './audit';

export function clientLogged(
  kind: 'create' | 'update' | 'delete',
  before: Partial<Client> | undefined,
  after: Partial<Client> | undefined,
): AuditInput | null {
  const ref = after ?? before ?? {};
  const name = ref.name || 'client';
  if (kind === 'create') {
    return {
      entity: 'client',
      entity_id: ref.id ?? '',
      action: 'create',
      summary: `Added client ${name}${ref.gstin ? ` (${ref.gstin})` : ''}`,
      changes: [{ field: 'Name', from: null, to: name }],
    };
  }
  if (kind === 'delete') {
    return {
      entity: 'client',
      entity_id: ref.id ?? '',
      action: 'delete',
      summary: `Deleted client ${name}`,
      changes: [{ field: 'Name', from: name, to: null }],
    };
  }
  const changes = diffClient(before ?? {}, after ?? {});
  if (!changes.length) return null;
  return {
    entity: 'client',
    entity_id: ref.id ?? '',
    action: 'update',
    summary: `Edited client ${name}: ${summarizeChanges(changes)}`,
    changes,
  };
}

/** Subset of AppSettings the log cares about (structural, so this file never imports localDb). */
export interface LoggedSettings {
  profiles: SenderProfile[];
  activeProfileId: string;
  defaultCurrency: string;
  defaultTaxRate: number;
  invoicePrefix: string;
  defaultDueDays: number;
  roundOff: boolean;
  lock_until?: string;
}

function change(out: AuditChange[], field: string, from: string | null, to: string | null) {
  if ((from ?? '') !== (to ?? '')) out.push({ field, from: from || null, to: to || null });
}

/** Everything a settings save changed, as ready-to-record rows. */
export function settingsLogged(before: LoggedSettings, after: LoggedSettings): AuditInput[] {
  const out: AuditInput[] = [];

  const beforeById = new Map(before.profiles.map((p) => [p.id, p]));
  const afterIds = new Set(after.profiles.map((p) => p.id));
  for (const p of after.profiles) {
    const prev = beforeById.get(p.id);
    if (!prev) {
      out.push({
        entity: 'profile',
        entity_id: p.id ?? '',
        action: 'create',
        summary: `Added business profile ${p.companyName || 'Untitled'}`,
        changes: [{ field: 'Business name', from: null, to: p.companyName || null }],
      });
      continue;
    }
    const changes = diffProfile(prev, p);
    if (changes.length) {
      out.push({
        entity: 'profile',
        entity_id: p.id ?? '',
        action: 'update',
        summary: `Edited profile ${p.companyName || prev.companyName || 'Untitled'}: ${summarizeChanges(changes)}`,
        changes,
      });
    }
  }
  for (const p of before.profiles) {
    // The untouched starter profile of a fresh install is not worth a log row.
    if (!afterIds.has(p.id) && p.companyName.trim()) {
      out.push({
        entity: 'profile',
        entity_id: p.id ?? '',
        action: 'delete',
        summary: `Deleted business profile ${p.companyName || 'Untitled'}`,
        changes: [{ field: 'Business name', from: p.companyName || null, to: null }],
      });
    }
  }

  const changes: AuditChange[] = [];
  const nameOf = (id: string, s: LoggedSettings) => s.profiles.find((p) => p.id === id)?.companyName || null;
  if (before.activeProfileId !== after.activeProfileId) {
    change(changes, 'Default profile', nameOf(before.activeProfileId, before), nameOf(after.activeProfileId, after));
  }
  change(changes, 'Currency', before.defaultCurrency, after.defaultCurrency);
  change(changes, 'Default GST rate', `${before.defaultTaxRate}%`, `${after.defaultTaxRate}%`);
  change(changes, 'Number prefix', before.invoicePrefix, after.invoicePrefix);
  change(changes, 'Due in (days)', String(before.defaultDueDays), String(after.defaultDueDays));
  change(changes, 'Round to rupee', before.roundOff ? 'On' : 'Off', after.roundOff ? 'On' : 'Off');
  if (changes.length) {
    out.push({
      entity: 'settings',
      entity_id: 'defaults',
      action: 'update',
      summary: `Changed defaults: ${summarizeChanges(changes)}`,
      changes,
    });
  }

  const lockBefore = before.lock_until || '';
  const lockAfter = after.lock_until || '';
  if (lockBefore !== lockAfter) {
    const raised = lockAfter !== '' && (lockBefore === '' || lockAfter > lockBefore);
    out.push({
      entity: 'settings',
      entity_id: 'lock_until',
      action: raised ? 'lock' : 'unlock',
      summary: raised
        ? `Books locked up to ${lockAfter}${lockBefore ? ` (was ${lockBefore})` : ''}`
        : lockAfter
          ? `Lock moved earlier: ${lockBefore} → ${lockAfter}`
          : `Period lock removed (was ${lockBefore})`,
      changes: [{ field: 'Locked up to', from: lockBefore || null, to: lockAfter || null }],
    });
  }
  return out;
}

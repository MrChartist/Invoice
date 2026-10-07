import type { AuditAction } from '../../types/audit';

export type Tone = 'neutral' | 'good' | 'bad' | 'lock';

export function toneOf(action: AuditAction): Tone {
  switch (action) {
    case 'create':
    case 'payment_add':
    case 'reinstate':
      return 'good';
    case 'delete':
    case 'cancel':
    case 'payment_remove':
      return 'bad';
    case 'lock':
    case 'unlock':
    case 'override':
    case 'restore':
      return 'lock';
    default:
      return 'neutral';
  }
}

/** "7 Oct 2026, 3:42 pm" in the user's locale. */
export function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  try {
    return d.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return d.toISOString();
  }
}

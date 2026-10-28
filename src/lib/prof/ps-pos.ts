/**
 * R14 PS-C1: place of supply of a cross-border service (Sec 13 IGST Act) for the export check. Default Sec 13(2), the
 * recipient's location; the exceptions are flagged by the engagement / document class: immovable property (13(4), the
 * property's location — PS6), services needing physical presence or on goods made available (13(3), where performed),
 * events (13(5), where held) and intermediary services (13(8)(b) by the dated rule — PS4). Pure; verify with your CA.
 */
import { intermediaryPos } from '../prof-rules';
/** The dated intermediary rule, for readers outside `lib/prof` (the R8 indent note). */
export { intermediaryPos };

export type PosClass = 'general' | 'property' | 'physical' | 'event' | 'intermediary';
export const POS_CLASSES: readonly PosClass[] = ['general', 'property', 'physical', 'event', 'intermediary'];

export interface PosFacts {
  cls?: PosClass;
  /** Property's GST state code (`96` = outside India) for 13(4). */
  propertyState?: string;
  /** 13(3) / 13(5): performed / held outside India (absent = not known). */
  abroad?: boolean;
  /** Recipient is outside India (from condition (ii)); null = not known. */
  recipientAbroad: boolean | null;
}

/** `true` = place of supply outside India; `false` = in India; `null` = not known. With the reason key. */
export function servicePos(f: PosFacts, date?: string): { abroad: boolean | null; reason: string } {
  const cls = f.cls ?? 'general';
  if (cls === 'property') {
    const s = String(f.propertyState ?? '');
    return { abroad: s ? s === '96' : null, reason: 'posProperty' };
  }
  if (cls === 'physical' || cls === 'event') return { abroad: f.abroad ?? null, reason: cls === 'event' ? 'posEvent' : 'posPhysical' };
  if (cls === 'intermediary' && intermediaryPos(date) === 'supplier') return { abroad: false, reason: 'posIntermediaryOld' };
  return { abroad: f.recipientAbroad, reason: cls === 'intermediary' ? 'posIntermediaryNew' : 'pos132' };
}

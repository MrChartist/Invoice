/**
 * AG-A4 farmer slips on WhatsApp: the slip text in the farmer's language (`ag.language`, Hindi or English) and a
 * `wa.me` link — nothing is sent by the app; the "send all" queue walks the farmers one tap at a time.
 */
import type { FarmerCycle, FarmerCycleLine } from '../../types/agri-r12';
import { whatsappLink } from '../share';

const rs = (n: unknown) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export function slipText(c: Pick<FarmerCycle, 'number' | 'period_from' | 'period_to'>, l: FarmerCycleLine, business: string, lang: 'en' | 'hi' = 'en'): string {
  const ded = l.deductions.reduce((s, d) => s + (Number(d.amount) || 0), 0);
  return lang === 'hi'
    ? `${business}: ${l.name ?? ''} — भुगतान ${c.period_from} से ${c.period_to} (${c.number})\nमात्रा ${l.qty} ${l.unit}, राशि ${rs(l.amount)}${ded ? `, कटौती ${rs(ded)}` : ''}\nशुद्ध भुगतान ${rs(l.net)}`
    : `${business}: ${l.name ?? ''} — payment for ${c.period_from} to ${c.period_to} (${c.number})\nQty ${l.qty} ${l.unit}, amount ${rs(l.amount)}${ded ? `, deductions ${rs(ded)}` : ''}\nNet paid ${rs(l.net)}`;
}

export const slipWaLink = (phone: string | undefined, text: string): string => whatsappLink(phone, text);

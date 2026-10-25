import { useInvoiceStore } from '../../store/useInvoiceStore';
import { localDb } from '../../lib/localDb';
import { addressToShipTo, contactToAttention, defaultShipTo, primaryContact } from '../../lib/contacts';
import type { Client } from '../../types/invoice';
import type {} from '../../types/contacts';

/** The client master behind the document's party (by id, else by name). */
export function masterOf(c: Pick<Client, 'id' | 'name'>): Client | undefined {
  const all = localDb.clients.getAll();
  const key = (c.name ?? '').trim().toLowerCase();
  return (c.id ? all.find((x) => x.id === c.id) : undefined) ?? (key ? all.find((x) => (x.name ?? '').trim().toLowerCase() === key) : undefined);
}

/**
 * When a party is picked on a NEW document: its default ship-to and primary contact are filled in
 * (an existing document keeps what it was issued with — Critical Rule 3).
 */
export function applyPartyDefaults(c: Client): void {
  const st = useInvoiceStore.getState();
  if (st.id) return;
  const master = masterOf(c) ?? c;
  const addr = defaultShipTo(master);
  const contact = primaryContact(master);
  st.patch({
    ship_to: addr ? addressToShipTo(addr, master) : st.ship_to,
    attention: contact ? contactToAttention(contact) : undefined,
  });
}


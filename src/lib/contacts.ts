/**
 * R2-B4: contact persons and the ship-to address book of a party, and the "Kind attn." snapshot.
 *
 *  - A party has any number of contacts (one primary) and delivery addresses (one default ship-to).
 *  - Picking an address on a document fills `ship_to` (the e-Way bill / e-Invoice ShipDtls keep reading
 *    `invoice.ship_to`; the place-of-supply logic is unchanged).
 *  - Picking a contact snapshots `attention` on the document: editing the contact later never changes
 *    what an issued document prints (Critical Rule 3).
 *  - `partyRecipients` lists who statements / reminders should go to (wiring into the reminder screen
 *    is a follow-up).
 *  - Client CSV export carries the first contact / address as `contact_*` / `address_*` columns, which
 *    the client import reads back (`importers.ts`).
 *
 * Pure: no storage.
 */

import type { Client, ShipTo } from '../types/invoice';
import type { AttentionSnapshot, ContactPerson, PartyAddress } from '../types/contacts';
import { resolveStateCode, stateByCode } from './india-states';
import { toCsv } from './csv';

const clean = (s: unknown): string => String(s ?? '').trim();
const key = (s: unknown): string => clean(s).toLowerCase().replace(/\s+/g, ' ');
const digits = (s: unknown): string => clean(s).replace(/\D/g, '');

let seq = 0;
/** Short local id for a contact / address row (unique within one party). */
export function newRowId(prefix: 'ct' | 'ad'): string {
  seq = (seq + 1) % 1e6;
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/* ── Contacts ───────────────────────────────────────────────────── */

/** Trimmed contacts without blank names; at most one primary (the first one marked). */
export function normalizeContacts(list: readonly Partial<ContactPerson>[] | undefined): ContactPerson[] {
  const out: ContactPerson[] = [];
  let primarySeen = false;
  for (const c of list ?? []) {
    const name = clean(c?.name);
    if (!name) continue;
    const row: ContactPerson = { id: clean(c.id) || newRowId('ct'), name };
    if (clean(c.role)) row.role = clean(c.role);
    if (clean(c.phone)) row.phone = clean(c.phone);
    if (clean(c.email)) row.email = clean(c.email);
    if (c.primary && !primarySeen) {
      row.primary = true;
      primarySeen = true;
    }
    if (c.statements) row.statements = true;
    out.push(row);
  }
  return out;
}

/** The marked primary contact, else the first one. */
export function primaryContact(client: Pick<Client, 'contacts'> | null | undefined): ContactPerson | undefined {
  const list = client?.contacts ?? [];
  return list.find((c) => c.primary) ?? list[0];
}

/** Make `id` the only primary contact. */
export function setPrimary(list: readonly ContactPerson[], id: string): ContactPerson[] {
  return list.map((c) => {
    const next = { ...c };
    if (c.id === id) next.primary = true;
    else delete next.primary;
    return next;
  });
}

/** The "Kind attn." snapshot for a contact (copied fields only, no id). */
export function contactToAttention(c: Pick<ContactPerson, 'name' | 'role' | 'phone' | 'email'>): AttentionSnapshot {
  const out: AttentionSnapshot = { name: clean(c.name) };
  if (clean(c.role)) out.role = clean(c.role);
  if (clean(c.phone)) out.phone = clean(c.phone);
  if (clean(c.email)) out.email = clean(c.email);
  return out;
}

/** "Kind attn.: R. Iyer, Accounts" text (without the label); '' when nothing to print. */
export function attentionText(att: Partial<AttentionSnapshot> | null | undefined): string {
  if (!att || !clean(att.name)) return '';
  return [clean(att.name), clean(att.role)].filter(Boolean).join(', ');
}

export interface Recipient {
  name: string;
  phone?: string;
  email?: string;
}

/**
 * Who statements / payment reminders go to: contacts ticked "send statements", else the primary
 * contact, else the party's own phone / e-mail. Contacts with neither a phone nor an e-mail are skipped.
 */
export function partyRecipients(client: Pick<Client, 'name' | 'phone' | 'email' | 'contacts'>): Recipient[] {
  const reachable = (c: ContactPerson) => !!(clean(c.phone) || clean(c.email));
  const list = (client.contacts ?? []).filter(reachable);
  const ticked = list.filter((c) => c.statements);
  const chosen = ticked.length ? ticked : list.filter((c) => c.primary).slice(0, 1);
  const out: Recipient[] = chosen.map((c) => ({ name: c.name, ...(clean(c.phone) ? { phone: clean(c.phone) } : {}), ...(clean(c.email) ? { email: clean(c.email) } : {}) }));
  if (out.length) return out;
  if (clean(client.phone) || clean(client.email)) {
    return [{ name: clean(client.name), ...(clean(client.phone) ? { phone: clean(client.phone) } : {}), ...(clean(client.email) ? { email: clean(client.email) } : {}) }];
  }
  return [];
}

/** Extra text the client typeahead matches: contact names and phones (also digits only). */
export function contactSearchFields(client: Pick<Client, 'contacts'>): string[] {
  const out: string[] = [];
  for (const c of client.contacts ?? []) {
    out.push(c.name);
    if (c.phone) out.push(c.phone, digits(c.phone));
    if (c.email) out.push(c.email);
  }
  return out.filter(Boolean);
}

/* ── Addresses ──────────────────────────────────────────────────── */

/** Trimmed addresses (a label or an address line is needed); state code from the GSTIN when missing; one default. */
export function normalizeAddresses(list: readonly Partial<PartyAddress>[] | undefined): PartyAddress[] {
  const out: PartyAddress[] = [];
  let defaultSeen = false;
  for (const a of list ?? []) {
    const label = clean(a?.label);
    const address = clean(a?.address);
    if (!label && !address) continue;
    const gstin = clean(a.gstin).toUpperCase();
    const state = resolveStateCode({ code: clean(a.state_code), gstin });
    const row: PartyAddress = { id: clean(a.id) || newRowId('ad'), label: label || address.split('\n')[0].slice(0, 40) };
    if (address) row.address = address;
    if (clean(a.city)) row.city = clean(a.city);
    if (digits(a.zip)) row.zip = digits(a.zip).slice(0, 6);
    if (state) row.state_code = state;
    if (gstin) row.gstin = gstin;
    if (a.default_ship_to && !defaultSeen) {
      row.default_ship_to = true;
      defaultSeen = true;
    }
    out.push(row);
  }
  return out;
}

/** The address marked as default ship-to (none when none is marked). */
export function defaultShipTo(client: Pick<Client, 'addresses'> | null | undefined): PartyAddress | undefined {
  return (client?.addresses ?? []).find((a) => a.default_ship_to);
}

/** `ship_to` for a document from an address-book entry. The consignee name is the party's. */
export function addressToShipTo(addr: PartyAddress, client: Pick<Client, 'name' | 'company'>): ShipTo {
  const state_code = resolveStateCode({ code: addr.state_code, gstin: addr.gstin });
  const out: ShipTo = { name: clean(client.company) || clean(client.name) };
  if (addr.address) out.address = addr.address;
  if (addr.city) out.city = addr.city;
  if (addr.zip) out.zip = addr.zip;
  if (state_code) out.state_code = state_code;
  if (addr.gstin) out.gstin = addr.gstin;
  return out;
}

/** Same delivery place (address + PIN + GSTIN, case / space insensitive). */
const sameAddress = (a: Pick<PartyAddress, 'address' | 'zip' | 'gstin'>, b: Pick<ShipTo, 'address' | 'zip' | 'gstin'>) =>
  key(a.address) === key(b.address) && digits(a.zip) === digits(b.zip) && key(a.gstin) === key(b.gstin);

/**
 * "Save this ship-to to the party": the client's address book with `ship` added (or unchanged when the
 * same address is already there). Returns the new list and whether it changed.
 */
export function addShipToAddressBook(client: Pick<Client, 'addresses'>, ship: ShipTo, label?: string): { addresses: PartyAddress[]; added: boolean } {
  const list = client.addresses ?? [];
  if (!clean(ship.address)) return { addresses: [...list], added: false };
  if (list.some((a) => sameAddress(a, ship))) return { addresses: [...list], added: false };
  const city = clean(ship.city);
  const next = normalizeAddresses([
    ...list,
    {
      label: clean(label) || [city, stateByCode(ship.state_code)?.name].filter(Boolean).join(', ') || clean(ship.address).split('\n')[0],
      address: ship.address, city: ship.city, zip: ship.zip, state_code: ship.state_code, gstin: ship.gstin,
    },
  ]);
  return { addresses: next, added: true };
}

/** Address list with `id` as the only default ship-to (or none with `undefined`). */
export function setDefaultShipTo(list: readonly PartyAddress[], id: string | undefined): PartyAddress[] {
  return list.map((a) => {
    const next = { ...a };
    if (id && a.id === id) next.default_ship_to = true;
    else delete next.default_ship_to;
    return next;
  });
}

/* ── Import / export (first contact / address per party) ────────── */

export const CLIENT_CSV_HEADERS = [
  'Name', 'Company', 'GSTIN', 'Email', 'Phone', 'Address', 'City', 'State', 'PIN code', 'Notes',
  'contact_name', 'contact_role', 'contact_phone', 'contact_email',
  'address_label', 'address_line', 'address_city', 'address_pin', 'address_state', 'address_gstin',
] as const;

/** Client list as CSV (the first contact and address in their own columns; the client import reads them back). */
export function clientsCsv(clients: readonly Client[]): string {
  const rows: unknown[][] = [[...CLIENT_CSV_HEADERS]];
  for (const c of clients) {
    const ct = primaryContact(c);
    const ad = defaultShipTo(c) ?? c.addresses?.[0];
    rows.push([
      c.name, c.company ?? '', c.gstin ?? '', c.email ?? '', c.phone ?? '', c.address ?? '', c.city ?? '',
      c.state_code ? stateByCode(c.state_code)?.name ?? c.state ?? '' : c.state ?? '', c.zip ?? '', c.notes ?? '',
      ct?.name ?? '', ct?.role ?? '', ct?.phone ?? '', ct?.email ?? '',
      ad?.label ?? '', ad?.address ?? '', ad?.city ?? '', ad?.zip ?? '', ad?.state_code ? stateByCode(ad.state_code)?.name ?? ad.state_code : '', ad?.gstin ?? '',
    ]);
  }
  return toCsv(rows);
}

/**
 * Contacts / addresses read from an import row merged into what the party already has: rows already
 * present (same name / same address) are not added twice, nothing existing is removed.
 */
export function mergeImported(existing: Pick<Client, 'contacts' | 'addresses'> | undefined, incoming: Pick<Client, 'contacts' | 'addresses'>): Pick<Client, 'contacts' | 'addresses'> {
  const contacts = [...(existing?.contacts ?? [])];
  for (const c of incoming.contacts ?? []) {
    if (!contacts.some((x) => key(x.name) === key(c.name))) contacts.push(c);
  }
  const addresses = [...(existing?.addresses ?? [])];
  for (const a of incoming.addresses ?? []) {
    if (!addresses.some((x) => sameAddress(x, a))) addresses.push(a);
  }
  return {
    ...(contacts.length ? { contacts: normalizeContacts(contacts) } : {}),
    ...(addresses.length ? { addresses: normalizeAddresses(addresses) } : {}),
  };
}

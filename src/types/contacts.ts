/**
 * R2-B4: contact persons and a ship-to address book per party, plus the "Kind attn." snapshot on a
 * document. The fields are added to `Client` / `InvoiceRecord` by declaration merging (the shared
 * `invoice.ts` is owned by another work package, see docs/prd/round-2.md §6). All fields are additive.
 */

/** One person at a party (accounts, purchase, plant …). */
export interface ContactPerson {
  id: string;
  name: string;
  /** Designation / desk, printed after the name ("Kind attn.: R. Iyer, Accounts"). */
  role?: string;
  phone?: string;
  email?: string;
  /** The party's main contact (at most one; the first contact when none is marked). */
  primary?: boolean;
  /** Send statements / payment reminders to this person (`partyRecipients`). */
  statements?: boolean;
}

/** One delivery address (plant / branch / warehouse) of a party. */
export interface PartyAddress {
  id: string;
  /** Short name shown in the picker ("Plant 2 — Chakan"). */
  label: string;
  address?: string;
  city?: string;
  zip?: string;
  /** Two-digit GST state code (decides the place of supply when the goods go here). */
  state_code?: string;
  /** GSTIN of that unit, if it has its own registration. */
  gstin?: string;
  /** Pre-selected as the ship-to on new documents (at most one). */
  default_ship_to?: boolean;
}

/** "Kind attn." snapshot frozen on the document: later edits of the contact never change it (Critical Rule 3). */
export interface AttentionSnapshot {
  name: string;
  role?: string;
  phone?: string;
  email?: string;
}

declare module './invoice' {
  interface Client {
    /** Additive (R2-B4): contact persons of this party (master only, never on a document snapshot). */
    contacts?: ContactPerson[];
    /** Additive (R2-B4): delivery address book (master only). */
    addresses?: PartyAddress[];
  }
  interface InvoiceRecord {
    /** Additive (R2-B4): the contact person the document is addressed to ("Kind attn."). */
    attention?: AttentionSnapshot;
  }
}

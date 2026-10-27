/**
 * R14 PS-B4 place of supply for services directly in relation to immovable property (architects, interior designers,
 * surveyors): the property's location — Sec 12(3) IGST when the supplier and the property are in India, Sec 13(4) for a
 * foreign recipient — so a house in Pune designed for a client in Dubai is a supply in Maharashtra, not an export. For
 * property outside India: the location of the recipient. The suggestion fills the invoice once; the user can change it.
 * PS-C's export check reads `isPropertyExport`. Working paper — verify with your CA (PS6).
 */
import { resolveStateCode } from '../india-states';

export interface PropertyLike {
  state?: string;
  city?: string;
  /** ISO / name; empty, "IN" or "India" = in India. */
  country?: string;
}

export const inIndia = (country: string | undefined): boolean => {
  const c = String(country ?? '').trim().toLowerCase();
  return !c || c === 'in' || c === 'ind' || c === 'india' || c === 'bharat';
};

export interface PropertyPos {
  /** Two-digit place-of-supply code ('96' other countries); '' when the property's State is not known. */
  pos: string;
  basis: 'property' | 'recipient';
  /** True only when neither the property nor the recipient is in India. */
  exportPossible: boolean;
}

/** Place of supply for a service on immovable property. */
export function propertyPos(property: PropertyLike, recipient: { state_code?: string; gstin?: string; state?: string; country?: string }): PropertyPos {
  if (inIndia(property.country)) {
    return { pos: resolveStateCode({ code: property.state, name: property.state }), basis: 'property', exportPossible: false };
  }
  const foreignRecipient = !inIndia(recipient.country) || recipient.state_code === '96' || recipient.state_code === '99';
  const pos = foreignRecipient ? '96' : resolveStateCode({ code: recipient.state_code, gstin: recipient.gstin, name: recipient.state });
  return { pos, basis: 'recipient', exportPossible: foreignRecipient };
}

/** For PS-C's Sec 2(6) check: a property in India means "place of supply in India — not an export". */
export const isPropertyExport = (property: PropertyLike | null | undefined, recipient: Parameters<typeof propertyPos>[1]): boolean =>
  !!property && propertyPos(property, recipient).exportPossible;

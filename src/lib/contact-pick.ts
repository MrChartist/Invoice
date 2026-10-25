/**
 * "Add party from contacts" (roadmap 8.24): the Contact Picker API (Android Chrome; feature-detected,
 * nothing elsewhere). The browser shows its own chooser; only the one contact the user picks reaches
 * the form, and nothing is stored until the party is saved. Pure mapping + a thin browser call.
 */

export interface PickedContact {
  name?: string[];
  tel?: string[];
  email?: string[];
  address?: { addressLine?: string[]; city?: string; region?: string; postalCode?: string; country?: string }[];
}

export interface ContactFields {
  name: string;
  phone: string;
  email: string;
  address: string;
  city?: string;
  zip?: string;
}

const first = (v: string[] | undefined) => (v ?? []).map((s) => String(s ?? '').trim()).find(Boolean) ?? '';

/** Form fields from a picked contact (first non-empty value of each). */
export function contactToFields(c: PickedContact): ContactFields {
  const a = c.address?.[0];
  const pin = a?.postalCode?.replace(/\s/g, '') ?? '';
  return {
    name: first(c.name),
    phone: first(c.tel),
    email: first(c.email),
    address: [...(a?.addressLine ?? []), a?.region].map((s) => String(s ?? '').trim()).filter(Boolean).join(', '),
    ...(a?.city?.trim() ? { city: a.city.trim() } : {}),
    ...(/^\d{6}$/.test(pin) ? { zip: pin } : {}),
  };
}

interface ContactsManager {
  select(props: string[], opts?: { multiple?: boolean }): Promise<PickedContact[]>;
  getProperties?(): Promise<string[]>;
}

const manager = (): ContactsManager | null => {
  const nav = (typeof navigator !== 'undefined' ? navigator : undefined) as (Navigator & { contacts?: ContactsManager }) | undefined;
  return nav?.contacts && typeof nav.contacts.select === 'function' ? nav.contacts : null;
};

export const contactPickerSupported = (): boolean => manager() !== null;

/** Open the phone's contact chooser (from a click). Null when cancelled or unsupported. */
export async function pickContact(): Promise<ContactFields | null> {
  const m = manager();
  if (!m) return null;
  let props = ['name', 'tel', 'email'];
  try {
    const available = (await m.getProperties?.()) ?? props;
    props = ['name', 'tel', 'email', 'address'].filter((p) => available.includes(p));
  } catch {
    /* older implementations: ask for the basics */
  }
  const picked = await m.select(props, { multiple: false });
  return picked[0] ? contactToFields(picked[0]) : null;
}

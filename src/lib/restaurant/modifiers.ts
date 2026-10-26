/**
 * Modifiers / add-ons and "86" (not available today) — R3-A4. Pure.
 *
 *  - A modifier group (name, min / max picks, options) applies to catalogue items or stock groups.
 *    Required groups (min > 0) block adding until picked.
 *  - A priced option becomes a CHILD line (`modifier_of` = parent line id) with the parent's HSN and
 *    GST, so GST stays right per line — unless the option maps to its own catalogue item, whose HSN /
 *    GST / unit it then uses (and stock, being a named item). Free options become a note printed on
 *    the KOT and the bill.
 *  - "Not available today" is `unavailable_on: 'YYYY-MM-DD'` (local day) on the catalogue row; it
 *    clears itself the next day because only today's date counts. A group toggle marks many at once.
 *  - Optional auto-86 at zero stock for tracked items: on hand (base units) minus what live orders
 *    already hold (quantity × `lineFactor`, alternate units) ≤ 0.
 */
import type { InvoiceItem } from '../../types/invoice';
import type { ModifierGroup, ModifierOption, OrderLine } from '../../types/restaurant';
import { num, round2 } from '../invoice-calc';
import { lineFactor } from '../units';

export type Picks = Record<string, string[]>;

/** Groups that apply to an item (by catalogue id, or by its stock group). */
export function groupsFor(item: Pick<InvoiceItem, 'id'> & { group_id?: string }, groups: readonly ModifierGroup[]): ModifierGroup[] {
  return groups.filter((g) => (item.id && g.item_ids?.includes(item.id)) || (item.group_id && g.group_ids?.includes(item.group_id)));
}

/** Errors for the picks against min / max (empty = fine). */
export function validatePicks(groups: readonly ModifierGroup[], picks: Picks): string[] {
  const errors: string[] = [];
  for (const g of groups) {
    const chosen = (picks[g.id] ?? []).filter((id) => g.options.some((o) => o.id === id));
    const min = Math.max(Math.floor(num(g.min)), 0);
    const max = Math.max(Math.floor(num(g.max)), 0);
    if (chosen.length < min) errors.push(min === 1 ? `Pick one ${g.name}.` : `Pick at least ${min} in ${g.name}.`);
    if (max > 0 && chosen.length > max) errors.push(max === 1 ? `Only one ${g.name}.` : `At most ${max} in ${g.name}.`);
  }
  return errors;
}

/** Errors in a modifier group master (empty = fine). */
export function validateGroup(g: Pick<ModifierGroup, 'name' | 'min' | 'max' | 'options'>): string[] {
  const errors: string[] = [];
  if (!g.name.trim()) errors.push('Give the group a name.');
  if (!g.options.length) errors.push('Add at least one option.');
  if (g.options.some((o) => !o.name.trim())) errors.push('Every option needs a name.');
  if (g.options.some((o) => !(num(o.price) >= 0))) errors.push('Option prices cannot be negative.');
  const min = num(g.min);
  const max = num(g.max);
  if (min < 0 || max < 0) errors.push('Min and max cannot be negative.');
  if (max > 0 && min > max) errors.push('Min cannot be more than max.');
  if (min > g.options.length) errors.push('Min is more than the options there are.');
  return errors;
}

export interface ModifierResult {
  /** Priced options as child lines (no ids / parent yet: `addItem` links them). */
  children: OrderLine[];
  /** Free options joined: "Jain, less spicy". */
  note: string;
}

/**
 * Child lines and the note for the picked options of a parent line. A priced option without its own
 * item inherits the parent's HSN, GST and cess; a mapped option uses its catalogue item.
 */
export function modifierLines(
  parent: Pick<OrderLine, 'hsn' | 'tax_rate' | 'cess_rate' | 'quantity' | 'type' | 'unit'>,
  groups: readonly ModifierGroup[],
  picks: Picks,
  catalog: readonly InvoiceItem[],
  newId: () => string,
): ModifierResult {
  const children: OrderLine[] = [];
  const free: string[] = [];
  const qty = num(parent.quantity) > 0 ? num(parent.quantity) : 1;
  for (const g of groups) {
    for (const id of picks[g.id] ?? []) {
      const o: ModifierOption | undefined = g.options.find((x) => x.id === id);
      if (!o) continue;
      const price = round2(Math.max(num(o.price), 0));
      if (price <= 0) {
        free.push(o.name.trim());
        continue;
      }
      const own = o.item_id ? catalog.find((c) => c.id === o.item_id) : undefined;
      const line: OrderLine = own
        ? {
            id: newId(), name: own.name, type: own.type || 'Product', hsn: own.hsn ?? '', unit: own.unit || 'NOS',
            quantity: qty, rate: price, amount: round2(qty * price), item_id: own.id, option_id: o.id,
            ...(typeof own.tax_rate === 'number' ? { tax_rate: own.tax_rate } : typeof parent.tax_rate === 'number' ? { tax_rate: parent.tax_rate } : {}),
            ...(num(own.cess_rate) > 0 ? { cess_rate: num(own.cess_rate) } : {}),
          }
        : {
            id: newId(), name: o.name.trim(), type: parent.type || 'Product', hsn: parent.hsn ?? '', unit: 'NOS',
            quantity: qty, rate: price, amount: round2(qty * price), option_id: o.id,
            ...(typeof parent.tax_rate === 'number' ? { tax_rate: parent.tax_rate } : {}),
            ...(num(parent.cess_rate) > 0 ? { cess_rate: num(parent.cess_rate) } : {}),
          };
      children.push(line);
    }
  }
  return { children, note: free.filter(Boolean).join(', ') };
}

/* ── 86: not available today ─────────────────────────────────── */

export const isUnavailable = (item: Pick<InvoiceItem, 'unavailable_on'> | null | undefined, day: string): boolean => !!item && item.unavailable_on === day;

/** Switch items off (or back on) for `day`. Returns the whole catalogue with those rows patched. */
export function set86(catalog: readonly InvoiceItem[], ids: readonly string[], off: boolean, day: string): InvoiceItem[] {
  const want = new Set(ids);
  return catalog.map((c) => {
    if (!want.has(c.id)) return c;
    const next = { ...c };
    if (off) next.unavailable_on = day;
    else delete next.unavailable_on;
    return next;
  });
}

/** Catalogue ids in a stock group (by the item's own `group_id`, else its stock item's, matched by name). */
export function idsInGroup(catalog: readonly InvoiceItem[], stock: readonly { name: string; group_id?: string }[], groupId: string, groups: readonly { id: string; parent_id?: string }[] = []): string[] {
  const inTree = (id: string | undefined): boolean => {
    const seen = new Set<string>();
    let cur = id;
    while (cur && !seen.has(cur)) {
      if (cur === groupId) return true;
      seen.add(cur);
      cur = groups.find((g) => g.id === cur)?.parent_id;
    }
    return false;
  };
  const stockGroup = new Map(stock.map((s) => [s.name.trim().toLowerCase(), s.group_id]));
  return catalog.filter((c) => inTree(c.group_id ?? stockGroup.get(c.name.trim().toLowerCase()))).map((c) => c.id);
}

/**
 * Auto-86 at zero stock (optional, tracked items only): `onHandBase` is the stock in the item's base
 * unit; `held` are live order lines of that item (quantity × lineFactor).
 */
export function autoUnavailable(onHandBase: number | null, held: readonly Pick<OrderLine, 'quantity' | 'unit_factor'>[]): boolean {
  if (onHandBase === null) return false;
  const used = held.reduce((s, l) => s + num(l.quantity) * lineFactor(l), 0);
  return round2(num(onHandBase) - used) <= 0;
}

/**
 * R3-C2 item photos on invoice lines: a line snapshots its catalogue item's `image` (`asset:<id>`) at save,
 * so later catalogue photo changes never change a saved document. Tiny on purpose: imported by the editor.
 */

import type { InvoiceItem } from '../types/invoice';
import { isAssetRef } from './assets';

const normName = (s: unknown) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

/** The line's photo reference (an `asset:` ref), or '' when it has none. */
export function lineImageRef(item: Pick<InvoiceItem, 'image'> | undefined): string {
  return item && isAssetRef(item.image) ? item.image : '';
}

/**
 * Copy the catalogue photo reference onto lines that have none yet (matched by name, and HSN when
 * both carry one). Lines that already hold a photo keep it — that is the snapshot. Returns the same
 * array when nothing changed.
 */
export function snapshotLineImages(items: readonly InvoiceItem[], catalogue: readonly Pick<InvoiceItem, 'name' | 'hsn' | 'image'>[]): InvoiceItem[] {
  const withImage = catalogue.filter((c) => isAssetRef(c?.image) && normName(c.name));
  if (!withImage.length) return items as InvoiceItem[];
  let changed = false;
  const out = items.map((line) => {
    if (lineImageRef(line) || !normName(line.name)) return line;
    const hit = withImage.find((c) => normName(c.name) === normName(line.name) && (!c.hsn || !line.hsn || String(c.hsn) === String(line.hsn)));
    if (!hit) return line;
    changed = true;
    return { ...line, image: hit.image };
  });
  return changed ? out : (items as InvoiceItem[]);
}


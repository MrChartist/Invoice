/**
 * 6.23 (PENDING #25): item custom fields editable on one invoice line — lazy, shown when an item field is defined or the
 * line already carries values. The catalogue values still arrive when an item is picked (`applyCatalogItem`); typing
 * here changes only this line (a snapshot, finalised on save).
 */
import { useInvoiceStore } from '../../store/useInvoiceStore';
import type { InvoiceItem } from '../../types/invoice';
import { SnapshotFields } from './SnapshotFields';

export default function LineFields({ item, index }: { item: InvoiceItem; index: number }) {
  return (
    <SnapshotFields
      scope="item"
      compact
      idPrefix={`line-${index + 1}`}
      values={item.custom_values}
      onChange={(custom_values) => useInvoiceStore.getState().patchItem(item.id, { custom_values })}
    />
  );
}

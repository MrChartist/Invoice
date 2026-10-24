/**
 * Custom fields (roadmap 6.23): user-defined fields on documents, items and parties.
 *
 * Definitions live in the `mrchartist_inv_custom_fields` table. Values are additive fields
 * on the records themselves:
 *  - master data (clients, vendors, catalogue items): `custom_fields?: Record<fieldId, string>`
 *    — plain values, the label is always the current definition's;
 *  - documents and their line items: `custom_values?: CustomFieldValue[]` — a snapshot of
 *    label + value + print flag taken when the value was entered, so renaming or deleting a
 *    field later never changes what a saved invoice prints (Critical Rule 3).
 */

export type CustomFieldType = 'text' | 'number' | 'date';

/** `party` covers both clients and vendors. */
export type CustomFieldScope = 'document' | 'item' | 'party';

export interface CustomFieldDef {
  id: string;
  label: string;
  type: CustomFieldType;
  applies_to: CustomFieldScope;
  /** Printable fields appear on the invoice templates. */
  print: boolean;
  created_at?: string;
  updated_at?: string;
}

/** A value as snapshotted on an invoice or line item. Dates are bare `YYYY-MM-DD` local days. */
export interface CustomFieldValue {
  id: string;
  label: string;
  type: CustomFieldType;
  value: string;
  print: boolean;
  /** Set when the value came from the client (a party field) rather than the document itself. */
  scope?: 'party';
}

export const CUSTOM_FIELD_TYPE_LABELS: Record<CustomFieldType, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
};

export const CUSTOM_FIELD_SCOPE_LABELS: Record<CustomFieldScope, string> = {
  document: 'Documents (invoices, quotations…)',
  item: 'Items (catalogue → invoice lines)',
  party: 'Parties (clients & vendors)',
};

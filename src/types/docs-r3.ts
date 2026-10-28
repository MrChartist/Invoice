/**
 * R3-C document polish: additive document fields, declared by declaration merging so the shared
 * `invoice.ts` / `attachments.ts` stay with their owners (docs/prd/round-3.md §6).
 *  - `InvoiceRecord.delivery_proof` — receiver signature ("Received by"), an event snapshot (C2);
 *  - `AttachmentRef.print` — an image attachment printed on a photo page (C2).
 * `InvoiceItem.image` (an `asset:<id>` reference) is already declared on the shared item shape.
 */

export type PhotoGroup = 'before' | 'after' | 'other';

/** On an image attachment: print it on the document's photo pages. */
export interface AttachmentPrint {
  caption?: string;
  group?: PhotoGroup;
}

/** A replaced receiver signature (owner only, with a reason; audited). */
export interface DeliveryProofReplacement {
  /** ISO time of the replacement. */
  at: string;
  /** Who replaced it (user name). */
  by: string;
  reason: string;
}

/** Receiver signature on an issued invoice / delivery challan (proof of delivery). */
export interface DeliveryProof {
  receiver: string;
  remark?: string;
  /** ISO timestamp of signing. */
  signed_at: string;
  /** `asset:<id>` reference to the PNG in the `assets` table. */
  signature: string;
  /** Earlier versions replaced by the owner (newest last). */
  replaced?: DeliveryProofReplacement[];
}

declare module './invoice' {
  interface InvoiceRecord {
    /** Additive (R3-C2): receiver signature / proof of delivery, written once (owner may replace with a reason). */
    delivery_proof?: DeliveryProof;
  }
}

/** Cargo type for the e-Way validity (Rule 138(10)). */
export type EwayCargo = 'normal' | 'odc' | 'multimodal_ship';

/** One Part-B (vehicle) change recorded from the e-Way desk. */
export interface VehicleChange {
  at: string;
  vehicle: string;
  reason: 'breakdown' | 'transhipment' | 'others';
  place: string;
  state_code: string;
  remark?: string;
  doc_no?: string;
  doc_date?: string;
}

export interface TransporterChange {
  at: string;
  transporter_id: string;
  transporter_name?: string;
}

declare module '../lib/einvoice' {
  interface EInvoiceMeta {
    /** Additive (R3-C5): e-Way Bill generation date-time (ISO, local), for the computed validity. */
    eway_generated_at?: string;
    /** Additive (R3-C5): cargo type for Rule 138(10) (absent = normal). */
    eway_cargo?: EwayCargo;
    /** Additive (R3-C5): distance used for the validity, km (falls back to `distance`). */
    eway_distance_km?: number;
    /** Additive (R3-C5): Part-B vehicle changes prepared from the e-Way desk (newest last). */
    vehicle_history?: VehicleChange[];
    /** Additive (R3-C5): transporter changes prepared from the e-Way desk (newest last). */
    transporter_history?: TransporterChange[];
  }
}

declare module './attachments' {
  interface AttachmentRef {
    /** Additive (R3-C2): print this image on the document's photo pages. */
    print?: AttachmentPrint;
  }
}

export {};

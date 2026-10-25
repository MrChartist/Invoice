/**
 * Persisted shapes for job work (P1-9, Phase 7M) and Rejections In (P1-8). Additive only: add optional
 * fields, never rename or remove one.
 *
 * Tables:
 *  - `job_work_orders`  Job Work Out / In order `JWO/FY<yy-yy>/<seq>` (what is to be processed, by whom).
 *  - `job_work_out`     Material Out: delivery challan to a job worker `JWC/FY…` (CGST Rule 55, Sec 143).
 *                       Goods move to the job worker's godown: still OUR stock ("our stock with third party").
 *  - `job_work_in`      Material In `JWR/FY…`: processed goods / scrap / unprocessed inputs received back, the
 *                       inputs consumed at the job worker (BOM optional), losses, and goods supplied from his
 *                       premises (Table 5C).
 *  - `job_work_principal` Job Work In side (we are the job worker) `JWP/FY…`: the principal's material received
 *                       and goods sent back. The principal's goods are NOT our stock: register only.
 *  - `rejections_in`    Rejections In `RJI/FY…`: a customer rejects goods sent on a delivery challan before it is
 *                       invoiced; stock comes back and the challan's balance falls.
 *
 * None of these is stored as `stock_moves`: the stock engine reads them through `events-job-work.ts`.
 */

/** Sec 143 return clock: inputs 1 year, capital goods 3 years, moulds / dies / jigs / fixtures / tools none. */
export type JobWorkGoodsKind = 'input' | 'capital_goods' | 'mould_tool';

/** One stock line sent to / received from a job worker. Quantity as typed in `unit` (factor `unit_factor`). */
export interface JobWorkLine {
  id: string;
  /** `stock_items` row id. */
  item_id: string;
  qty: number;
  /** Unit the quantity was typed in (absent = the item's base unit) and its factor snapshot. */
  unit?: string;
  unit_factor?: number;
  batch_no?: string;
  /** Our godown the goods leave from (Material Out) or arrive in (Material In); absent = Main. */
  godown_id?: string;
  /** Material Out: value per typed unit for the challan (taxable value), GST rate %, HSN. */
  rate?: number;
  tax_rate?: number;
  hsn?: string;
  goods_kind?: JobWorkGoodsKind;
  /** Material In: the Material Out challan line this line settles (absent = oldest open line, FIFO). */
  out_line_id?: string;
}

/** What a Material In line is. */
export type JobWorkReceiptKind =
  /** Processed goods back into our godown (produced; cost = inputs consumed + job charges). */
  | 'processed'
  /** Waste / scrap brought back (fixed value per unit, deducted from the processed goods' cost). */
  | 'scrap'
  /** Inputs returned unprocessed (moved back from the job worker's godown). */
  | 'returned';

export interface JobWorkReceiptLine extends JobWorkLine {
  kind: JobWorkReceiptKind;
}

export interface JobWorkOrder {
  id: string;
  /** `JWO/FY<yy-yy>/<seq>`. */
  number: string;
  date: string;
  /** `out`: we send goods to a job worker; `in`: a principal sends goods to us. */
  direction: 'out' | 'in';
  party_name: string;
  vendor_id?: string;
  client_id?: string;
  party_gstin?: string;
  party_state_code?: string;
  /** Nature of the job work ("Powder coating"). */
  process?: string;
  /** Job Work Out: the goods expected back and the BOM that consumes inputs (optional). */
  finished_item_id?: string;
  finished_qty?: number;
  bom_id?: string;
  /** Agreed job charges per finished unit (₹, ex-GST). */
  rate?: number;
  due_date?: string;
  closed?: boolean;
  notes?: string;
  created_at?: string;
  updated_at?: string;
}

/** Material Out (Rule 55 challan to a job worker). */
export interface MaterialOut {
  id: string;
  /** `JWC/FY<yy-yy>/<seq>`. */
  number: string;
  date: string;
  order_id?: string;
  party_name: string;
  vendor_id?: string;
  party_gstin?: string;
  party_state_code?: string;
  /** The job worker's godown the goods go to (a godown with `job_worker: true`). */
  job_worker_godown: string;
  process?: string;
  lines: JobWorkLine[];
  /** e-Way bill number, when one was generated (Rule 138). */
  eway_bill_no?: string;
  /** Commissioner's extension of the return period (Sec 143(1) proviso), yyyy-mm-dd. */
  extended_until?: string;
  narration?: string;
  created_at?: string;
  updated_at?: string;
}

/** Material In from a job worker. */
export interface MaterialIn {
  id: string;
  /** `JWR/FY<yy-yy>/<seq>`. */
  number: string;
  date: string;
  order_id?: string;
  party_name: string;
  vendor_id?: string;
  party_gstin?: string;
  job_worker_godown: string;
  /** The job worker's own challan / invoice reference (ITC-04 Table 5). */
  jw_challan_no?: string;
  jw_challan_date?: string;
  /** Goods came back through another job worker (ITC-04 Table 5B): that worker's name / GSTIN. */
  via_party_name?: string;
  via_party_gstin?: string;
  /** Inputs used up at the job worker (issued from his godown). */
  consumed: JobWorkLine[];
  /** Processed goods, scrap and returned inputs. */
  received: JobWorkReceiptLine[];
  /** Losses / waste written off at the job worker (no goods come back), settling the challan. */
  losses?: JobWorkLine[];
  /**
   * Goods supplied directly from the job worker's premises (ITC-04 Table 5C, Sec 143(1)(b)). Stock moves from his
   * godown back to `godown_id` on this date, so the sales invoice (godown left as Main) takes it from there.
   */
  supplied?: JobWorkLine[];
  supply_invoice_no?: string;
  /** Job work charges (₹, ex-GST) loaded on the processed goods' cost. The bill itself is a purchase. */
  charges?: number;
  narration?: string;
  created_at?: string;
  updated_at?: string;
}

/** Job Work In side: one movement of the principal's goods (not our stock). */
export interface PrincipalMovement {
  id: string;
  /** `JWP/FY<yy-yy>/<seq>`. */
  number: string;
  date: string;
  order_id?: string;
  /** `receipt`: principal's material received; `return`: processed / unused goods sent back. */
  kind: 'receipt' | 'return';
  party_name: string;
  client_id?: string;
  party_gstin?: string;
  /** The principal's challan number / date (receipt) or our challan (return). */
  challan_no?: string;
  challan_date?: string;
  lines: { id: string; name: string; qty: number; unit?: string; hsn?: string; value?: number; processed?: boolean }[];
  narration?: string;
  created_at?: string;
  updated_at?: string;
}

/** Rejections In: goods a customer rejected from a delivery challan, before invoicing. */
export interface RejectionIn {
  id: string;
  /** `RJI/FY<yy-yy>/<seq>`. */
  number: string;
  date: string;
  challan_id: string;
  challan_number?: string;
  client_name?: string;
  lines: {
    id: string;
    /** The challan line (`InvoiceItem.id`) rejected. */
    challan_line_id: string;
    name: string;
    hsn?: string;
    /** Quantity in the challan line's unit (its `unit_factor` converts). */
    quantity: number;
    unit?: string;
    unit_factor?: number;
    godown_id?: string;
    batch_no?: string;
  }[];
  reason?: string;
  created_at?: string;
  updated_at?: string;
}

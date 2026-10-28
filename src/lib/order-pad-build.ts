/**
 * Sales-order records for the order pad import (8.81): the same draft defaults as the editor
 * (`makeDraft`), the party's state as the place of supply (goods are dispatched), totals from the
 * calculator, the next `SO/FY…` number of the sender profile's series. Status Sent (an open order).
 */

import type { Client, InvoiceItem, InvoiceRecord } from '../types/invoice';
import { makeDraft, senderStateCode } from '../store/invoice-defaults';
import { resolveStateCode } from './india-states';
import { localDb } from './localDb';
import { withTotals } from './pos';

export function buildSalesOrder(input: { client: Client; date: string; items: InvoiceItem[]; agentId?: string; note?: string }): InvoiceRecord {
  const settings = localDb.settings.get();
  const sender = localDb.settings.activeProfile();
  const draft = makeDraft({ settings, sender, docType: 'SALES_ORDER', templateId: localDb.template.get() });
  const home = senderStateCode(sender);
  const { custom_fields: _cf, credit_limit: _cl, credit_days: _cd, price_level: _pl, area_id: _a, beat_id: _b, agent_id: _g, credit_policy: _p, ...snap } = input.client;
  const client: Client = { ...draft.client, ...snap };
  const place = resolveStateCode({ code: client.state_code, gstin: client.gstin, name: client.state }) || home;
  let gst_mode = draft.gst_mode;
  if (gst_mode === 'CGST_SGST' || gst_mode === 'IGST') gst_mode = place && home && place !== home ? 'IGST' : 'CGST_SGST';
  return withTotals({
    ...draft,
    issue_date: input.date,
    due_date: input.date,
    client,
    place_of_supply: place,
    gst_mode,
    items: input.items,
    notes: input.note ?? '',
    status: 'Sent',
    ...(input.agentId ? { agent_id: input.agentId } : {}),
    invoice_number: localDb.invoices.nextNumber(input.date, 'SALES_ORDER', sender?.invoicePrefix || undefined),
  });
}

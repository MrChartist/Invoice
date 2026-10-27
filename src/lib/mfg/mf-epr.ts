/**
 * MF-B4 EPR register (pack `plastics`; reads only): kg of plastic packaging supplied per month by EPR category (item
 * `mf_epr`: I / II / III / IV) and customer (brand owner, `Client.mf.epr_no`), from sales net of credit notes — kg from
 * the base quantity (`lineFactor`) of a KG item, else `mf_unit_kg` per unit; and the recycled content of the month's
 * runs (inputs whose item is flagged post-consumer recycled, `mf_pcr`). CSV for the brand owner. Working paper — the
 * EPR filing itself is on the CPCB portal (MF27). Tests: tests/mf-epr.test.ts.
 */
import type { Client, InvoiceRecord } from '../../types/invoice';
import type { ProcessRun } from '../../types/mfg-r13';
import type { StockItem } from '../inventory';
import { buildItemIndex, invoiceEffect } from '../inventory';
import { lineFactor } from '../units';
import { num } from '../invoice-calc';
import { r2, r3 } from './mf-b-db';

export interface EprRow { month: string; category: string; client: string; epr_no: string; kg: number }

const kgPer = (it: Pick<StockItem, 'unit' | 'mf_unit_kg'>) => (String(it.unit ?? '').toUpperCase() === 'KG' ? 1 : num(it.mf_unit_kg));

/** Kg supplied by month × category × customer (months `from`–`to`, yyyy-mm, inclusive). */
export function eprSupplied(invoices: readonly Pick<InvoiceRecord, 'doc_type' | 'status' | 'issue_date' | 'items' | 'client'>[], items: readonly StockItem[], clients: readonly Client[], from: string, to: string): EprRow[] {
  const epr = items.filter((i) => i.mf_epr);
  const index = buildItemIndex(epr as StockItem[]);
  const m = new Map<string, EprRow>();
  for (const inv of invoices) {
    const eff = invoiceEffect(inv.doc_type, inv.status, false);
    const month = String(inv.issue_date ?? '').slice(0, 7);
    if (!eff || month < from || month > to) continue;
    const c = (inv.client?.id ? clients.find((x) => x.id === inv.client.id) : undefined) ?? inv.client;
    for (const l of inv.items ?? []) {
      const it = index.find(l.name, l.hsn);
      if (!it) continue;
      const kg = (eff === 'out' ? 1 : -1) * num(l.quantity) * lineFactor(l) * kgPer(it);
      const k = `${month}|${it.mf_epr}|${c?.name ?? ''}`;
      const row = m.get(k) ?? { month, category: String(it.mf_epr), client: c?.name || '—', epr_no: c?.mf?.epr_no ?? '', kg: 0 };
      row.kg += kg;
      m.set(k, row);
    }
  }
  return [...m.values()].map((r) => ({ ...r, kg: r3(r.kg) })).sort((a, b) => a.month.localeCompare(b.month) || a.category.localeCompare(b.category) || a.client.localeCompare(b.client));
}

/** Recycled content of the runs in a month: post-consumer kg ÷ all input kg. */
export function recycledShare(runs: readonly Pick<ProcessRun, 'date' | 'inputs'>[], items: readonly Pick<StockItem, 'id' | 'mf_pcr'>[], month: string): { input_kg: number; pcr_kg: number; pct: number } {
  const pcr = new Set(items.filter((i) => i.mf_pcr).map((i) => i.id));
  let input = 0;
  let rec = 0;
  for (const r of runs) {
    if (!r.date.startsWith(month)) continue;
    for (const i of r.inputs) {
      input += num(i.kg);
      if (pcr.has(i.item_id)) rec += num(i.kg);
    }
  }
  return { input_kg: r3(input), pcr_kg: r3(rec), pct: input > 0 ? r2((rec / input) * 100) : 0 };
}

const q = (s: string | number) => `"${String(s).replace(/"/g, '""')}"`;

/** CSV for the brand owner (one row per month × category × customer). */
export const eprCsv = (rows: readonly EprRow[]): string =>
  ['Month,EPR category,Customer,Customer EPR registration,Kg supplied', ...rows.map((r) => [r.month, r.category, r.client, r.epr_no, r.kg].map(q).join(','))].join('\n') + '\nWorking paper — your EPR filing is on the CPCB portal.\n';

/** R5-A test world: a seller in Maharashtra selling on "Amazon" with two catalogue items and a pack-of-3 listing. */
import { readFileSync } from 'node:fs';
import { resetStorage } from './shim.ts';
import { installSettings } from './world.ts';
import { localDb } from '../../src/lib/localDb.ts';
import { parseTable } from '../../src/lib/csv.ts';
import { saveChannel } from '../../src/lib/marketplace/channels.ts';
import { saveSkuRows } from '../../src/lib/marketplace/sku-map.ts';
import { guessColumns } from '../../src/lib/marketplace/file-map.ts';
import { SALES_FIELDS, applySalesImport, liveSalesContext, planSalesImport } from '../../src/lib/marketplace/sales-import.ts';
import type { SalesChannel } from '../../src/types/marketplace-r5.ts';

export const AMZ_MH = '27AAICA3918J1CT';
export const AMZ_KA = '29AAICA3918J1CP';
export const AMZ_TAN = 'MUMA12345B';

export function fixture(name: string) {
  const t = parseTable(readFileSync(new URL(`../fixtures/marketplace/${name}`, import.meta.url), 'utf8'));
  return { headers: t.headers, rows: t.rows };
}

export function mugId(): string {
  return localDb.items.getAll().find((i) => i.name === 'Red Mug')!.id;
}

export function setupWorld(): SalesChannel {
  resetStorage();
  installSettings({ business_type: 'ecommerce' } as never);
  localDb.items.upsertMany([
    { name: 'Red Mug', sku: 'MUG-RED', hsn: '6912', unit: 'NOS', tax_rate: 18, rate: 500, type: 'Product' },
    { name: 'Blue Mug', sku: 'MUG-BLUE', barcode: '8901234567890', short_code: 'BM', hsn: '6912', unit: 'NOS', tax_rate: 12, rate: 400, type: 'Product' },
  ]);
  const ch = saveChannel({ name: 'Amazon', platform: 'amazon', gstins: [{ state: '27', gstin: AMZ_MH }, { state: '29', gstin: AMZ_KA }], tan: AMZ_TAN, payout_cycle_days: 14 });
  saveSkuRows([{ channel_id: ch.id, channel_sku: 'MUG-3PK', listing_id: 'B0MUG3', item_id: mugId(), qty_per_unit: 3 }]);
  return ch;
}

/** Import the MTR fixture for the channel (returns the plan and the saved documents). */
export function importMtr(ch: SalesChannel, opts: { summary?: boolean } = {}) {
  const t = fixture('amazon-mtr.csv');
  const plan = planSalesImport(t, guessColumns(t.headers, SALES_FIELDS), 'amazon_mtr_b2c', liveSalesContext(ch, 'amazon-mtr.csv'), opts);
  const res = applySalesImport(ch, plan, 'amazon-mtr.csv');
  return { plan, res };
}

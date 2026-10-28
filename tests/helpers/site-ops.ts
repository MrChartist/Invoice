/** CN-D fixtures: a civil contractor with the R5 two-line BOQ, a project cost centre, one site, vendors and cement. */
import { freezeDate } from './shim.ts';
import { gstin } from './world.ts';
import { setupWorks } from './transport-works.ts';
import { setTable } from '../../src/lib/storage.ts';
import { saveCostCentre } from '../../src/lib/cost-centres.ts';
import { saveBoqTerms } from '../../src/lib/works/boq.ts';
import { addSite } from '../../src/lib/works/sites.ts';
import { blankStockItem, stockDb } from '../../src/lib/inventory.ts';
import { localDb } from '../../src/lib/localDb.ts';
import type { Vendor } from '../../src/types/purchases.ts';

export const SUB: Vendor = { id: 'v-sub', name: 'Kumar Plasterers', gstin: gstin('27ABCPK1234L1Z'), pan: 'ABCPK1234L', state_code: '27' };
export const LAB: Vendor = { id: 'v-lab', name: 'Shree Labour Supply', pan: 'AAFFS1234K', state_code: '27' };
export const HIRER: Vendor = { id: 'v-hire', name: 'Crane Hire Co', gstin: gstin('27AACCC1234D1Z'), pan: 'AACCC1234D', state_code: '27' };

export function siteWorld(today = '2026-10-27') {
  const boq = setupWorks({ construction_kind: 'civil' });
  freezeDate(`${today}T10:00:00`);
  const cc = saveCostCentre({ name: 'PWD Road Pkg 3', kind: 'project', active: true });
  saveBoqTerms(boq.id, { cost_centre_id: cc.id });
  const site = addSite(boq.id, 'Ch. 12 site', cc.id);
  setTable('vendors', [SUB, LAB, HIRER]);
  const cement = blankStockItem({ name: 'Cement', unit: 'BAG', opening_qty: 1000, opening_rate: 400 });
  stockDb.saveItem(cement);
  return { boq: localDb.invoices.getById(boq.id)!, cc, site, cement };
}

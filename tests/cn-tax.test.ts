/** CN-A2: works-contract classes, place of supply = site State, the other-State notice, declarations, re-class. */
import './helpers/shim.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { setupWorks } from './helpers/transport-works.ts';
import { localDb } from '../src/lib/localDb.ts';
import { saveBoqTerms } from '../src/lib/works/boq.ts';
import { saveRaBill } from '../src/lib/works/measurements.ts';
import { classConflicts, classRate, declarationKind, mixedSupplyInstall, otherStateNotice, rateDiffers, reclassAsWorks, suggestedRate, worksDeclarations, worksPlaceOfSupply } from '../src/lib/construction/cn-tax.ts';

test('class → rate by date (before / after 22 Sep 2025); typed rate wins; conflicting classes flagged', () => {
  assert.equal(classRate('wc_govt', '2025-09-21')!.rate, 12);
  assert.equal(classRate('wc_govt', '2025-09-22')!.rate, 18);
  assert.equal(classRate('wc_govt_earthwork', '2024-01-01')!.rate, 5);
  assert.equal(classRate('wc_general', '2017-07-01')!.rate, 18);
  assert.equal(classRate('manpower', '2026-01-01')!.sac, '998519');
  assert.equal(classRate('supply_goods', '2026-01-01')!.rate, null, 'supply of goods keeps the line HSN rate');
  assert.equal(classRate('pure_labour_exempt', '2026-01-01')!.exempt, true);
  assert.equal(suggestedRate('wc_govt', '2025-01-01', 18), 18, 'typed rate wins');
  assert.equal(suggestedRate('wc_govt', '2025-01-01'), 12);
  assert.equal(rateDiffers(12, 'wc_govt', '2026-01-01'), true);
  assert.equal(rateDiffers(18, 'wc_govt', '2026-01-01'), false);
  assert.equal(rateDiffers(28, 'supply_goods', '2026-01-01'), false);
  assert.ok(classConflicts('wc_govt') && !classConflicts('wc_general'));
});

test('place of supply = the site State (Sec 12(3)); IGST follows; notice when not registered there', () => {
  const sender = { state: '27', hasGstin: true };
  assert.deepEqual(worksPlaceOfSupply({ state_code: '29' }, '27', sender), { place_of_supply: '29', gst_mode: 'IGST', fromSite: true });
  assert.deepEqual(worksPlaceOfSupply(undefined, '27', sender), { place_of_supply: '27', gst_mode: 'CGST_SGST', fromSite: false });
  assert.match(otherStateNotice({ state_code: '29' }, ['27']), /registration in Karnataka.*CN4/);
  assert.equal(otherStateNotice({ state_code: '27' }, ['27']), '');
  assert.equal(otherStateNotice(undefined, ['27']), '');
});

test('an RA bill takes the site State as place of supply even when the client is elsewhere', () => {
  const boq = setupWorks();
  saveBoqTerms(boq.id, { ...boq.boq_terms, site: { address: 'NH-48 km 120, Belagavi', state_code: '29' } });
  const r = saveRaBill(boq.id, { date: '2026-06-30', lines: [{ line_id: 'l1', cumulative_qty: 100 }] });
  assert.equal(r.invoice.place_of_supply, '29');
  assert.equal(r.invoice.gst_mode, 'IGST');
  assert.ok(r.invoice.igst_amount > 0 && r.invoice.cgst_amount === 0);
  assert.equal(r.invoice.boq_terms!.cn!.header!.site!.state_code, '29');
  assert.equal(localDb.invoices.getById(boq.id)!.place_of_supply, '27', 'the BOQ itself is untouched');
});

test('declarations by line mix; supply + installation caution; one-click re-class', () => {
  assert.equal(declarationKind(['wc_general'], false), 'works');
  assert.equal(declarationKind(['supply_goods', 'install_service'], true), 'supply_install');
  assert.equal(declarationKind([undefined], false), 'none');
  assert.deepEqual(worksDeclarations({ a: { cls: 'wc_govt' }, b: { cls: 'pure_labour_exempt' } }, true), ['Composite supply of works contract as defined in Sec 2(119) of the CGST Act, 2017.', 'Exempt — pure labour (verify with your CA, CN2).']);
  assert.ok(mixedSupplyInstall(['supply_goods', 'install_service']));
  assert.ok(!mixedSupplyInstall(['supply_goods']));
  assert.deepEqual(reclassAsWorks({ a: { cls: 'supply_goods' }, b: { cls: 'install_service' }, c: { cls: 'manpower' } }), { a: { cls: 'wc_general' }, b: { cls: 'wc_general' }, c: { cls: 'manpower' } });
});

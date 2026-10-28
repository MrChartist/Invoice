/** PS-D3 194J receivable: defaults by profile; fee base excludes pure agent and GST; threshold by client and FY; 194C by entity form; chase list by quarter. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientKA, clientMH, createViaStore, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { PURE_AGENT_CHARGE } from '../src/lib/trade/pure-agent.ts';
import { buildTdsRegister } from '../src/lib/tds-register.ts';
import { chaseLetter, chaseList, clientTdsDefault, codeFor, expectedTds, feeBase, profileTdsDefault } from '../src/lib/prof/ps-tds-recv.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
});

test('defaults by profile; a client default wins; consulting asks per client', () => {
  assert.deepEqual(profileTdsDefault('ca'), { section: '194J' });
  assert.deepEqual(profileTdsDefault('legal'), { section: '194J' });
  assert.deepEqual(profileTdsDefault('freelancer'), { section: '194J' });
  assert.deepEqual(profileTdsDefault('agency'), { section: '194C' });
  assert.equal(profileTdsDefault('consulting'), undefined);
  assert.equal(profileTdsDefault(''), undefined);
  assert.deepEqual(clientTdsDefault({ ps: { tds: { section: '194J-T' } } }, 'ca'), { section: '194J-T' });
  assert.deepEqual(clientTdsDefault({}, 'ca'), { section: '194J' });
  assert.deepEqual(codeFor('194C', 'proprietorship'), { code: '194C-1', family: '194C' });
  assert.deepEqual(codeFor('194C', 'partnership'), { code: '194C-2', family: '194C' });
});

test('fee base: taxable value of the fee lines only (pure agent and GST out)', () => {
  const inv = createViaStore({ date: '2025-06-10', lines: [{ name: 'Fees', qty: 1, rate: 40000, tax: 18 }, { name: 'ROC fee', qty: 1, rate: 2000, tax: 0 }] });
  const items = inv.items.map((it, i) => (i === 1 ? { ...it, charge_head_id: 'rule33', description: PURE_AGENT_CHARGE } : it));
  assert.equal(feeBase({ ...inv, items }), 40000);
  assert.equal(feeBase(inv), 42000, 'an ordinary 0 % line stays in');
  const legacy = inv.items.map((it, i) => (i === 1 ? { ...it, description: 'Recovered at actual cost as a pure agent (Rule 33, CGST Rules)' } : it));
  assert.equal(feeBase({ ...inv, items: legacy }), 40000);
});

test('expected TDS only once the client\'s FY total passes ₹50,000 (194J), per client and FY; 194C by our form', () => {
  const issue = (date: string, rate: number, client = clientMH) => createViaStore({ client, date, lines: [{ name: 'Fees', qty: 1, rate, tax: 18 }] });
  issue('2025-05-10', 32000);
  issue('2025-05-12', 90000, clientKA);
  const invoices = () => localDb.invoices.getAll() as InvoiceRecord[];
  const below = expectedTds({ client: clientMH, def: { section: '194J' }, date: '2025-06-01', base: 10000, invoices: invoices(), ourForm: 'partnership' })!;
  assert.equal(below.applies, false);
  assert.match(below.message, /₹42000 of ₹50000/);
  const above = expectedTds({ client: clientMH, def: { section: '194J' }, date: '2025-06-01', base: 20000, invoices: invoices(), ourForm: 'partnership' })!;
  assert.deepEqual([above.applies, above.rate, above.amount, above.fyBefore], [true, 10, 2000, 32000]);
  const nextFy = expectedTds({ client: clientMH, def: { section: '194J' }, date: '2026-04-05', base: 20000, invoices: invoices(), ourForm: 'partnership' })!;
  assert.equal(nextFy.applies, false, 'a new FY starts again');
  const tech = expectedTds({ client: clientMH, def: { section: '194J-T' }, date: '2025-06-01', base: 60000, invoices: [], ourForm: 'partnership' })!;
  assert.equal(tech.amount, 1200);
  const c1 = expectedTds({ client: clientMH, def: { section: '194C' }, date: '2025-06-01', base: 40000, invoices: [], ourForm: 'proprietorship' })!;
  const c2 = expectedTds({ client: clientMH, def: { section: '194C' }, date: '2025-06-01', base: 40000, invoices: [], ourForm: 'llp' })!;
  assert.deepEqual([c1.applies, c1.rate, c1.amount, c2.rate, c2.amount], [true, 1, 400, 2, 800], '194C single above ₹30,000');
  assert.equal(expectedTds({ client: clientMH, def: { section: 'none' }, date: '2025-06-01', base: 1, invoices: [], ourForm: 'llp' }), null);
});

test('chase list per client × quarter (received out, overdue first) and the letter names Form 131 from TY 2026-27', () => {
  createViaStore({ client: clientMH, date: '2026-07-10', lines: [{ name: 'Fees', qty: 1, rate: 100000, tax: 18 }], tds: { rate: 10, section: '194J' } });
  createViaStore({ client: clientKA, date: '2025-05-10', lines: [{ name: 'Fees', qty: 1, rate: 100000, tax: 18 }], tds: { rate: 10, section: '194J' } });
  const reg = buildTdsRegister({ invoices: localDb.invoices.getAll(), certificates: [] }, { today: '2026-12-01' });
  const list = chaseList(reg, '2026-12-01');
  assert.deepEqual(list.map((r) => [r.partyName, r.fy, r.quarter, r.due, r.overdue, r.tds]), [['Karnataka Tech', 2025, 1, '2025-08-15', true, 10000], ['Bharat Traders', 2026, 2, '2026-11-15', true, 10000]]);
  assert.equal(chaseList(reg, '2026-12-01', 2026).length, 1);
  const letter = chaseLetter(list[1], 'Rao & Co');
  assert.match(letter, /Form 131 \(earlier 16A\)/);
  assert.match(letter, /Form 168/);
  assert.match(chaseLetter(list[0], 'Rao & Co'), /Form 16A\)/);
});

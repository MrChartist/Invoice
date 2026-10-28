/**
 * R18-C4 bank receipts matched by unit: narrations naming one unit (A-101, A101, A/101, 101A, FLAT 101 A; a bare
 * number only after FLAT / UNIT / SHOP), never a longer number or two units; the amount hint; the bridge's receipt
 * suggestion for the member through the existing bank-rules action, nothing for a non-society company.
 */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { setTable } from '../src/lib/storage.ts';
import { amountFits, matchUnitInNarration } from '../src/lib/society/hs-bank-match.ts';
import { societySuggestions } from '../src/lib/society/hs-bank-io.ts';
import { saveSocietySettings } from '../src/lib/society/hs-settings.ts';
import { issueRun } from '../src/lib/society/hs-issue-io.ts';
import type { BankLine } from '../src/lib/bank-recon.ts';
import type { SocietyUnit } from '../src/types/society-r18.ts';

const units = [{ id: 'a101', code: 'A-101' }, { id: 'a102', code: 'A-102' }, { id: 'b101', code: 'B-101' }, { id: 's1', code: '12' }, { id: 'a1010', code: 'A-1010' }];

test('the unit a narration names', () => {
  const m = (n: string) => matchUnitInNarration(n, units)?.id;
  assert.deepEqual(['NEFT/UTR123/A-101 MAINT', 'UPI-A101-OCT', 'IMPS A/101 ASHA', 'FLAT 101 A SEPT', 'by 101a', 'A 1010 rent', 'FLAT NO. 12 OCT'].map(m), ['a101', 'a101', 'a101', 'a101', 'a101', 'a1010', 's1']);
  assert.deepEqual(['A-101 and A-102', 'UTR 3101012', 'INV 12 PAID', 'FLAT 101', 'XA101'].map(m), [undefined, undefined, undefined, undefined, undefined], 'ambiguous, digits inside a reference, a bare number, no wing, a longer token');
  assert.deepEqual([amountFits(6710, [6710, 6729.93], 13439.93), amountFits(13439.93, [6710], 13439.93), amountFits(5000, [6710], 6710)], ['bill', 'dues', '']);
});

test('bridge: a credit naming A-101 → receipt from its member, "= open bill"; debits and other companies get none', () => {
  resetStorage();
  installSettings();
  const line = (id: string, o: Partial<BankLine>): BankLine => ({ id, date: '2026-10-25', narration: '', debit: 0, credit: 0, balance: 0, ...o }) as BankLine;
  const lines = [line('l1', { narration: 'NEFT A-101 OCT', credit: 3000 }), line('l2', { narration: 'A-101 refund', debit: 50 })];
  assert.deepEqual(societySuggestions(lines), [], 'not a society');
  localDb.settings.save({ ...localDb.settings.get(), society_kind: 'chs' });
  setTable('clients', [{ id: 'c1', name: 'Asha', email: '', address: '', city: '', zip: '' }]);
  setTable('society_units', [{ id: 'u1', code: 'A-101', use: 'residential', occupancy: 'owner', parking: [], owner_id: 'c1', status: 'active', updated_at: '' } as SocietyUnit]);
  saveSocietySettings({ state: '27', heads: [{ id: 'svc', name: 'Service', kind: 'service', basis: 'per_unit', rate: 3000, sac: '999598', active: true }] });
  issueRun({ period: '2026-10', date: '2026-10-01', due: '2026-10-20' });
  assert.deepEqual(societySuggestions(lines), [{ lineId: 'l1', source: 'rule', action: { kind: 'receipt', client_id: 'c1' }, label: 'A-101 = open bill' }]);
});

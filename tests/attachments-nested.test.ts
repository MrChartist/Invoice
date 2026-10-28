/**
 * CN-D2 labour compliance keeps its PF / ESI / wage-register files in nested fields (`pf.file`, `esi.file`,
 * `wage_register`), not in `attachments`: the clean-up scan must still count them as in use, or they are deleted.
 */
import './helpers/shim.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { attachmentIdsIn } from '../src/lib/attachments.ts';

const ref = (id: string) => ({ id, name: `${id}.pdf`, mime: 'application/pdf', size: 100, added_at: '2026-10-28T10:00:00.000Z' });

test('labour compliance: nested PF / ESI / wage-register files are referenced', () => {
  const row = { id: 'lc1', pf: { trrn: 'T1', file: ref('pf1') }, esi: { challan: 'C1', file: ref('esi1') }, wage_register: ref('wr1') };
  assert.deepEqual([...attachmentIdsIn([row])].sort(), ['esi1', 'pf1', 'wr1']);
});

test('labour compliance: rows without files, odd shapes and the plain attachments list still read as before', () => {
  assert.deepEqual([...attachmentIdsIn([{ pf: {}, esi: 'x', wage_register: null }, { pf: 'x' }, 5, null])], []);
  assert.deepEqual([...attachmentIdsIn([{ attachments: [ref('a1'), ref('a1')], pf: { file: ref('a1') } }])], ['a1']);
});

test('labour compliance: a binned row keeps its nested files referenced', () => {
  const entry = { id: 'b1', table: 'labour_compliance', row_id: 'lc1', deleted_at: '2026-10-28T10:00:00.000Z', row: { id: 'lc1', pf: { file: ref('pf9') } } };
  assert.deepEqual([...attachmentIdsIn([entry])], ['pf9']);
  assert.deepEqual([...attachmentIdsIn([{ ...entry, table: 'invoices' }])], [], 'other binned rows read their copied attachments only');
});

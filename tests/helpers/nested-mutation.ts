/**
 * Child process of tests/storage-rows.test.ts (run WITHOUT the test runner, so shared rows are not deep-frozen, as in
 * production): a nested value of a `getTable` copy of a chunked table changed in place must either throw or be saved.
 */
import './shim.ts';
import { installFakeIdb } from './fake-idb.ts';
import { flushStorage, getTable, initStorage, resetStorageBackend, setTable, sharedRowsFrozen } from '../../src/lib/storage.ts';
import { resetIdbConnection } from '../../src/lib/idb-kv.ts';

installFakeIdb();
type Row = { id: string; items: { id: string }[] };
await initStorage();
setTable('invoices', Array.from({ length: 200 }, (_, i) => ({ id: `inv${i}`, items: [{ id: `l${i}` }] })));
await flushStorage();
let outcome = 'lost';
try {
  const all = getTable<Row>('invoices');
  all[5].items.push({ id: 'new' });
  setTable('invoices', all);
  await flushStorage();
  resetStorageBackend();
  resetIdbConnection();
  await initStorage();
  if (getTable<Row>('invoices')[5].items.length === 2) outcome = 'saved';
} catch (err) {
  if (err instanceof TypeError) outcome = 'threw';
}
console.log(`frozen=${sharedRowsFrozen()} nested=${outcome}`);

/**
 * ROADMAP 7.49: Tally import of inventory vouchers' quantities as stock moves (never GST documents).
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { TALLY_FIXTURE } from './tally-fixture.ts';
import { parseTallyXml, planTallyImport } from '../src/lib/tally-import.ts';
import { applyTallyImport, loadExistingBooks } from '../src/lib/tally-import-apply.ts';
import { planTallyStockMoves } from '../src/lib/tally-import-stock.ts';
import { stockDb, loadPositions } from '../src/lib/inventory.ts';
import { localDb } from '../src/lib/localDb.ts';

const BOOKS = '2025-04-01';

/** The fixture plus a quantity-only Stock Journal, a purchase in boxes and a line for an unknown item. */
const EXTRA = `
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <VOUCHER VCHTYPE="Stock Journal" ACTION="Create">
      <GUID>sj-1</GUID>
      <DATE>20250410</DATE><VOUCHERTYPENAME>Stock Journal</VOUCHERTYPENAME><VOUCHERNUMBER>SJ1</VOUCHERNUMBER>
      <INVENTORYENTRIESOUT.LIST><STOCKITEMNAME>Widget</STOCKITEMNAME><ACTUALQTY>5 Nos</ACTUALQTY><AMOUNT>1000.00</AMOUNT>
       <BATCHALLOCATIONS.LIST><GODOWNNAME>Warehouse 2</GODOWNNAME></BATCHALLOCATIONS.LIST></INVENTORYENTRIESOUT.LIST>
      <INVENTORYENTRIESIN.LIST><STOCKITEMNAME>Gadget</STOCKITEMNAME><ACTUALQTY>2 Nos</ACTUALQTY><AMOUNT>1000.00</AMOUNT></INVENTORYENTRIESIN.LIST>
     </VOUCHER>
    </TALLYMESSAGE>
    <TALLYMESSAGE xmlns:UDF="TallyUDF">
     <VOUCHER VCHTYPE="Stock Journal" ACTION="Create">
      <GUID>sj-2</GUID>
      <DATE>20250411</DATE><VOUCHERTYPENAME>Stock Journal</VOUCHERTYPENAME><VOUCHERNUMBER>SJ2</VOUCHERNUMBER>
      <INVENTORYENTRIESIN.LIST><STOCKITEMNAME>Widget</STOCKITEMNAME><ACTUALQTY>1 Box</ACTUALQTY><AMOUNT>200.00</AMOUNT></INVENTORYENTRIESIN.LIST>
     </VOUCHER>
    </TALLYMESSAGE>
   </REQUESTDATA>`;
const FILE = TALLY_FIXTURE.replace('   </REQUESTDATA>', EXTRA);
const plan = () => planTallyImport(parseTallyXml(FILE), loadExistingBooks(), { booksBegin: BOOKS });

beforeEach(() => resetStorage());

test('parsing: item lines with direction, unit, value, godown', () => {
  const parsed = parseTallyXml(FILE);
  const sales = parsed.vouchers.find((v) => v.number === '101')!;
  assert.deepEqual(sales.inventory, [{ item: 'Widget', qty: 10, unit: 'Nos', direction: 'out', paise: 1_000_000 }]);
  const sj = parsed.vouchers.find((v) => v.number === 'SJ1')!;
  assert.equal(sj.base, 'Stock Journal');
  assert.deepEqual(sj.inventory?.map((l) => [l.item, l.direction, l.qty, l.godown ?? '']), [['Widget', 'out', 5, 'Warehouse 2'], ['Gadget', 'in', 2, '']]);
});

test('plan: quantity-only stock journal is "stock only", moves get a status each', () => {
  const p = plan();
  const sj = p.vouchers.find((v) => v.rec.number === 'SJ1')!;
  assert.equal(sj.status, 'stock_only');
  const moves = p.stockMoves ?? [];
  const byKey = (n: string, item: string) => moves.find((m) => m.number === n && m.item === item)!;
  assert.equal(byKey('101', 'Widget').status, 'ok');
  assert.equal(byKey('101', 'Widget').qty, -10);
  assert.equal(byKey('101', 'Widget').kind, 'sale');
  assert.equal(byKey('101', 'Widget').rate, 1000);
  assert.equal(byKey('SJ1', 'Widget').status, 'ok');
  assert.equal(byKey('SJ1', 'Gadget').status, 'no_item');
  assert.equal(byKey('SJ2', 'Widget').status, 'unit', 'Box is not a unit of Widget');
});

test('apply: stock moves added (period lock / audit through addMove), no GST documents, re-import adds nothing', async () => {
  const res = applyTallyImport(plan());
  assert.equal(res.stockMoves, 2);
  const moves = stockDb.moves();
  assert.equal(moves.length, 2);
  assert.ok(moves.every((m) => m.ref_type === 'tally' && m.ref_id?.includes('#')));
  const out = moves.find((m) => m.qty === -5)!;
  assert.ok(out.godown_id, 'godown matched by name');
  const widget = stockDb.items().find((i) => i.name === 'Widget')!;
  const pos = loadPositions().find((x) => x.item.id === widget.id);
  assert.equal(pos?.qty, 85, '100 opening − 10 sold − 5 consumed');
  assert.equal(localDb.invoices.getAll().length, 0, 'never invoices');
  await Promise.resolve();
  const again = plan();
  assert.ok((again.stockMoves ?? []).filter((m) => m.status === 'ok').length === 0);
  assert.equal(applyTallyImport(again).stockMoves, 0);
  assert.equal(stockDb.moves().length, 2);
});

test('plan: alternate unit converts; locked and pre-books lines are left out', () => {
  const parsed = parseTallyXml(FILE);
  const tag = (v: { number: string }) => `t:${v.number}`;
  const moves = planTallyStockMoves(parsed.vouchers, {
    stockItems: [{ name: 'Widget', unit: 'Nos', alt_units: [{ unit: 'Box', factor: 12 }] }],
    booksBegin: '2025-04-11',
    lockUntil: '',
  }, tag);
  const sj2 = moves.find((m) => m.number === 'SJ2')!;
  assert.equal(sj2.status, 'ok');
  assert.equal(sj2.unit, 'Box');
  assert.equal(sj2.unit_factor, 12);
  assert.equal(moves.find((m) => m.number === '101')?.status, 'before_books');
  const locked = planTallyStockMoves(parsed.vouchers, { stockItems: [{ name: 'Widget', unit: 'Nos' }], booksBegin: '2025-04-01', lockUntil: '2025-04-30' }, tag);
  assert.ok(locked.every((m) => m.status === 'locked' || m.status === 'no_item'));
});

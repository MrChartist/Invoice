/** PS-D5 bill from the board: draft lines at the agreed fee, retainer cover at 0, UDIN on the line, disbursements included, fee schedule writes. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { clientMH, installSettings } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { getTable, setTable } from '../src/lib/storage.ts';
import { billFromBoard, clientFees, draftLines, feeItems, patchClientPs, retainerClients, setFeeEvent, typedEvent } from '../src/lib/prof/ps-ca-bill.ts';
import { caEvents, caKey, type CaEvent } from '../src/lib/prof/ps-ca-events.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';

beforeEach(() => {
  resetStorage();
  installSettings();
  setTable('clients', [clientMH]);
  setTable('items_catalog', [
    { id: 'i3b', name: 'GSTR-3B filing', hsn: '998231', rate: 1500, tax_rate: 18, quantity: 1, amount: 1500 },
    { id: 'icert', name: 'Certification', hsn: '998221', rate: 5000, tax_rate: 18, quantity: 1, amount: 5000 },
  ]);
});

const ev3b: CaEvent = { key: caKey(clientMH.id!, 'gstr3b', '2026-10'), client_id: clientMH.id!, kind: 'gstr3b', period: '2026-10', date: '2026-11-18', label: 'GSTR3B 2026-10' };
const evCert: CaEvent = { key: 'udin:u1', client_id: clientMH.id!, kind: 'certificate', period: '2026-11-12', date: '2026-11-12', label: 'Turnover certificate — UDIN 26123456ABCDEF1234', udin: '26123456ABCDEF1234' };

test('fee schedule: catalogue items flagged by event; the client\'s agreed fee wins; TDS default kept beside it', () => {
  setFeeEvent('i3b', 'gstr3b');
  setFeeEvent('icert', 'certificate');
  assert.deepEqual([...feeItems(localDb.items.getAll()).keys()], ['gstr3b', 'certificate']);
  patchClientPs(clientMH.id!, { fees: { gstr3b: 2000 } });
  patchClientPs(clientMH.id!, { tds: { section: '194J' } });
  const c = localDb.clients.getById(clientMH.id!);
  assert.deepEqual(clientFees(c), { gstr3b: 2000 });
  assert.deepEqual((c as unknown as { ps: { tds: unknown } }).ps.tds, { section: '194J' });
  const lines = draftLines([ev3b, evCert], c, localDb.items.getAll(), false);
  assert.deepEqual(lines.map((l) => [l.name, l.rate, l.tax_rate, l.bill_refs, l.description]), [
    ['GSTR-3B filing — GSTR3B 2026-10', 2000, 18, [ev3b.key], ''],
    ['Certification — Turnover certificate — UDIN 26123456ABCDEF1234', 5000, 18, ['udin:u1'], 'UDIN 26123456ABCDEF1234'],
  ]);
  const covered = draftLines([ev3b, typedEvent(clientMH.id!, 'retainer', '2026-11', 'Retainer 2026-11')], c, localDb.items.getAll(), true);
  assert.equal(covered[0].rate, 0);
  assert.match(covered[0].description ?? '', /retainer/);
  setFeeEvent('icert', '');
  assert.deepEqual([...feeItems(localDb.items.getAll()).keys()], ['gstr3b']);
});

test('the draft: one line per event, disbursements at actual, events billed, cancel frees them; retainer engagements cover', () => {
  setFeeEvent('i3b', 'gstr3b');
  setTable('purchases', [{ id: 'p1', date: '2026-11-03', vendor_name: 'GST portal', category: 'Late fee', total: 2000, pure_agent: true, billable: true, billable_to_client_id: clientMH.id, items: [] } as unknown as PurchaseRecord]);
  const inv = billFromBoard(clientMH.id!, [ev3b, evCert], { disbursements: true });
  assert.equal(inv.status, 'Draft');
  assert.equal(inv.items.length, 3);
  assert.equal(inv.items[2].rate, 2000);
  assert.equal(inv.items[2].tax_rate, 0);
  assert.equal(getTable<PurchaseRecord>('purchases')[0].rebilled_in, inv.id);
  const settings = { company_clients: [] };
  const udins = [{ id: 'u1', udin: '26123456ABCDEF1234', date: '2026-11-12', client_id: clientMH.id!, kind: 'certificate' as const, description: 'x', member_no: '123456' }];
  const billed = () => caEvents({ settings, peeks: new Map(), udins, month: '2026-11', invoices: localDb.invoices.getAll() as InvoiceRecord[] });
  assert.equal(billed()[0].billedBy, inv.id);
  localDb.invoices.save({ ...localDb.invoices.getById(inv.id)!, status: 'Cancelled' });
  assert.equal(billed()[0].billedBy, undefined);
  assert.deepEqual([...retainerClients([{ client_id: 'c1', model: 'retainer', status: 'active' }, { client_id: 'c2', model: 'fixed', status: 'active' }])], ['c1']);
  assert.throws(() => billFromBoard('nobody', [ev3b]), /no longer/);
});

/**
 * R16-B2 / B3 on the pre-bill: appearances billed as count × fee (time still counts for realisation; off = the same
 * draft), media rows billed as pure agent + fee with the `ps.media` snapshot, the publisher's commission as its own draft.
 */
import './helpers/shim.ts';
import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { freezeDate, resetStorage, thawDate } from './helpers/shim.ts';
import { installSettings, clientMH } from './helpers/world.ts';
import { localDb } from '../src/lib/localDb.ts';
import { setTable } from '../src/lib/storage.ts';
import { purchasesDb } from '../src/lib/purchases.ts';
import { currentLiveInvoiceIds, readTimePrefs, timeDb, unbilledTime } from '../src/lib/timesheets.ts';
import { createCommissionDraft, createPrebillDraft } from '../src/lib/prof/ps-prebill.ts';
import { docBilling } from '../src/lib/prof/ps-writedown.ts';
import { mediaLines, mediaSnap, unbilledMedia } from '../src/lib/prof/ps-media.ts';
import { isPureAgentLine } from '../src/lib/trade/pure-agent.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import type { PurchaseRecord } from '../src/types/purchases.ts';
import type { TimeEntry } from '../src/types/time.ts';

const te = (id: string, date: string, extra: Partial<TimeEntry> = {}): TimeEntry => ({ id, client_id: clientMH.id, client_name: clientMH.name, description: 'Work', date, minutes: 60, hourly_rate: 4000, billable: true, ...extra });

function seed() {
  resetStorage();
  installSettings({ prof_kind: 'legal', industry_packs: ['practice', 'legal', 'media'] } as never);
  localDb.clients.upsert(clientMH);
  setTable('work_types', [{ id: 'app', name: 'Appearance — Saket court', rate: 15000, ps: { unit: 'appearance' } }, { id: 'res', name: 'Research', rate: 4000 }]);
  for (let k = 1; k <= 5; k++) timeDb.save(te(`a${k}`, `2026-06-0${k}`, { work_type_id: 'app', minutes: 120 }));
  timeDb.save(te('r1', '2026-06-10', { work_type_id: 'res', minutes: 90 }));
}

beforeEach(() => { seed(); freezeDate('2026-06-30T10:00:00'); });
afterEach(() => thawDate());

/** The draft without ids, dates or numbers (ids → positions). */
function shape(d: InvoiceRecord) {
  const pos = new Map(d.items.map((it, k) => [it.id, `#${k}`]));
  return JSON.parse(JSON.stringify(d, (k, v) => (['id', 'created_at', 'updated_at', 'invoice_number'].includes(k) ? undefined : k === 'lines' && v && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([id, l]) => [pos.get(id) ?? id, l])) : v)));
}

test('B3: five appearances → one line 5 × fee; the entries are billed and still count for realisation', () => {
  const d = createPrebillDraft({ key: clientMH.id!, appearances: true });
  const app = d.items.find((i) => i.name === 'Appearance — Saket court')!;
  assert.deepEqual([app.quantity, app.rate, app.unit, app.bill_refs], [5, 15000, 'NOS', ['a1', 'a2', 'a3', 'a4', 'a5']]);
  assert.deepEqual(d.items.filter((i) => i.unit === 'HRS').map((i) => i.bill_refs), [['r1']], 'hourly work stays hourly');
  assert.equal(unbilledTime(timeDb.all(), currentLiveInvoiceIds(), undefined, readTimePrefs()).length, 0);
  const b = docBilling(d, new Map(timeDb.all().map((e) => [e.id, e])), readTimePrefs());
  assert.deepEqual([b?.standard, b?.billed], [46000, 81000], 'standard = 5 × 2 h × 4,000 + 1.5 h × 4,000; billed = 75,000 + 6,000');
  assert.equal(d.ps?.wd?.billed, 81000);
});

test('B3: off is the same draft as before the option existed', () => {
  const before = shape(createPrebillDraft({ key: clientMH.id! }));
  seed();
  const off = shape(createPrebillDraft({ key: clientMH.id!, appearances: false }));
  assert.deepEqual(off, before);
});

test('B2: two insertions as pure agent with a 15 % fee; snapshot in ps.media; billed after; commission is its own draft', () => {
  const buy = (id: string, ro: string, total: number): PurchaseRecord => ({
    id, kind: 'EXPENSE', vendor_name: 'Daily Times', bill_number: ro, date: '2026-06-15', category: 'Media', taxable: total, cgst: 0, sgst: 0, igst: 0, total, itc_eligible: false, amount_paid: total,
    ps: { media: { client_id: clientMH.id!, medium: 'print', mode: 'agent', ro, publication: 'Daily Times', insert_from: '2026-06-14' } },
  } as unknown as PurchaseRecord);
  purchasesDb.save(buy('m1', 'RO-1', 50000));
  purchasesDb.save(buy('m2', 'RO-2', 30000));
  const live = () => currentLiveInvoiceIds();
  const rows = unbilledMedia(purchasesDb.all(), clientMH.id!, (id) => !!live().byRow.get(id)?.length);
  assert.equal(rows.length, 2);
  const prefs = readTimePrefs();
  const d = createPrebillDraft({ key: clientMH.id!, extra: { lines: mediaLines(rows, { fee_pct: 15, sac: prefs.sac, gst_rate: prefs.gst_rate }), media: mediaSnap(rows) } });
  const agent = d.items.filter((i) => isPureAgentLine(i));
  assert.deepEqual(agent.map((i) => [i.rate, i.tax_rate, i.bill_refs]), [[50000, 0, ['m1']], [30000, 0, ['m2']]]);
  assert.deepEqual(d.items.filter((i) => i.name.startsWith('Agency service fee')).map((i) => i.rate), [7500, 4500]);
  assert.deepEqual(d.ps?.media?.rows?.map((r) => [r.ro, r.amount]), [['RO-1', 50000], ['RO-2', 30000]]);
  assert.equal(unbilledMedia(purchasesDb.all(), clientMH.id!, (id) => !!live().byRow.get(id)?.length).length, 0);
  const c = createCommissionDraft('Daily Times', 80000, 15, prefs);
  assert.deepEqual([c.client.name, c.items.length, c.items[0].rate], ['Daily Times', 1, 12000]);
  assert.throws(() => createCommissionDraft('', 1000, 15, prefs), /publication/);
});

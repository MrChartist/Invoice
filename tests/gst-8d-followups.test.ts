/**
 * 8.66 (PENDING 41) — 8D follow-ups: GSTR-3B Table 3.2 split for composition / UIN recipients, GSTR-1A JSON, IRN
 * cancel from the bulk response file, GSTR-6 / 7 / 8 time bar and one-off due-date extensions as data rows.
 */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import { BUYER_KA, SELLER, SELLER_GSTIN, clientKA } from './helpers/world.ts';
import type { InvoiceRecord } from '../src/types/invoice.ts';
import { buildGstReport, periodForDate } from '../src/lib/gst-reports.ts';
import { buildGstr3bJson, gstr3bRows } from '../src/lib/gstr-json.ts';
import { gstr1aDiff, snapshotFromReport, specialReturnDues, specialReturnForms, timeBarList, RETURN_TIME_BAR_RULES } from '../src/lib/gst-guards.ts';
import { buildGstr1aJson, GSTR1A_JSON_LAYOUT } from '../src/lib/gstr1a-json.ts';
import { applyIrpResponse, parseIrpResponse } from '../src/lib/einvoice-bulk.ts';
import { DUE_DATE_EXTENSIONS, complianceCalendar, withExtension } from '../src/lib/compliance.ts';
import { isUinShaped } from '../src/lib/gstin.ts';

beforeEach(() => resetStorage());

const doc = (over: Partial<InvoiceRecord>): InvoiceRecord =>
  ({
    id: 'i1', invoice_number: 'INV/FY25-26/0001', doc_type: 'TAX_INVOICE', status: 'Sent', issue_date: '2025-06-05',
    place_of_supply: '29', gst_mode: 'IGST', total: 1180, sender: { ...SELLER }, client: { ...clientKA },
    items: [{ id: 'l1', name: 'Widget', hsn: '8471', quantity: 1, rate: 1000, tax_rate: 18 }], ...over,
  }) as unknown as InvoiceRecord;

const period = periodForDate('month', '2025-06-01');

test('Table 3.2: inter-state supplies to composition dealers and UIN holders get their own rows (and JSON arrays)', () => {
  assert.equal(isUinShaped('0717UNO00157UNO'), true);
  assert.equal(isUinShaped(BUYER_KA), false);
  const comp = doc({ id: 'c1', client: { ...clientKA, gst_reg_type: 'composition' } });
  const uin = doc({ id: 'u1', invoice_number: 'INV/FY25-26/0002', place_of_supply: '07', client: { ...clientKA, gstin: '0717UNO00157UNO', state_code: '07', gst_reg_type: 'uin' } });
  const reg = doc({ id: 'r1', invoice_number: 'INV/FY25-26/0003' });
  const rep = buildGstReport([comp, uin, reg], [], { period, gstin: SELLER_GSTIN });
  const b = rep.gstr3b;
  assert.deepEqual(b.interStateComp, [{ pos: '29', taxable: 1000, igst: 180 }]);
  assert.deepEqual(b.interStateUin, [{ pos: '07', taxable: 1000, igst: 180 }]);
  assert.deepEqual(b.interStateUnreg, []);
  // The UIN is accepted (no GSTIN_INVALID) and the supply goes to B2B with the UIN.
  assert.ok(!rep.issues.some((i) => i.code === 'GSTIN_INVALID'));
  assert.ok(rep.gstr1.b2b.some((d) => d.ctin === '0717UNO00157UNO'));
  const json = buildGstr3bJson(b, SELLER_GSTIN, '062025') as { inter_sup: { comp_details: unknown[]; uin_details: unknown[] } };
  assert.deepEqual(json.inter_sup.comp_details, [{ pos: '29', txval: 1000, iamt: 180 }]);
  assert.deepEqual(json.inter_sup.uin_details, [{ pos: '07', txval: 1000, iamt: 180 }]);
  assert.ok(gstr3bRows(b).some((r) => String(r[1]).includes('composition taxable persons')));
});

test('GSTR-1A JSON: added / changed documents in the GSTR-1 layout, B2CS as the difference, removed listed apart', () => {
  const a = doc({ id: 'a' });
  const gone = doc({ id: 'g', invoice_number: 'INV/FY25-26/0002' });
  const b2c = doc({ id: 'x', invoice_number: 'INV/FY25-26/0003', client: { ...clientKA, gstin: '' }, total: 1180 });
  const filed = buildGstReport([a, gone, b2c], [], { period, gstin: SELLER_GSTIN });
  const snap = snapshotFromReport(filed.gstr1, filed.gstr3b.interStateUnreg, SELLER_GSTIN);
  const added = doc({ id: 'n', invoice_number: 'INV/FY25-26/0004' });
  const b2c2 = doc({ id: 'y', invoice_number: 'INV/FY25-26/0005', client: { ...clientKA, gstin: '' }, items: [{ id: 'l1', name: 'W', hsn: '8471', quantity: 1, rate: 500, tax_rate: 18 }] as never, total: 590 });
  const now = buildGstReport([a, added, b2c, b2c2], [], { period, gstin: SELLER_GSTIN });
  const paper = gstr1aDiff(snap, now.gstr1);
  const out = buildGstr1aJson(paper, now.gstr1);
  const json = out.json as { gstin: string; fp: string; gt?: number; b2b: { inv: { inum: string }[] }[]; b2cs: { txval: number; rt: number }[] };
  assert.equal(json.fp, '062025');
  assert.equal(json.gt, undefined, 'no GSTR-1 turnover fields');
  assert.deepEqual(json.b2b.flatMap((c) => c.inv.map((i) => i.inum)), ['INV/FY25-26/0004']);
  assert.deepEqual(json.b2cs.map((r) => [r.rt, r.txval]), [[18, 500]], 'B2CS written as the difference');
  assert.deepEqual(out.removed.map((r) => r.number), ['INV/FY25-26/0002']);
  assert.equal(GSTR1A_JSON_LAYOUT.verified, false);
});

test('IRN cancel from the bulk response: a CNL row marks the IRN cancelled on the document, not a failure', () => {
  const irn = 'a'.repeat(64);
  const inv = doc({ id: 'k1' });
  const rows = parseIrpResponse(JSON.stringify([{ DocNo: 'INV/FY25-26/0001', Irn: irn, Status: 'CNL', CancelDate: '21/06/2025 10:00:00' }, { DocNo: 'X', Irn: 'b'.repeat(64), Status: 'CNL' }])).rows;
  const res = applyIrpResponse(rows, [inv], [{ invoice_id: 'k1', irn, ack_date: '2025-06-20 09:00:00' }], { now: '2025-06-21T12:00:00Z' });
  assert.equal(res.failed.length, 0);
  assert.deepEqual(res.cancelled.map((c) => c.invoiceId), ['k1']);
  const m = res.meta.find((x) => x.invoice_id === 'k1')!;
  assert.equal(m.irn_cancel?.status, 'done');
  assert.equal(m.irn_cancel?.done_on, '2025-06-21');
  assert.equal(res.unmatched.length, 1, 'a cancelled IRN not recorded on any document is reported');
});

test('time bar: GSTR-6 / 7 / 8 monthly rows (13th / 10th) are listed once they near the three-year bar', () => {
  assert.ok(RETURN_TIME_BAR_RULES.at(-1)!.value!.forms.includes('GSTR7'));
  const g7 = specialReturnDues('GSTR7', '2022-08-01', '2025-09-15');
  assert.equal(g7[0].due, '2022-09-10');
  assert.equal(specialReturnDues('GSTR6', '2022-08-01', '2025-09-15')[0].due, '2022-09-13');
  assert.equal(specialReturnDues('GSTR8', '2018-08-01', '2018-11-01')[0].periodKey, '2018-10', 'no GSTR-8 before 1 Oct 2018');
  const special = specialReturnForms({ gst_special_returns: ['GSTR7'] }, [{ kind: 'INWARD', date: '2022-08-03' }], '2022-08-01');
  assert.deepEqual(special.map((s) => s.form), ['GSTR6', 'GSTR7']);
  const rows = timeBarList({ frequency: 'monthly', today: '2025-09-15', since: '2025-09-01' }, [], '', 30, special);
  assert.ok(rows.some((r) => r.r.form === 'GSTR6' && r.r.periodKey === '2022-08'));
  assert.ok(rows.some((r) => r.r.form === 'GSTR7' && r.bar.barredOn === '2025-09-11'));
});

test('due-date extensions are data rows: the calendar shows the extended day and keeps the regular one', () => {
  assert.ok(DUE_DATE_EXTENSIONS.every((e) => e.verified === false && e.source));
  const cal = complianceCalendar({ frequency: 'monthly', today: '2025-01-31', monthsBack: 2 });
  const g3 = cal.find((r) => r.id === 'GSTR3B:2024-12')!;
  assert.equal(g3.due, '2025-01-22');
  assert.equal(g3.extended_from, '2025-01-20');
  const q = withExtension({ id: 'GSTR3B:2024-Q3', form: 'GSTR3B', periodKey: '2024-Q3', label: '', from: '2024-10-01', to: '2024-12-31', due: '2025-01-24', optional: false }, 'qrmp', '09');
  assert.equal(q.due, '2025-01-26', 'category-Y State gets its own day');
});

/** R2-C3: IMS ITC reduction on credit notes, declared ITC, remarks by date, the working file. */
import './helpers/shim.ts';
import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { resetStorage } from './helpers/shim.ts';
import {
  GSTR2B_ACTIONS_TABLE,
  actionId,
  defaultReduction,
  effectiveDeclaredItc,
  effectiveReduction,
  gstr2bActionsDb,
  imsIssues,
  imsSummary,
  remarkRequired,
  type Gstr2bAction,
  type Gstr2bLine,
  type MatchRow,
} from '../src/lib/gstr2b.ts';
import { IMS_FILE_FORMAT, IMS_LAYOUT_NOTE, buildImsFile, imsFileSheets } from '../src/lib/ims-file.ts';
import { getTable, setTable } from '../src/lib/storage.ts';

const line = (over: Partial<Gstr2bLine>): Gstr2bLine => ({
  key: '', section: 'B2B', ctin: '27AAPFU0939F1ZV', tradeName: 'Acme', number: 'A-1', date: '2025-10-05', docType: 'INV', sign: 1,
  value: 1180, taxable: 1000, pos: '27', reverseCharge: false, itcAvailable: true, reason: '', igst: 0, cgst: 90, sgst: 90, cess: 0, ...over,
});
const inv = line({ number: 'A-1' });
const cn = line({ section: 'CDNR', number: 'CN-7', docType: 'CN', sign: -1, taxable: 200, cgst: 18, sgst: 18, value: 236 });
const cnIgst = line({ section: 'CDNRA', number: 'CN-9', docType: 'CN', sign: -1, taxable: 500, igst: 90, cgst: 0, sgst: 0, cess: 5 });
const rows = (ls: Gstr2bLine[]): MatchRow[] => ls.map((l) => ({ key: `${l.section}|${l.number}`, cls: 'missing_in_books', line: l, diffs: [], taxDiff: 0 }));
const PERIOD = '102025';

beforeEach(() => resetStorage());

test('reduction defaults from the credit note’s tax; rejected notes reduce nothing', () => {
  assert.deepEqual(defaultReduction(cn), { igst: 0, cgst: 18, sgst: 18, cess: 0 });
  assert.deepEqual(defaultReduction(cnIgst), { igst: 90, cgst: 0, sgst: 0, cess: 5 });
  assert.deepEqual(defaultReduction(inv), { igst: 0, cgst: 0, sgst: 0, cess: 0 });
  assert.deepEqual(effectiveReduction(cn, undefined), { igst: 0, cgst: 18, sgst: 18, cess: 0 }, 'deemed accepted');
  const rej = gstr2bActionsDb.set(PERIOD, cn, 'REJECT');
  assert.deepEqual(effectiveReduction(cn, rej), { igst: 0, cgst: 0, sgst: 0, cess: 0 });
  const pend = gstr2bActionsDb.set(PERIOD, cn, 'PENDING');
  assert.equal(effectiveReduction(cn, pend).cgst, 18, 'pending still reduces');
});

test('declared reduction and partial declared ITC are stored and used', () => {
  gstr2bActionsDb.setDetails(PERIOD, cn, { itc_reduction: { igst: 0, cgst: 10, sgst: 10, cess: 0 } });
  gstr2bActionsDb.setDetails(PERIOD, inv, { declared_itc: { igst: 0, cgst: 45, sgst: 45, cess: 0 } });
  const actions = gstr2bActionsDb.forPeriod(PERIOD);
  assert.equal(actions.get(actionId(PERIOD, cn))?.action, 'ACCEPT', 'details alone record a deemed Accept');
  assert.equal(effectiveReduction(cn, actions.get(actionId(PERIOD, cn))).cgst, 10);
  assert.deepEqual(effectiveDeclaredItc(inv, actions.get(actionId(PERIOD, inv))), { igst: 0, cgst: 45, sgst: 45, cess: 0 });
  // Changing the decision keeps the details.
  gstr2bActionsDb.set(PERIOD, cn, 'PENDING');
  assert.equal(gstr2bActionsDb.forPeriod(PERIOD).get(actionId(PERIOD, cn))?.itc_reduction?.cgst, 10);
  // null removes a detail
  gstr2bActionsDb.setDetails(PERIOD, cn, { itc_reduction: null });
  assert.equal(gstr2bActionsDb.forPeriod(PERIOD).get(actionId(PERIOD, cn))?.itc_reduction, undefined);
});

test('summary totals by head and counts', () => {
  gstr2bActionsDb.set(PERIOD, cnIgst, 'REJECT');
  gstr2bActionsDb.setDetails(PERIOD, inv, { declared_itc: { igst: 0, cgst: 45, sgst: 45, cess: 0 } });
  const s = imsSummary({ rows: rows([inv, cn, cnIgst]) }, gstr2bActionsDb.forPeriod(PERIOD), PERIOD);
  assert.equal(s.accepted, 2);
  assert.equal(s.rejected, 1);
  assert.equal(s.pending, 0);
  assert.deepEqual(s.reduction, { igst: 0, cgst: 18, sgst: 18, cess: 0 }, 'only the accepted note');
  assert.deepEqual(s.notClaimed, { igst: 0, cgst: 45, sgst: 45, cess: 0 });
  assert.equal(s.reductionDocs, 1);
  assert.equal(s.partialDocs, 1);
});

test('remark rule by return period (tax-rules), and switchable', () => {
  assert.equal(remarkRequired(cn, 'PENDING', '092025'), false, 'before Oct 2025');
  assert.equal(remarkRequired(cn, 'PENDING', '102025'), true);
  assert.equal(remarkRequired(cn, 'REJECT', '112025'), true);
  assert.equal(remarkRequired(cn, 'ACCEPT', '112025'), false);
  assert.equal(remarkRequired(inv, 'REJECT', '112025'), false, 'invoices: no remark rule');
  assert.equal(remarkRequired(cn, 'PENDING', '102025', false), false, 'user switched the check off');
  gstr2bActionsDb.set(PERIOD, cn, 'PENDING');
  const m = { rows: rows([cn]) };
  assert.equal(imsIssues(m, gstr2bActionsDb.forPeriod(PERIOD), PERIOD).length, 1);
  gstr2bActionsDb.setDetails(PERIOD, cn, { remark: 'Goods not returned yet' });
  assert.equal(imsIssues(m, gstr2bActionsDb.forPeriod(PERIOD), PERIOD).length, 0);
  gstr2bActionsDb.setDetails(PERIOD, cn, { itc_reduction: { igst: 0, cgst: 50, sgst: 0, cess: 0 } });
  assert.match(imsIssues(m, gstr2bActionsDb.forPeriod(PERIOD), PERIOD)[0].message, /more than the note/);
});

test('working file shape (snapshot of keys) and XLSX sheets', () => {
  gstr2bActionsDb.set(PERIOD, cn, 'PENDING');
  gstr2bActionsDb.setDetails(PERIOD, cn, { remark: 'Awaiting return', itc_reduction: { igst: 0, cgst: 18, sgst: 9, cess: 0 } });
  const f = buildImsFile({ rows: rows([inv, cn]) }, gstr2bActionsDb.forPeriod(PERIOD), PERIOD, { gstin: '27aabcu9603r1zx', generatedOn: '2025-11-02T00:00:00.000Z' });
  assert.equal(f.format, IMS_FILE_FORMAT);
  assert.equal(f.note, IMS_LAYOUT_NOTE);
  assert.match(f.note, /unverified/i);
  assert.match(f.note, /verify with your CA/i);
  assert.equal(f.gstin, '27AABCU9603R1ZX');
  assert.deepEqual(Object.keys(f).sort(), ['docs', 'format', 'generated_on', 'gstin', 'issues', 'note', 'rtnprd', 'summary']);
  assert.deepEqual(f.docs[0], {
    section: 'B2B', ctin: '27AAPFU0939F1ZV', trdnm: 'Acme', inum: 'A-1', idt: '2025-10-05', typ: 'INV', txval: 1000, igst: 0, cgst: 90, sgst: 90, cess: 0, action: 'A', deemed: true,
  });
  assert.deepEqual(f.docs[1], {
    section: 'CDNR', ctin: '27AAPFU0939F1ZV', trdnm: 'Acme', inum: 'CN-7', idt: '2025-10-05', typ: 'CN', txval: -200, igst: 0, cgst: -18, sgst: -18, cess: 0, action: 'P', deemed: false,
    itc_reduction: { igst: 0, cgst: 18, sgst: 9, cess: 0 }, remark: 'Awaiting return',
  });
  assert.deepEqual(f.summary.itc_reduction, { igst: 0, cgst: 18, sgst: 9, cess: 0 });
  const sheets = imsFileSheets(f);
  assert.equal(sheets.length, 2);
  assert.equal(sheets[0].rows.length, 3);
  assert.equal(sheets[0].rows[0][11], 'IMS action');
  assert.match(String(sheets[1].rows[0][1]), /unverified/i);
});

test('backward compatible: a stored pre-R2 action reads as before', () => {
  const old: Gstr2bAction = { id: actionId(PERIOD, cn), period: PERIOD, section: 'CDNR', ctin: cn.ctin, inum: 'CN7', action: 'ACCEPT', note: 'ok', updated_at: '2025-11-01T00:00:00Z' };
  setTable(GSTR2B_ACTIONS_TABLE, [old]);
  const a = gstr2bActionsDb.forPeriod(PERIOD).get(old.id);
  assert.equal(a?.action, 'ACCEPT');
  assert.deepEqual(effectiveReduction(cn, a), defaultReduction(cn));
  gstr2bActionsDb.set(PERIOD, cn, 'REJECT');
  const after = getTable<Gstr2bAction>(GSTR2B_ACTIONS_TABLE)[0];
  assert.equal(after.note, 'ok', 'the old note survives a new decision');
  assert.equal('itc_reduction' in after, false, 'no field added unless entered');
});

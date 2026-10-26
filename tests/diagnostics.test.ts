/** Beta "Report a problem": the diagnostic text never carries business data. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDiagnostics, scrubRoute, scrubText, scrubTyped, type DiagnosticsInput } from '../src/lib/diagnostics.ts';
import { clearRouteTrail, maskRoute, pushRoute, recentRoutes } from '../src/lib/route-trail.ts';
import { SHARE_CAP, capForShare, composeFeedback, composeTyped, emptyDraft, mailtoLink, parseDraft, whatsappLink, FEEDBACK_CONTACT } from '../src/lib/feedback.ts';

const base: DiagnosticsInput = {
  appVersion: '3.1.0',
  buildId: 'abc123def456',
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/140',
  uiLanguage: 'hi',
  theme: 'dark',
  online: false,
  standalone: true,
  offlineReady: true,
  viewport: '390×844 @3x',
  pathname: '/invoice/3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f',
  search: '?tab=statements&party=Acme%20Traders',
  errors: [
    '10:01:02 TypeError: x is undefined',
    '10:01:03 Invoice INV/FY26-27/0042 for "Acme Traders" (27AAACB1234M1Z5) failed: ₹1,23,456.00 owed by ravi@example.com, call 9876543210',
  ],
  storage: {
    backend: 'idb', vault: true, failure: null, level: 'warn', pct: 12.4, usedChars: 2_500_000, quotaChars: 50_000_000,
    keyCount: 31, persisted: false, lastBackupIso: '2026-10-01T10:00:00.000Z', findings: ['not-persisted:warn'],
  },
  now: new Date('2026-10-25T08:00:00Z'),
};

test('the report masks names, numbers, GSTINs, e-mails, amounts and record ids', () => {
  const text = buildDiagnostics(base);
  for (const leak of ['Acme', 'Traders', '27AAACB1234M1Z5', 'ravi@example.com', '9876543210', '1,23,456', 'INV/FY26-27/0042', '3f2b8c1e']) {
    assert.ok(!text.includes(leak), `leaked ${leak}`);
  }
  assert.match(text, /Version: 3\.1\.0/);
  assert.match(text, /Build: abc123def456/);
  assert.match(text, /Screen: \/invoice\/:id\?tab=…&party=…/);
  assert.match(text, /TypeError: x is undefined/);
  assert.match(text, /Backend: idb \(vault encryption on\) · Persistent: no/);
  assert.match(text, /Findings: not-persisted:warn/);
  assert.match(text, /Last backup: 2026-10-01/);
});

test('scrubbers and empty states', () => {
  assert.equal(scrubRoute('/', ''), '/');
  assert.equal(scrubRoute('/books', '?tab=coa&m=menu'), '/books?tab=…&m=…');
  assert.equal(scrubText('PAN ABCDE1234F and data:image/png;base64,AAAA'), 'PAN [pan] and [data-url]');
  const empty = buildDiagnostics({ ...base, buildId: null, errors: [], storage: { ...base.storage, lastBackupIso: null, findings: [] } });
  assert.match(empty, /Build: not installed/);
  assert.match(empty, /Last backup: never/);
  assert.match(empty, /\[Recent errors\] \(0, newest last, scrubbed\)\nnone/);
});

/* ── R6-A5 report v2 ─────────────────────────────────────────────────────── */

test('typed text is scrubbed: a GSTIN, a phone and an amount in "What did you do?" are masked', () => {
  const d = { ...emptyDraft('GST reports'), did: 'Billed 27AAACB1234M1Z5 for Rs 12500, call 9876543210, mail a@b.co', expected: '₹ 4,500 total', actual: 'showed 12,500.00' };
  const text = composeTyped(d);
  for (const leak of ['27AAACB1234M1Z5', '12500', '9876543210', 'a@b.co', '4,500', '12,500']) assert.ok(!text.includes(leak), `leaked ${leak}`);
  assert.match(text, /\[gstin\]/);
  assert.match(text, /Severity: Annoying/);
  assert.equal(scrubTyped('Form 194C on GSTR-3B'), 'Form 194C on GSTR-3B', 'section and form codes stay readable');
});

test('an idea has no expected / actual block', () => {
  const text = composeTyped({ ...emptyDraft('POS'), kind: 'idea', did: 'Add a dark receipt', expected: 'x', actual: 'y' });
  assert.match(text, /Kind: Idea/);
  assert.match(text, /Idea:\nAdd a dark receipt/);
  assert.ok(!/expected|instead|Severity/i.test(text));
});

test('the route trail masks ids, keeps tab names, drops repeats and holds 10', () => {
  clearRouteTrail();
  pushRoute({ pathname: '/invoice/3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f', search: '?party=Acme' });
  pushRoute({ pathname: '/invoice/3f2b8c1e-1d2a-4b5c-9e8f-0a1b2c3d4e5f', search: '?party=Acme' });
  pushRoute({ pathname: '/gst-reports', search: '?tab=cdnur&gstin=27AAACB1234M1Z5' });
  assert.deepEqual(recentRoutes(), ['/invoice/:id?party=…', '/gst-reports?tab=cdnur&gstin=…']);
  for (let i = 0; i < 12; i++) pushRoute({ pathname: i % 2 ? '/books' : '/', search: '' });
  assert.equal(recentRoutes().length, 10);
  assert.equal(maskRoute('/clients/12345'), '/clients/:id');
  const text = buildDiagnostics({ ...base, trail: ['/books?tab=tb', '/clients/:id'] });
  assert.match(text, /\[Screens before\] \(2, oldest first\)\n- \/books\?tab=tb\n- \/clients\/:id/);
  assert.ok(!/Screens before/.test(buildDiagnostics(base)), 'no trail, no section');
  clearRouteTrail();
});

test('WhatsApp / e-mail links: no fixed recipient, text capped, full report when it fits', () => {
  assert.equal(FEEDBACK_CONTACT.whatsapp, '');
  assert.equal(FEEDBACK_CONTACT.email, '');
  const d = { ...emptyDraft('Books'), did: 'Opened the trial balance' };
  const diag = buildDiagnostics(base);
  const small = capForShare(d, diag);
  assert.equal(small.shortened, false);
  assert.equal(small.text, composeFeedback(d, diag));
  const long = capForShare(d, diag + '\n' + 'x'.repeat(5000));
  assert.equal(long.shortened, true);
  assert.ok(long.text.length <= SHARE_CAP, `capped at ${long.text.length}`);
  assert.match(long.text, /Opened the trial balance/, 'the typed part is kept, diagnostics shortened first');
  assert.match(long.text, /full report was copied/);
  const huge = capForShare({ ...d, did: 'y'.repeat(4000) }, diag);
  assert.ok(huge.text.length <= SHARE_CAP);
  const wa = whatsappLink(long.text);
  assert.ok(wa.startsWith('https://wa.me/?text='), wa.slice(0, 30));
  assert.equal(decodeURIComponent(wa.slice('https://wa.me/?text='.length)), long.text);
  const mail = mailtoLink('Subject', long.text);
  assert.ok(mail.startsWith('mailto:?subject=Subject&body='));
  assert.ok(whatsappLink('a', '+91 98765 43210').startsWith('https://wa.me/919876543210?text='), 'a future number keeps only its numerals');
  assert.ok(mailtoLink('s', 'b', 'beta@example.com').startsWith('mailto:beta@example.com?'));
});

test('a stored draft is read defensively', () => {
  assert.equal(parseDraft(null), null);
  assert.equal(parseDraft('nope'), null);
  assert.deepEqual(parseDraft(JSON.stringify({ kind: 'idea', did: 'x', severity: 'weird' })), { ...emptyDraft(''), kind: 'idea', did: 'x' });
});

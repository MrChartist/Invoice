/** Beta "Report a problem": the diagnostic text never carries business data. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDiagnostics, scrubRoute, scrubText, type DiagnosticsInput } from '../src/lib/diagnostics.ts';

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

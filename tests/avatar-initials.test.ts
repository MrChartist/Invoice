/** Avatar initials take letters and digits only (docs/theme/IOS-UI.md 2.11; iOS P4). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { initialsOf } from '../src/lib/initials.ts';

test('bracketed notes, punctuation and legal-form words never become initials', () => {
  assert.equal(initialsOf('Lotus Clinics Pvt Ltd (demo)'), 'LC');
  assert.equal(initialsOf('Saffron Hospitality (demo)'), 'SH');
  assert.equal(initialsOf('(demo)'), '?');
  assert.equal(initialsOf('  '), '?');
  assert.equal(initialsOf('acme'), 'AC');
  assert.equal(initialsOf('M/s. Sharma & Sons'), 'MS');
  assert.equal(initialsOf('Ltd Holdings'), 'LH');
  assert.equal(initialsOf('रमेश कुमार'), 'रक');
  assert.equal(initialsOf('3M India'), '3I');
});

test('avatar colours are icon-tile tokens, never raw hex', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'src/components/ui/Avatar.tsx'), 'utf8');
  assert.doesNotMatch(src, /#[0-9a-f]{3,8}\b/i);
  assert.match(src, /var\(--sys-\$\{c\}-tile\)/);
});

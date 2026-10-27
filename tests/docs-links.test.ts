/**
 * R6-C6: the documents tell the truth about what exists — every feature doc the roadmap names is present, and every
 * CA item id cited by the in-app help (R6-A2, `src/lib/help/*`, guarded until it is merged) exists in CA_REVIEW.md.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const read = (p: string) => readFileSync(p, 'utf8');

test('every docs/features/*.md path named in the roadmap exists', () => {
  const roadmap = read('docs/ROADMAP.md');
  const named = [...new Set(roadmap.match(/docs\/features\/[a-z0-9-]+\.md/g) ?? [])];
  assert.ok(named.length > 40, 'the roadmap names its feature docs');
  const missing = named.filter((p) => !existsSync(p));
  assert.deepEqual(missing, []);
});

test('CA_REVIEW ids are unique, and every id the help cites exists there', () => {
  const full = read('docs/CA_REVIEW.md');
  // The R6-C notes section only cites ids; every other section defines them (Rounds 7–8 append HT / TR sections).
  const notesAt = full.indexOf('## Round 6 (R6-C)');
  const notesEnd = notesAt < 0 ? -1 : full.indexOf('\n## ', notesAt + 1);
  const ca = notesAt < 0 ? full : full.slice(0, notesAt) + (notesEnd < 0 ? '' : full.slice(notesEnd));
  const rows = [...ca.matchAll(/^\| ([A-Z]{1,2}\d+)(?: ★)? \|/gm)].map((m) => m[1]);
  const total = Number(/^\| \*\*Total\*\* \| \| \*\*(\d+)\*\* \|/m.exec(full)?.[1]);
  assert.ok(rows.length >= 160, 'the pack keeps at least its 160 Round 2–5 items');
  assert.equal(rows.length, total, 'the summary table total matches the id rows');
  assert.equal(new Set(rows).size, rows.length, 'no id twice');
  const ids = new Set(rows);
  const helpDir = 'src/lib/help';
  if (!existsSync(helpDir)) return; // R6-A2 not merged on this branch yet
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx|json)$/.test(f)) files.push(p);
    }
  };
  walk(helpDir);
  const cited = new Set<string>();
  for (const f of files) for (const m of read(f).matchAll(/CA_REVIEW[^\n]*?\b((?:G|T|P|AC|I|X|CN|SV)\d{1,2})\b/g)) cited.add(m[1]);
  for (const f of files) for (const m of read(f).matchAll(/\bca:\s*\[([^\]]*)\]/g)) for (const id of m[1].match(/(?:CN|SV|G|T|P|AC|I|X)\d{1,2}/g) ?? []) cited.add(id);
  assert.deepEqual([...cited].filter((id) => !ids.has(id)), []);
});

test('feature docs that hand statutory points to a CA point at the consolidated pack', () => {
  for (const doc of ['collections-r2', 'sales-r2', 'docs-compliance-r3', 'production-r4', 'marketplace-r5', 'transport-works-r5', 'institutions-property-r5']) {
    assert.match(read(`docs/features/${doc}.md`), /Consolidated in `docs\/CA_REVIEW\.md` \(ids /, doc);
  }
});

/**
 * 5.4 round 2: every per-area catalogue (src/i18n/areas/*.ts) has Hindi for every key, non-empty,
 * with the same {placeholders} as English.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, '../src/i18n/areas');
const files = (() => {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.ts'));
  } catch {
    return [];
  }
})();
const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');

test('area catalogues: Hindi complete, non-empty, placeholders match', async () => {
  for (const f of files) {
    const mod = (await import(join(dir, f))) as Record<string, unknown>;
    for (const [name, value] of Object.entries(mod)) {
      const area = value as { en?: Record<string, string>; hi?: Record<string, string> };
      if (typeof value !== 'function' || !area.en || !area.hi) continue;
      for (const [k, en] of Object.entries(area.en)) {
        const hi = area.hi[k];
        assert.ok(typeof hi === 'string' && hi.trim() !== '', `${f} ${name}.${k}: missing Hindi`);
        assert.equal(ph(hi), ph(en), `${f} ${name}.${k}: placeholders differ`);
      }
      assert.deepEqual(Object.keys(area.hi).sort(), Object.keys(area.en).sort(), `${f} ${name}: extra or missing keys`);
    }
  }
});

test('defineArea falls back to English and fills placeholders', async () => {
  const { defineArea } = await import('../src/i18n/area.ts');
  const { setCatalogueForTests, resetI18nForTests, setLanguage } = await import('../src/i18n/index.ts');
  const a = defineArea({ hello: 'Hello {name}', only: 'Only English' } as const, { hello: 'नमस्ते {name}', only: '' });
  resetI18nForTests();
  assert.equal(a('hello', { name: 'Asha' }), 'Hello Asha');
  setCatalogueForTests('hi', {});
  await setLanguage('hi', { persist: false });
  assert.equal(a('hello', { name: 'Asha' }), 'नमस्ते Asha');
  assert.equal(a('only'), 'Only English', 'empty Hindi falls back to English');
  resetI18nForTests();
});

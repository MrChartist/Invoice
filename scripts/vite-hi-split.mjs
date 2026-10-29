/**
 * R16-A1: Hindi out of the English chunks (build only).
 *
 * Area files keep `defineArea(en, hi)` exactly as written (the typecheck still forces every Hindi key). At build time
 * this plugin rewrites the `hi` argument of every call into a loader of a virtual module,
 *
 *   defineArea({ title: 'GST returns' }, { title: 'GST रिटर्न' })
 *   → defineArea({ title: 'GST returns' }, () => import('virtual:hi/gst/gst~1a2b3c4d'))
 *
 * and the `lang-hi-<family>` chunk group (vite.config.ts, `langChunkName`) collects those modules per string family, so
 * an English device never downloads (or precaches) a Hindi byte. `src/i18n/area.ts` loads the object when the language
 * is Hindi. `npm run dev` is unchanged (`apply: 'build'`).
 *
 * Fail-loud: a `hi` argument that is not a static object of string literals fails the build, unless its file is in
 * `HI_INLINE` (code that reads `someT.hi` directly — a bilingual print — must keep the object inline; see
 * tests/hi-split.test.ts, which greps for such readers).
 *
 * `generateBundle` writes `dist/lang-manifest.json` ({ hi: [files], regional: [files] }), computed from each chunk's
 * module ids (never from file names); scripts/gen-precache.mjs turns it into the service worker's language packs.
 */
import { createHash } from 'node:crypto';
import { relative, sep } from 'node:path';
import { parseAst } from 'rolldown/parseAst';

/** Area files whose `.hi` object is read directly by code (bilingual output): their Hindi stays inline. */
export const HI_INLINE = [
  'src/i18n/areas/gateway.ts', // GatewayMenu shows the other language beside each item (gwT.hi)
  'src/i18n/areas/construction-r11-paper.ts', // works-text.ts prints the bilingual works paper (cnPaperT.hi)
];

const VIRTUAL = 'virtual:hi/';
const RESOLVED = '\0' + VIRTUAL;
/** The Hindi shell catalogue (`hi.ts`), the Hindi of `src/lib` messages (`hi-lib.ts`, PENDING 51) and the regional catalogues (`regional.ts` + its six languages). */
const HI_CORE = /[\\/]src[\\/]i18n[\\/]hi(-lib)?\.ts$/;
const REGIONAL = /[\\/]src[\\/]i18n[\\/](regional|mr|gu|ta|bn|te|kn)\.ts$/;

/**
 * String family of a file (posix path relative to the project): an area file's name up to its first `-` segment
 * (`prof-r14a-matters` → `prof`, `gst-views` → `gst`, `extras-7u` → `extras`); any other file uses its folder name
 * (`src/components/dashboard/DashboardTiles.tsx` → `dashboard`, `src/pages/Books.tsx` → `pages`).
 */
export function familyOf(rel) {
  const parts = rel.split('/');
  const file = parts[parts.length - 1].replace(/\.[cm]?[jt]sx?$/, '');
  if (rel.startsWith('src/i18n/areas/')) return file.split('-')[0].replace(/\d.*$/, '').toLowerCase() || 'misc';
  return (parts[parts.length - 2] || 'misc').toLowerCase().replace(/[^a-z0-9]+/g, '-');
}

/** Which language pack a module belongs to (`hi`, `regional`) or null for English / shared code. */
export function langPackOf(id) {
  if (id.startsWith(RESOLVED) || HI_CORE.test(id)) return 'hi';
  if (REGIONAL.test(id)) return 'regional';
  return null;
}

/** `codeSplitting` group name function: `lang-hi-<family>`, `lang-hi-core`, `lang-regional`, else null. */
export function langChunkName(id) {
  if (id.startsWith(RESOLVED)) return 'lang-hi-' + id.slice(RESOLVED.length).split('/')[0];
  if (HI_CORE.test(id)) return 'lang-hi-core';
  if (REGIONAL.test(id)) return 'lang-regional';
  return null;
}

/** A static string: a literal, a template without expressions, or a `+` of those. Else undefined. */
function staticString(node) {
  if (!node) return undefined;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis.map((q) => q.value.cooked).join('');
  if (node.type === 'BinaryExpression' && node.operator === '+') {
    const l = staticString(node.left);
    const r = staticString(node.right);
    return l === undefined || r === undefined ? undefined : l + r;
  }
  if (node.type === 'ParenthesizedExpression') return staticString(node.expression);
  return undefined;
}

const unwrap = (n) => (n && (n.type === 'TSAsExpression' || n.type === 'TSSatisfiesExpression' || n.type === 'ParenthesizedExpression' || n.type === 'TSNonNullExpression') ? unwrap(n.expression) : n);

/** The `hi` object of a call as plain data, or a reason why it is not static. */
export function staticObject(node) {
  const obj = unwrap(node);
  if (!obj || obj.type !== 'ObjectExpression') return { error: `not an object literal (${obj?.type ?? 'missing'})` };
  const data = {};
  for (const p of obj.properties) {
    if (p.type !== 'Property' || p.kind !== 'init' || p.method) return { error: `${p.type === 'SpreadElement' ? 'a spread' : 'a method / accessor'} in the object` };
    let key;
    if (!p.computed && p.key.type === 'Identifier') key = p.key.name;
    else if (p.key.type === 'Literal' && (typeof p.key.value === 'string' || typeof p.key.value === 'number')) key = String(p.key.value);
    else key = p.computed ? staticString(p.key) : undefined;
    if (key === undefined) return { error: 'a computed key' };
    const value = staticString(p.shorthand ? null : p.value);
    if (value === undefined) return { error: `key "${key}" is not a string literal` };
    data[key] = value;
  }
  return { data };
}

function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) walk(n, visit);
    return;
  }
  if (typeof node.type === 'string') visit(node);
  for (const k in node) {
    if (k === 'start' || k === 'end' || k === 'type') continue;
    const v = node[k];
    if (v && typeof v === 'object') walk(v, visit);
  }
}

const lineOf = (code, at) => code.slice(0, at).split('\n').length;

/**
 * Rewrite every `defineArea(en, hi)` of one file. Returns null when nothing changes, else the new code and the
 * virtual modules it now imports. Throws on a non-static `hi` argument.
 */
export function splitHindi(code, rel) {
  if (!code.includes('defineArea(') || HI_INLINE.includes(rel)) return null;
  const ast = parseAst(code, { lang: rel.endsWith('x') ? 'tsx' : 'ts' }, rel);
  const calls = [];
  walk(ast, (n) => {
    if (n.type === 'CallExpression' && n.callee.type === 'Identifier' && n.callee.name === 'defineArea') calls.push(n);
  });
  if (!calls.length) return null;
  const family = familyOf(rel);
  const base = rel.split('/').pop().replace(/\.[cm]?[jt]sx?$/, '');
  const modules = [];
  const edits = [];
  calls.forEach((call, i) => {
    const where = `${rel}:${lineOf(code, call.start)}`;
    if (call.arguments.length !== 2) throw new Error(`hi-split: ${where}: defineArea needs exactly (en, hi)`);
    const arg = call.arguments[1];
    const { data, error } = staticObject(arg);
    if (error) {
      throw new Error(`hi-split: ${where}: the Hindi argument of defineArea must be a static object of string literals (${error}); ` +
        'write it out, or add the file to HI_INLINE in scripts/vite-hi-split.mjs with a reason');
    }
    const json = JSON.stringify(data);
    const hash = createHash('sha256').update(`${rel}#${i}\n${json}`).digest('hex').slice(0, 8);
    const id = `${VIRTUAL}${family}/${base}~${hash}`;
    modules.push({ id, family, data, json });
    edits.push({ start: arg.start, end: arg.end, text: `() => import(${JSON.stringify(id)})` });
  });
  let out = code;
  for (const e of edits.sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { code: out, modules };
}

/** The language packs of a bundle: chunk file names per pack, from the chunks' module ids. Throws on a mixed chunk. */
export function langManifest(bundle) {
  const packs = { hi: [], regional: [] };
  for (const chunk of Object.values(bundle)) {
    if (chunk.type !== 'chunk') continue;
    const ids = Object.keys(chunk.modules ?? {}).length ? Object.keys(chunk.modules) : (chunk.moduleIds ?? []);
    const kinds = new Set(ids.map(langPackOf));
    if (kinds.size === 1 && !kinds.has(null)) {
      packs[[...kinds][0]].push(chunk.fileName);
    } else if ([...kinds].some((k) => k !== null)) {
      const stray = ids.filter((id) => langPackOf(id) === null).slice(0, 3).join(', ');
      throw new Error(`hi-split: chunk ${chunk.fileName} mixes language-pack modules with app code (${stray}); check the lang group in vite.config.ts`);
    }
  }
  for (const k of Object.keys(packs)) packs[k].sort();
  return packs;
}

/** The Vite plugin (build only). */
export function hiSplit({ root = process.cwd() } = {}) {
  const virtual = new Map();
  let calls = 0;
  return {
    name: 'hi-split',
    apply: 'build',
    enforce: 'pre',
    buildStart() {
      virtual.clear();
      calls = 0;
    },
    resolveId(source) {
      if (source.startsWith(VIRTUAL)) return '\0' + source;
      return null;
    },
    load(id) {
      if (!id.startsWith(RESOLVED)) return null;
      const m = virtual.get(id.slice(1));
      if (!m) this.error(`hi-split: unknown Hindi module ${id.slice(1)}`);
      return { code: `export default ${m.json};\n`, moduleType: 'js' };
    },
    transform(code, id) {
      if (id.includes('\0') || id.includes('node_modules') || !/\.tsx?$/.test(id)) return null;
      const rel = relative(root, id.split('?')[0]).split(sep).join('/');
      if (!rel.startsWith('src/') || rel === 'src/i18n/area.ts') return null;
      const r = splitHindi(code, rel);
      if (!r) return null;
      for (const m of r.modules) virtual.set(m.id, m);
      calls += r.modules.length;
      return { code: r.code, map: null };
    },
    generateBundle(_opts, bundle) {
      const packs = langManifest(bundle);
      if (calls > 0 && packs.hi.length === 0) this.error('hi-split: Hindi modules were split but no lang-hi chunk was emitted');
      this.emitFile({ type: 'asset', fileName: 'lang-manifest.json', source: JSON.stringify({ calls, ...packs }, null, 1) + '\n' });
    },
  };
}

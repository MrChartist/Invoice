/**
 * PERF-7: app code imports React, the router and Vite's preload helper through first-paint re-export modules (build
 * only).
 *
 * Every lazy chunk is gzipped on its own, so what each chunk repeats is paid ~900 times in the core precache:
 *  - `react`, `react/jsx-runtime` and `react-dom` are CommonJS, so rolldown wrapped them in every chunk that used them:
 *    `import{r as e}from"./rolldown-runtime-….js";…var p=e(t(),1)` (the `__toESM` interop, ~420 chunks), and every use
 *    was a property read on that wrapper, `(0,m.jsx)(…)` / `(0,p.useState)(…)` (~37,000 JSX calls);
 *  - `react-router-dom` and Vite's preload helper live in vendor-react, so ~300 chunks carried an extra
 *    `import{…}from"./vendor-react-….js"` statement beside the one they already have for the entry chunk.
 *
 * `vendorEsm()` resolves those ids, imported from `src/`, to a virtual module that binds each name once and exports
 * it as an ES binding of its own. It is imported by the shell, so it lands in the entry chunk (`$initial`), and lazy
 * chunks import `jsx` / `useState` / `Link` / `__vitePreload` from the entry like any other first-paint export: one import
 * statement, a plain call `n(…)`. The values are the very same functions and objects (none of these exports is ever
 * reassigned), so nothing the app does changes; node modules keep importing the originals.
 *
 * Names: CommonJS ids re-export the export names of the installed production build; ESM ids re-export the names that
 * `src/` imports (scanned at build start, kept only if the package exports them: a type-only name is skipped). A name
 * the module lacks fails the build (missing export), never silently.
 */
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseAst } from 'rolldown/parseAst';

const require = createRequire(import.meta.url);
/** CommonJS ids → [package, production file] whose export names the virtual module re-exports. */
export const CJS_IDS = {
  react: ['react', 'react.production.js'],
  'react/jsx-runtime': ['react', 'react-jsx-runtime.production.js'],
  'react-dom': ['react-dom', 'react-dom.production.js'],
};
/** ESM ids whose app-imported names the virtual module re-exports. Measured and left out: `lucide-react` (core ±0,
 * first paint +2.6 kB: the icons' bindings move into the entry) and `zustand/react/shallow` (core +0.4 kB). */
export const ESM_IDS = ['react-router-dom'];
/** Vite's dynamic-import preload helper (injected into every module with an `import()`; react-router's own `import()`
 * puts it in vendor-react). */
export const PRELOAD_HELPER = '\0vite/preload-helper.js';
const PREFIX = '\0vendor-esm:';
const IDENT = /^[A-Za-z_$][\w$]*$/;

/** Export names of a CommonJS id (internal `__…` names left out: nothing in the app may use them). */
export function cjsNames(id, req = require) {
  const [pkg, file] = CJS_IDS[id];
  const dir = dirname(req.resolve(`${pkg}/package.json`));
  return Object.keys(req(join(dir, 'cjs', file))).filter((n) => IDENT.test(n) && !n.startsWith('__') && n !== 'default');
}

/** Value names `code` imports from each of `ids` (`import type` / `type X` specifiers skipped). */
export function importedNames(code, file, ids, out = new Map()) {
  if (!ids.some((id) => code.includes(`'${id}'`) || code.includes(`"${id}"`))) return out;
  const ast = parseAst(code, { lang: file.endsWith('x') ? 'tsx' : 'ts' }, file);
  for (const s of ast.body) {
    if (s.type !== 'ImportDeclaration' || s.importKind === 'type' || !ids.includes(s.source.value)) continue;
    for (const sp of s.specifiers) {
      if (sp.type !== 'ImportSpecifier') throw new Error(`${file}: vendor-esm handles named imports from ${s.source.value} only`);
      if (sp.importKind === 'type') continue;
      const name = sp.imported.type === 'Identifier' ? sp.imported.name : sp.imported.value;
      if (!out.has(s.source.value)) out.set(s.source.value, new Set());
      out.get(s.source.value).add(name);
    }
  }
  return out;
}

function scanSrc(root, ids) {
  const out = new Map();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts')) importedNames(readFileSync(p, 'utf8'), p, ids, out);
    }
  };
  walk(join(root, 'src'));
  return out;
}

/** The virtual module: bind each name once (default export too, for CommonJS), export it as the module's own. */
export function vendorEsmCode(id, names, { cjs = false } = {}) {
  const src = JSON.stringify(id);
  if (cjs) return `import M from ${src};\nexport default M;\nexport const { ${names.join(', ')} } = M;\n`;
  const local = names.map((n, i) => `${n} as v${i}`).join(', ');
  return `import { ${local} } from ${src};\nexport const ${names.map((n, i) => `${n} = v${i}`).join(', ')};\n`;
}

const fromSrc = (importer) => !!importer && !importer.startsWith('\0') && /[\\/]src[\\/]/.test(importer) && !/[\\/]node_modules[\\/]/.test(importer);

export function vendorEsm({ root = process.cwd(), req = require, esmIds = ESM_IDS } = {}) {
  let esm = new Map();
  return {
    name: 'vendor-esm',
    apply: 'build',
    buildStart() {
      esm = scanSrc(root, esmIds);
    },
    resolveId: {
      order: 'pre',
      handler(source, importer) {
        if (!fromSrc(importer)) return null;
        if (source === PRELOAD_HELPER || Object.hasOwn(CJS_IDS, source) || esmIds.includes(source)) return PREFIX + source;
        return null;
      },
    },
    load(id) {
      if (!id.startsWith(PREFIX)) return null;
      const src = id.slice(PREFIX.length);
      let code;
      if (src === PRELOAD_HELPER) code = `import { __vitePreload as p } from ${JSON.stringify(PRELOAD_HELPER)};\nexport const __vitePreload = p;\n`;
      else if (Object.hasOwn(CJS_IDS, src)) code = vendorEsmCode(src, cjsNames(src, req), { cjs: true });
      else {
        const exported = new Set(Object.keys(req(src)));
        const names = [...(esm.get(src) ?? [])].filter((n) => exported.has(n)).sort();
        code = vendorEsmCode(src, names);
      }
      return { code, moduleSideEffects: false };
    },
  };
}

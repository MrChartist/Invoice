/**
 * R16-A2: "safe" code-splitting groups (build only).
 *
 * Rolldown pulls a captured module's static dependencies into its group. A group that captures a module importing
 * shared lazy code therefore drags that code along (QA17 / R16 §2.3: a naive `src/lib/trade/` group swallowed Books,
 * GST reports and the ledger). These groups only capture modules for which nothing can be dragged:
 *
 *  - `safeFamilyGroup(name, re, priority)`: a module matching `re` whose static imports are all first-paint
 *    (`$initial`), a vendor-group module, or family modules that pass the same test. Computed over strongly connected
 *    components, so a cycle passes only if the whole component passes.
 *  - `leafGroup(name, priority, { maxModuleSize })`: a lazy `src/lib/**` module whose static imports are all
 *    first-paint / vendor (a "leaf"), up to `maxModuleSize` bytes.
 *
 * `graphPlugin()` records the module graph once the build has loaded every module (`buildEnd`), and writes
 * `build-meta/chunks.json` (outside dist/, never precached) for the post-build checks in check-bundle-size.mjs.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

/** Shared graph state between the plugin (writer) and the group functions (readers). */
export function createGraph({ vendor = [], root = process.cwd() } = {}) {
  return { vendor, root, imports: new Map(), entries: new Set(), initial: null, safe: new Map(), families: new Map() };
}

export const isVendor = (g, id) => g.vendor.some((re) => re.test(id));
const isRuntime = (id) => id.startsWith('\0rolldown/runtime') || id === 'rolldown:runtime';

/** First-paint modules: everything statically reachable from an entry (rolldown's `$initial`). */
export function initialSet(g) {
  if (g.initial) return g.initial;
  const seen = new Set();
  const stack = [...g.entries];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    for (const d of g.imports.get(id) ?? []) if (!seen.has(d)) stack.push(d);
  }
  g.initial = seen;
  return seen;
}

/** A dependency that can never be dragged into a lazy group: first paint, a vendor group, or the runtime. */
function fixed(g, id) {
  return initialSet(g).has(id) || isVendor(g, id) || isRuntime(id);
}

/**
 * The modules matching `member` that are safe to capture: Tarjan SCCs over the candidates (members not on first
 * paint), then a component is safe iff every outside import of its modules is fixed and every component it imports
 * is safe. Iterative, so deep graphs do not overflow the stack.
 */
export function safeSet(g, member) {
  const initial = initialSet(g);
  const cand = [...g.imports.keys()].filter((id) => member(id) && !initial.has(id));
  const inCand = new Set(cand);
  const index = new Map();
  const low = new Map();
  const onStack = new Set();
  const stack = [];
  const comp = new Map();
  const comps = [];
  let next = 0;
  for (const start of cand) {
    if (index.has(start)) continue;
    const work = [[start, 0]];
    index.set(start, next);
    low.set(start, next++);
    stack.push(start);
    onStack.add(start);
    while (work.length) {
      const frame = work[work.length - 1];
      const [v] = frame;
      const deps = (g.imports.get(v) ?? []).filter((d) => inCand.has(d));
      if (frame[1] < deps.length) {
        const w = deps[frame[1]++];
        if (!index.has(w)) {
          index.set(w, next);
          low.set(w, next++);
          stack.push(w);
          onStack.add(w);
          work.push([w, 0]);
        } else if (onStack.has(w)) low.set(v, Math.min(low.get(v), index.get(w)));
        continue;
      }
      work.pop();
      if (work.length) {
        const parent = work[work.length - 1][0];
        low.set(parent, Math.min(low.get(parent), low.get(v)));
      }
      if (low.get(v) === index.get(v)) {
        const members = [];
        let w;
        do {
          w = stack.pop();
          onStack.delete(w);
          comp.set(w, comps.length);
          members.push(w);
        } while (w !== v);
        comps.push(members);
      }
    }
  }
  // Tarjan emits components in reverse topological order: every component a component imports comes first.
  const ok = new Array(comps.length).fill(false);
  comps.forEach((members, c) => {
    ok[c] = members.every((id) => (g.imports.get(id) ?? []).every((d) => (inCand.has(d) ? comp.get(d) === c || ok[comp.get(d)] : fixed(g, d))));
  });
  return new Set(cand.filter((id) => ok[comp.get(id)]));
}

/** A lazy module whose static imports are all fixed (first paint / vendor / runtime). */
export function isLeaf(g, id) {
  return !initialSet(g).has(id) && (g.imports.get(id) ?? []).every((d) => fixed(g, d));
}

const rel = (g, id) => (id.startsWith(g.root) ? relative(g.root, id).split(sep).join('/') : id.replace(/\0/g, ''));

/** A family group: `test` matches the family's files; only safe members are captured. */
export function safeFamilyGroup(g, name, re, priority) {
  g.families.set(name, re);
  return {
    name: (id) => {
      if (!re.test(id)) return null;
      let safe = g.safe.get(name);
      if (!safe) g.safe.set(name, (safe = safeSet(g, (m) => re.test(m))));
      return safe.has(id) ? name : null;
    },
    priority,
  };
}

const LIB = /[\\/]src[\\/]lib[\\/][^\0]*\.tsx?$/;

/** The lazy-leaves group: small `src/lib` leaves (≤ maxModuleSize bytes). */
export function leafGroup(g, name, priority, { maxModuleSize }) {
  return { name: (id) => (LIB.test(id) && isLeaf(g, id) ? name : null), priority, maxModuleSize };
}

/** Records the graph and writes build-meta/chunks.json. */
export function graphPlugin(g) {
  return {
    name: 'safe-groups-graph',
    apply: 'build',
    buildStart() {
      g.imports.clear();
      g.entries.clear();
      g.initial = null;
      g.safe.clear();
    },
    buildEnd() {
      for (const id of this.getModuleIds()) {
        const info = this.getModuleInfo(id);
        if (!info) continue;
        g.imports.set(id, [...(info.importedIds ?? [])]);
        if (info.isEntry) g.entries.add(id);
      }
      g.initial = null;
    },
    generateBundle(_opts, bundle) {
      const initial = initialSet(g);
      const chunks = {};
      const modules = {};
      for (const c of Object.values(bundle)) {
        if (c.type !== 'chunk') continue;
        const ids = Object.keys(c.modules ?? {});
        chunks[c.fileName] = { name: c.name, entry: c.isEntry, modules: ids.map((id) => rel(g, id)) };
        if (/^(f-|lazy-leaves)/.test(c.name)) {
          for (const id of ids) modules[rel(g, id)] = (g.imports.get(id) ?? []).map((d) => ({ id: rel(g, d), fixed: fixed(g, d) }));
        }
      }
      const out = join(g.root, 'build-meta');
      mkdirSync(out, { recursive: true });
      const families = Object.fromEntries([...g.families].map(([n, re]) => [n, re.source]));
      writeFileSync(join(out, 'chunks.json'), JSON.stringify({ initialModules: initial.size, families, chunks, imports: modules }, null, 1));
    },
  };
}

/**
 * A family's files: `src/lib/<dir>/**`, `src/lib/<rules>.ts` and the area files whose name starts with `area`
 * (`-pick` areas excluded: the setup wizard imports those).
 */
export function familyRe(dir, rules, area) {
  const S = String.raw`[\\/]`;
  const lib = [`${dir}${S}[^\0]*`, rules].filter(Boolean).join('|');
  return new RegExp(String.raw`${S}src${S}(?:lib${S}(?:${lib})\.tsx?|i18n${S}areas${S}${area}(?![^\\/]*-pick)[^\\/]*\.ts)$`);
}

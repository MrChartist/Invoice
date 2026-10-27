// Temporary (QA17 size analysis; deleted before commit).
import { defineConfig, mergeConfig } from 'vite';
import { writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import base from './vite.config';

export default mergeConfig(base, defineConfig({
  plugins: [{
    name: 'qa17-analyze',
    generateBundle(_o, bundle) {
      const out: string[] = [];
      for (const c of Object.values(bundle)) {
        if (c.type !== 'chunk') continue;
        const gz = gzipSync(c.code, { level: 9 }).length;
        const mods = Object.entries(c.modules).map(([id, m]) => [id.replace(/^.*\/src\//, 'src/').replace(/^.*node_modules\//, 'nm/'), m.renderedLength] as const).sort((a, b) => b[1] - a[1]);
        out.push(`${gz}\t${c.fileName}\timports:${c.imports.length}\tdyn:${c.dynamicImports.length}\t${mods.map(([i, l]) => `${i}:${l}`).join(' ')}`);
      }
      writeFileSync(process.env.QA17_OUT || 'qa17-chunks.txt', out.join('\n'));
    },
  }],
}));

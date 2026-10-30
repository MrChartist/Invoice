import type { Plugin } from 'vite';
export declare function preloadTrim(): {
  plugin: Plugin;
  resolveDependencies: (filename: string, deps: string[], ctx: { hostId: string; hostType: 'html' | 'js' }) => string[];
  firstPaint: Set<string>;
};
export declare const MAP_NAME: string;
export declare function compactMapDeps(code: string, file?: string): string | null;
export declare function mapDepsCompact(): Plugin;

import type { Plugin } from 'vite';
export declare function preloadTrim(): {
  plugin: Plugin;
  resolveDependencies: (filename: string, deps: string[], ctx: { hostId: string; hostType: 'html' | 'js' }) => string[];
  firstPaint: Set<string>;
};

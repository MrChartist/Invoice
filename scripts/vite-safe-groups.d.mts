import type { Plugin } from 'vite';
export interface Graph {
  vendor: RegExp[];
  root: string;
  imports: Map<string, string[]>;
  entries: Set<string>;
  initial: Set<string> | null;
  importers: Map<string, number> | null;
  safe: Map<string, Set<string>>;
  families: Map<string, RegExp>;
}
export interface SafeGroup { name: (id: string) => string | null; priority: number; maxModuleSize?: number }
export declare function createGraph(opts?: { vendor?: RegExp[]; root?: string }): Graph;
export declare function isVendor(g: Graph, id: string): boolean;
export declare function initialSet(g: Graph): Set<string>;
export declare function safeSet(g: Graph, member: (id: string) => boolean): Set<string>;
export declare function isLeaf(g: Graph, id: string): boolean;
export declare function safeFamilyGroup(g: Graph, name: string, re: RegExp, priority: number): SafeGroup;
export declare const UI_LEAF: RegExp;
export declare function leafGroup(g: Graph, name: string, priority: number, opts: { maxModuleSize: number; test?: RegExp; pure?: boolean; read?: (id: string) => string }): SafeGroup;
/** PERF-6: every rule of a CSS module is local (a class in every selector; no :global, element, @page …). */
export declare function cssIsLocal(css: string): boolean;
/** PERF-6: top-level statements that may do something at load (empty = none). */
export declare function loadEffects(code: string, file: string): string[];
export declare function cssMapGroup(g: Graph, name: string, priority: number, opts: { maxCssSize: number; minImporters?: number; read?: (id: string) => string }): SafeGroup;
export declare function graphPlugin(g: Graph): Plugin;
export declare function familyRe(dir: string, rules: string | null, area: string, except?: string): RegExp;

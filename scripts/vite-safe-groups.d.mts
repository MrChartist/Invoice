import type { Plugin } from 'vite';
export interface Graph {
  vendor: RegExp[];
  root: string;
  imports: Map<string, string[]>;
  entries: Set<string>;
  initial: Set<string> | null;
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
export declare function leafGroup(g: Graph, name: string, priority: number, opts: { maxModuleSize: number }): SafeGroup;
export declare function graphPlugin(g: Graph): Plugin;
export declare function familyRe(dir: string, rules: string | null, area: string): RegExp;

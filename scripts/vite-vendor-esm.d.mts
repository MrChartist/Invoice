import type { Plugin } from 'vite';
export declare const CJS_IDS: Record<string, [pkg: string, file: string]>;
export declare const ESM_IDS: string[];
export declare const PRELOAD_HELPER: string;
export declare function cjsNames(id: string, req?: NodeJS.Require): string[];
export declare function importedNames(code: string, file: string, ids: string[], out?: Map<string, Set<string>>): Map<string, Set<string>>;
export declare function vendorEsmCode(id: string, names: string[], opts?: { cjs?: boolean }): string;
export declare function vendorEsm(opts?: { root?: string; req?: NodeJS.Require; esmIds?: string[] }): Plugin;

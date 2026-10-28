import type { Plugin } from 'vite';
export declare const HI_INLINE: string[];
export declare function familyOf(rel: string): string;
export declare function langPackOf(id: string): 'hi' | 'regional' | null;
export declare function langChunkName(id: string): string | null;
export declare function staticObject(node: unknown): { data?: Record<string, string>; error?: string };
export declare function splitHindi(code: string, rel: string): { code: string; modules: { id: string; family: string; data: Record<string, string>; json: string }[] } | null;
export declare function langManifest(bundle: Record<string, unknown>): { hi: string[]; regional: string[] };
export declare function hiSplit(opts?: { root?: string }): Plugin;

/**
 * Files shared INTO the app (roadmap 8.20 / 8.23, Web Share Target).
 *
 * The installed PWA declares a `share_target` (public/manifest.json). Android's share sheet then
 * POSTs the file to `/share-target`; the service worker (public/sw.js) puts each file into the
 * `mci-share` cache — on this device, nothing is uploaded — and redirects to `/share-target`, where
 * `ShareTarget.tsx` reads them back with {@link readSharedFiles} (which empties the cache), sorts them
 * with {@link classifyShared} and hands them over in memory ({@link stashShared} / {@link takeShared})
 * to the screen that already knows the file:
 *
 *  - a backup (`.json` / `.txt`) → Settings → Security → restore (owner only; validation, passphrase
 *    for encrypted files and the restore undo copy are that screen's existing steps);
 *  - an image / PDF → Expenses → new expense with the file attached (attachments.ts checks it);
 *  - a `.csv` / `.xlsx` → Reconcile → bank-statement import.
 *
 * Pure except `readSharedFiles` (Cache Storage, browser only).
 */

export type SharedKind = 'backup' | 'receipt' | 'statement';

export const SHARE_CACHE = 'mci-share';
/** Largest file read back from the share cache (same cap as a backup restore). */
export const MAX_SHARED_BYTES = 200 * 1024 * 1024;

/** What a shared file is, from its name and type (content is checked by the receiving screen). */
export function classifyShared(name: string, type: string): SharedKind | null {
  const n = name.toLowerCase();
  const t = type.toLowerCase();
  if (/\.(csv|xlsx|xlsm)$/.test(n) || t === 'text/csv' || t.includes('spreadsheetml')) return 'statement';
  if (/\.(json|txt)$/.test(n) || t === 'application/json' || t === 'text/plain') return 'backup';
  if (/\.(pdf|jpe?g|png|webp|gif)$/.test(n) || t === 'application/pdf' || t.startsWith('image/')) return 'receipt';
  return null;
}

/** The kind to open for a set of files: the first file decides; only receipts travel together. */
export function routeShared(files: readonly { name: string; type: string }[]): { kind: SharedKind; count: number } | null {
  const first = files[0];
  const kind = first ? classifyShared(first.name, first.type) : null;
  if (!kind) return null;
  const count = kind === 'receipt' ? files.filter((f) => classifyShared(f.name, f.type) === 'receipt').length : 1;
  return { kind, count };
}

const inbox = new Map<SharedKind, File[]>();

export function stashShared(kind: SharedKind, files: File[]): void {
  inbox.set(kind, files);
}

/** Files waiting for `kind` (removed as they are taken), or null. */
export function takeShared(kind: SharedKind): File[] | null {
  const files = inbox.get(kind) ?? null;
  inbox.delete(kind);
  return files && files.length ? files : null;
}

/** Read and clear what the service worker received. Empty when there is nothing (or no Cache API). */
export async function readSharedFiles(): Promise<File[]> {
  if (typeof caches === 'undefined') return [];
  const out: File[] = [];
  try {
    const cache = await caches.open(SHARE_CACHE);
    const keys = [...(await cache.keys())];
    keys.sort((a, b) => a.url.localeCompare(b.url, undefined, { numeric: true }));
    for (const req of keys) {
      const res = await cache.match(req);
      await cache.delete(req);
      if (!res) continue;
      const blob = await res.blob();
      if (blob.size > MAX_SHARED_BYTES) continue;
      let name = 'shared-file';
      try {
        name = decodeURIComponent(res.headers.get('x-file-name') || name);
      } catch {
        /* keep the fallback name */
      }
      out.push(new File([blob], name, { type: res.headers.get('content-type') || blob.type }));
    }
  } catch {
    /* Cache Storage unavailable (private window): nothing received */
  }
  return out;
}

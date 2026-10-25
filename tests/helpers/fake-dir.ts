/**
 * In-memory File System Access directory handle for the folder-sync tests (the subset sync-files.ts
 * uses). Files are plain strings; `createWritable()` buffers and replaces on `close()`, like Chromium.
 */
import type { PermState, SyncDir, SyncFileHandle } from '../../src/lib/sync-files.ts';

function notFound(name: string): Error {
  const e = new Error(`${name} not found`);
  e.name = 'NotFoundError';
  return e;
}

export class FakeDir implements SyncDir {
  readonly kind = 'directory' as const;
  readonly dirs = new Map<string, FakeDir>();
  readonly files = new Map<string, string>();
  /** Per file name: texts returned by the next reads instead of the real content (simulates a half-synced file). */
  readonly nextReads = new Map<string, string[]>();
  permission: PermState = 'granted';
  readonly name: string;
  constructor(name: string) {
    this.name = name;
  }

  async getDirectoryHandle(name: string, opts: { create?: boolean } = {}): Promise<FakeDir> {
    let d = this.dirs.get(name);
    if (!d) {
      if (!opts.create) throw notFound(name);
      d = new FakeDir(name);
      this.dirs.set(name, d);
    }
    return d;
  }

  async getFileHandle(name: string, opts: { create?: boolean } = {}): Promise<SyncFileHandle> {
    if (!this.files.has(name)) {
      if (!opts.create) throw notFound(name);
      this.files.set(name, '');
    }
    return {
      kind: 'file',
      getFile: async () => ({
        text: async () => {
          const queued = this.nextReads.get(name);
          if (queued?.length) return queued.shift() as string;
          if (!this.files.has(name)) throw notFound(name);
          return this.files.get(name) as string;
        },
      }),
      createWritable: async () => {
        let buf = '';
        return {
          write: async (data: string) => {
            buf += data;
          },
          close: async () => {
            this.files.set(name, buf);
          },
        };
      },
    };
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.files.delete(name) && !this.dirs.delete(name)) throw notFound(name);
  }

  async *values(): AsyncIterable<{ kind: 'file' | 'directory'; name: string }> {
    for (const name of this.dirs.keys()) yield { kind: 'directory', name };
    for (const name of this.files.keys()) yield { kind: 'file', name };
  }

  async queryPermission(): Promise<PermState> {
    return this.permission;
  }

  async requestPermission(): Promise<PermState> {
    return this.permission;
  }

  /** Walk to a nested directory (must exist). */
  at(...path: string[]): FakeDir {
    return path.reduce<FakeDir>((d, p) => {
      const next = d.dirs.get(p);
      if (!next) throw notFound(p);
      return next;
    }, this);
  }

  /** Every file in the tree as [path, text]. */
  allFiles(prefix = ''): [string, string][] {
    const out: [string, string][] = [];
    for (const [n, t] of this.files) out.push([`${prefix}${n}`, t]);
    for (const [n, d] of this.dirs) out.push(...d.allFiles(`${prefix}${n}/`));
    return out;
  }
}

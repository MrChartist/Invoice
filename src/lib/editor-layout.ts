/**
 * R3-C1 editor layout (device-local `mrchartist_editor_layout`, outside the data prefix: never backed
 * up or synced). Remembers whether the live paper preview pane is shown beside the editor form on wide
 * screens, plus the small helpers the pane and the live template thumbnails share. Pure apart from the
 * guarded localStorage access.
 */

export const EDITOR_LAYOUT_KEY = 'mrchartist_editor_layout';
/** The pane is offered from this viewport width (px) upwards; phones keep the preview modal. */
export const PREVIEW_MIN_WIDTH = 1280;
export const PREVIEW_MEDIA = `(min-width: ${PREVIEW_MIN_WIDTH}px)`;
/** Idle debounce before the pane re-renders after typing (ms), on top of `useDeferredValue`. */
export const PREVIEW_DEBOUNCE_MS = 250;
/** Scale of a live template thumbnail. */
export const THUMB_SCALE = 0.18;

export interface EditorLayout {
  /** Show the live preview pane on wide screens (default off: the user turns it on once per device). */
  preview: boolean;
}

export const DEFAULT_EDITOR_LAYOUT: EditorLayout = { preview: false };

/** Tolerant parse of the stored value; anything unreadable gives the defaults. */
export function parseEditorLayout(raw: string | null | undefined): EditorLayout {
  if (!raw) return { ...DEFAULT_EDITOR_LAYOUT };
  try {
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return { ...DEFAULT_EDITOR_LAYOUT };
    return { preview: typeof v.preview === 'boolean' ? v.preview : DEFAULT_EDITOR_LAYOUT.preview };
  } catch {
    return { ...DEFAULT_EDITOR_LAYOUT };
  }
}

type KV = Pick<Storage, 'getItem' | 'setItem'>;
const store = (): KV | undefined => {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
};

export function readEditorLayout(kv: KV | undefined = store()): EditorLayout {
  try {
    return parseEditorLayout(kv?.getItem(EDITOR_LAYOUT_KEY));
  } catch {
    return { ...DEFAULT_EDITOR_LAYOUT };
  }
}

/** Remember the layout; a blocked storage keeps it for this session only. Returns the clean value. */
export function writeEditorLayout(next: EditorLayout, kv: KV | undefined = store()): EditorLayout {
  const clean = parseEditorLayout(JSON.stringify(next));
  try {
    kv?.setItem(EDITOR_LAYOUT_KEY, JSON.stringify(clean));
  } catch {
    /* private mode / blocked storage */
  }
  return clean;
}

/** True when the device should get the static template tiles (few cores or reduced motion). */
export function lowEndDevice(cores: number | undefined, reducedMotion: boolean): boolean {
  return reducedMotion || (typeof cores === 'number' && cores > 0 && cores <= 4);
}

/** True when a draft has something worth showing in a thumbnail (a party or a priced / named line). */
export function draftHasContent(d: { client?: { name?: string } | null; items?: readonly { name?: string; rate?: number }[] }): boolean {
  return !!d.client?.name?.trim() || (d.items ?? []).some((i) => !!i.name?.trim() || Number(i.rate) > 0);
}

/**
 * Short, stable hash of the fields a thumbnail shows (FNV-1a over the JSON), used to memoise the
 * live tiles by template id + draft. Equal drafts give equal hashes.
 */
export function draftHash(d: unknown): string {
  let s: string;
  try {
    s = JSON.stringify(d) ?? '';
  } catch {
    s = '';
  }
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${s.length.toString(36)}-${h.toString(36)}`;
}

/** Form section a clicked paper block scrolls to (`data-r3c-section` on the editor's cards). */
export type PreviewSection = 'party' | 'items' | 'totals' | 'notes';

/** The form section for a click inside the paper, from the closest marked block (or null). */
export function sectionForBlock(attr: string | null | undefined): PreviewSection | null {
  return attr === 'party' || attr === 'items' || attr === 'totals' || attr === 'notes' ? attr : null;
}

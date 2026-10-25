/**
 * Item photos (8H catalogue v2): a catalogue / stock item keeps `image: 'asset:<id>'`, the picture
 * itself is stored once in the existing `assets` table (same content-hash interning as logos and
 * signatures, `assets.ts`), so it is backed up and synced with the company and never duplicated.
 * The exported catalogue inlines the data URI.
 */
import { ASSET_TABLE, internImage, isAssetRef, parseAssets, resolveImage, serializeAssets } from './assets';
import { DB_PREFIX, readRaw, writeRaw } from './storage';

/** Raster images only (an SVG may carry script); base64 data URIs as `imageToDataUrl` produces them. */
export const SAFE_IMAGE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/;

/** Largest photo kept (characters of the data URI, ~150 kB of image). */
export const MAX_ITEM_IMAGE = 200_000;

const KEY = DB_PREFIX + ASSET_TABLE;

/** Store a photo and return its reference. Throws on a non-image or an oversized one. */
export function storeItemImage(dataUrl: string): string {
  if (!SAFE_IMAGE.test(dataUrl)) throw new Error('Choose a PNG, JPEG, WebP or GIF photo.');
  if (dataUrl.length > MAX_ITEM_IMAGE) throw new Error('That photo is too large. Pick a smaller one.');
  const idx = parseAssets(readRaw(KEY));
  const before = idx.byId.size;
  const ref = internImage(idx, dataUrl);
  if (idx.byId.size !== before) writeRaw(KEY, serializeAssets(idx));
  return ref;
}

/** The data URI behind an item's `image` ('' when absent, missing or unsafe). */
export function itemImageData(ref: string | undefined, assetsRaw: string | null = readRaw(KEY)): string {
  if (!ref) return '';
  const data = isAssetRef(ref) ? resolveImage(parseAssets(assetsRaw), ref) : ref;
  return SAFE_IMAGE.test(data) ? data : '';
}

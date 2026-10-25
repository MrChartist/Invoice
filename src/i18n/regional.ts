/**
 * Regional catalogues (8H) in one lazy chunk: Marathi, Gujarati, Tamil (shell, editor, POS, Clients)
 * and Bengali, Telugu, Kannada (shell). Loaded only on devices that pick one of them.
 */
import type { Catalogue, Lang } from './index';
import { mr } from './mr';
import { gu } from './gu';
import { ta } from './ta';
import { bn } from './bn';
import { te } from './te';
import { kn } from './kn';

export const REGIONAL: Record<Exclude<Lang, 'en' | 'hi'>, Catalogue> = { mr, gu, ta, bn, te, kn };

import { cn } from '../../lib/utils';
import styles from './Skeleton.module.css';

export interface SkeletonProps {
  /** Width of the real element (CSS length or px), e.g. '60%' for a line of text, 120 for a figure. */
  width?: number | string;
  /** Height of the real element; 14px is a line of body text at its x-height. */
  height?: number | string;
  /** Capsule ends (a pill, a button, a line of text in a row). */
  pill?: boolean;
  /** Card corners (a whole card or panel still loading). */
  block?: boolean;
  className?: string;
}

/**
 * Placeholder block while something loads (IOS-UI.md 2.10): --fill-3 with the real element's size and radius, a soft
 * shimmer, and nothing at all for the first --dur-3, so a quick load never flashes. Hidden from assistive tech: the
 * container that is loading carries `aria-busy`.
 */
export function Skeleton({ width = '100%', height = 14, pill, block, className }: SkeletonProps) {
  return <span aria-hidden="true" className={cn(styles.skeleton, pill && styles.skeletonPill, block && styles.skeletonBlock, className)} style={{ width, height }} />;
}

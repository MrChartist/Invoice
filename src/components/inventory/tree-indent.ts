import styles from './masters.module.css';

/** Indent class for a tree row at `depth` (0 = none; capped at 4 levels). */
export const depthClass = (depth: number): string => (depth <= 0 ? '' : styles[`depth${Math.min(depth, 4)}` as 'depth1']);

import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import styles from '../../styles/surface.module.css';
import { SYS, type SysColour } from './sys-colour';

export type StatTone = 'default' | 'profit' | 'warning' | 'loss' | 'brand';

/** Tile colour per tone (IOS-UI.md 1.1 meaning map); `tile` on the card overrides it (a module's own colour). */
const TONE_TILE: Record<StatTone, SysColour> = { default: 'gray', profit: 'green', warning: 'orange', loss: 'red', brand: 'blue' };
/** The figure itself is coloured only for a gain or a loss (2.8); a warning shows on the tile, not the number. */
const TONE_VALUE: Partial<Record<StatTone, string>> = { profit: styles.statGain, loss: styles.statLoss };

export interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon: LucideIcon;
  tone?: StatTone;
  /** Icon-tile colour (the module's colour); defaults to the tone's. */
  tile?: SysColour;
  className?: string;
}

/** KPI card: leading icon tile + label, the figure (350, tabular), a hint. */
export function StatCard({ label, value, hint, icon: Icon, tone = 'default', tile, className }: StatCardProps) {
  return (
    <div className={cn(styles.stat, className)}>
      <div className={styles.statTop}>
        <span className={styles.statLabel}>{label}</span>
        <span className={cn(styles.statIcon, SYS[tile ?? TONE_TILE[tone]])} aria-hidden="true">
          <Icon size={16} />
        </span>
      </div>
      <div className={cn(styles.statValue, TONE_VALUE[tone])}>{value}</div>
      {hint && <div className={styles.statHint}>{hint}</div>}
    </div>
  );
}

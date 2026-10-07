import type { LucideIcon } from 'lucide-react';
import { cn } from '../../lib/utils';
import styles from '../../styles/surface.module.css';

export type StatTone = 'default' | 'profit' | 'warning' | 'loss' | 'brand';

const TONE_COLOUR: Record<StatTone, string> = {
  default: 'var(--foreground)',
  profit: 'var(--profit)',
  warning: 'var(--warning)',
  loss: 'var(--loss)',
  brand: 'var(--brand)',
};

export interface StatCardProps {
  label: string;
  value: string | number;
  hint?: string;
  icon: LucideIcon;
  tone?: StatTone;
  className?: string;
}

export function StatCard({ label, value, hint, icon: Icon, tone = 'default', className }: StatCardProps) {
  return (
    <div className={cn(styles.stat, className)}>
      <div className={styles.statTop}>
        <span className={styles.statLabel}>{label}</span>
        <span className={styles.statIcon} style={{ color: TONE_COLOUR[tone] }}>
          <Icon size={16} />
        </span>
      </div>
      <div className={styles.statValue} style={tone === 'default' ? undefined : { color: TONE_COLOUR[tone] }}>
        {value}
      </div>
      {hint && <div className={styles.statHint}>{hint}</div>}
    </div>
  );
}

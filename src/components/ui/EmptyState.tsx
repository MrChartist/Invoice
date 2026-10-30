import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '../../lib/utils';
import styles from '../../styles/surface.module.css';
import { SYS, type SysColour } from './sys-colour';

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  text?: string;
  action?: ReactNode;
  /** Tile colour: the page's meaning colour (IOS-UI.md 2.10), blue by default. */
  tone?: SysColour;
}

export function EmptyState({ icon: Icon, title, text, action, tone = 'blue' }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <div className={cn(styles.emptyIcon, SYS[tone])} aria-hidden="true">
        <Icon size={28} />
      </div>
      <h3 className={styles.emptyTitle}>{title}</h3>
      {text && <p className={styles.emptyText}>{text}</p>}
      {action}
    </div>
  );
}

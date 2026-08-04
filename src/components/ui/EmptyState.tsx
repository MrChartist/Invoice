import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import styles from '../../styles/surface.module.css';

export interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  text?: string;
  action?: ReactNode;
}

export function EmptyState({ icon: Icon, title, text, action }: EmptyStateProps) {
  return (
    <div className={styles.empty}>
      <div className={styles.emptyIcon}>
        <Icon size={30} />
      </div>
      <h3 className={styles.emptyTitle}>{title}</h3>
      {text && <p className={styles.emptyText}>{text}</p>}
      {action}
    </div>
  );
}

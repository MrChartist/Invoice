import { lazy, Suspense, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import styles from './SplitView.module.css';

// The pane chrome (Back / close, the resize handle) loads with the first detail, in the inspectors' chunk.
const SplitPane = lazy(() => import('../split/panes').then((m) => ({ default: m.SplitPane })));

/**
 * Master-detail panes (docs/theme/IOS-UI.md 3.4, package PL). `children` is the master (a list); `detail`, when
 * given, opens beside it on a wide split (52.125em+ of its own width: list + detail, the detail its own scroller,
 * resizable on pointer devices) or is pushed over the list on a narrow one, with a
 * Back link. `onClose` clears the selection.
 */
export interface SplitViewProps {
  id: string;
  children: ReactNode;
  detail?: ReactNode;
  /** The detail pane's accessible name. */
  label: string;
  onClose: () => void;
}

export function SplitView({ id, children, detail, label, onClose }: SplitViewProps) {
  const open = detail != null;
  return (
    // An open detail widens the frame by the inspector's width (DashboardLayout .content:has([data-inspector])).
    <div className={styles.split} data-split={id} data-inspector={open ? '' : undefined}>
      <div className={cn(styles.grid, open && styles.open)}>
        <div className={styles.master}>{children}</div>
        {open && (
          <Suspense fallback={null}>
            <SplitPane id={id} label={label} onClose={onClose}>
              {detail}
            </SplitPane>
          </Suspense>
        )}
      </div>
    </div>
  );
}

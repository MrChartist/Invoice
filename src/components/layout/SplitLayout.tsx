import type { ReactNode } from 'react';
import styles from './SplitLayout.module.css';

interface SplitLayoutProps {
  left: ReactNode;
  right: ReactNode;
}

export const SplitLayout = ({ left, right }: SplitLayoutProps) => {
  return (
    <div className={styles.container}>
      <div className={styles.leftPanel}>
        <div className={styles.leftScroll}>
          {left}
        </div>
      </div>

      <div className={styles.rightPanel}>
        <div className={styles.rightScroll}>
          {right}
        </div>
      </div>
    </div>
  );
};

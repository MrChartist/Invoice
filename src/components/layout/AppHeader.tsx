import { useEffect, useState } from 'react';
import { Moon, Sun, Receipt } from 'lucide-react';
import styles from './AppHeader.module.css';

export const AppHeader = () => {
  const [isDark, setIsDark] = useState(() => {
    return localStorage.getItem('theme') === 'dark' ||
      (!localStorage.getItem('theme') && window.matchMedia('(prefers-color-scheme: dark)').matches);
  });

  useEffect(() => {
    if (isDark) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDark]);

  return (
    <header className={styles.header}>
      <div className={styles.brand}>
        <div className={styles.logoBox}>
          <Receipt size={16} strokeWidth={2.5} />
        </div>
        <span className={styles.brandName}>
          Invoice<span>Pro</span>
        </span>
        <span className={styles.badge}>MrChartist</span>
      </div>

      <div className={styles.actions}>
        <button
          className={styles.iconBtn}
          onClick={() => setIsDark(!isDark)}
          aria-label="Toggle theme"
        >
          {isDark ? <Sun size={18} /> : <Moon size={18} />}
        </button>
      </div>
    </header>
  );
};

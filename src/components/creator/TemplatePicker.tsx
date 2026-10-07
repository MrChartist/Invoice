import { Check } from 'lucide-react';
import { TEMPLATES, TEMPLATE_CATEGORIES } from '../templates/registry';
import { useInvoiceStore } from '../../store/useInvoiceStore';
import { cn } from '../../lib/utils';
import styles from './TemplatePicker.module.css';

/** Compact gallery grouped by category; the live look is shown in Preview. */
export function TemplatePicker() {
  const templateId = useInvoiceStore((s) => s.template_id);
  const setTemplate = useInvoiceStore((s) => s.setTemplate);

  return (
    <div className={styles.wrap} role="radiogroup" aria-label="Invoice template">
      {TEMPLATE_CATEGORIES.map((category) => (
        <div key={category}>
          <div className={styles.cat}>{category}</div>
          <div className={styles.grid}>
            {TEMPLATES.filter((t) => t.category === category).map((t) => {
              const active = t.id === templateId;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  className={cn(styles.tile, active && styles.active)}
                  onClick={() => setTemplate(t.id)}
                  title={t.description}
                >
                  <span className={styles.thumb} style={{ '--accent-c': t.accent } as React.CSSProperties}>
                    <i />
                    <i />
                    <i />
                  </span>
                  <span className={styles.name}>{t.name}</span>
                  {active && <Check size={13} className={styles.check} />}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

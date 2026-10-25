import styles from '../invoice-paper.module.css';

/**
 * Statutory declaration (Sec 31(3)(c) / Rule 49) for a composition dealer's document. Rendered once by
 * TemplateEngine after every layout body, so all 26 templates and every paper size print it. Colours come
 * from the template's accent variable.
 */
export function SupplyDeclaration({ text }: { text: string }) {
  return (
    <div className={styles.supplyDeclaration} data-supply-declaration role="note">
      {text}
    </div>
  );
}

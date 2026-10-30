import { createContext, useContext, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/utils';
import styles from '../../styles/page.module.css';

// SplitView ships with the frame (first paint, docs/prd/ios-ui.md section 6), so list routes add no chunk for it.
export { SplitView } from './SplitView';

/**
 * The one page frame (docs/theme/IOS-UI.md section 3.2). Every route renders `<Page>`; the shell
 * (`DashboardLayout` `.content`) owns the gutter and the width, this component owns the slot order:
 * back link · large title + subtitle + actions (or a custom `head`) · page tabs · notices · content.
 *
 * - `tier`: `page` (default, up to `--page-max`), `form` (blocks capped at `--form-max`, left-aligned) or
 *   `bleed` (no cap: POS, the editor with live preview, Gateway display).
 * - `notices`: one-time tips, "About this tab" strips, demo / lock notices. They render BELOW the header so the
 *   title sits at the same place on every route. The shell's own notices (cross-tab, backup nudge) join them.
 * - `inspector`: a trailing pane shown when the frame is wide (74.6875em+), instead of an empty margin.
 */
export type PageTier = 'page' | 'form' | 'bleed';

export interface PageProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** A custom header row that replaces title / subtitle / actions (the editor's header). */
  head?: ReactNode;
  back?: ReactNode;
  tabs?: ReactNode;
  notices?: ReactNode;
  tier?: PageTier;
  inspector?: ReactNode;
}

/** The shell's notices (cross-tab, backup nudge): provided by DashboardLayout, shown in the top page's notices slot. */
const ShellNotices = createContext<ReactNode>(null);
export function ShellNoticesProvider({ value, children }: { value: ReactNode; children: ReactNode }) {
  return <ShellNotices.Provider value={value}>{children}</ShellNotices.Provider>;
}

export function PageHead({ title, subtitle, actions }: Pick<PageProps, 'title' | 'subtitle' | 'actions'>) {
  return (
    <div className={styles.head} data-page-head>
      <div className={styles.headText}>
        <h1 className={styles.title}>{title}</h1>
        {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
      </div>
      {actions && <div className={styles.actions}>{actions}</div>}
    </div>
  );
}

export function Page({ title, subtitle, actions, head, back, tabs, notices, tier = 'page', inspector, className, children, ...rest }: PageProps) {
  const shell = useContext(ShellNotices);
  return (
    <div {...rest} className={cn(styles.page, className)} data-tier={tier} data-inspector={inspector ? '' : undefined}>
      {back && <div className={styles.back}>{back}</div>}
      {head ?? (title != null && <PageHead title={title} subtitle={subtitle} actions={actions} />)}
      {tabs}
      <div className={styles.notices}>
        {shell}
        {notices}
      </div>
      {/* A page nested inside another (a desk view) never repeats the shell's notices. */}
      <ShellNotices.Provider value={null}>
        {inspector ? (
          <div className={styles.withInspector}>
            <div className={styles.body}>{children}</div>
            <aside className={styles.inspector}>{inspector}</aside>
          </div>
        ) : (
          children
        )}
      </ShellNotices.Provider>
    </div>
  );
}

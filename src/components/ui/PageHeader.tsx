import type { ReactNode } from 'react';
import { PageHead } from './Page';

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

/** Kept for older imports: the header row of `<Page>` (same height, position and weight on every route). */
export function PageHeader(props: PageHeaderProps) {
  return <PageHead {...props} />;
}

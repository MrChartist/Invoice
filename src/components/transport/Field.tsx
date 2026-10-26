import type { ReactNode } from 'react';
import controls from '../../styles/controls.module.css';

/** A labelled form field. */
export function F({ l, children }: { l: ReactNode; children: ReactNode }) {
  return <label className={controls.field}><span className={controls.label}>{l}</span>{children}</label>;
}

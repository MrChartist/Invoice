/** R18: the UI bits the Society desk views share (props, a labelled field). */
import type { ReactNode } from 'react';
import controls from '../../styles/controls.module.css';

export type Notify = (message: string, tone?: 'success' | 'error' | 'info') => void;
export interface HsViewProps { notify: Notify }

export const Field = ({ label, children }: { label: string; children: ReactNode }) => <label className={controls.field}><span className={controls.label}>{label}</span>{children}</label>;

export const row = { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', marginBottom: '0.75rem' } as const;

/** A number input's value → a number, or undefined when blank. */
export const numIn = (v: string): number | undefined => (v.trim() === '' ? undefined : Number(v));

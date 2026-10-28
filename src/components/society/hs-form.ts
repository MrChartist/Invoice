/** R18: layout and input helpers the Society desk views share. */
export const row = { display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'flex-end', marginBottom: '0.75rem' } as const;

/** A number input's value → a number, or undefined when blank. */
export const numIn = (v: string): number | undefined => (v.trim() === '' ? undefined : Number(v));

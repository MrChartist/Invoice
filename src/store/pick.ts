/**
 * `pick(state, ['a', 'b'])` → `{ a: state.a, b: state.b }`. Used with zustand's `useShallow` so a
 * component subscribes to just the fields it lists (same result as a hand-written object
 * selector, but the field names appear once — the editor's selectors list 15-25 fields).
 */
export function pick<T extends object, K extends keyof T>(obj: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) out[k] = obj[k];
  return out;
}

/** Shared by the accounting / GST areas: pick a `…One` / `…Many` key for a count and fill `{n}`. */
export const plural = <K extends string>(tr: (k: K, v?: Record<string, string | number>) => string, one: K, many: K, n: number): string =>
  tr(n === 1 ? one : many, { n });

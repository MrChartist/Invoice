import { createElement, Fragment, type ReactNode } from 'react';

/**
 * Area counterpart of `tNodes`: put React nodes into the `{placeholders}` of an already translated
 * string (call the area translator without vars, e.g. `nodes(gstT('x'), { b: <strong>…</strong> })`),
 * so each language keeps its own word order.
 */
export function nodes(text: string, vars: Record<string, ReactNode>): ReactNode {
  const parts = text.split(/(\{\w+\})/).map((part) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return m && m[1] in vars ? vars[m[1]] : part;
  });
  return createElement(Fragment, null, ...parts);
}

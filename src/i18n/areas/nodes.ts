/**
 * `areaNodes(text, { link: <Link/> })`: like `tNodes`, for an area translator's output — each
 * language keeps its own word order around React nodes (a link, a <strong>…). Call the area
 * translator without vars, e.g. `areaNodes(gstT('x'), { b: <strong>…</strong> })`.
 */
import { createElement, Fragment, type ReactNode } from 'react';

export function areaNodes(text: string, vars: Record<string, ReactNode>): ReactNode {
  const parts = text.split(/(\{\w+\})/).map((part) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return m && m[1] in vars ? vars[m[1]] : part;
  });
  return createElement(Fragment, null, ...parts);
}

/** Same helper under the name the accounting / GST areas use. */
export const nodes = areaNodes;

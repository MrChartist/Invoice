/**
 * `areaNodes(text, { link: <Link/> })`: like `tNodes`, for an area translator's output — each
 * language keeps its own word order around React nodes (a link, a <strong>…).
 */
import { createElement, Fragment, type ReactNode } from 'react';

export function areaNodes(text: string, vars: Record<string, ReactNode>): ReactNode {
  const nodes = text.split(/(\{\w+\})/).map((part) => {
    const m = /^\{(\w+)\}$/.exec(part);
    return m && m[1] in vars ? vars[m[1]] : part;
  });
  return createElement(Fragment, null, ...nodes);
}

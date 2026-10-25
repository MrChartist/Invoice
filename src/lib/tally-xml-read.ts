/**
 * Reading Tally XML safely (WP-7, P0-7). Pure; no browser APIs required.
 *
 * Imported files are untrusted:
 *  - size cap (`MAX_TALLY_XML_CHARS`) and element cap (`MAX_XML_NODES`) — a hostile file cannot
 *    exhaust memory;
 *  - any DOCTYPE / ENTITY declaration is refused outright, so no entity expansion ("billion laughs")
 *    or external entity can ever happen, whichever parser runs;
 *  - only the five predefined entities and numeric character references are decoded.
 *
 * Tally quirks handled: UTF-16 exports (with or without a BOM), and the `&#4;` "not applicable"
 * marker Tally writes in empty fields — a character XML 1.0 forbids, which makes the browser's
 * DOMParser reject the whole file. Such references and raw control characters are removed first.
 *
 * Two parsers produce the same `XmlNode` tree: `parseXmlLite` (this file, used in tests and as the
 * fallback) and `xmlNodeFromDom` (adapter over the browser's DOMParser result).
 */

export interface XmlNode {
  name: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  /** Concatenated character data directly inside this element (trimmed by readers, not here). */
  text: string;
}

export type XmlParser = (text: string) => XmlNode;

/** 64 M characters (~64–128 MB file). A year's Day Book of a busy company fits comfortably. */
export const MAX_TALLY_XML_CHARS = 64 * 1024 * 1024;
export const MAX_XML_NODES = 2_000_000;

export class TallyXmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TallyXmlError';
  }
}

/** Bytes of a Tally export → text: UTF-16 LE/BE (BOM or zero-byte pattern) or UTF-8. */
export function decodeTallyBytes(bytes: Uint8Array): string {
  let enc = 'utf-8';
  let start = 0;
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    enc = 'utf-16le';
    start = 2;
  } else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    enc = 'utf-16be';
    start = 2;
  } else if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    start = 3;
  } else if (bytes.length >= 4 && bytes[0] === 0x3c && bytes[1] === 0 && bytes[2] !== 0 && bytes[3] === 0) {
    enc = 'utf-16le';
  } else if (bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0x3c && bytes[2] === 0) {
    enc = 'utf-16be';
  }
  return new TextDecoder(enc).decode(bytes.subarray(start));
}

/** XML 1.0 forbids C0 controls except tab / LF / CR — as characters and as references (Tally's `&#4;`). */
const BAD_REF = /&#(?:x0*(?:[0-8bcef]|1[0-9a-f])|0*(?:[0-8]|1[124-9]|2[0-9]|3[01]));/gi;
// eslint-disable-next-line no-control-regex
const BAD_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g;

/** Size / DOCTYPE checks, then remove what XML forbids. Throws TallyXmlError. */
export function sanitizeTallyXml(text: string): string {
  if (text.length > MAX_TALLY_XML_CHARS) throw new TallyXmlError('This file is too large to import (over 64 MB of text). Export a shorter period from Tally.');
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new TallyXmlError('This file declares a DOCTYPE or entities, which a Tally export never does. It was not read.');
  return text.replace(/^\uFEFF/, '').replace(BAD_REF, '').replace(BAD_CHARS, '');
}

function decodeEntities(s: string): string {
  if (s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|lt|gt|amp|quot|apos);/gi, (_m, e: string) => {
    const k = e.toLowerCase();
    if (k === 'lt') return '<';
    if (k === 'gt') return '>';
    if (k === 'amp') return '&';
    if (k === 'quot') return '"';
    if (k === 'apos') return "'";
    const code = k.startsWith('#x') ? parseInt(k.slice(2), 16) : parseInt(k.slice(1), 10);
    if (!Number.isFinite(code) || code < 0x9 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)) return '';
    return String.fromCodePoint(code);
  });
}

const ATTR = /([^\s=/>]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

/**
 * Minimal non-validating XML parser for Tally exports (elements, attributes, text, CDATA, comments,
 * processing instructions). Refuses DOCTYPE (via `sanitizeTallyXml`). Mismatched closing tags are
 * tolerated by closing up to the matching open element; an unknown close tag is ignored.
 */
export function parseXmlLite(input: string): XmlNode {
  const text = sanitizeTallyXml(input);
  const root: XmlNode = { name: '#document', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let nodes = 0;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break; // trailing text after the root carries nothing
    if (lt > i) {
      const seg = text.slice(i, lt);
      // Indentation between elements is dropped (keeps containers small); leaf values are kept.
      if (/\S/.test(seg)) stack[stack.length - 1].text += decodeEntities(seg);
    }
    if (text.startsWith('<!--', lt)) {
      const end = text.indexOf('-->', lt + 4);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (text.startsWith('<![CDATA[', lt)) {
      const end = text.indexOf(']]>', lt + 9);
      stack[stack.length - 1].text += text.slice(lt + 9, end < 0 ? n : end);
      i = end < 0 ? n : end + 3;
      continue;
    }
    if (text.startsWith('<?', lt)) {
      const end = text.indexOf('?>', lt + 2);
      i = end < 0 ? n : end + 2;
      continue;
    }
    if (text.startsWith('<!', lt)) throw new TallyXmlError('Unsupported markup declaration in the file.');
    const gt = text.indexOf('>', lt + 1);
    if (gt < 0) throw new TallyXmlError('The file ends in the middle of a tag (incomplete export?).');
    const raw = text.slice(lt + 1, gt);
    i = gt + 1;
    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim();
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].name === name) {
          stack.length = k;
          break;
        }
      }
      continue;
    }
    const selfClose = raw.endsWith('/');
    const body = selfClose ? raw.slice(0, -1) : raw;
    const sp = body.search(/\s/);
    const name = sp < 0 ? body : body.slice(0, sp);
    if (!name) throw new TallyXmlError('Empty tag in the file.');
    const attrs: Record<string, string> = {};
    if (sp >= 0) {
      ATTR.lastIndex = 0;
      let m: RegExpExecArray | null;
      const rest = body.slice(sp);
      while ((m = ATTR.exec(rest))) attrs[m[1]] = decodeEntities(m[3] ?? m[4] ?? '');
    }
    if (++nodes > MAX_XML_NODES) throw new TallyXmlError('This file has too many elements to import at once. Export a shorter period from Tally.');
    const node: XmlNode = { name, attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
  }
  return root;
}

/** Structural view of a DOM element (no lib.dom dependency at runtime). */
interface DomLike {
  nodeType: number;
  nodeName: string;
  nodeValue: string | null;
  childNodes: ArrayLike<DomLike>;
  attributes?: ArrayLike<{ name: string; value: string }>;
}

/** Convert a DOMParser document / element into the same tree `parseXmlLite` returns. */
export function xmlNodeFromDom(dom: DomLike): XmlNode {
  let nodes = 0;
  const walk = (el: DomLike): XmlNode => {
    if (++nodes > MAX_XML_NODES) throw new TallyXmlError('This file has too many elements to import at once. Export a shorter period from Tally.');
    const attrs: Record<string, string> = {};
    const list = el.attributes;
    if (list) for (let k = 0; k < list.length; k++) attrs[list[k].name] = list[k].value;
    const out: XmlNode = { name: el.nodeType === 9 ? '#document' : el.nodeName, attrs, children: [], text: '' };
    for (let k = 0; k < el.childNodes.length; k++) {
      const c = el.childNodes[k];
      if (c.nodeType === 1) out.children.push(walk(c));
      else if (c.nodeType === 3 || c.nodeType === 4) out.text += c.nodeValue ?? '';
    }
    return out;
  };
  return walk(dom);
}

/* ── Tree helpers ─────────────────────────────────────────────── */

export const kids = (n: XmlNode | undefined, name: string): XmlNode[] => (n ? n.children.filter((c) => c.name === name) : []);
export const kid = (n: XmlNode | undefined, name: string): XmlNode | undefined => n?.children.find((c) => c.name === name);
/** Trimmed text of the first child element called `name` ('' when absent). */
export const textOf = (n: XmlNode | undefined, name: string): string => (kid(n, name)?.text ?? '').trim();

/** Every element called one of `names` anywhere below `root` (document order), not descending into matches. */
export function findAll(root: XmlNode, names: ReadonlySet<string>): XmlNode[] {
  const out: XmlNode[] = [];
  const stack: XmlNode[] = [root];
  while (stack.length) {
    const n = stack.pop()!;
    if (n !== root && names.has(n.name)) {
      out.push(n);
      continue;
    }
    for (let k = n.children.length - 1; k >= 0; k--) stack.push(n.children[k]);
  }
  return out;
}

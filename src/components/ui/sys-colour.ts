import surface from '../../styles/surface.module.css';

/**
 * iOS system colours used for meaning (docs/theme/IOS-UI.md 1.1). Each class on `surface` sets four variables for
 * whatever sits inside: `--tone` (mark, dot, bar; a pill mixes its soft fill from it), `--tone-ink` (text) and `--tile`
 * (icon tile, read by the global `.tile`). Meaning map: green paid / gain, red overdue / loss, orange due soon / partial,
 * blue sent / info, gray draft / inactive, purple notes / returns, indigo GST, teal recurring, brown stock, cyan bank,
 * pink people (mint and yellow, a highlight fill only, have no class). Never the only signal: pair it with a word or a glyph.
 */
export type SysColour =
  | 'blue' | 'green' | 'indigo' | 'orange' | 'pink' | 'purple' | 'red' | 'teal' | 'cyan' | 'brown' | 'gray';

export const SYS: Record<SysColour, string> = {
  blue: surface.sysBlue,
  green: surface.sysGreen,
  indigo: surface.sysIndigo,
  orange: surface.sysOrange,
  pink: surface.sysPink,
  purple: surface.sysPurple,
  red: surface.sysRed,
  teal: surface.sysTeal,
  cyan: surface.sysCyan,
  brown: surface.sysBrown,
  gray: surface.sysGray,
};

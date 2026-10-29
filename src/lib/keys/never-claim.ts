/**
 * R20-A2 / PRD §5.1: keys the app never claims — the browser or the OS owns them (closing tabs, new windows, text
 * editing, AltGr …). Re-exported by `registry.ts`; `pos-keys.ts` reads it too (`isAssignableCombo`). `apple` = only on
 * Apple platforms (⌘H, ⌘M …: there Ctrl = ⌘). `say` = the cheat sheet's "not in a browser" row (keys-r20a label:
 * what to use instead). Written compactly: `combo[:say][@]` (`@` = apple).
 */
import type { KeysKey } from '../../i18n/areas/keys-r20a';

export interface NeverClaim {
  combo: string;
  apple?: true;
  say?: KeysKey;
}

const DEF =
  'mod+n:nc_calc mod+shift+n mod+t:nc_postDated mod+shift+t mod+w:nc_lang mod+shift+w mod+f4:nc_payroll alt+f4:nc_quit ' +
  'mod+q:nc_quitScreen mod+shift+q mod+tab mod+shift+tab mod+pageup mod+pagedown mod+1 mod+2 mod+3 mod+4 mod+5 mod+6 mod+7 ' +
  'mod+8 mod+9 alt+arrowleft alt+arrowright alt+f:nc_find alt+e:nc_export mod+z mod+y mod+x mod+c mod+v mod+alt+delete ' +
  'mod+shift+escape mod+alt+t mod+alt+l mod+alt+arrowup mod+alt+arrowdown mod+alt+arrowleft mod+alt+arrowright mod+h@ mod+m@ mod+space@';

export const NEVER_CLAIM: readonly NeverClaim[] = DEF.split(' ').map((t) => {
  const [combo, say] = t.replace('@', '').split(':');
  return { combo, ...(say ? { say: say as KeysKey } : {}), ...(t.endsWith('@') ? { apple: true as const } : {}) };
});

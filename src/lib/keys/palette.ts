/**
 * R20-A6: the Ctrl+K actions "Tally keys on / off", "Key layout" and "Keyboard cheat sheet". Loaded with the palette
 * (kept off first paint); the toast is the polite announcement of a switch.
 */
import type { PaletteAction } from '../../components/command/CommandPalette';
import { keysT } from '../../i18n/areas/keys-r20a';
import { keysLayout, keysOn, setKeysLayout, setKeysMode } from './stub';

type Notify = (msg: string, tone?: 'info') => void;

export function keysAction(what: 'mode' | 'layout', notify: Notify): void {
  if (what === 'layout') {
    if (!keysOn()) setKeysMode('on');
    const next = keysLayout() === 'prime' ? 'erp9' : 'prime';
    setKeysLayout(next);
    notify(`${keysT('layout')}: ${keysT(next)}`, 'info');
    return;
  }
  const on = !keysOn();
  setKeysMode(on ? 'on' : 'off');
  notify(keysT(on ? 'on' : 'off'), 'info');
}

export const paletteActions = (openSheet: () => void, notify: Notify): PaletteAction[] => [
  { id: 'tally-keys', title: keysT('pMode'), keywords: ['tally', 'keys', 'f5', 'shortcut'], run: () => keysAction('mode', notify) },
  { id: 'key-layout', title: keysT('pLayout'), keywords: ['tally', 'prime', 'erp 9', 'layout'], run: () => keysAction('layout', notify) },
  { id: 'cheat-sheet', title: keysT('title'), keywords: ['keyboard', 'shortcuts', 'keys'], run: openSheet },
];

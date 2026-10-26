/**
 * R6-A3: the "About this tab" strips on/off switch. Device-local `mrchartist_help_strips` ('on' | 'off'), outside the
 * company prefix (never backed up or synced); every access in try / catch.
 */
import { readRaw, writeRaw } from '../storage';

export const HELP_STRIPS_KEY = 'mrchartist_help_strips';
export const STRIPS_EVENT = 'mrc:help-strips';

export function stripsOn(): boolean {
  try {
    return readRaw(HELP_STRIPS_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setStrips(on: boolean): void {
  try {
    writeRaw(HELP_STRIPS_KEY, on ? 'on' : 'off');
  } catch {
    /* storage blocked: the choice lasts for this page only */
  }
  try {
    window.dispatchEvent(new Event(STRIPS_EVENT));
  } catch {
    /* no window (tests) */
  }
}

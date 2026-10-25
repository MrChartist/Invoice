/**
 * Split Save button (8G, A4): Save / Save & print / Save & WhatsApp. The last choice is remembered on
 * this device only (`mrchartist_inv_save_choice`, listed in DEVICE_LOCAL_KEYS: never backed up / synced).
 */

import { DB_PREFIX, readRaw, writeRaw } from './storage';

export type SaveChoice = 'save' | 'print' | 'whatsapp';
export const SAVE_CHOICES: readonly SaveChoice[] = ['save', 'print', 'whatsapp'];
export const SAVE_CHOICE_KEY = `${DB_PREFIX}save_choice`;

export function normalizeSaveChoice(v: unknown): SaveChoice {
  return SAVE_CHOICES.includes(v as SaveChoice) ? (v as SaveChoice) : 'save';
}

export function getSaveChoice(): SaveChoice {
  try {
    return normalizeSaveChoice(readRaw(SAVE_CHOICE_KEY));
  } catch {
    return 'save';
  }
}

export function setSaveChoice(c: SaveChoice): SaveChoice {
  const clean = normalizeSaveChoice(c);
  try {
    writeRaw(SAVE_CHOICE_KEY, clean);
  } catch {
    /* remembered for this session only */
  }
  return clean;
}

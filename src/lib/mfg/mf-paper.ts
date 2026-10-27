/**
 * MF-B5 paper maths (pure; tests/mf-paper.test.ts). Sizes in mm. Ups on a sheet in both orientations after the gripper
 * (one long edge), an edge margin on the other sides and a bleed around each piece; sheets = qty ÷ ups (up); wastage =
 * make-ready sheets per colour pass + running % of the net sheets; kg = sheets × w × h (m) × GSM ÷ 1000; reams of 500,
 * packets of 100; sheet area in square inches for finishing rates.
 */
import { num } from '../invoice-calc';
import { r3 } from './mf-b-db';

export interface Size { w: number; h: number }
export interface Margins { gripper: number; bleed: number; edge: number }
export const DEFAULT_MARGINS: Margins = { gripper: 10, bleed: 3, edge: 5 };

export interface UpsResult { ups: number; across: number; down: number; rotated: boolean }

/** The best of the two orientations of the piece on the sheet (ties keep the piece upright). */
export function upsOn(sheet: Size, piece: Size, m: Margins = DEFAULT_MARGINS): UpsResult {
  const W = num(sheet.w) - 2 * num(m.edge);
  const H = num(sheet.h) - num(m.gripper) - num(m.edge);
  const pw = num(piece.w) + 2 * num(m.bleed);
  const ph = num(piece.h) + 2 * num(m.bleed);
  if (!(W > 0 && H > 0 && pw > 0 && ph > 0)) return { ups: 0, across: 0, down: 0, rotated: false };
  const a = { across: Math.floor(W / pw), down: Math.floor(H / ph), rotated: false };
  const b = { across: Math.floor(W / ph), down: Math.floor(H / pw), rotated: true };
  const best = b.across * b.down > a.across * a.down ? b : a;
  return { ups: best.across * best.down, ...best };
}

/** Net sheets for a quantity (rounded up; 0 when nothing fits). */
export const netSheets = (qty: number, ups: number): number => (ups > 0 ? Math.ceil(Math.max(num(qty), 0) / ups) : 0);

/** Wastage sheets: make-ready per colour pass + running % of the net sheets (rounded up). */
export const wasteSheets = (net: number, passes: number, makeReady: number, runningPct: number): number =>
  Math.max(Math.round(num(passes)), 0) * Math.max(num(makeReady), 0) + Math.ceil((Math.max(num(net), 0) * Math.max(num(runningPct), 0)) / 100);

/** Paper weight in kg for sheets of a size at a GSM. */
export const paperKg = (sheets: number, sheet: Size, gsm: number): number => r3((num(sheets) * (num(sheet.w) / 1000) * (num(sheet.h) / 1000) * num(gsm)) / 1000);

export const reams = (sheets: number): number => r3(num(sheets) / 500);
export const packets = (sheets: number): number => Math.ceil(num(sheets) / 100);
/** Sheet area in square inches. */
export const sqIn = (s: Size): number => r3((num(s.w) / 25.4) * (num(s.h) / 25.4));

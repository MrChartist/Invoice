/** AG-B test fixtures: a 3 × 3 cow matrix chart (₹ per litre, fat 3 / 3.5 / 4 × SNF 8 / 8.5 / 9) from 1 Nov 2026. */
import type { MilkRateChart } from '../../src/types/agri-r12.ts';

export const cowMatrix = (over: Partial<MilkRateChart> = {}): Omit<MilkRateChart, 'id'> => ({
  name: 'Cow', milk: 'cow', unit: 'L', effective_from: '2026-11-01', below_min: 'reject',
  basis: 'matrix', matrix: { fat_steps: [3, 3.5, 4], snf_steps: [8, 8.5, 9], rates: [[30, 31, 32], [33, 34, 35], [36, 37, 38]] }, ...over,
});

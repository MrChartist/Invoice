/** R3-B1: rate-card masters for the timer / time form, and the rate they resolve (kept out of the component file). */
import { useState } from 'react';
import type { Client } from '../../types/invoice';
import type { TimePrefs } from '../../types/time';
import { loadCostCentres, type CostCentre } from '../../lib/cost-centres';
import { loadTasks, type ProjectTask } from '../../lib/projects';
import { loadWorkTypes, resolveEntryRate, type RateData, type RateOpts, type RateSource, type RateSubject, type WorkType } from '../../lib/rate-cards';

export interface RateMasters {
  tasks: ProjectTask[];
  centres: CostCentre[];
  workTypes: WorkType[];
}

/** Masters read once per mounted form (they change on other tabs). */
export function useRateMasters(): RateMasters {
  const [m] = useState<RateMasters>(() => ({ tasks: loadTasks(), centres: loadCostCentres(), workTypes: loadWorkTypes() }));
  return m;
}

export function rateFor(subject: RateSubject, masters: RateMasters, clients: readonly Client[], prefs: TimePrefs, opts?: RateOpts): { rate: number; source: RateSource } {
  const data: RateData = { ...masters, clients, prefs };
  return resolveEntryRate(subject, data, opts);
}


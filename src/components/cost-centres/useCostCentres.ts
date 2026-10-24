import { useState } from 'react';
import { loadCostCentres, type CostCentre } from '../../lib/cost-centres';

/** Cost centres read once per mounted form (the master changes on the Books page only). */
export function useCostCentres(): CostCentre[] {
  const [centres] = useState<CostCentre[]>(() => loadCostCentres());
  return centres;
}

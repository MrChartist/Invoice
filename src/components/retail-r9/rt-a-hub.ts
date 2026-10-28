/**
 * RT-A: one lazy chunk for every RT-A screen part (each lazy chunk costs first-paint bytes in the preload map, and the
 * parts share their strings and engines). Hosts mount them with `lazy(() => import('…/rt-a-hub').then(…))`.
 */
export { default as RelabelQueue, MrpBasisTool } from './RelabelQueue';
export { default as ShortBookTab } from './ShortBookTab';
export { default as DeliveriesTab } from './DeliveriesTab';
export { default as DeliveryStrip, PosRetailStrip } from './DeliveryStrip';
export { default as RetailChecks } from './RetailChecks';

/**
 * R5-C: every screen of the package (fees, common credit, donations, funds, registrations, leases) and its bell
 * provider behind ONE lazy entry, so they ship as one chunk (shared strings and helpers compress once). Pages and
 * the bell import it dynamically only; nothing first-paint imports it statically.
 */
export { default as FeesTab } from './FeesTab';
export { default as CommonCreditView } from './CommonCreditView';
export { default as DonationsTab } from '../nonprofit/DonationsTab';
export { default as FundsTab } from '../nonprofit/FundsTab';
export { default as NpoRegistrationsPanel } from '../nonprofit/NpoRegistrationsPanel';
export { default as LeasesTab } from '../property/LeasesTab';
export { registerR5cAlerts } from '../../lib/institutions/r5c-alerts';

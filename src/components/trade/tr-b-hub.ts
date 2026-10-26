/**
 * R8-B (TR-B) hub: every TR-B screen and editor part, so they ship as ONE lazy chunk (the hosts — editor lines, editor
 * summary, bill modal — and the Distribution → Mandi / Brokers facades all import this module). Commodity / agency pack.
 */
export { default as LineWeightRow } from './LineWeightRow';
export { default as ChargesStrip } from './ChargesStrip';
export { default as BillTradePanel } from './BillTradePanel';
export { default as MandiTab } from './MandiView';
export { default as BrokersTab } from './BrokersView';

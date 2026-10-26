/** TR-A1 / A2: what the editor's pricing glue needs, loaded as one lazy chunk (keeps the editor's static graph). */
export { PARTY_RATE_BASIS, loadPartyRates, partyRateFor } from './tr-party-rates';
export { effectivePercent } from './tr-discounts';
export { applyScopedSchemes, liveScopeItems, type ScopeCtx } from './tr-schemes';

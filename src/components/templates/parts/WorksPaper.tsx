/**
 * R11 (CN-A3 … A5): one lazy chunk for every construction paper part, loaded by TemplateEngine only for documents
 * that carry the construction snapshot (`boq_terms.cn`) or an RA number — other documents never download it.
 * CN-B (`PvWorkingPage`) and CN-C (`DemandBlock`) export their parts from here when they merge.
 */
export { WorksHeaderBlock } from './WorksHeaderBlock';
export { RaItemsTable } from './RaItemsTable';
export { WorksDeductionsBlock } from './WorksDeductionsBlock';
export { WorksAbstractPage } from './WorksAbstractPage';

/** CN-B3 / CN-C3 placeholders: render nothing until those packages replace them. */
export const PvWorkingPage = (_: { invoice: unknown }) => null;
export const DemandBlock = (_: { invoice: unknown }) => null;

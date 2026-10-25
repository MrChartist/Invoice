/** Icons of the quick-create actions (8H), shared by the "+" sheet and the Dashboard row. */
import { FilePlus2, FileText, IndianRupee, Receipt, ScanBarcode, ShoppingCart, type LucideIcon } from 'lucide-react';
import type { QuickId } from '../../lib/quick-create';

export const QUICK_ICONS: Record<QuickId, LucideIcon> = {
  sale: FilePlus2,
  pos: ScanBarcode,
  payment: IndianRupee,
  expense: Receipt,
  bill: ShoppingCart,
  quote: FileText,
};

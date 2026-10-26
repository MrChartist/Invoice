import { itemImageData } from '../../../lib/item-images';
import { usePaper } from '../paper-context';

/** Header band artwork (replaces the template's logo / name block), or '' when the design has none. */
export function useHeaderBand(): string {
  const { art } = usePaper();
  return art?.letterhead?.mode === 'header' ? itemImageData(art.letterhead.image) : '';
}

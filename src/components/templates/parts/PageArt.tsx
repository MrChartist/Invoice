import { itemImageData } from '../../../lib/item-images';
import { usePaper } from '../paper-context';
import styles from './docs-r3-paper.module.css';

/**
 * R3-C3 letterhead artwork drawn under the content: a full-page background (page 1) and the footer band
 * at the foot of the paper (`data-page-footer`: the PDF builder repeats it on every page instead). The
 * header band is part of `PaperHeader`. Nothing renders without artwork, so other designs are unchanged.
 */
export function PageArt() {
  const { art, size } = usePaper();
  if (!art) return null;
  const bg = art.letterhead?.mode === 'background' ? itemImageData(art.letterhead.image) : '';
  const foot = art.footer ? itemImageData(art.footer) : '';
  if (!bg && !foot) return null;
  return (
    <>
      {bg && <img className={styles.background} src={bg} alt="" style={{ maxHeight: size.height }} data-page-background />}
      {foot && <img className={styles.footerBand} src={foot} alt="" data-page-footer />}
    </>
  );
}

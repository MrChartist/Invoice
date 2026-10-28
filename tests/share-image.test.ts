/** R3-A5 · Share the bill as an image: slice counts per paper, file names, the 5-page cap. Pure parts only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_IMAGE_PAGES, imageFileName, imageKind, imagePagesCapped, imageSlices, zipName } from '../src/lib/share-image.ts';
import { paperSize } from '../src/lib/design-prefs.ts';
import { posBillImageName } from '../src/lib/pos-share.ts';

test('slices: one page for a short A4 bill, several for a long one, one image for a thermal roll', () => {
  const a4 = paperSize({ paper: 'a4' } as never).height;
  assert.equal(imageSlices(800, { paper: 'a4' } as never).length, 1);
  assert.equal(imageSlices(a4 * 2.5, { paper: 'a4' } as never).length, 3);
  assert.equal(imageSlices(5000, { paper: 'thermal80' } as never).length, 1);
  assert.equal(imageKind({ paper: 'thermal80' } as never), 'png');
  assert.equal(imageKind({ paper: 'a4' } as never), 'jpeg');
});

test('cap: never more than 5 images', () => {
  const a4 = paperSize({ paper: 'a4' } as never).height;
  assert.equal(imageSlices(a4 * 9, { paper: 'a4' } as never).length, MAX_IMAGE_PAGES);
  assert.equal(imagePagesCapped(a4 * 9, { paper: 'a4' } as never), true);
  assert.equal(imagePagesCapped(a4 * 4.5, { paper: 'a4' } as never), false);
});

test('file names: slashes replaced, page suffix, zip name', () => {
  assert.equal(imageFileName('INV/FY26-27/0012', 'jpeg'), 'INV-FY26-27-0012.jpg');
  assert.equal(imageFileName('INV/FY26-27/0012', 'png'), 'INV-FY26-27-0012.png');
  assert.equal(imageFileName('INV/FY26-27/0012', 'jpeg', 2, 3), 'INV-FY26-27-0012-p2.jpg');
  assert.equal(imageFileName('', 'jpeg'), 'bill.jpg');
  assert.equal(imageFileName('A:B*C', 'jpeg'), 'A-B-C.jpg');
  assert.equal(zipName('INV/FY26-27/0012'), 'INV-FY26-27-0012-images.zip');
  assert.equal(posBillImageName({ invoice_number: 'INV/FY26-27/0003' }), 'INV-FY26-27-0003.png');
});

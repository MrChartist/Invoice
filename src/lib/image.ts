/**
 * Downscale an uploaded logo / signature before it is stored as a data URL.
 * localStorage is small (~5 MB), so a phone photo must not be saved as-is.
 */

const MAX_INPUT_BYTES = 3 * 1024 * 1024;

export async function imageToDataUrl(file: File, maxDimension = 480): Promise<string> {
  if (!/^image\/(png|jpe?g|webp)$/.test(file.type)) {
    throw new Error('Please choose a PNG, JPG or WebP image.');
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('That image is over 3 MB. Please pick a smaller one.');
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Your browser could not process the image.');
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close?.();

  // PNG keeps transparency (signatures, logos); photos compress better as JPEG.
  return file.type === 'image/jpeg' ? canvas.toDataURL('image/jpeg', 0.88) : canvas.toDataURL('image/png');
}

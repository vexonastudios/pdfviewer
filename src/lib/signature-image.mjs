export function cleanSignaturePixels(source, width, height, threshold = 65) {
  if (!(source instanceof Uint8ClampedArray) || source.length !== width * height * 4 || width < 1 || height < 1) throw new Error('This image could not be processed.');
  const pixels = new Uint8ClampedArray(source.length);
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const darkness = 255 - (source[i] * 0.2126 + source[i + 1] * 0.7152 + source[i + 2] * 0.0722);
    const alpha = Math.round(Math.max(0, Math.min(1, (darkness - threshold) / 70)) * source[i + 3]);
    pixels[i] = 25; pixels[i + 1] = 41; pixels[i + 2] = 53; pixels[i + 3] = alpha;
    if (alpha > 24) { left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y); }
  }
  if (right < left) throw new Error('No dark signature ink was found. Try a clearer photo or lower the cleanup setting.');
  const pad = Math.max(8, Math.round(Math.min(width, height) * 0.015));
  left = Math.max(0, left - pad); top = Math.max(0, top - pad);
  right = Math.min(width - 1, right + pad); bottom = Math.min(height - 1, bottom + pad);
  const outputWidth = right - left + 1, outputHeight = bottom - top + 1;
  const output = new Uint8ClampedArray(outputWidth * outputHeight * 4);
  for (let y = 0; y < outputHeight; y++) {
    const from = ((top + y) * width + left) * 4;
    output.set(pixels.subarray(from, from + outputWidth * 4), y * outputWidth * 4);
  }
  return { pixels: output, width: outputWidth, height: outputHeight };
}

export async function cleanSignaturePhoto(file, threshold = 65) {
  if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 15_000_000) throw new Error('Choose a PNG, JPEG, or WebP photo smaller than 15 MB.');
  const bitmap = await createImageBitmap(file);
  try {
    if (bitmap.width > 10000 || bitmap.height > 10000) throw new Error('This photo is too large. Choose one under 10,000 pixels per side.');
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
    const source = document.createElement('canvas'); source.width = width; source.height = height;
    const context = source.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0, width, height);
    const cleaned = cleanSignaturePixels(context.getImageData(0, 0, width, height).data, width, height, threshold);
    const output = document.createElement('canvas'); output.width = cleaned.width; output.height = cleaned.height;
    output.getContext('2d').putImageData(new ImageData(cleaned.pixels, cleaned.width, cleaned.height), 0, 0);
    const dataUrl = output.toDataURL('image/png');
    if (dataUrl.length > 2_000_000) throw new Error('The cleaned signature is too large. Crop the photo closer and try again.');
    return { dataUrl, width: output.width, height: output.height };
  } finally { bitmap.close(); }
}

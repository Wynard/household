// Receipt photos (2b, 6.7): every photo is re-encoded through a canvas
// (longest side ~1600 px, JPEG quality ~0.8), which drops EXIF metadata
// including GPS location. As a second line of defence the JPEG bytes are then
// scanned and every metadata segment (APP1-APP15: Exif, XMP, ICC...; COM) is
// removed. The same compressed, clean image is sent to Gemini and to Drive.

const MAX_SIDE = 1600;
const QUALITY = 0.8;

/**
 * Removes metadata segments from a JPEG, keeping only what's needed to show the
 * image (APP0/JFIF, quantisation and Huffman tables, frame and scan data).
 * Returns the input unchanged if it isn't a JPEG.
 */
export function stripJpegMetadata(input: Uint8Array): Uint8Array {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return input;
  const out: number[] = [0xff, 0xd8];
  let i = 2;
  while (i + 4 <= input.length) {
    if (input[i] !== 0xff) break; // malformed: stop and keep the rest
    const marker = input[i + 1];
    if (marker === 0xd9) break; // EOI before any scan
    if (marker === 0xda) {
      // start of scan: everything after this is image data until EOI
      for (let j = i; j < input.length; j++) out.push(input[j]);
      return Uint8Array.from(out);
    }
    const len = (input[i + 2] << 8) | input[i + 3];
    const end = i + 2 + len;
    const isAppN = marker >= 0xe1 && marker <= 0xef; // APP1..APP15 (Exif, XMP, ICC, Photoshop IPTC...)
    const isComment = marker === 0xfe;
    if (!isAppN && !isComment) for (let j = i; j < end && j < input.length; j++) out.push(input[j]);
    i = end;
  }
  for (let j = i; j < input.length; j++) out.push(input[j]);
  return Uint8Array.from(out);
}

/** True if the bytes contain an Exif block (used by tests and as a final check). */
export function hasExif(bytes: Uint8Array): boolean {
  const sig = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00]; // "Exif\0\0"
  outer: for (let i = 0; i + sig.length <= bytes.length; i++) {
    for (let k = 0; k < sig.length; k++) if (bytes[i + k] !== sig[k]) continue outer;
    return true;
  }
  return false;
}

export interface CompressedPhoto {
  blob: Blob;
  base64: string;
  width: number;
  height: number;
}

async function decode(file: Blob): Promise<{
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  width: number;
  height: number;
  close: () => void;
}> {
  if (typeof createImageBitmap === 'function') {
    // imageOrientation: 'from-image' applies the EXIF rotation before the metadata is dropped
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' } as ImageBitmapOptions);
    return {
      draw: (c, w, h) => c.drawImage(bmp, 0, 0, w, h),
      width: bmp.width,
      height: bmp.height,
      close: () => bmp.close(),
    };
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  return {
    draw: (c, w, h) => c.drawImage(img, 0, 0, w, h),
    width: img.naturalWidth,
    height: img.naturalHeight,
    close: () => URL.revokeObjectURL(url),
  };
}

export async function blobToBase64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

/** Resizes and re-encodes a photo; the result has no EXIF/GPS metadata. */
export async function compressPhoto(file: Blob): Promise<CompressedPhoto> {
  const src = await decode(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(src.width, src.height));
    const w = Math.max(1, Math.round(src.width * scale));
    const h = Math.max(1, Math.round(src.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error("This phone can't prepare the photo.");
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    src.draw(ctx, w, h);
    const encoded = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("Couldn't prepare the photo."))),
        'image/jpeg',
        QUALITY,
      ),
    );
    const clean = stripJpegMetadata(new Uint8Array(await encoded.arrayBuffer()));
    if (hasExif(clean)) throw new Error('The photo still had location data, so it was not used.');
    const blob = new Blob([clean as BlobPart], { type: 'image/jpeg' });
    return { blob, base64: await blobToBase64(blob), width: w, height: h };
  } finally {
    src.close();
  }
}

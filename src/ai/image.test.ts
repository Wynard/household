import { describe, expect, it } from 'vitest';
import { hasExif, stripJpegMetadata } from './image';

/** Builds a JPEG-shaped byte array with an Exif APP1 segment that holds a GPS IFD. */
function jpegWithGps(): Uint8Array {
  const seg = (marker: number, payload: number[]) => [
    0xff,
    marker,
    ((payload.length + 2) >> 8) & 0xff,
    (payload.length + 2) & 0xff,
    ...payload,
  ];
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
  // TIFF header (little endian) with IFD0 holding one entry: GPSInfo (0x8825) -> GPS IFD with GPSLatitude
  const tiff = [
    ...ascii('II'),
    0x2a,
    0x00,
    0x08,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00, // 1 entry
    0x25,
    0x88,
    0x04,
    0x00,
    0x01,
    0x00,
    0x00,
    0x00,
    0x1a,
    0x00,
    0x00,
    0x00, // GPSInfo pointer
    0x00,
    0x00,
    0x00,
    0x00,
    0x01,
    0x00, // GPS IFD: 1 entry
    0x02,
    0x00,
    0x05,
    0x00,
    0x03,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00, // GPSLatitude, RATIONAL x3
    0x00,
    0x00,
    0x00,
    0x00,
    ...ascii('44.4268N 26.1025E'), // a recognisable location string
  ];
  const app0 = seg(0xe0, [...ascii('JFIF'), 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]);
  const app1 = seg(0xe1, [...ascii('Exif'), 0x00, 0x00, ...tiff]);
  const xmp = seg(0xe1, [
    ...ascii('http://ns.adobe.com/xap/1.0/'),
    0x00,
    ...ascii('<x:xmpmeta exif:GPSLatitude="44,26N"/>'),
  ]);
  const com = seg(0xfe, ascii('taken at home'));
  const dqt = seg(0xdb, [0x00, ...new Array(64).fill(1)]);
  const sof = seg(0xc0, [0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00]);
  const sos = [...seg(0xda, [0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]), 0x12, 0x34, 0x56, 0xff, 0x00, 0x78];
  return Uint8Array.from([0xff, 0xd8, ...app0, ...app1, ...xmp, ...com, ...dqt, ...sof, ...sos, 0xff, 0xd9]);
}

const text = (b: Uint8Array) => String.fromCharCode(...b);

describe('receipt photo metadata', () => {
  it('removes EXIF (including GPS), XMP and comments from a JPEG', () => {
    const input = jpegWithGps();
    expect(hasExif(input)).toBe(true);
    expect(text(input)).toContain('44.4268N');
    const out = stripJpegMetadata(input);
    expect(hasExif(out)).toBe(false);
    expect(text(out)).not.toContain('44.4268N');
    expect(text(out)).not.toContain('GPSLatitude');
    expect(text(out)).not.toContain('taken at home');
    // GPS IFD tag 0x8825 is gone
    expect(text(out)).not.toContain(String.fromCharCode(0x25, 0x88));
  });

  it('keeps the parts needed to show the image', () => {
    const out = stripJpegMetadata(jpegWithGps());
    expect([out[0], out[1]]).toEqual([0xff, 0xd8]);
    expect(text(out)).toContain('JFIF');
    const hasMarker = (m: number) => out.some((v, i) => v === 0xff && out[i + 1] === m);
    expect(hasMarker(0xdb)).toBe(true); // quantisation table
    expect(hasMarker(0xc0)).toBe(true); // frame
    expect(hasMarker(0xda)).toBe(true); // scan
    expect([out.at(-2), out.at(-1)]).toEqual([0xff, 0xd9]);
  });

  it('leaves non-JPEG data alone', () => {
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47]);
    expect(stripJpegMetadata(png)).toBe(png);
  });
});

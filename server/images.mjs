import { crc32 } from 'node:zlib';

// Parent pictures and home-screen icons: PNG, JPEG or WebP picked by their bytes (never the name or the
// Content-Type), size-capped, and rebuilt from only the parts that draw the picture, so camera EXIF,
// GPS, XMP, comments, colour profiles, thumbnails and anything appended after the image are dropped.

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGE_SIDE = 4096;

export class ImageError extends Error {}
const fail = message => { throw new ImageError(message); };

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const TYPES = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };
const EXTENSIONS = { png: 'png', jpeg: 'jpg', webp: 'webp' };
export const imageExtension = kind => EXTENSIONS[kind];

export function sniff(bytes) {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 12 && bytes.toString('latin1', 0, 4) === 'RIFF' && bytes.toString('latin1', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/* ---------- PNG ---------- */
// Chunks that only describe how to draw the pixels; everything else (tEXt, iTXt, zTXt, eXIf, tIME,
// iCCP, private chunks) is metadata and goes.
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'IDAT', 'IEND']);

function pngChunks(bytes) {
  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) fail('That is not a PNG.');
  const chunks = [];
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('latin1', at + 4, at + 8);
    if (!/^[A-Za-z]{4}$/.test(type) || at + 12 + length > bytes.length) fail('The PNG is damaged.');
    const body = bytes.subarray(at + 4, at + 8 + length);
    if (crc32(body) !== bytes.readUInt32BE(at + 8 + length)) fail('The PNG is damaged.');
    chunks.push({ type, data: bytes.subarray(at + 8, at + 8 + length), raw: bytes.subarray(at, at + 12 + length) });
    at += 12 + length;
    if (type === 'IEND') break;
  }
  if (chunks[0]?.type !== 'IHDR' || chunks[0].data.length !== 13 || chunks.at(-1)?.type !== 'IEND') fail('The PNG is damaged.');
  if (!chunks.some(chunk => chunk.type === 'IDAT')) fail('The PNG has no picture.');
  return chunks;
}

export function pngSize(bytes) {
  const [ihdr] = pngChunks(bytes);
  return { width: ihdr.data.readUInt32BE(0), height: ihdr.data.readUInt32BE(4) };
}

function cleanPng(bytes) {
  const chunks = pngChunks(bytes);
  if (chunks.some(chunk => chunk.type === 'acTL')) fail('Use a still picture, not an animation.');
  const { width, height } = { width: chunks[0].data.readUInt32BE(0), height: chunks[0].data.readUInt32BE(4) };
  return { width, height, bytes: Buffer.concat([PNG_SIGNATURE, ...chunks.filter(chunk => PNG_KEEP.has(chunk.type)).map(chunk => chunk.raw)]) };
}

/* ---------- JPEG ---------- */
const SOF = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
// Tables and frame markers a decoder needs; APPn and COM segments are metadata, except Adobe's APP14,
// which says how to read the colours of some CMYK files and carries nothing personal.
const JPEG_KEEP = new Set([0xdb, 0xc4, 0xcc, 0xdd, ...SOF]);

// Reads the EXIF orientation so a sideways phone photo still shows upright once its EXIF is gone.
function exifOrientation(segment) {
  if (segment.length < 14 || segment.toString('latin1', 0, 6) !== 'Exif\0\0') return 0;
  const tiff = segment.subarray(6);
  const little = tiff.toString('latin1', 0, 2) === 'II';
  if (!little && tiff.toString('latin1', 0, 2) !== 'MM') return 0;
  const u16 = at => little ? tiff.readUInt16LE(at) : tiff.readUInt16BE(at);
  const u32 = at => little ? tiff.readUInt32LE(at) : tiff.readUInt32BE(at);
  try {
    const ifd = u32(4);
    const count = u16(ifd);
    for (let i = 0; i < count; i++) {
      const entry = ifd + 2 + i * 12;
      if (u16(entry) === 0x0112) {
        const value = u16(entry + 8);
        return value >= 2 && value <= 8 ? value : 0;
      }
    }
  } catch { return 0; }
  return 0;
}

// A fresh EXIF block holding only the orientation tag.
function orientationSegment(value) {
  const payload = Buffer.alloc(6 + 8 + 2 + 12 + 4);
  payload.write('Exif\0\0', 0, 'latin1');
  payload.write('MM', 6, 'latin1');
  payload.writeUInt16BE(42, 8);
  payload.writeUInt32BE(8, 10);
  payload.writeUInt16BE(1, 14);
  payload.writeUInt16BE(0x0112, 16);
  payload.writeUInt16BE(3, 18);
  payload.writeUInt32BE(1, 20);
  payload.writeUInt16BE(value, 24);
  const header = Buffer.from([0xff, 0xe1, 0, 0]);
  header.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([header, payload]);
}

function cleanJpeg(bytes) {
  const out = [Buffer.from([0xff, 0xd8])];
  let at = 2, width = 0, height = 0, orientation = 0, ended = false;
  while (at < bytes.length) {
    if (bytes[at] !== 0xff) fail('The JPEG is damaged.');
    let marker = bytes[at + 1];
    while (marker === 0xff) marker = bytes[++at + 1];
    if (marker === undefined) fail('The JPEG is damaged.');
    if (marker === 0xd9) { out.push(Buffer.from([0xff, 0xd9])); ended = true; break; }
    if (at + 4 > bytes.length) fail('The JPEG is damaged.');
    const length = bytes.readUInt16BE(at + 2);
    if (length < 2 || at + 2 + length > bytes.length) fail('The JPEG is damaged.');
    const segment = bytes.subarray(at, at + 2 + length);
    const payload = bytes.subarray(at + 4, at + 2 + length);
    at += 2 + length;
    if (marker === 0xe1 && !orientation) orientation = exifOrientation(payload);
    if (marker === 0xda) {
      // Entropy-coded data runs until a marker other than a stuffed 0xFF00 or a restart marker.
      let end = at;
      while (end + 1 < bytes.length && !(bytes[end] === 0xff && bytes[end + 1] !== 0 && !(bytes[end + 1] >= 0xd0 && bytes[end + 1] <= 0xd7))) end++;
      if (end + 1 >= bytes.length) fail('The JPEG is damaged.');
      out.push(segment, bytes.subarray(at, end));
      at = end;
      continue;
    }
    if (SOF.has(marker)) {
      if (payload.length < 6) fail('The JPEG is damaged.');
      height = payload.readUInt16BE(1);
      width = payload.readUInt16BE(3);
    }
    if (JPEG_KEEP.has(marker) || (marker === 0xee && payload.toString('latin1', 0, 5) === 'Adobe')) out.push(segment);
    else if (!((marker >= 0xe0 && marker <= 0xef) || marker === 0xfe)) fail('The JPEG uses a feature this site does not accept.');
  }
  if (!ended || !width || !height) fail('The JPEG is damaged.');
  if (orientation) out.splice(1, 0, orientationSegment(orientation));
  return { width, height, bytes: Buffer.concat(out) };
}

/* ---------- WebP ---------- */
function cleanWebp(bytes) {
  const declared = bytes.readUInt32LE(4) + 8;
  if (declared > bytes.length || declared < 20) fail('The WebP is damaged.');
  const chunks = [];
  for (let at = 12; at < declared;) {
    if (at + 8 > declared) fail('The WebP is damaged.');
    const type = bytes.toString('latin1', at, at + 4), length = bytes.readUInt32LE(at + 4);
    if (at + 8 + length > declared) fail('The WebP is damaged.');
    chunks.push({ type, data: bytes.subarray(at + 8, at + 8 + length) });
    at += 8 + length + (length & 1);
  }
  const image = chunks.find(chunk => chunk.type === 'VP8 ' || chunk.type === 'VP8L');
  if (!image) fail('The WebP has no picture.');
  if (chunks.some(chunk => chunk.type === 'ANIM' || chunk.type === 'ANMF')) fail('Use a still picture, not an animation.');
  let width, height;
  const vp8x = chunks.find(chunk => chunk.type === 'VP8X');
  if (vp8x) {
    if (vp8x.data.length < 10) fail('The WebP is damaged.');
    if (vp8x.data[0] & 0x02) fail('Use a still picture, not an animation.');
    width = vp8x.data.readUIntLE(4, 3) + 1;
    height = vp8x.data.readUIntLE(7, 3) + 1;
  } else if (image.type === 'VP8 ') {
    if (image.data.length < 10 || image.data[3] !== 0x9d || image.data[4] !== 0x01 || image.data[5] !== 0x2a) fail('The WebP is damaged.');
    width = image.data.readUInt16LE(6) & 0x3fff;
    height = image.data.readUInt16LE(8) & 0x3fff;
  } else {
    if (image.data.length < 5 || image.data[0] !== 0x2f) fail('The WebP is damaged.');
    const bits = image.data.readUInt32LE(1);
    width = (bits & 0x3fff) + 1;
    height = ((bits >> 14) & 0x3fff) + 1;
  }
  // Keep the picture and its alpha; drop ICCP, EXIF, XMP and unknown chunks, and clear their flags.
  const kept = [];
  for (const chunk of chunks) {
    let data = chunk.data;
    if (chunk.type === 'VP8X') { data = Buffer.from(data); data[0] &= ~(0x20 | 0x08 | 0x04); }
    else if (!['VP8 ', 'VP8L', 'ALPH'].includes(chunk.type)) continue;
    const header = Buffer.alloc(8);
    header.write(chunk.type, 0, 'latin1');
    header.writeUInt32LE(data.length, 4);
    kept.push(header, data, ...(data.length & 1 ? [Buffer.alloc(1)] : []));
  }
  const body = Buffer.concat(kept);
  const head = Buffer.alloc(12);
  head.write('RIFF', 0, 'latin1');
  head.writeUInt32LE(body.length + 4, 4);
  head.write('WEBP', 8, 'latin1');
  return { width, height, bytes: Buffer.concat([head, body]) };
}

// Checks and cleans a parent's picture. Returns { kind, type, width, height, bytes }.
export function cleanImage(bytes, { maxBytes = MAX_IMAGE_BYTES, maxSide = MAX_IMAGE_SIDE } = {}) {
  if (bytes.length > maxBytes) fail(`Pictures must be under ${Math.round(maxBytes / 1024 / 1024)} MB.`);
  const kind = sniff(bytes);
  if (!kind) fail('Use a PNG, JPEG or WebP picture.');
  const result = kind === 'png' ? cleanPng(bytes) : kind === 'jpeg' ? cleanJpeg(bytes) : cleanWebp(bytes);
  if (!result.width || !result.height || result.width > maxSide || result.height > maxSide) {
    fail(`Pictures can be up to ${maxSide} pixels on each side.`);
  }
  return { kind, type: TYPES[kind], ...result };
}

// Home-screen icons are always square PNGs of an exact size.
export function cleanIcon(bytes, side) {
  if (sniff(bytes) !== 'png') fail('Icons must be PNG files.');
  const { width, height, bytes: clean } = cleanPng(bytes);
  if (width !== side || height !== side) fail(`This icon must be ${side} x ${side} pixels.`);
  return clean;
}

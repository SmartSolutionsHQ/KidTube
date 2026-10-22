// A small TrueType reader: just enough of cmap, head, hhea, hmtx, maxp, loca, glyf and OS/2 to turn
// characters into outlines. Fonts are treated as data; anything malformed throws.

const TAG = (view, at) => String.fromCharCode(view.getUint8(at), view.getUint8(at + 1), view.getUint8(at + 2), view.getUint8(at + 3));

export function parseFont(buffer) {
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const version = view.getUint32(0);
  if (version !== 0x00010000 && version !== 0x74727565) throw new Error('Not a TrueType font (glyf outlines only).');
  const tables = {};
  for (let i = 0, count = view.getUint16(4); i < count; i++) {
    const at = 12 + i * 16;
    const offset = view.getUint32(at + 8), length = view.getUint32(at + 12);
    if (offset + length > buffer.byteLength) throw new Error('Table runs past the end of the file.');
    tables[TAG(view, at)] = { offset, length };
  }
  for (const name of ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'loca', 'glyf']) if (!tables[name]) throw new Error(`Missing ${name} table.`);

  const head = tables.head.offset;
  const unitsPerEm = view.getUint16(head + 18);
  const longLoca = view.getInt16(head + 50) === 1;
  const numGlyphs = view.getUint16(tables.maxp.offset + 4);
  const hhea = tables.hhea.offset;
  const ascender = view.getInt16(hhea + 4), descender = view.getInt16(hhea + 6);
  const numberOfHMetrics = view.getUint16(hhea + 34);

  let capHeight = null, xHeight = null;
  if (tables['OS/2'] && view.getUint16(tables['OS/2'].offset) >= 2) {
    xHeight = view.getInt16(tables['OS/2'].offset + 86);
    capHeight = view.getInt16(tables['OS/2'].offset + 88);
  }

  function advance(glyph) {
    const index = Math.min(glyph, numberOfHMetrics - 1);
    return view.getUint16(tables.hmtx.offset + index * 4);
  }

  function glyphRange(glyph) {
    if (glyph < 0 || glyph >= numGlyphs) throw new Error(`Glyph ${glyph} out of range.`);
    const loca = tables.loca.offset;
    const start = longLoca ? view.getUint32(loca + glyph * 4) : view.getUint16(loca + glyph * 2) * 2;
    const end = longLoca ? view.getUint32(loca + glyph * 4 + 4) : view.getUint16(loca + glyph * 2 + 2) * 2;
    if (end < start || end > tables.glyf.length) throw new Error(`Bad loca entry for glyph ${glyph}.`);
    return [tables.glyf.offset + start, end - start];
  }

  // Each contour is a list of {x, y, on} points in font units, y up.
  function contours(glyph, depth = 0) {
    if (depth > 8) throw new Error('Composite glyphs nest too deeply.');
    const [at, length] = glyphRange(glyph);
    if (!length) return [];
    const count = view.getInt16(at);
    if (count >= 0) return simple(at, count);
    return composite(at, depth);
  }

  function simple(at, count) {
    const ends = [];
    for (let i = 0; i < count; i++) ends.push(view.getUint16(at + 10 + i * 2));
    const total = count ? ends[count - 1] + 1 : 0;
    let p = at + 10 + count * 2;
    p += 2 + view.getUint16(p);
    const flags = [];
    while (flags.length < total) {
      const flag = view.getUint8(p++);
      flags.push(flag);
      if (flag & 8) for (let r = view.getUint8(p++); r > 0; r--) flags.push(flag);
    }
    const xs = [], ys = [];
    let x = 0, y = 0;
    for (const flag of flags) {
      if (flag & 2) { const d = view.getUint8(p++); x += flag & 16 ? d : -d; }
      else if (!(flag & 16)) { x += view.getInt16(p); p += 2; }
      xs.push(x);
    }
    for (const flag of flags) {
      if (flag & 4) { const d = view.getUint8(p++); y += flag & 32 ? d : -d; }
      else if (!(flag & 32)) { y += view.getInt16(p); p += 2; }
      ys.push(y);
    }
    const out = [];
    let start = 0;
    for (const end of ends) {
      const contour = [];
      for (let i = start; i <= end; i++) contour.push({ x: xs[i], y: ys[i], on: Boolean(flags[i] & 1) });
      out.push(contour);
      start = end + 1;
    }
    return out;
  }

  function composite(at, depth) {
    const out = [];
    let p = at + 10, more = true;
    while (more) {
      const flags = view.getUint16(p), component = view.getUint16(p + 2);
      p += 4;
      let dx, dy;
      if (flags & 1) { dx = view.getInt16(p); dy = view.getInt16(p + 2); p += 4; }
      else { dx = view.getInt8(p); dy = view.getInt8(p + 1); p += 2; }
      if (!(flags & 2)) throw new Error('Point-matched composite glyphs are not supported.');
      let a = 1, b = 0, c = 0, d = 1;
      const f2dot14 = q => view.getInt16(q) / 16384;
      if (flags & 8) { a = d = f2dot14(p); p += 2; }
      else if (flags & 0x40) { a = f2dot14(p); d = f2dot14(p + 2); p += 4; }
      else if (flags & 0x80) { a = f2dot14(p); b = f2dot14(p + 2); c = f2dot14(p + 4); d = f2dot14(p + 6); p += 8; }
      for (const contour of contours(component, depth + 1)) {
        out.push(contour.map(pt => ({ x: pt.x * a + pt.y * c + dx, y: pt.x * b + pt.y * d + dy, on: pt.on })));
      }
      more = Boolean(flags & 0x20);
    }
    return out;
  }

  // cmap formats 4 and 12, preferring a Unicode subtable.
  const cmap = new Map();
  {
    const base = tables.cmap.offset;
    let best = null;
    for (let i = 0, n = view.getUint16(base + 2); i < n; i++) {
      const platform = view.getUint16(base + 4 + i * 8), encoding = view.getUint16(base + 6 + i * 8);
      const offset = base + view.getUint32(base + 8 + i * 8);
      const format = view.getUint16(offset);
      const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
      if (!unicode || (format !== 4 && format !== 12)) continue;
      if (!best || format > best.format) best = { offset, format };
    }
    if (!best) throw new Error('No Unicode cmap.');
    const t = best.offset;
    if (best.format === 4) {
      const segments = view.getUint16(t + 6) / 2;
      const ends = t + 14, starts = ends + segments * 2 + 2, deltas = starts + segments * 2, ranges = deltas + segments * 2;
      for (let s = 0; s < segments; s++) {
        const end = view.getUint16(ends + s * 2), start = view.getUint16(starts + s * 2);
        const delta = view.getInt16(deltas + s * 2), range = view.getUint16(ranges + s * 2);
        for (let code = start; code <= end && code !== 0xffff; code++) {
          let glyph;
          if (!range) glyph = (code + delta) & 0xffff;
          else {
            const q = ranges + s * 2 + range + (code - start) * 2;
            glyph = view.getUint16(q);
            if (glyph) glyph = (glyph + delta) & 0xffff;
          }
          if (glyph) cmap.set(code, glyph);
        }
      }
    } else {
      for (let g = 0, n = view.getUint32(t + 12); g < n; g++) {
        const at = t + 16 + g * 12;
        const start = view.getUint32(at), end = view.getUint32(at + 4), first = view.getUint32(at + 8);
        for (let code = start; code <= end && code <= 0xffff; code++) cmap.set(code, first + code - start);
      }
    }
  }

  return { unitsPerEm, ascender, descender, capHeight, xHeight, numGlyphs, cmap, advance, contours };
}

// Outlines are rounded to whole font units (a badge draws a glyph at most ~100 px tall, so 1/2048 em
// is far below a pixel) and written with relative commands to keep the tables small.
function writer() {
  let d = '', x = 0, y = 0, last = '';
  const pair = (px, py) => {
    const dx = Math.round(px) - x, dy = Math.round(py) - y;
    x += dx; y += dy;
    return [dx, dy];
  };
  const join = values => values.map((value, i) => (i && value >= 0 ? ' ' : '') + value).join('');
  return {
    move(px, py) { d += 'm' + join(pair(px, py)); last = 'm'; },
    line(px, py) { const v = pair(px, py); d += (last === 'l' ? (v[0] >= 0 ? ' ' : '') : 'l') + join(v); last = 'l'; },
    quad(cx, cy, px, py) {
      const values = [Math.round(cx) - x, Math.round(cy) - y, ...pair(px, py)];
      d += (last === 'q' ? (values[0] >= 0 ? ' ' : '') : 'q') + join(values); last = 'q';
    },
    close() { d += 'z'; last = 'z'; },
    toString() { return d; },
  };
}

// Quadratic TrueType contours to an SVG path in font units (y up), with implied on-curve midpoints.
export function contoursToPath(contours) {
  const out = writer();
  for (const contour of contours) {
    if (contour.length < 2) continue;
    let points = contour;
    // Start on an on-curve point; if there is none, start at the midpoint of the first two.
    const first = points.findIndex(pt => pt.on);
    let start;
    if (first < 0) {
      start = { x: (points[0].x + points[1].x) / 2, y: (points[0].y + points[1].y) / 2, on: true };
      points = points.slice(1).concat(points.slice(0, 1));
    } else {
      points = points.slice(first).concat(points.slice(0, first));
      start = points[0];
      points = points.slice(1);
    }
    out.move(start.x, start.y);
    let control = null;
    for (const pt of [...points, start]) {
      if (pt.on) {
        if (control) out.quad(control.x, control.y, pt.x, pt.y); else out.line(pt.x, pt.y);
        control = null;
      } else if (control) {
        out.quad(control.x, control.y, (control.x + pt.x) / 2, (control.y + pt.y) / 2);
        control = pt;
      } else control = pt;
    }
    out.close();
  }
  return String(out);
}

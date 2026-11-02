// imaging.js — JS reference implementations of the filters that also run in
// filter.lat. Used by the image demo for the "JS" mode and by the parity check.
//
// The math intentionally mirrors the Latent source bit for bit: integer luma,
// clamped-edge box blur with a sliding window, Sobel on luma. No allocations in
// the hot path: callers reuse `dst` (and `tmp` for blur).

export function luma(r, g, b) {
  return (77 * r + 150 * g + 29 * b) >> 8;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function grayJS(src, dst, w, h) {
  const n = w * h * 4;
  for (let i = 0; i < n; i += 4) {
    const v = luma(src[i], src[i + 1], src[i + 2]);
    dst[i] = v;
    dst[i + 1] = v;
    dst[i + 2] = v;
    dst[i + 3] = 255;
  }
  return dst;
}

export function thresholdJS(src, dst, w, h, cut) {
  const n = w * h * 4;
  for (let i = 0; i < n; i += 4) {
    const v = luma(src[i], src[i + 1], src[i + 2]);
    const o = v >= cut ? 255 : 0;
    dst[i] = o;
    dst[i + 1] = o;
    dst[i + 2] = o;
    dst[i + 3] = 255;
  }
  return dst;
}

export function sobelJS(src, dst, w, h) {
  for (let y = 0; y < h; y++) {
    const ym = y > 0 ? y - 1 : 0;
    const yp = y < h - 1 ? y + 1 : h - 1;
    for (let x = 0; x < w; x++) {
      const xm = x > 0 ? x - 1 : 0;
      const xp = x < w - 1 ? x + 1 : w - 1;
      const at = (xx, yy) => {
        const o = (yy * w + xx) * 4;
        return luma(src[o], src[o + 1], src[o + 2]);
      };
      const tl = at(xm, ym);
      const tc = at(x, ym);
      const tr = at(xp, ym);
      const ml = at(xm, y);
      const mr = at(xp, y);
      const bl = at(xm, yp);
      const bc = at(x, yp);
      const br = at(xp, yp);
      const gx = tr + 2 * mr + br - (tl + 2 * ml + bl);
      const gy = bl + 2 * bc + br - (tl + 2 * tc + tr);
      const mag = gx * gx + gy * gy;
      let v = 255;
      if (mag < 90000) v = 0;
      if (mag > 90000 && mag < 160000) v = 128;
      const o = (y * w + x) * 4;
      dst[o] = v;
      dst[o + 1] = v;
      dst[o + 2] = v;
      dst[o + 3] = 255;
    }
  }
  return dst;
}

export function blurHJS(src, dst, w, h, r) {
  const d = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (let k = -r; k <= r; k++) {
      const o = row + clamp(k, 0, w - 1) * 4;
      sr += src[o];
      sg += src[o + 1];
      sb += src[o + 2];
    }
    for (let x = 0; x < w; x++) {
      const o = row + x * 4;
      dst[o] = (sr / d) | 0;
      dst[o + 1] = (sg / d) | 0;
      dst[o + 2] = (sb / d) | 0;
      dst[o + 3] = 255;
      const xo = clamp(x - r, 0, w - 1);
      const xn = clamp(x + r + 1, 0, w - 1);
      sr += src[row + xn * 4] - src[row + xo * 4];
      sg += src[row + xn * 4 + 1] - src[row + xo * 4 + 1];
      sb += src[row + xn * 4 + 2] - src[row + xo * 4 + 2];
    }
  }
  return dst;
}

export function blurVJS(src, dst, w, h, r) {
  const d = 2 * r + 1;
  for (let x = 0; x < w; x++) {
    let sr = 0;
    let sg = 0;
    let sb = 0;
    for (let k = -r; k <= r; k++) {
      const o = (clamp(k, 0, h - 1) * w + x) * 4;
      sr += src[o];
      sg += src[o + 1];
      sb += src[o + 2];
    }
    for (let y = 0; y < h; y++) {
      const o = (y * w + x) * 4;
      dst[o] = (sr / d) | 0;
      dst[o + 1] = (sg / d) | 0;
      dst[o + 2] = (sb / d) | 0;
      dst[o + 3] = 255;
      const yo = clamp(y - r, 0, h - 1);
      const yn = clamp(y + r + 1, 0, h - 1);
      sr += src[(yn * w + x) * 4] - src[(yo * w + x) * 4];
      sg += src[(yn * w + x) * 4 + 1] - src[(yo * w + x) * 4 + 1];
      sb += src[(yn * w + x) * 4 + 2] - src[(yo * w + x) * 4 + 2];
    }
  }
  return dst;
}

/**
 * Apply filter `cmd` (1 gray, 2 blur, 3 sobel, 4 threshold) in plain JS.
 * `tmp` is required for blur; it must be the same size as dst.
 */
export function filterJS(src, dst, w, h, cmd, radius, cut, tmp) {
  if (cmd === 1) return grayJS(src, dst, w, h);
  if (cmd === 2) {
    const r = clamp(radius, 0, 24);
    if (r === 0) return grayJS(src, dst, w, h);
    blurHJS(src, tmp, w, h, r);
    return blurVJS(tmp, dst, w, h, r);
  }
  if (cmd === 3) return sobelJS(src, dst, w, h);
  if (cmd === 4) return thresholdJS(src, dst, w, h, clamp(cut, 0, 255));
  return dst;
}

/** Cheap order-sensitive checksum used for the WASM/JS parity badge. */
export function checksum(data) {
  let h = 2166136261;
  for (let i = 0; i < data.length; i += 16) {
    h = Math.imul(h ^ data[i], 16777619);
  }
  return h >>> 0;
}

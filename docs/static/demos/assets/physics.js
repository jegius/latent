// physics.js — plain-JS twin of particles.lat.
//
// Same fixed-point layout and the same integer operations (positions 1/16 px,
// velocities 1/256 px/step, 16.16 attractor rotation). It exists for two things:
// the "JS" mode of the physics demo, and the parity check that proves the WASM
// kernel computes exactly the same trajectories.

const MAX = 30000;
const MASK = 0x7fffffff;

function lcg(s) {
  return (Math.imul(s, 1103515245) + 12345) & MASK;
}

function truncDiv(a, b) {
  return (a / b) | 0;
}

export class PhysicsJS {
  constructor() {
    this.x = new Int32Array(MAX);
    this.y = new Int32Array(MAX);
    this.vx = new Int32Array(MAX);
    this.vy = new Int32Array(MAX);
    this.r0x = 0;
    this.r0y = 0;
    this.r1x = 0;
    this.r1y = 0;
    this.r2x = 0;
    this.r2y = 0;
    this.count = 0;
    this.w = 0;
    this.h = 0;
  }

  init(count, w, h) {
    count = Math.min(count, MAX);
    this.count = count;
    this.w = w;
    this.h = h;
    this.r0x = w * 3;
    this.r0y = 0;
    this.r1x = -truncDiv(w * 3, 2);
    this.r1y = truncDiv(w * 3 * 443, 512);
    this.r2x = -truncDiv(w * 3, 2);
    this.r2y = -truncDiv(w * 3 * 443, 512);

    let s = 88172645;
    const cx = w * 8;
    const cy = h * 8;
    const rr = w * 4;
    for (let i = 0; i < count; i++) {
      let px = 0;
      let py = 0;
      let ok = 0;
      while (ok === 0) {
        s = lcg(s);
        px = s % (w * 16);
        s = lcg(s);
        py = s % (h * 16);
        const dx = px - cx;
        const dy = py - cy;
        if (dx * dx + dy * dy < rr * rr) ok = 1;
      }
      s = lcg(s);
      this.x[i] = px;
      this.y[i] = py;
      this.vx[i] = truncDiv(0 - (py - cy), 10) + (s % 161) - 80;
      s = lcg(s);
      this.vy[i] = truncDiv(px - cx, 10) + (s % 161) - 80;
    }
  }

  step(count, gravity, w, h) {
    count = Math.min(count, MAX);
    const {x, y, vx, vy} = this;

    const c = 65501;
    const sn = 2287;
    let n0x = (this.r0x * c - this.r0y * sn) >> 16;
    let n0y = (this.r0y * c + this.r0x * sn) >> 16;
    let n1x = (this.r1x * c - this.r1y * sn) >> 16;
    let n1y = (this.r1y * c + this.r1x * sn) >> 16;
    let n2x = (this.r2x * c - this.r2y * sn) >> 16;
    let n2y = (this.r2y * c + this.r2x * sn) >> 16;
    this.r0x = n0x;
    this.r0y = n0y;
    this.r1x = n1x;
    this.r1y = n1y;
    this.r2x = n2x;
    this.r2y = n2y;

    const cx = w * 8;
    const cy = h * 8;
    const ax0 = cx + n0x;
    const ay0 = cy + n0y;
    const ax1 = cx + n1x;
    const ay1 = cy + n1y;
    const ax2 = cx + n2x;
    const ay2 = cy + n2y;

    for (let i = 0; i < count; i++) {
      let px = x[i];
      let py = y[i];
      let pvx = vx[i];
      let pvy = vy[i];

      // Attractor 0
      let dx = ax0 - px;
      let dy = ay0 - py;
      let d2 = (dx * dx + dy * dy) | 0;
      if (d2 < 90000) {
        let vn = (pvx * dx + pvy * dy) | 0;
        if (vn > 0 && d2 > 0) {
          pvx = (pvx - truncDiv(2 * vn * dx, d2)) | 0;
          pvy = (pvy - truncDiv(2 * vn * dy, d2)) | 0;
        }
      } else {
        let f = truncDiv(gravity << 24, d2 + 40000);
        pvx = (pvx + ((dx * f) >> 13) - ((dy * f) >> 13)) | 0;
        pvy = (pvy + ((dy * f) >> 13) + ((dx * f) >> 13)) | 0;
      }

      // Attractor 1
      dx = ax1 - px;
      dy = ay1 - py;
      d2 = (dx * dx + dy * dy) | 0;
      if (d2 < 90000) {
        let vn = (pvx * dx + pvy * dy) | 0;
        if (vn > 0 && d2 > 0) {
          pvx = (pvx - truncDiv(2 * vn * dx, d2)) | 0;
          pvy = (pvy - truncDiv(2 * vn * dy, d2)) | 0;
        }
      } else {
        let f = truncDiv(gravity << 24, d2 + 40000);
        pvx = (pvx + ((dx * f) >> 13) - ((dy * f) >> 13)) | 0;
        pvy = (pvy + ((dy * f) >> 13) + ((dx * f) >> 13)) | 0;
      }

      // Attractor 2
      dx = ax2 - px;
      dy = ay2 - py;
      d2 = (dx * dx + dy * dy) | 0;
      if (d2 < 90000) {
        let vn = (pvx * dx + pvy * dy) | 0;
        if (vn > 0 && d2 > 0) {
          pvx = (pvx - truncDiv(2 * vn * dx, d2)) | 0;
          pvy = (pvy - truncDiv(2 * vn * dy, d2)) | 0;
        }
      } else {
        let f = truncDiv(gravity << 24, d2 + 40000);
        pvx = (pvx + ((dx * f) >> 13) - ((dy * f) >> 13)) | 0;
        pvy = (pvy + ((dy * f) >> 13) + ((dx * f) >> 13)) | 0;
      }

      pvx = (pvx * 252) >> 8;
      pvy = (pvy * 252) >> 8;
      px = (px + (pvx >> 4)) | 0;
      py = (py + (pvy >> 4)) | 0;

      if (px < 0) {
        px = 0;
        pvx = -truncDiv(pvx, 2);
      }
      if (px > w * 16) {
        px = w * 16;
        pvx = -truncDiv(pvx, 2);
      }
      if (py < 0) {
        py = 0;
        pvy = -truncDiv(pvy, 2);
      }
      if (py > h * 16) {
        py = h * 16;
        pvy = -truncDiv(pvy, 2);
      }

      x[i] = px;
      y[i] = py;
      vx[i] = pvx;
      vy[i] = pvy;
    }
  }
}

export {MAX as PHYSICS_MAX};

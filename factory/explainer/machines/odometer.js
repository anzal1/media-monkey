/*
 * odometer.js: machine #1, a mechanical counter.
 *
 * Digit drums on one axle between two cheeks, read through a two-rail bezel
 * tilted to face the camera. A crank on a spur gear drives the units drum.
 * Over the drums hangs a row of carry pawls on a lay shaft, one per gap: when
 * a drum wraps, the pawl to its left rocks and kicks its neighbour on by one.
 * The leftmost pawl has no drum to kick. It strikes a stop pin on the cheek,
 * which is where the carry goes when the register overflows.
 *
 * It explains counters, wraparound, modulo, integer overflow, two's
 * complement and base conversion. Bits mode (base 2) prints 0 and 1 around
 * each drum, greys the zeros and gaps the drums in nibbles.
 *
 *   params: { digits: 2..8, base: 2 | 10 | 16, label, readout, accent, signed }
 *   state:  { from, to, behaviour: "count" | "rollover" | "set" }
 *
 * Numbers are decimal integers. Strings are read as digits in the machine's
 * base ("01111111" in base 2, "7f" or "0x7f" in base 16), falling back to
 * decimal when they are not valid in that base.
 */
(function (root) {
  'use strict';
  const M_ = root.MM_MACHINES;
  if (!M_) return;
  const { glide, hump, smooth, prismX, turnYZ } = M_.util;
  const DIG = '0123456789ABCDEF';
  const AZIMUTH = 76;
  const ELEVATION = 17;
  const VW = 1000;
  const VH_MIN = 420;
  const VH_MAX = 660;
  const PAD = 8;
  const HEADROOM = 44;          // room for the plate's corner labels

  // ---------------------------------------------------------------- params
  function baseOf(b) {
    const s = String(b == null ? '10' : b).trim().toLowerCase();
    if (s === '2' || s === 'bin' || s === 'binary' || s === 'bits') return 2;
    if (s === '10' || s === 'dec' || s === 'decimal') return 10;
    if (s === '16' || s === 'hex' || s === 'hexadecimal') return 16;
    throw new Error(`base must be 2, 10 or 16, got ${b}`);
  }

  function valueOf(v, base) {
    if (typeof v === 'number') {
      if (!Number.isInteger(v)) throw new Error(`value ${v} is not an integer`);
      return v;
    }
    if (typeof v !== 'string') throw new Error('value missing');
    let s = v.trim().replace(/[\s_,']/g, '');
    let neg = false;
    if (s[0] === '-' || s[0] === '\u2212') { neg = true; s = s.slice(1); } else if (s[0] === '+') s = s.slice(1);
    let b = base;
    if (/^0x/i.test(s)) { b = 16; s = s.slice(2); } else if (/^0b/i.test(s)) { b = 2; s = s.slice(2); }
    const okIn = (bb) => s.length > 0 && new RegExp(`^[${DIG.slice(0, bb)}]+$`, 'i').test(s);
    if (!okIn(b)) {
      if (okIn(10)) b = 10;
      else throw new Error(`"${v}" is not a number in base ${base}`);
    }
    const n = parseInt(s, b);
    if (!Number.isFinite(n)) throw new Error(`"${v}" is not a number`);
    return neg ? -n : n;
  }

  const widthIn = (v, base) => Math.max(1, Math.abs(v).toString(base).length);

  function normalize(params, state) {
    const base = baseOf(params.base);
    const behaviour = ['count', 'rollover', 'set'].includes(state.behaviour) ? state.behaviour
      : ['count', 'rollover', 'set'].includes(state.behavior) ? state.behavior : 'count';
    if (state.from == null && state.to == null) throw new Error('state needs from or to');
    const from = valueOf(state.from != null ? state.from : state.to, base);
    let to = state.to != null ? valueOf(state.to, base) : behaviour === 'set' ? from : from + 1;
    if (Math.abs(from) > 2 ** 40 || Math.abs(to) > 2 ** 40) throw new Error('value out of range');
    let digits = Math.round(Number(params.digits));
    if (!Number.isFinite(digits)) {
      // infer from how the planner wrote the numbers
      const str = (v) => (typeof v === 'string' ? v.replace(/^[-+\u2212]?(0x|0b)?/i, '').length : 0);
      digits = Math.max(str(state.from), str(state.to), base === 10 ? 3 : 0, widthIn(from, base));
    }
    digits = Math.max(2, Math.min(8, digits));
    const accent = typeof params.accent === 'string' && /^(#[0-9a-f]{3,8}|[a-z]+|rgb\([\d\s,.%]+\)|hsl\([\d\s,.%deg]+\))$/i.test(params.accent.trim())
      ? params.accent.trim() : null;
    const clip = (s, n) => (typeof s === 'string' ? s.trim().slice(0, n) : '');
    return {
      p: {
        digits, base, accent,
        signed: !!params.signed && base !== 10,
        label: clip(params.label, 28),
        readout: clip(params.readout || params.readoutLabel || params.readout_label, 24),
      },
      s: { from, to, behaviour },
    };
  }

  // ---------------------------------------------------------------- timeline
  /**
   * Every drum turn is an event { start, dur, delta }: the drum's position
   * (in glyph pitches) glides by delta. A carry is just a later event on the
   * next drum, so the ripple is the stagger between those starts. Pawls get a
   * hump over the same window. All of it is fixed by (state, span) and read
   * at any t, which is what keeps the page frame-exact.
   */
  function timeline(p, s, span) {
    const { digits: N, base: b } = p;
    const M = b === 16 ? 16 : 10;
    const wheels = Array.from({ length: N }, () => []);
    const pawls = Array.from({ length: N + 1 }, () => []);   // pawls[j]: carries INTO wheel j; j = N is the overflow pawl
    const T0 = 0.75;
    const E = Math.max(T0 + 1.2, span - 0.85);
    const avail = E - T0;
    const n = Math.abs(s.to - s.from);
    const dir = s.to >= s.from ? 1 : -1;
    let readAt = null;   // (t) => integer the counter holds
    let mode = s.behaviour;
    if ((mode === 'count' || mode === 'rollover') && n > 60) mode = 'big';

    // returns when the step has settled: the last drum it moves is past half way
    const stepEvents = (k, tau, D, d) => {
      const prev = s.from + dir * (k - 1);
      const next = s.from + dir * k;
      let settled = tau + 0.5 * D;
      for (let j = 0; j <= N; j++) {
        if (Math.floor(next / b ** j) === Math.floor(prev / b ** j)) break;
        const start = tau + j * d;
        if (j < N) wheels[j].push({ start, dur: D, delta: dir });
        if (j > 0) pawls[j].push({ start: start - 0.2 * D, dur: D * 1.15 });
        settled = Math.max(settled, j < N ? start + 0.5 * D : start + 0.3 * D);
      }
      return settled;
    };

    if ((mode === 'count' || mode === 'rollover') && n > 0) {
      const taus = [];
      if (mode === 'rollover') {
        // the run-up ticks by quickly, the last step is the slow cascade
        const lastD = 0.62;
        const lastAt = n === 1 ? T0 + 0.2 : T0 + avail * 0.42;
        const dd = Math.max(0.08, Math.min(0.2, (E - lastAt - lastD) / N));
        if (n > 1) {
          const quick = Math.min(0.32, (lastAt - T0 - 0.1) / (n - 1));
          for (let k = 1; k < n; k++) taus.push(stepEvents(k, T0 + (k - 1) * quick, Math.max(0.1, quick * 0.92), Math.min(0.08, quick * 0.25)));
        }
        // the readout only changes once the whole cascade has gone through
        taus.push(stepEvents(n, lastAt, lastD, dd) + 0.3 * lastD);
        readAt = (t) => {
          let c = 0;
          for (let k = 0; k < taus.length; k++) if (t >= taus[k]) c = k + 1;
          return s.from + dir * c;
        };
      } else {
        let D; let d;
        if (n === 1) { D = 0.55; d = 0.18; taus.push(T0 + 0.1); } else {
          D = Math.max(0.12, Math.min(0.5, avail / (n + 2)));
          d = Math.max(0.035, Math.min(0.18, 0.36 * D));
          let I = Math.min(0.9, D * 1.08);
          if ((n - 1) * I + D + (N - 1) * d > avail) I = Math.max(0.04, (avail - D - (N - 1) * d) / (n - 1));
          for (let k = 1; k <= n; k++) taus.push(T0 + (k - 1) * I);
        }
        const settle = taus.map((tau, i) => stepEvents(i + 1, tau, D, d));
        readAt = (t) => {
          let c = 0;
          for (let k = 0; k < settle.length; k++) if (t >= settle[k]) c = k + 1;
          return s.from + dir * c;
        };
      }
    } else if (mode === 'set' || mode === 'big') {
      // every drum rolls forward to its new digit, units first, rippling left;
      // a long count also spins the drums that would have wrapped
      const fromD = digitsOf(s.from, p);
      const toD = digitsOf(s.to, p);
      let end = T0;
      for (let j = 0; j < N; j++) {
        let delta = ((toD[j] - fromD[j]) % b + b) % b;
        if (mode === 'big' && n >= b ** (j + 1)) delta += M;
        if (mode === 'big' && dir < 0) delta = -((((fromD[j] - toD[j]) % b + b) % b) + (n >= b ** (j + 1) ? M : 0));
        if (!delta) continue;
        const start = T0 + 0.1 + j * 0.12;
        const dur = Math.min(Math.max(0.6, avail - 0.1 - j * 0.12), 0.5 + 0.07 * Math.abs(delta));
        wheels[j].push({ start, dur, delta });
        end = Math.max(end, start + dur);
      }
      const wrapped = Math.floor(s.to / b ** N) !== Math.floor(s.from / b ** N);
      if (mode === 'big' && wrapped) pawls[N].push({ start: end - 0.35, dur: 0.7 });
      const t1 = end;
      readAt = mode === 'big'
        ? (t) => Math.round(s.from + (s.to - s.from) * glide((t - T0 - 0.1) / Math.max(0.3, t1 - T0 - 0.1)))
        : (t) => (t >= t1 - 0.15 ? s.to : s.from);
    } else {
      readAt = () => s.from;
    }
    // when the readout first shows a wrap, so the tag can ease in from there
    let tagAt = null;
    for (let t = 0; t <= span + 1; t += 1 / 60) if (tagOf(readAt(t), s, p)) { tagAt = t; break; }
    return { wheels, pawls, readAt, tagAt };
  }

  function digitsOf(v, p) {
    const { digits: N, base: b } = p;
    const mod = b ** N;
    const w = ((v % mod) + mod) % mod;
    return Array.from({ length: N }, (_, j) => Math.floor(w / b ** j) % b);
  }

  function formatValue(v, p) {
    const mod = p.base ** p.digits;
    let w = ((v % mod) + mod) % mod;
    if (p.signed && w >= mod / 2) w -= mod;
    const txt = Math.abs(w).toLocaleString('en-US');
    return w < 0 ? '\u2212' + txt : txt;
  }

  function tagOf(v, s, p) {
    const mod = p.base ** p.digits;
    const half = p.signed ? mod / 2 : 0;
    const block = (x) => Math.floor((x + half) / mod);
    if (block(v) === block(s.from)) return '';
    return v > s.from ? 'OVERFLOW' : 'UNDERFLOW';
  }

  // ---------------------------------------------------------------- build
  function build(p, s) {
    const { k, G } = root.ANATOMY;
    const N = p.digits;
    const b = p.base;
    const M = b === 16 ? 16 : 10;                 // glyph positions round a drum
    const PITCH = (Math.PI * 2) / M;
    const R = b === 16 ? 31 : 27;                 // rim radius
    const FL = 1.1;                               // flange width
    const RF = R + 1.1;                           // flange radius
    const W = 13;                                 // drum width
    const GAP = 4.2;
    const NIB = b === 2 && N > 4 ? 6 : 0;         // extra air between nibbles
    const Z0 = RF + 5;                            // axle height above the base top
    const OV = 7;                                 // overflow gap, left of the top drum
    const RG = 6;                                 // gap from the units drum to the right cheek
    const CH = 3.5;                               // cheek thickness
    const RB = RF + 1.8;                          // bezel rail inner radius
    const RAIL_T = 2.6;                           // rail radial thickness
    const RAIL_H = 2.2;                           // rail half height (tangential)
    const SHAFT = [-0.42 * R, Z0 + R + 7];        // carry lay shaft (y, z)
    const SHAFT_R = 1.8;

    const P0 = { scale: 1, azimuth: AZIMUTH, elevation: ELEVATION, origin: [0, 0] };
    const V = G.viewOf(P0);
    // read where the rim faces the camera most squarely
    const READ = Math.atan2(V[2], V[1]);
    const WIN = (b === 16 ? 0.58 : 0.62) * PITCH;
    const capH = (b === 16 ? 0.74 : 0.7) * R * PITCH;    // glyph cap height on the rim
    const FS = Math.min(capH / 0.73, (W - 2 * FL - 1.8) / 0.6);

    // drums left to right; drum i shows wheel j = N - 1 - i
    const drums = [];
    let x = OV;
    for (let i = 0; i < N; i++) {
      const j = N - 1 - i;
      drums.push({ i, j, x0: x, x1: x + W, cx: x + W / 2 });
      x += W;
      if (i < N - 1) x += GAP + (NIB && j % 4 === 0 ? NIB : 0);
    }
    const xR = x + RG;                            // right cheek inner face
    const xG0 = xR + CH + 1.6;                    // gear
    const xG1 = xG0 + 3.6;
    const xA1 = xG1 + 1.6;                        // crank arm face
    const xK1 = xA1 + 5;                          // knob end
    const CRANK = 0.42 * R;
    const GEAR_R = 0.5 * R;

    // cheek outline in (y, z), the convex hull of what it has to carry
    const railCorners = (a) => {
      const ra = [Math.cos(a), Math.sin(a)];
      const ta = [-Math.sin(a), Math.cos(a)];
      return [[RB, -RAIL_H], [RB + RAIL_T, -RAIL_H], [RB + RAIL_T, RAIL_H], [RB, RAIL_H]]
        .map(([r, h]) => [r * ra[0] + h * ta[0], Z0 + r * ra[1] + h * ta[1]]);
    };
    const A_TOP = READ + WIN + RAIL_H / RB;
    const A_BOT = READ - WIN - RAIL_H / RB;
    const circ = (cy, cz, r, n = 16) => Array.from({ length: n }, (_, i) => [cy + r * Math.cos((i / n) * 2 * Math.PI), cz + r * Math.sin((i / n) * 2 * Math.PI)]);
    const cheekPts = G.hullOf([
      [-(RF + 5), 0], [RB + RAIL_T + 5, 0],
      ...railCorners(A_TOP).map(([y, z]) => [y + 2.5, z + 2.5]),
      ...railCorners(A_BOT).map(([y, z]) => [y + 2.5, z]),
      ...circ(SHAFT[0], SHAFT[1], 4.6),
      [-(RF + 5), SHAFT[1]],
    ]);

    const BASE = { x: -CH - 7, y: -(RF + 5) - 4, w: xK1 + 5 + CH + 7, d: (RF + 5) + 4 + RB + RAIL_T + 5 + 6, r: 5 };
    const BASE_H = 6;
    const FOOT_H = 2.6;

    const EXTREMES = [
      ...k.boxCorners(BASE, -BASE_H - FOOT_H, 0),
      [-CH, SHAFT[0], SHAFT[1] + 4.6], [xR + CH, SHAFT[0], SHAFT[1] + 4.6],
      [-CH, -(RF + 5), SHAFT[1]], [xK1, CRANK + 3, Z0 + CRANK + 3], [xK1, -CRANK - 3, Z0 - CRANK - 3],
    ];
    // the plate is as tall as this machine needs, within what the hero allows:
    // a short wide register gets a short plate, a three wheel counter a tall one
    const VH = (() => {
      const flat = EXTREMES.map((pt) => k.iso(pt, { origin: [0, 0], scale: 1, azimuth: AZIMUTH, elevation: ELEVATION }));
      const w = Math.max(...flat.map((q) => q[0])) - Math.min(...flat.map((q) => q[0]));
      const h = Math.max(...flat.map((q) => q[1])) - Math.min(...flat.map((q) => q[1]));
      return Math.round(Math.max(VH_MIN, Math.min(VH_MAX, (h * (VW - 2 * PAD)) / w + 2 * PAD + HEADROOM)));
    })();
    const P = k.fitProjection(EXTREMES, VW, VH, { pad: PAD, headroom: HEADROOM, azimuth: AZIMUTH, elevation: ELEVATION });

    const at = (pt) => k.iso(pt, P);
    const S = (paths, style) => k.solidSvg(paths, style);
    const L = (d, style) => k.lineSvg(d, style);
    const D = (pts, style) => k.dotsSvg(pts, style);
    const FX = G.frameOf([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);   // prism polygons in (y, z)
    const AX = G.frameAlong([0, 0, Z0], [1, 0, 0]);                     // the axle; s is world x
    const SH = G.frameAlong([0, SHAFT[0], SHAFT[1]], [1, 0, 0]);
    const byDepth = (pts) => [...pts].sort((a, b2) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b2[0], b2[1], 0], P));

    // ---------------- static: base on feet
    const base = [];
    base.push(`<path class="iso-halo" style="filter:blur(10px);transform:translateY(4px)" d="${k.haloOf(BASE, -BASE_H - FOOT_H, BASE_H, P)}"/>`);
    for (const [fx, fy] of byDepth(k.corners(BASE, 9))) {
      base.push(S(k.cylinder(fx, fy, 5, -BASE_H - FOOT_H, 1, P, 24), { tone: 'lo' }));
      base.push(S(k.cylinder(fx, fy, 3.8, -BASE_H - FOOT_H + 1, FOOT_H - 1, P, 24), { tone: 'mid' }));
    }
    base.push(S(k.slabOf(BASE, -BASE_H, BASE_H, P, 8, 1.4), { tone: 'mid' }));
    base.push(L(k.planOutline(k.insetPlan(BASE, 3.6), 0, P), { tone: 'faint' }));
    const screws = k.corners(BASE, 6.5);
    base.push(L(screws.map(([sx, sy]) => k.ring(sx, sy, 1.6, 0, P, 16)).join(''), { tone: 'lo' }));
    base.push(D(screws.map(([sx, sy]) => at([sx, sy, 0])), { size: 0.9 }));

    // ---------------- static: left cheek, stop pin, shafts
    const left = [];
    left.push(S(G.prismOf(FX, cheekPts, -CH, 0, P), { tone: 'mid' }));
    // the stop pin the overflow pawl strikes: on the cheek, where its tip lands
    const pawlLen = (() => {
      // the tip rests on the rim, just ahead of top dead centre
      const tip = [Math.cos(1.5) * (RF + 1.5), Z0 + Math.sin(1.5) * (RF + 1.5)];
      return Math.hypot(tip[0] - SHAFT[0], tip[1] - SHAFT[1]);
    })();
    const tipRest = (() => {
      const tip = [Math.cos(1.5) * (RF + 1.5), Z0 + Math.sin(1.5) * (RF + 1.5)];
      return Math.atan2(tip[1] - SHAFT[1], tip[0] - SHAFT[0]);
    })();
    const SWING = 0.3;                                              // radians the pawl lifts on a carry
    const stopAt = [SHAFT[0] + Math.cos(tipRest + SWING) * pawlLen + 1.9 * Math.cos(tipRest + SWING + Math.PI / 2),
      SHAFT[1] + Math.sin(tipRest + SWING) * pawlLen + 1.9 * Math.sin(tipRest + SWING + Math.PI / 2)];
    left.push(S(G.disc(0, OV / 2 - 0.4, 1.1, G.frameAlong([0, stopAt[0], stopAt[1]], [1, 0, 0]), P), { tone: 'mid' }));
    left.push(S(G.disc(0, xR, 2.2, AX, P), { tone: 'mid', crease: 'none' }));
    left.push(S(G.disc(0, xR, SHAFT_R, SH, P), { tone: 'mid', crease: 'none' }));

    // ---------------- pawls (dynamic): hub on the shaft, arm down to the rim
    const pawlShape = (() => {
      const tip = [SHAFT[0] + Math.cos(tipRest) * pawlLen, SHAFT[1] + Math.sin(tipRest) * pawlLen];
      return G.hullOf([...circ(SHAFT[0], SHAFT[1], 3.1, 18), ...circ(tip[0], tip[1], 1.25, 12)]);
    })();
    const pawlGap = (j) => {
      // pawl into wheel j sits in the gap left of the drum that shows wheel j - 1
      const right = drums[N - j];
      const leftDrum = drums[N - 1 - j];
      const xa = leftDrum ? leftDrum.x1 : 0;
      const xb = right.x0;
      const mid = (xa + xb) / 2;
      return [mid - 1.7, mid + 1.7];
    };
    const pawlSvg = (j, lift) => {
      const [xa, xb] = pawlGap(j);
      const poly = turnYZ(pawlShape, SHAFT[0], SHAFT[1], SWING * lift);
      const paths = G.prismOf(FX, poly, xa, xb, P);
      const pin = L(G.circleOf(G.frameAlong([xb, SHAFT[0], SHAFT[1]], [1, 0, 0]), 0, 1.15, P, 20), { tone: 'mid' });
      const glow = lift > 0.01 ? `<path class="mm-accent" opacity="${Math.min(1, lift * 1.6).toFixed(2)}" d="${paths.outline}"/>` : '';
      return S(paths, { tone: 'mid' }) + pin + glow;
    };

    // ---------------- drums
    const discOf = (x0, x1, r) => G.disc(x0, x1, r, AX, P);
    const drumStatic = drums.map((dr) => ({
      lf: S(discOf(dr.x0, dr.x0 + FL, RF), { tone: 'hi', crease: 'lo' }),
      core: S(discOf(dr.x0 + FL, dr.x1 - FL, R), { tone: 'hi', crease: 'lo' }),
      rf: S(discOf(dr.x1 - FL, dr.x1, RF), {
        tone: 'hi', crease: 'lo',
        inner: dr.j === 0 ? L(G.circleOf(G.frameAlong([dr.x1, 0, Z0], [1, 0, 0]), 0, 0.42 * R, P, 48), { tone: 'faint' }) : '',
      }),
      outline: discOf(dr.x0, dr.x1, RF).outline,
    }));

    // a glyph lies flat on the rim's tangent plane at angle a
    const exv = (() => { const o = at([0, 0, 0]); const e = at([1, 0, 0]); return [e[0] - o[0], e[1] - o[1]]; })();
    const glyphMatrix = (cx, a) => {
      const o = at([cx, R * Math.cos(a), Z0 + R * Math.sin(a)]);
      const o0 = at([0, 0, 0]);
      const dn = at([0, Math.sin(a), -Math.cos(a)]);
      const ey = [dn[0] - o0[0], dn[1] - o0[1]];
      return `matrix(${exv[0].toFixed(4)} ${exv[1].toFixed(4)} ${ey[0].toFixed(4)} ${ey[1].toFixed(4)} ${o[0].toFixed(1)} ${o[1].toFixed(1)})`;
    };
    const facing = (a) => V[1] * Math.cos(a) + V[2] * Math.sin(a);
    const glyphKind = (dr, ch) => {
      if (p.signed && dr.i === 0 && parseInt(ch, 16) >= b / 2) return 'sign';
      if (b === 2 && ch === '0') return 'off';
      return '';
    };
    const glyphsSvg = (dr, pos) => {
      const out = [];
      const q0 = Math.floor(pos);
      for (let q = q0 - 3; q <= q0 + 4; q++) {
        const a = READ + (pos - q) * PITCH;
        const f = facing(a);
        if (f < 0.1) continue;
        const off = Math.abs(a - READ);
        const op = G.fadeOf(f, [0.1, 0.42]) * (1 - 0.88 * smooth(WIN * 0.75, WIN * 1.35, off));
        if (op < 0.03) continue;
        const ch = DIG[(((q % M) + M) % M) % b];
        const g = glyphKind(dr, ch);
        out.push(`<text class="mm-glyph"${g ? ` data-g="${g}"` : ''} transform="${glyphMatrix(dr.cx, a)}" font-size="${FS.toFixed(2)}" y="${(0.365 * FS).toFixed(2)}"${op < 0.99 ? ` opacity="${op.toFixed(2)}"` : ''}>${ch}</text>`);
      }
      return out.join('');
    };
    const ticksSvg = (x0, x1, pos) => {
      const list = [];
      const q0 = Math.floor(pos);
      for (let q = q0 - 4; q <= q0 + 5; q++) {
        const a = READ + (pos - q - 0.5) * PITCH;
        const f = facing(a);
        if (f < 0.05) continue;
        const c = Math.cos(a) * RF; const z = Z0 + Math.sin(a) * RF;
        list.push({ d: k.pathOf([at([x0 + 0.25, c, z]), at([x1 - 0.25, c, z])]), alpha: G.fadeOf(f, [0.05, 0.4]) });
      }
      return k.fadedSvg(list, { tone: 'lo' });
    };

    // ---------------- static: bezel rails
    const rails = [];
    for (const a of [A_BOT, A_TOP]) {
      rails.push(S(G.prismOf(FX, railCorners(a), 0, xR, P), { tone: 'mid' }));
      const mid = railCorners(a).slice(1, 3);
      const fy = (mid[0][0] + mid[1][0]) / 2; const fz = (mid[0][1] + mid[1][1]) / 2;
      rails.push(D([at([3.2, fy, fz]), at([xR - 3.2, fy, fz])], { size: 0.85 }));
    }

    // ---------------- static: right cheek with its bosses, collar
    const right = [];
    const inset = G.hullOf(cheekPts.map(([y, z]) => {
      const cy = (Math.min(...cheekPts.map((q) => q[0])) + Math.max(...cheekPts.map((q) => q[0]))) / 2;
      const cz = (Math.min(...cheekPts.map((q) => q[1])) + Math.max(...cheekPts.map((q) => q[1]))) / 2;
      const dy = y - cy; const dz = z - cz; const l = Math.hypot(dy, dz) || 1;
      return [y - (dy / l) * 2.6, z - (dz / l) * 2.6];
    }));
    right.push(S(G.prismOf(FX, cheekPts, xR, xR + CH, P), {
      tone: 'mid',
      inner: L(k.pathOf(inset.map(([y, z]) => at([xR + CH, y, z])), true), { tone: 'faint' }),
    }));
    right.push(S(G.disc(xR + CH, xR + CH + 1.2, 3.4, SH, P), { tone: 'mid' }));
    right.push(D([at([xR + CH + 1.2, SHAFT[0], SHAFT[1]])], { size: 0.9, tone: 'hi' }));
    const cheekScrews = [[-(RF + 1.5), 3.2], [RB + RAIL_T + 1.5, 3.2], [-(RF + 1.5), SHAFT[1] - 1]];
    right.push(D(cheekScrews.map(([y, z]) => at([xR + CH, y, z])), { size: 0.9 }));
    right.push(S(G.disc(xR + CH, xG0, 4.2, AX, P), { tone: 'mid' }));

    // ---------------- gear, crank and knob (dynamic: they turn with the units drum)
    const TEETH = 12;
    const gearRing = (phi) => {
      const pts = [];
      const tau = (Math.PI * 2) / TEETH;
      for (let t = 0; t < TEETH; t++) {
        const a = phi + t * tau;
        for (const [r, da] of [[GEAR_R, -0.3], [GEAR_R + 3.4, -0.16], [GEAR_R + 3.4, 0.16], [GEAR_R, 0.3]]) {
          pts.push([Math.cos(a + da * tau) * r, Z0 + Math.sin(a + da * tau) * r]);
        }
      }
      return pts;
    };
    const hub = S(G.disc(xG1, xG1 + 0.9, 5.2, AX, P), { tone: 'mid' }) +
      L(G.circleOf(G.frameAlong([xG1 + 0.9, 0, Z0], [1, 0, 0]), 0, 3.2, P, 32), { tone: 'faint' });
    const KF = G.frameAlong([0, CRANK, Z0], [1, 0, 0]);
    const knobAt0 = at([xA1, CRANK, Z0]);
    const knob = S(G.disc(xA1, xA1 + 1.2, 1.4, KF, P), { tone: 'mid' }) +
      S(G.disc(xA1 + 1.2, xK1, 2.5, KF, P), { tone: 'hi', crease: 'lo', inner: k.fadedSvg(G.ribsOf(KF, xA1 + 1.6, xK1 - 0.8, 2.5, 18, P, { fade: [0.1, 0.5] }), { tone: 'lo' }) });
    const gearSvg = (pos) => {
      const phi = pos * PITCH;
      const out = [S(prismX(gearRing(phi), xG0, xG1, P), { tone: 'mid', crease: 'lo' })];
      out.push(hub);
      const kc = [Math.cos(phi) * CRANK, Z0 + Math.sin(phi) * CRANK];
      const arm = G.hullOf([...circ(0, Z0, 3.6, 20), ...circ(kc[0], kc[1], 2.9, 16)]);
      out.push(S(G.prismOf(FX, arm, xG1 + 0.9, xA1, P), { tone: 'mid' }));
      out.push(D([at([xA1, 0, Z0])], { size: 1.1, tone: 'hi' }));
      const kp = at([xA1, kc[0], kc[1]]);
      out.push(`<g transform="translate(${(kp[0] - knobAt0[0]).toFixed(2)} ${(kp[1] - knobAt0[1]).toFixed(2)})">${knob}</g>`);
      return out.join('');
    };

    // ---------------- layers, in painter's order
    const layers = [];
    layers.push({ s: base.join('') });
    layers.push({ s: left.join('') });
    layers.push({ d: (st) => pawlSvg(N, st.pawl[N]) });
    drums.forEach((dr, i) => {
      const ds = drumStatic[i];
      layers.push({ s: ds.lf });
      layers.push({ d: (st) => ticksSvg(dr.x0, dr.x0 + FL, st.pos[dr.j]) });
      layers.push({ s: ds.core });
      layers.push({ d: (st) => glyphsSvg(dr, st.pos[dr.j]) });
      layers.push({ s: ds.rf });
      layers.push({
        d: (st) => ticksSvg(dr.x1 - FL, dr.x1, st.pos[dr.j]) +
          (st.act[dr.j] > 0.01 ? `<path class="mm-accent" opacity="${Math.min(1, st.act[dr.j] * 1.4).toFixed(2)}" d="${ds.outline}"/>` : '') +
          (dr.j > 0 ? pawlSvg(dr.j, st.pawl[dr.j]) : ''),
      });
    });
    layers.push({ s: rails.join('') });
    layers.push({ s: right.join('') });
    layers.push({ d: (st) => gearSvg(st.pos[0]) });

    // merge neighbouring static layers so the DOM has fewer slots
    const merged = [];
    for (const l of layers) {
      const prev = merged[merged.length - 1];
      if (l.s != null && prev && prev.s != null) prev.s += l.s; else merged.push({ ...l });
    }

    const start = digitsOf(s.from, p);
    const cache = new Map();
    const tlFor = (span) => {
      const key = Math.round(span * 1000);
      if (!cache.has(key)) cache.set(key, timeline(p, s, span));
      return cache.get(key);
    };
    return {
      viewBox: [VW, VH],
      layers: merged,
      meta: {
        corner: b === 2 ? `${N} BITS` : b === 16 ? `${N} HEX DIGITS` : `${N} DIGITS`,
        label: p.label || (b === 2 ? 'BIT REGISTER' : b === 16 ? 'HEX REGISTER' : 'COUNTER'),
        accent: p.accent,
      },
      at(t, span = 5) {
        const tl = tlFor(span);
        const pos = start.slice();
        const act = new Array(N).fill(0);
        for (let j = 0; j < N; j++) {
          for (const ev of tl.wheels[j]) {
            const u = (t - ev.start) / ev.dur;
            if (u <= 0) continue;
            pos[j] += ev.delta * glide(u);
            act[j] = Math.max(act[j], hump(u));
          }
        }
        const pawl = tl.pawls.map((list) => Math.min(1, list.reduce((m, ev) => Math.max(m, hump((t - ev.start) / ev.dur)), 0)));
        const v = tl.readAt(t);
        const tagIn = tl.tagAt == null || t < tl.tagAt ? 0 : Math.min(1, (t - tl.tagAt) / 0.35);
        return { pos, act, pawl, v, tagIn };
      },
      readout(st) {
        return {
          label: p.readout || (p.signed ? 'SIGNED VALUE' : b === 10 ? 'READS' : 'VALUE'),
          value: formatValue(st.v, p),
          tag: tagOf(st.v, s, p),
          tagIn: st.tagIn,
        };
      },
    };
  }

  M_.register('odometer', { normalize, build });
})(typeof window !== 'undefined' ? window : globalThis);

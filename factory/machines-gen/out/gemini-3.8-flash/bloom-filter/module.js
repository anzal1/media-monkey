(function (root) {
  'use strict';
  const M_ = root.MM_MACHINES;
  if (!M_) return;
  const { glide, hump, smooth, prismX, turnYZ, clamp01 } = M_.util;

  const AZIMUTH = 62;
  const ELEVATION = 24;
  const VW = 1000;
  const PAD = 8;
  const HEADROOM = 44;

  // ---------------------------------------------------------------- params
  function normalize(params, state) {
    const pIn = params || {};
    const sIn = state || {};
    const cells = 8; // fixed 8-slot register for phone clarity
    const item = typeof sIn.item === 'string' ? sIn.item.trim().toUpperCase() : 'TOKEN';
    const mode = sIn.mode === 'insert' ? 'insert' : 'query';

    // bits probed by this token (default 3 hash outputs)
    let bits = Array.isArray(sIn.bits) ? sIn.bits.map((x) => Math.round(Number(x))) : [1, 3, 6];
    bits = bits.filter((b) => Number.isFinite(b) && b >= 0 && b < cells);
    if (!bits.length) bits = [1, 3, 6];
    bits = Array.from(new Set(bits)).sort((a, b) => a - b);

    // prior register state (array of 0 | 1)
    let prior = new Array(cells).fill(0);
    if (Array.isArray(sIn.prior)) {
      for (let i = 0; i < cells; i++) prior[i] = sIn.prior[i] ? 1 : 0;
    } else if (typeof sIn.prior === 'number' && Number.isFinite(sIn.prior)) {
      for (let i = 0; i < cells; i++) prior[i] = (sIn.prior >> i) & 1;
    }

    const falsePositive = !!sIn.falsePositive;
    const clip = (s, n) => (typeof s === 'string' ? s.trim().slice(0, n) : '');

    return {
      p: {
        cells,
        label: clip(pIn.label, 28) || 'BLOOM FILTER',
        readout: clip(pIn.readout || pIn.readoutLabel, 24),
      },
      s: {
        mode,
        item,
        bits,
        prior,
        falsePositive,
      },
    };
  }

  // ---------------------------------------------------------------- build
  function build(p, s) {
    const { k, G } = root.ANATOMY;
    const N = p.cells;
    const PITCH = 24;
    const cxOf = (i) => (i - (N - 1) / 2) * PITCH;

    // Toggle geometry in y-z plane (pivot at y = 0, z = 20)
    // Upright (0): anvil strike surface squarely at y = 0, z = 39.
    // Tipped (1): rotated forward by -0.92 rad; anvil moves to y = 15, z = 31.
    const TOGGLE_POLY = [
      [-4, 15],
      [-12, 10],
      [-14, 13],
      [-6, 18],
      [-3, 27],
      [-3.5, 36],
      [-3.5, 39],
      [3.5, 39],
      [3.5, 36],
      [3, 27],
      [7, 18],
      [5, 14],
      [1, 15],
    ];
    const ANGLE_DOWN = -0.92;

    // Carrier heights: rest = 68, blocked = 61.5, full drop / pressed = 48
    const Z_REST = 68;
    const Z_BLOCKED = 61.5;
    const Z_DOWN = 48;

    const BASE = { x: -118, y: -46, w: 236, d: 92, r: 6 };
    const BASE_H = 7;
    const FOOT_H = 3;

    const EXTREMES = [
      ...k.boxCorners(BASE, -BASE_H - FOOT_H, 0),
      [-108, -18, 0], [108, 18, 36],
      [-108, -10, 92], [108, 10, 92],
      [34, 14, 96], [34, -14, 96],
      [-104, -8, 76], [104, 8, 76],
    ];

    const flat0 = EXTREMES.map((pt) => k.iso(pt, { origin: [0, 0], scale: 1, azimuth: AZIMUTH, elevation: ELEVATION }));
    const spanW = Math.max(...flat0.map((q) => q[0])) - Math.min(...flat0.map((q) => q[0]));
    const spanH = Math.max(...flat0.map((q) => q[1])) - Math.min(...flat0.map((q) => q[1]));
    const VH = Math.round(Math.max(480, Math.min(640, (spanH * (VW - 2 * PAD)) / spanW + 2 * PAD + HEADROOM)));
    const P = k.fitProjection(EXTREMES, VW, VH, { pad: PAD, headroom: HEADROOM, azimuth: AZIMUTH, elevation: ELEVATION });

    const at = (pt) => k.iso(pt, P);
    const S = (paths, style) => k.solidSvg(paths, style);
    const L = (d, style) => k.lineSvg(d, style);
    const D = (pts, style) => k.dotsSvg(pts, style);

    const isMatch = s.bits.every((b) => s.prior[b] === 1);
    const blockedBits = s.mode === 'query' ? s.bits.filter((b) => s.prior[b] === 0) : [];

    // ---------------- 1. static base & feet
    const staticBase = [];
    staticBase.push(`<path class="iso-halo" style="filter:blur(10px);transform:translateY(5px)" d="${k.haloOf(BASE, -BASE_H - FOOT_H, BASE_H, P)}"/>`);
    const feetLocs = k.corners(BASE, 10).sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
    for (const [fx, fy] of feetLocs) {
      staticBase.push(S(k.cylinder(fx, fy, 5.5, -BASE_H - FOOT_H, 1.2, P, 24), { tone: 'lo' }));
      staticBase.push(S(k.cylinder(fx, fy, 4.2, -BASE_H - FOOT_H + 1.2, FOOT_H - 1.2, P, 24), { tone: 'mid' }));
    }
    staticBase.push(S(k.slabOf(BASE, -BASE_H, BASE_H, P, 8, 1.4), { tone: 'lo' }));
    staticBase.push(L(k.planOutline(k.insetPlan(BASE, 3.8), 0, P), { tone: 'faint' }));
    const screws = k.corners(BASE, 7);
    staticBase.push(L(screws.map(([sx, sy]) => k.ring(sx, sy, 1.6, 0, P, 16)).join(''), { tone: 'lo' }));
    staticBase.push(D(screws.map(([sx, sy]) => at([sx, sy, 0])), { size: 0.9 }));

    // ---------------- 2. structure: cheeks, axle, stops, bezel, guide rods
    const staticStruct = [];
    // Rear backstop rail
    const REAR_RAIL = { x: -98, y: -18, w: 196, d: 5, r: 1.2 };
    staticStruct.push(S(k.slabOf(REAR_RAIL, 8, 8, P, 4), { tone: 'mid' }));

    // Left pillow block cheek
    const L_CHEEK = { x: -108, y: -18, w: 12, d: 36, r: 2.5 };
    staticStruct.push(S(k.slabOf(L_CHEEK, 0, 32, P, 6, 1.0), { tone: 'mid' }));
    // Right pillow block cheek
    const R_CHEEK = { x: 96, y: -18, w: 12, d: 36, r: 2.5 };
    staticStruct.push(S(k.slabOf(R_CHEEK, 0, 32, P, 6, 1.0), { tone: 'mid' }));

    // Central axle through all toggles
    const AXLE = G.frameAlong([0, 0, 20], [1, 0, 0]);
    staticStruct.push(S(G.disc(-96, 96, 2.2, AXLE, P), { tone: 'mid', crease: 'none' }));

    // Inter-cell spacer collars along axle
    for (let i = 0; i < N - 1; i++) {
      const xMid = (cxOf(i) + cxOf(i + 1)) / 2;
      staticStruct.push(S(G.disc(xMid - 1.2, xMid + 1.2, 3.2, AXLE, P), { tone: 'lo' }));
    }

    // Front indicator rail
    const FRONT_RAIL = { x: -98, y: 18, w: 196, d: 8, r: 1.8 };
    staticStruct.push(S(k.slabOf(FRONT_RAIL, 0, 14, P, 4, 0.8), { tone: 'mid' }));
    staticStruct.push(L(k.planOutline(k.insetPlan(FRONT_RAIL, 1.4), 14, P), { tone: 'faint' }));

    // Guide columns (polished vertical rods)
    const GL = G.frameAlong([-102, 0, 0], [0, 0, 1]);
    const GR = G.frameAlong([102, 0, 0], [0, 0, 1]);
    staticStruct.push(S(G.disc(32, 86, 2.4, GL, P), { tone: 'mid', crease: 'none' }));
    staticStruct.push(S(G.disc(32, 86, 2.4, GR, P), { tone: 'mid', crease: 'none' }));
    // Lower collar stops
    staticStruct.push(S(G.disc(32, 35, 3.8, GL, P), { tone: 'lo' }));
    staticStruct.push(S(G.disc(32, 35, 3.8, GR, P), { tone: 'lo' }));

    // ---------------- 3. gantry carriage & feeler tines (built at Z = 0 local)
    const carrierParts = [];
    // Main crosshead bar
    const C_BAR = { x: -96, y: -6, w: 192, d: 12, r: 2 };
    carrierParts.push(S(k.slabOf(C_BAR, 0, 5, P, 4, 0.6), { tone: 'hi' }));
    // Bushings on guide rods
    carrierParts.push(S(k.cylinder(-102, 0, 4.2, -2, 9, P, 24), { tone: 'mid' }));
    carrierParts.push(S(k.cylinder(102, 0, 4.2, -2, 9, P, 24), { tone: 'mid' }));
    // Center link lug
    const C_LUG = { x: -5, y: -3, w: 10, d: 6, r: 1.2 };
    carrierParts.push(S(k.slabOf(C_LUG, 5, 5, P, 3), { tone: 'mid' }));
    carrierParts.push(D([at([0, 0, 7.5])], { size: 0.9 }));

    // Underside collars and active feeler tines
    const activeSet = new Set(s.bits);
    for (let i = 0; i < N; i++) {
      const cx = cxOf(i);
      carrierParts.push(S(k.cylinder(cx, 0, 3.2, -3, 3, P, 16), { tone: 'mid' }));
      if (activeSet.has(i)) {
        // Active downward feeler tine
        carrierParts.push(S(k.cylinder(cx, 0, 1.8, -22, 19, P, 20), { tone: 'hi' }));
        carrierParts.push(L(k.ring(cx, 0, 1.8, -22, P, 16), { tone: 'mid' }));
      } else {
        // Inactive collar bore ring
        carrierParts.push(L(k.ring(cx, 0, 1.2, -3, P, 14), { tone: 'faint' }));
      }
    }
    const carrierSvg = carrierParts.join('');

    // ---------------- 4. top bridge bar & lever pivot
    const staticTop = [];
    const BRIDGE = { x: -108, y: -8, w: 216, d: 16, r: 3 };
    staticTop.push(S(k.slabOf(BRIDGE, 82, 6, P, 6, 0.8), { tone: 'mid' }));
    staticTop.push(S(k.cylinder(-102, 0, 3.6, 88, 3, P, 20), { tone: 'lo' }));
    staticTop.push(S(k.cylinder(102, 0, 3.6, 88, 3, P, 20), { tone: 'lo' }));
    // Center lever pivot clevis
    const CLEVIS = { x: -4, y: -4, w: 8, d: 8, r: 1.5 };
    staticTop.push(S(k.slabOf(CLEVIS, 88, 6, P, 4), { tone: 'mid' }));
    staticTop.push(D([at([0, 0, 91])], { size: 1.0, tone: 'hi' }));

    // ---------------- dynamic helpers
    const toggleSvg = (i, angle) => {
      const cx = cxOf(i);
      const poly = turnYZ(TOGGLE_POLY, 0, 20, angle);
      const paths = prismX(poly, cx - 5.5, cx + 5.5, P);
      const isSet = angle < -0.4;
      return S(paths, { tone: isSet ? 'mid' : 'hi', crease: 'lo' });
    };

    const numeralsSvg = (angles) => {
      const out = [];
      for (let i = 0; i < N; i++) {
        const cx = cxOf(i);
        const isSet = angles[i] < -0.4;
        const g = isSet ? 'sign' : 'off';
        out.push(`<text class="mm-glyph" data-g="${g}" transform="${k.topMatrix([cx, 22], 14, P, 'x')}" font-size="7.2" y="0.5">${i}</text>`);
      }
      return out.join('');
    };

    const leverSvg = (carrierZ) => {
      // Lever angle derived smoothly from carrier travel
      const u = (Z_REST - carrierZ) / (Z_REST - Z_DOWN);
      const phi = 0.18 - 0.52 * u; // radians
      const L_LEN = 34;
      const hx = Math.cos(phi) * L_LEN;
      const hz = 91 + Math.sin(phi) * L_LEN;
      const armPts = [
        at([0, 0, 91]),
        at([hx, 0, hz]),
      ];
      const armLine = L(k.pathOf(armPts), { tone: 'hi' });
      const knob = S(G.sphereOf([hx, 0, hz], 3.2, P), { tone: 'hi' });
      // Pushrod from lever to carrier lug
      const rod = S(k.cylinder(0, 0, 1.4, carrierZ + 7, Math.max(2, 91 - (carrierZ + 7)), P, 14), { tone: 'mid' });
      return rod + armLine + knob;
    };

    const contactGlowSvg = (carrierZ, activeOp) => {
      if (activeOp <= 0.01) return '';
      const out = [];
      for (const b of blockedBits) {
        const cx = cxOf(b);
        const tipPt = at([cx, 0, carrierZ - 22]);
        out.push(`<circle cx="${tipPt[0].toFixed(1)}" cy="${tipPt[1].toFixed(1)}" r="4.2" class="mm-accent" opacity="${activeOp.toFixed(2)}"/>`);
      }
      return out.join('');
    };

    // ---------------- layers
    const layers = [
      { s: staticBase.join('') },
      { s: staticStruct.join('') },
      {
        d: (st) => {
          // 8 Rocker Toggles drawn far to near (i = 0..7)
          const toggles = [];
          for (let i = 0; i < N; i++) {
            toggles.push(toggleSvg(i, st.angles[i]));
          }
          return toggles.join('');
        },
      },
      {
        d: (st) => numeralsSvg(st.angles),
      },
      {
        d: (st) => {
          const trans = k.translateAlong(P, [0, 0, st.z]);
          const glow = contactGlowSvg(st.z, st.glow);
          return `<g transform="${trans}">${carrierSvg}</g>${glow}`;
        },
      },
      {
        d: (st) => leverSvg(st.z),
      },
      { s: staticTop.join('') },
    ];

    return {
      viewBox: [VW, VH],
      layers,
      meta: {
        corner: `${p.cells}-BIT REGISTER`,
        label: p.label,
        accent: null,
      },
      at(t, span = 5) {
        const angles = s.prior.map((v) => (v ? ANGLE_DOWN : 0));
        let z = Z_REST;
        let glow = 0;
        let tagIn = 0;

        if (s.mode === 'insert') {
          // INSERT: descend, press down to stamp new bits, retract to rest
          const t0 = 0.7;
          const tPress = t0 + 0.8;
          const tHold = tPress + 0.8;
          const tUp = tHold + 0.9;

          if (t < t0) {
            z = Z_REST;
          } else if (t < tPress) {
            const u = glide((t - t0) / (tPress - t0));
            z = Z_REST + (Z_BLOCKED - Z_REST) * u;
          } else if (t < tHold) {
            const u = glide((t - tPress) / (tHold - tPress));
            z = Z_BLOCKED + (Z_DOWN - Z_BLOCKED) * u;
            // Bits actively tip flat during the press
            for (const b of s.bits) {
              angles[b] = s.prior[b] ? ANGLE_DOWN : ANGLE_DOWN * u;
            }
          } else if (t < tUp) {
            const u = glide((t - tHold) / (tUp - tHold));
            z = Z_DOWN + (Z_REST - Z_DOWN) * u;
            for (const b of s.bits) angles[b] = ANGLE_DOWN;
          } else {
            z = Z_REST;
            for (const b of s.bits) angles[b] = ANGLE_DOWN;
          }
          tagIn = smooth(tPress, tPress + 0.4, t);
        } else {
          // QUERY: descend lightly
          const t0 = 0.7;
          if (isMatch) {
            // All flags down: comb passes through without resistance
            const tEnd = t0 + 1.6;
            if (t < t0) {
              z = Z_REST;
            } else if (t < tEnd) {
              const u = glide((t - t0) / (tEnd - t0));
              z = Z_REST + (Z_DOWN - Z_REST) * u;
            } else {
              z = Z_DOWN;
            }
            tagIn = smooth(tEnd - 0.2, tEnd + 0.3, t);
          } else {
            // At least one flag upright: comb halts firmly at half-stroke
            const tEnd = t0 + 1.2;
            if (t < t0) {
              z = Z_REST;
            } else if (t < tEnd) {
              const u = glide((t - t0) / (tEnd - t0));
              z = Z_REST + (Z_BLOCKED - Z_REST) * u;
            } else {
              z = Z_BLOCKED;
              glow = Math.min(1, 1.4 * smooth(tEnd, tEnd + 0.3, t));
            }
            tagIn = smooth(tEnd - 0.1, tEnd + 0.3, t);
          }
        }

        return { z, angles, glow, tagIn };
      },
      readout(st) {
        if (s.mode === 'insert') {
          return {
            label: `SET: ${s.item}`,
            value: `BITS ${s.bits.join(',')}`,
            tag: 'STAMPED',
            tagIn: st.tagIn,
          };
        }
        if (isMatch) {
          return {
            label: `TEST: ${s.item}`,
            value: 'DROPS THRU',
            tag: s.falsePositive ? 'FALSE POS' : 'MATCH',
            tagIn: st.tagIn,
          };
        }
        return {
          label: `TEST: ${s.item}`,
          value: 'BLOCKED',
          tag: 'DEFINITELY NO',
          tagIn: st.tagIn,
        };
      },
    };
  }

  M_.register('comb-gauge', { normalize, build });
})(typeof window !== 'undefined' ? window : globalThis);
(function (root) {
  'use strict';
  const M_ = root.MM_MACHINES;
  if (!M_) return;
  const { glide, hump, smooth, clamp01 } = M_.util;

  function normalize(params, state) {
    const capacity = Math.max(3, Math.min(8, Math.round(params.capacity || 5)));
    let tokens = Math.max(0, Math.min(capacity, Math.round(state.tokens || 0)));
    const action = ['refill', 'consume', 'deny', 'overflow'].includes(state.action) ? state.action : 'refill';

    if (action === 'deny') tokens = 0;
    if (action === 'overflow') tokens = capacity;
    if (action === 'consume' && tokens === 0) tokens = 1; 
    if (action === 'refill' && tokens === capacity) tokens = capacity - 1;

    return {
      p: {
        capacity,
        label: (params.label || 'TOKEN BUCKET').trim().slice(0, 24),
        readout: (params.readout || 'REQUEST').trim().slice(0, 24),
      },
      s: { tokens, action },
    };
  }

  function build(p, s) {
    const { k, G } = root.ANATOMY;

    const TR = 14;
    const PITCH = 32;
    const Z_BOT = 30;
    const Z_TOP = Z_BOT + (p.capacity - 1) * PITCH;
    
    const EXTREMES = [
      [-75, -25, -10],
      [80, 25, -10],
      [0, 0, Z_TOP + 65],
      [-75, 25, 0],
      [80, -25, 0]
    ];

    const flat = EXTREMES.map((pt) => k.iso(pt, { origin: [0, 0], scale: 1, azimuth: 45, elevation: 25 }));
    const w = Math.max(...flat.map((q) => q[0])) - Math.min(...flat.map((q) => q[0]));
    const h = Math.max(...flat.map((q) => q[1])) - Math.min(...flat.map((q) => q[1]));
    const VH = Math.round(Math.max(450, Math.min(700, (h * (1000 - 24)) / w + 24 + 44)));

    const P = k.fitProjection(EXTREMES, 1000, VH, { pad: 12, headroom: 44, azimuth: 45, elevation: 25 });
    const at = (pt) => k.iso(pt, P);
    const S = (paths, style) => k.solidSvg(paths, style);
    const L = (d, style) => k.lineSvg(d, style);
    const D = (pts, style) => k.dotsSvg(pts, style);
    const FY = G.frameOf([0, 0, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1]);

    // STATIC: Base
    const basePlan = { x: -80, y: -25, w: 165, d: 50, r: 6 };
    const baseLayer = [];
    baseLayer.push(`<path class="iso-halo" style="filter:blur(10px);transform:translateY(4px)" d="${k.haloOf(basePlan, -10, 10, P)}"/>`);
    const screws = k.corners(basePlan, 6);
    for (const [fx, fy] of [...screws].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P))) {
      baseLayer.push(S(k.cylinder(fx, fy, 4.5, -10, 3, P, 24), { tone: 'lo' }));
      baseLayer.push(S(k.cylinder(fx, fy, 3.5, -7, 7, P, 24), { tone: 'mid' }));
    }
    baseLayer.push(S(k.slabOf(basePlan, 0, -10, P, 8, 1.2), { tone: 'lo' }));
    baseLayer.push(L(k.planOutline(k.insetPlan(basePlan, 3), 0, P), { tone: 'faint' }));
    baseLayer.push(D(screws.map(([sx, sy]) => at([sx, sy, 0])), { size: 1.0, tone: 'mid' }));

    // STATIC: Back Structure
    const backLayer = [];
    backLayer.push(S(k.slabOf({ x: -70, y: -15, w: 46, d: 9, r: 2 }, 0, 50, P), { tone: 'mid' }));
    backLayer.push(S(k.slabOf({ x: 20, y: -15, w: 55, d: 9, r: 2 }, 0, Z_TOP + 15, P), { tone: 'mid' }));
    backLayer.push(S(k.slabOf({ x: -18, y: -9, w: 36, d: 4, r: 1 }, 0, Z_TOP + 20, P), { tone: 'lo', crease: 'none' }));

    // STATIC: Middle Ramps
    const rampLayer = [];
    const accPoly = [[16, 16], [75, 4], [75, -2], [16, 10]];
    rampLayer.push(S(G.prismOf(FY, accPoly, -4, 4, P), { tone: 'mid' }));
    const overPoly = [[16, Z_TOP - 14], [75, Z_TOP - 26], [75, Z_TOP - 32], [16, Z_TOP - 20]];
    rampLayer.push(S(G.prismOf(FY, overPoly, -4, 4, P), { tone: 'mid' }));

    // DYNAMIC: Pre-build Tokens
    const F_Tok = G.frameOf([0, 0, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1]);
    const tokDisc = G.disc(-3, 3, TR, F_Tok, P, { steps: 32 });
    const faceRing = G.circleOf(G.frameAlong([0, 3, 0], [0, 1, 0]), 0, 10, P, 32);
    const faceDots = G.dotsOf(G.frameAlong([0, 3, 0], [0, 1, 0]), 0, 7, 6, P);
    
    const buildToken = (accent) => {
      let out = S(tokDisc, { tone: accent ? 'hi' : 'mid', lit: accent });
      out += L(faceRing, { tone: accent ? 'lit' : 'lo' });
      out += D(faceDots, { tone: accent ? 'hi' : 'lo' });
      return out;
    };
    const TOK_STD = buildToken(false);
    const TOK_ACC = buildToken(true);
    const DENY_RING = G.circleOf(G.frameAlong([0, 3.5, Z_BOT], [0, 1, 0]), 0, TR, P, 32);

    // DYNAMIC: Pre-build Plunger
    let plSvg = S(k.slabOf({ x: -24, y: -5, w: 10, d: 10, r: 1 }, 16, 32, P), { tone: 'hi' });
    plSvg += S(G.disc(-60, -24, 3.5, G.frameAlong([0, 0, 32], [1, 0, 0]), P), { tone: 'mid' });
    
    // STATIC: Front Structure
    const frontLayer = [];
    frontLayer.push(S(k.slabOf({ x: -70, y: 6, w: 46, d: 9, r: 2 }, 0, 50, P), { tone: 'mid' }));
    frontLayer.push(S(k.slabOf({ x: 20, y: 6, w: 55, d: 9, r: 2 }, 0, 8, P), { tone: 'mid' }));
    frontLayer.push(S(k.slabOf({ x: -17, y: 5, w: 5, d: 4, r: 1 }, 0, Z_TOP + 20, P), { tone: 'hi' }));
    frontLayer.push(S(k.slabOf({ x: 12, y: 5, w: 5, d: 4, r: 1 }, 0, Z_TOP + 20, P), { tone: 'hi' }));
    
    // Inlet Funnel (Back then Front)
    const inletLayer = [];
    inletLayer.push(S(k.slabOf({ x: -25, y: -12, w: 50, d: 7, r: 2 }, Z_TOP + 20, 10, P), { tone: 'mid' }));
    inletLayer.push(S(k.slabOf({ x: -25, y: 5, w: 50, d: 7, r: 2 }, Z_TOP + 20, 10, P), { tone: 'mid' }));

    return {
      viewBox: [1000, VH],
      layers: [
        { s: baseLayer.join('') },
        { s: backLayer.join('') },
        { s: rampLayer.join('') },
        { d: (st) => {
            let out = '';
            const o = at([0, 0, 0]);
            
            // Plunger
            const pX = at([st.plX - (-16), 0, 0]);
            out += `<g transform="translate(${(pX[0]-o[0]).toFixed(2)} ${(pX[1]-o[1]).toFixed(2)})">${plSvg}</g>`;
            
            // Tokens
            for (const t of st.tks) {
              const pt = at([t.x, 0, t.z]);
              out += `<g transform="translate(${(pt[0]-o[0]).toFixed(2)} ${(pt[1]-o[1]).toFixed(2)})" opacity="${t.op.toFixed(2)}">${t.accent ? TOK_ACC : TOK_STD}</g>`;
            }
            
            // Deny Ring
            if (st.denyOp > 0.01) {
              out += `<path class="mm-accent" opacity="${st.denyOp.toFixed(2)}" d="${DENY_RING}"/>`;
            }
            return out;
          }
        },
        { s: frontLayer.join('') },
        { s: inletLayer.join('') },
      ],
      meta: {
        corner: p.capacity + ' MAX',
        label: p.label,
        accent: null,
      },
      at(t, span = 5) {
        const T0 = 0.7;
        let tks = [];
        let plX = -16;
        let denyOp = 0;
        let val = '';
        let tag = '';
        let tagIn = clamp01((t - 0.8) / 0.3);

        if (s.action === 'refill') {
          for (let i = 0; i < s.tokens; i++) tks.push({ x: 0, z: Z_BOT + i * PITCH, op: 1, accent: false });
          let u = clamp01((t - T0) / 1.0);
          let dz = (Z_TOP + 60) - glide(u) * ((Z_TOP + 60) - (Z_BOT + s.tokens * PITCH));
          if (t >= T0) tks.push({ x: 0, z: dz, op: 1, accent: true });
          val = 'REFILLED';
        } 
        else if (s.action === 'consume') {
          let uIn = clamp01((t - T0) / 1.2);
          plX = -16 + 18 * hump(uIn);
          
          if (s.tokens > 0) {
            let tx = 0, tz = Z_BOT, op = 1;
            if (t <= T0 + 0.6) {
              tx = 18 * hump((t - T0) / 1.2); // Matches plunger perfectly for first half
            } else {
              let uR = clamp01((t - (T0 + 0.6)) / 1.2);
              tx = 18 + 57 * uR;
              tz = Z_BOT - 12 * uR;
              op = 1 - smooth(0.6, 1.0, uR);
            }
            if (op > 0) tks.push({ x: tx, z: tz, op, accent: true });
          }

          for (let i = 1; i < s.tokens; i++) {
            let tz = Z_BOT + i * PITCH;
            if (t > T0 + 0.6) {
              tz -= PITCH * glide(clamp01((t - (T0 + 0.6)) / 0.8));
            }
            tks.push({ x: 0, z: tz, op: 1, accent: false });
          }
          val = 'ACCEPTED';
        }
        else if (s.action === 'deny') {
          let uIn = clamp01((t - T0) / 1.2);
          plX = -16 + 16 * hump(uIn);
          denyOp = hump(uIn);
          val = 'DENIED';
          tag = 'EMPTY';
        }
        else if (s.action === 'overflow') {
          for (let i = 0; i < p.capacity; i++) tks.push({ x: 0, z: Z_BOT + i * PITCH, op: 1, accent: false });
          let tx = 0, tz = Z_TOP + 60, op = 1;
          if (t <= T0 + 0.6) {
            tz = (Z_TOP + 60) - 28 * glide(clamp01((t - T0) / 0.6));
          } else {
            let uR = clamp01((t - (T0 + 0.6)) / 1.2);
            tx = 75 * uR;
            tz = (Z_TOP + 32) - 12 * uR;
            op = 1 - smooth(0.6, 1.0, uR);
          }
          if (t >= T0 && op > 0) tks.push({ x: tx, z: tz, op, accent: true });
          val = 'DROPPED';
          tag = 'FULL';
        }

        return { tks, plX, denyOp, val, tag, tagIn };
      },
      readout(st) {
        return { label: p.readout, value: st.val, tag: st.tag, tagIn: st.tagIn };
      },
    };
  }

  M_.register('token-bucket', { normalize, build });
})(typeof window !== 'undefined' ? window : globalThis);
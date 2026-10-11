MAPPING: A slotted vertical coin-hopper whose tokens represent permitted requests; when a request arrives, a push-slide dispenses a bottom brass token, while an overhead trickle chute refills the stack until full, spilling any excess over an overflow weir.
PARTS: Base: four stepped cylindrical feet, main beveled base slab, inset perimeter groove, corner screw rings and dots, raised machine plinth. Structure: four vertical corner guide rods, rear graduated index scale bar with level tick marks, top crown retaining collar, inflow trickle chute with support strut, overflow spillway chute, overflow collection cup, lower slide bed plate, front and rear slide guide rails, slide bearing gland, exit drop collar, inclined exit runway, and machined token catch tray. Mechanism: sliding dispenser shuttle with token pocket, push-button actuator drawbar, knurled plunger cap, and helical return spring split into back and front coils. Subject: precision milled brass token pucks stacked in the hopper column, plus exiting discharged tokens and arriving refill tokens.
KIND: token-bucket

```javascript
(function (root) {
  'use strict';
  const M_ = root.MM_MACHINES;
  if (!M_) return;
  const { glide, hump, smooth, clamp01 } = M_.util;

  const AZIMUTH = 56;
  const ELEVATION = 26;
  const VW = 1000;
  const PAD = 8;
  const HEADROOM = 44;

  // ---------------------------------------------------------------- params
  function normalize(params, state) {
    params = params || {};
    state = state || {};

    let cap = Math.round(Number(params.capacity));
    if (!Number.isFinite(cap) || cap < 3) cap = 5;
    if (cap > 6) cap = 6;

    const clip = (s, n) => (typeof s === 'string' ? s.trim().slice(0, n) : '');
    const validBehaviors = ['burst', 'throttle', 'refill', 'overflow'];
    let beh = String(state.behaviour || state.behavior || 'burst').toLowerCase();
    if (!validBehaviors.includes(beh)) beh = 'burst';

    let init = Number(state.initial != null ? state.initial : state.from);
    if (!Number.isFinite(init)) {
      init = beh === 'burst' ? 4 : beh === 'throttle' ? 1 : beh === 'refill' ? 1 : cap;
    }
    init = Math.max(0, Math.min(cap, Math.round(init)));

    return {
      p: {
        capacity: cap,
        label: clip(params.label, 24) || 'TOKEN BUCKET',
        readout: clip(params.readout || params.readoutLabel, 20) || 'TOKENS',
      },
      s: {
        initial: init,
        behaviour: beh,
      },
    };
  }

  // ---------------------------------------------------------------- timeline
  function timeline(p, s, span) {
    const cap = p.capacity;
    const beh = s.behaviour;
    const events = [];

    if (beh === 'burst') {
      events.push({ type: 'request', t: 0.9, dur: 0.72 });
      events.push({ type: 'request', t: 1.95, dur: 0.72 });
      events.push({ type: 'request', t: 3.0, dur: 0.72 });
    } else if (beh === 'throttle') {
      events.push({ type: 'request', t: 1.0, dur: 0.75 });
      events.push({ type: 'request', t: 2.35, dur: 0.75 });
    } else if (beh === 'refill') {
      events.push({ type: 'refill', t: 0.9, dur: 0.85 });
      events.push({ type: 'refill', t: 2.05, dur: 0.85 });
      events.push({ type: 'refill', t: 3.2, dur: 0.85 });
    } else if (beh === 'overflow') {
      events.push({ type: 'refill', t: 1.4, dur: 1.1 });
    }

    // pre-evaluate state trajectory at key boundaries
    const sim = [];
    let cur = s.initial;
    for (const ev of events) {
      if (ev.type === 'request') {
        const granted = cur > 0;
        const from = cur;
        const to = granted ? cur - 1 : 0;
        sim.push({ ...ev, granted, from, to, tCommit: ev.t + 0.42 * ev.dur });
        cur = to;
      } else {
        const overflow = cur >= cap;
        const from = cur;
        const to = overflow ? cur : cur + 1;
        sim.push({ ...ev, overflow, from, to, tCommit: ev.t + 0.55 * ev.dur });
        cur = to;
      }
    }

    return { events: sim, initial: s.initial, capacity: cap };
  }

  // ---------------------------------------------------------------- build
  function build(p, s) {
    const { k, G } = root.ANATOMY;
    const CAP = p.capacity;
    const R_TOK = 19;
    const H_TOK = 8.5;
    const Z_TOWER = 14;     // bottom of column / cradle surface

    const BASE = { x: -82, y: -60, w: 164, d: 120, r: 8 };
    const BASE_H = 7;
    const FOOT_H = 3.5;
    const PLINTH = { x: -44, y: -34, w: 90, d: 68, r: 4 };

    // column rod offsets
    const ROD_DX = 15.5;
    const ROD_DY = 15.5;
    const TOWER_TOP = Z_TOWER + CAP * H_TOK + 4;

    const EXTREMES = [
      ...k.boxCorners(BASE, -BASE_H - FOOT_H, 0),
      [-72, 0, 11],
      [64, -10, 0],
      [-48, 14, 102],
      [48, 20, 48],
      [0, 0, TOWER_TOP + 8],
    ];

    const VH = (() => {
      const flat = EXTREMES.map((pt) => k.iso(pt, { origin: [0, 0], scale: 1, azimuth: AZIMUTH, elevation: ELEVATION }));
      const w = Math.max(...flat.map((q) => q[0])) - Math.min(...flat.map((q) => q[0]));
      const h = Math.max(...flat.map((q) => q[1])) - Math.min(...flat.map((q) => q[1]));
      return Math.round(Math.max(480, Math.min(640, (h * (VW - 2 * PAD)) / w + 2 * PAD + HEADROOM)));
    })();

    const P = k.fitProjection(EXTREMES, VW, VH, { pad: PAD, headroom: HEADROOM, azimuth: AZIMUTH, elevation: ELEVATION });
    const at = (pt) => k.iso(pt, P);
    const S = (paths, style) => k.solidSvg(paths, style);
    const L = (d, style) => k.lineSvg(d, style);
    const D = (pts, style) => k.dotsSvg(pts, style);
    const byDepth = (pts) => [...pts].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));

    // ---------------- Layer 0: Base, feet, plinth
    const base = [];
    base.push(`<path class="iso-halo" style="filter:blur(10px);transform:translateY(4px)" d="${k.haloOf(BASE, -BASE_H - FOOT_H, BASE_H, P)}"/>`);
    for (const [fx, fy] of byDepth(k.corners(BASE, 9))) {
      base.push(S(k.cylinder(fx, fy, 5.2, -BASE_H - FOOT_H, 1, P, 20), { tone: 'lo' }));
      base.push(S(k.cylinder(fx, fy, 4.0, -BASE_H - FOOT_H + 1, FOOT_H - 1, P, 20), { tone: 'mid' }));
    }
    base.push(S(k.slabOf(BASE, -BASE_H, BASE_H, P, 8, 1.4), { tone: 'lo' }));
    base.push(L(k.planOutline(k.insetPlan(BASE, 3.5), 0, P), { tone: 'faint' }));
    const baseScrews = k.corners(BASE, 6.0);
    base.push(L(baseScrews.map(([sx, sy]) => k.ring(sx, sy, 1.6, 0, P, 16)).join(''), { tone: 'lo' }));
    base.push(D(baseScrews.map(([sx, sy]) => at([sx, sy, 0])), { size: 0.9 }));
    base.push(S(k.slabOf(PLINTH, 0, 5.5, P, 4, 1.0), { tone: 'mid' }));

    // ---------------- Layer 1: Back structures
    const backStruct = [];
    // slide deck bed plate (z = 5.5 to 7.5)
    const BED = { x: -38, y: -20, w: 76, d: 40, r: 2 };
    backStruct.push(S(k.slabOf(BED, 5.5, 2.0, P, 3, 0.4), { tone: 'mid' }));

    // rear guide rail for shuttle (y = 13 to 20, z = 7.5 to 14)
    const RAIL_R = { x: -38, y: 13, w: 76, d: 7, r: 1.5 };
    backStruct.push(S(k.slabOf(RAIL_R, 7.5, 6.5, P, 2, 0.4), { tone: 'mid' }));

    // rear posts of tower
    const rodH = TOWER_TOP - 7.5;
    backStruct.push(S(k.cylinder(-ROD_DX, ROD_DY, 2.2, 7.5, rodH, P, 18), { tone: 'mid' }));
    backStruct.push(S(k.cylinder(ROD_DX, ROD_DY, 2.2, 7.5, rodH, P, 18), { tone: 'mid' }));

    // rear calibrated scale bar (between rear posts)
    const SCALE = { x: -13, y: 16, w: 26, d: 3, r: 1 };
    backStruct.push(S(k.slabOf(SCALE, Z_TOWER, CAP * H_TOK, P, 2, 0.3), { tone: 'mid' }));
    // tick marks along the front edge of the scale bar
    const ticks = [];
    for (let i = 1; i <= CAP; i++) {
      const zt = Z_TOWER + i * H_TOK;
      ticks.push(k.segment([-12, 16, zt], [12, 16, zt], P));
      if (i < CAP) {
        ticks.push(k.segment([-6, 16, zt - H_TOK * 0.5], [6, 16, zt - H_TOK * 0.5], P));
      }
    }
    backStruct.push(L(ticks.join(''), { tone: 'lo' }));

    // top feed chute (rear-left channel feeding into column top)
    const CHUTE_TOP = [-46, 12, TOWER_TOP + 28];
    const CHUTE_BOT = [-14, 5, TOWER_TOP + 4];
    // chute strut
    backStruct.push(S(k.cylinder(-38, 12, 1.8, 5.5, TOWER_TOP + 12, P, 16), { tone: 'mid' }));
    // chute channel as angled prism
    const chutePts = [
      [-48, 14, TOWER_TOP + 29],
      [-44, 9, TOWER_TOP + 27],
      [-12, 2, TOWER_TOP + 5],
      [-16, 7, TOWER_TOP + 7],
    ];
    backStruct.push(L(k.pathOf([at(CHUTE_TOP), at(CHUTE_BOT)]), { tone: 'mid' }));
    backStruct.push(S(k.slabOf({ x: -44, y: 6, w: 32, d: 8, r: 1.5 }, TOWER_TOP + 10, 2.5, P, 2), { tone: 'mid' }));

    // overflow chute & receptacle (right side)
    const OVERFLOW_CUP = { cx: 44, cy: 16, r: 8, z: 5.5, h: 22 };
    backStruct.push(S(k.cylinder(OVERFLOW_CUP.cx, OVERFLOW_CUP.cy, OVERFLOW_CUP.r, OVERFLOW_CUP.z, OVERFLOW_CUP.h, P, 24, 0.5), { tone: 'mid' }));
    backStruct.push(L(k.ring(OVERFLOW_CUP.cx, OVERFLOW_CUP.cy, OVERFLOW_CUP.r - 1.2, OVERFLOW_CUP.z + OVERFLOW_CUP.h, P, 24), { tone: 'faint' }));
    // overflow deflector weir from collar down to cup
    const WEIR = { x: 16, y: 4, w: 26, d: 9, r: 2 };
    backStruct.push(S(k.slabOf(WEIR, TOWER_TOP - 6, 2.5, P, 2, 0.3), { tone: 'mid' }));

    // exit chute ramp at x = 28..52, y = -14..6
    const RAMP = { x: 26, y: -16, w: 26, d: 20, r: 2 };
    backStruct.push(S(k.slabOf(RAMP, 1.0, 4.5, P, 2, 0.4), { tone: 'mid' }));
    // catch tray rim on the base
    const TRAY = { x: 44, y: -16, w: 18, d: 20, r: 3 };
    backStruct.push(S(k.slabOf(TRAY, 1.0, 3.2, P, 2, 0.4), { tone: 'mid' }));

    // ---------------- Push slide / mechanism at rest
    const GLAND = { x: -38, y: -6, w: 6, d: 12, r: 1.5 };
    backStruct.push(S(k.slabOf(GLAND, 7.5, 6.5, P, 2), { tone: 'mid' }));

    // shuttle body (built at dx = 0)
    // shuttle has a pocket holding the bottom token
    const SHUTTLE = { x: -17, y: -14, w: 34, d: 28, r: 3 };
    const shuttleSolid = S(k.slabOf(SHUTTLE, 7.5, 6.0, P, 4, 0.5), { tone: 'hi' });
    const pocketRing = L(k.ring(0, 0, R_TOK + 0.5, 13.5, P, 28), { tone: 'faint' });

    // actuator push-rod from shuttle left edge (x = -17) through gland to knob
    const pushRod = S(G.disc(-56, -17, 2.2, G.frameAlong([0, 0, 10.5], [1, 0, 0]), P), { tone: 'hi', crease: 'lo' });
    const knobSolid = S(G.disc(-63, -56, 5.2, G.frameAlong([0, 0, 10.5], [1, 0, 0]), P), {
      tone: 'hi',
      crease: 'lo',
      inner: L(G.circleOf(G.frameAlong([-56, 0, 10.5], [1, 0, 0]), 0, 3.5, P, 24), { tone: 'faint' }),
    });

    const shuttleGroupStatic = shuttleSolid + pocketRing + pushRod + knobSolid;

    // ---------------- Front structures
    const frontStruct = [];
    // front guide rail for shuttle (y = -20 to -13, z = 7.5 to 14)
    const RAIL_F = { x: -38, y: -20, w: 76, d: 7, r: 1.5 };
    frontStruct.push(S(k.slabOf(RAIL_F, 7.5, 6.5, P, 2, 0.4), { tone: 'mid' }));

    // front corner posts of tower
    frontStruct.push(S(k.cylinder(-ROD_DX, -ROD_DY, 2.2, 7.5, rodH, P, 18), { tone: 'mid' }));
    frontStruct.push(S(k.cylinder(ROD_DX, -ROD_DY, 2.2, 7.5, rodH, P, 18), { tone: 'mid' }));

    // top crown retaining collar (z = TOWER_TOP to TOWER_TOP + 4)
    frontStruct.push(S(k.cylinder(0, 0, R_TOK + 4, TOWER_TOP, 4.0, P, 32, 0.5), { tone: 'mid' }));
    frontStruct.push(L(k.ring(0, 0, R_TOK, TOWER_TOP + 4, P, 32), { tone: 'faint' }));

    // exit aperture accent ring at drop point (x = 28, y = 0)
    frontStruct.push(L(k.ring(26, 0, R_TOK + 0.5, 7.5, P, 28), { tone: 'lo' }));

    // token solid helper
    const drawToken = (cx, cy, cz, alpha = 1, accent = false) => {
      const paths = k.cylinder(cx, cy, R_TOK, cz, H_TOK, P, 28, 0.5);
      const ring = L(k.ring(cx, cy, R_TOK * 0.65, cz + H_TOK, P, 24), { tone: 'faint' });
      const pip = D([at([cx, cy, cz + H_TOK])], { size: 0.75, tone: 'mid' });
      const glow = accent ? `<path class="mm-accent" d="${paths.outline}"/>` : '';
      const svg = S(paths, { tone: 'hi', crease: 'lo', inner: ring + pip }) + glow;
      if (alpha < 0.99) {
        return `<g opacity="${Math.max(0, alpha).toFixed(2)}">${svg}</g>`;
      }
      return svg;
    };

    // return spring generator (between gland at x = -38 and knob at x_knob)
    const springSvg = (xKnob) => {
      const xGland = -32;
      const xEnd = xKnob + 1.5;
      const turns = 6;
      const r = 3.6;
      const sp = k.coil(xEnd, xGland, [0, 10.5], r, turns, 'x', P);
      return {
        back: L(sp.back, { tone: 'mid' }),
        front: L(sp.front, { tone: 'mid' }),
      };
    };

    // ---------------- Pre-assemble static layers
    const staticBase = base.join('');
    const staticBack = backStruct.join('');
    const staticFront = frontStruct.join('');

    const tl = timeline(p, s, 5);

    return {
      viewBox: [VW, VH],
      layers: [
        { s: staticBase + staticBack },
        {
          d(st) {
            // dynamic spring back coils
            const sp = springSvg(-56 + st.dx);
            return sp.back;
          },
        },
        {
          d(st) {
            // moving shuttle + drawbar + knob group
            return `<g transform="${k.translateAlong(P, [st.dx, 0, 0])}">${shuttleGroupStatic}</g>`;
          },
        },
        {
          d(st) {
            // dynamic spring front coils
            const sp = springSvg(-56 + st.dx);
            return sp.front;
          },
        },
        {
          d(st) {
            // dynamic tokens (in stack, exiting, and incoming)
            const out = [];

            // 1. Tokens inside the column
            for (let i = 0; i < st.stack.length; i++) {
              const item = st.stack[i];
              out.push(drawToken(item.x, item.y, item.z, item.alpha, item.accent));
            }

            // 2. Discharged token traveling down exit chute
            if (st.discharged) {
              out.push(drawToken(st.discharged.x, st.discharged.y, st.discharged.z, st.discharged.alpha, st.discharged.accent));
            }

            // 3. Inflow token (refill or overflow)
            if (st.inflow) {
              out.push(drawToken(st.inflow.x, st.inflow.y, st.inflow.z, st.inflow.alpha, st.inflow.accent));
            }

            return out.join('');
          },
        },
        { s: staticFront },
        {
          d(st) {
            // transient accents (denied warning or overflow deflector highlight)
            const out = [];
            if (st.denied > 0.05) {
              // highlight empty pocket
              const pocket = k.cylinder(st.dx, 0, R_TOK, 7.5, 6.0, P, 24);
              out.push(`<path class="mm-accent" opacity="${st.denied.toFixed(2)}" d="${pocket.outline}"/>`);
            }
            if (st.overflowFlash > 0.05) {
              const weir = k.slabOf({ x: 16, y: 4, w: 26, d: 9, r: 2 }, TOWER_TOP - 6, 2.5, P, 2);
              out.push(`<path class="mm-accent" opacity="${st.overflowFlash.toFixed(2)}" d="${weir.outline}"/>`);
            }
            return out.join('');
          },
        },
      ],
      meta: {
        corner: `BURST CAP ${CAP}`,
        label: p.label,
        accent: null,
      },
      at(t) {
        let dx = 0;
        let denied = 0;
        let overflowFlash = 0;
        let count = tl.initial;
        let discharged = null;
        let inflow = null;
        let tag = '';
        let tagIn = 0;

        // compute live token count up to time t
        for (const ev of tl.events) {
          if (t >= ev.tCommit) {
            count = ev.to;
          }
        }

        // simulate active event at time t
        for (const ev of tl.events) {
          const u = (t - ev.t) / ev.dur;
          if (u < 0 || u > 1) continue;

          if (ev.type === 'request') {
            // push-stroke motion (operator pushes knob +x, travel = 26 units)
            const travel = 26;
            let push = 0;
            if (u < 0.42) {
              push = glide(u / 0.42);
            } else if (u < 0.58) {
              push = 1;
            } else {
              push = 1 - glide((u - 0.58) / 0.42);
            }
            dx = push * travel;

            if (ev.granted) {
              // token being pushed out
              if (u <= 0.46) {
                discharged = { x: push * travel, y: 0, z: Z_TOWER, alpha: 1, accent: u > 0.3 };
              } else {
                // drops down exit chute
                const fallU = (u - 0.46) / 0.54;
                const fx = travel + 20 * glide(fallU);
                const fy = -10 * glide(fallU);
                const fz = Z_TOWER - 10 * glide(fallU);
                discharged = { x: fx, y: fy, z: fz, alpha: 1 - 0.7 * smooth(0.8, 1.0, fallU), accent: false };
              }
              tag = 'BURST 1';
              tagIn = hump(u);
            } else {
              // denied request: shuttle is empty
              denied = hump((u - 0.2) / 0.7);
              tag = 'DENIED';
              tagIn = smooth(0.2, 0.45, u);
            }
          } else if (ev.type === 'refill') {
            if (!ev.overflow) {
              // normal refill dropping into stack
              if (u < 0.45) {
                // sliding down top feed chute
                const chuteU = u / 0.45;
                const cx = -44 + 32 * glide(chuteU);
                const cy = 12 - 7 * glide(chuteU);
                const cz = (TOWER_TOP + 28) - 24 * glide(chuteU);
                inflow = { x: cx, y: cy, z: cz, alpha: 1, accent: false };
              } else {
                // dropping into stack
                const dropU = (u - 0.45) / 0.55;
                const targetZ = Z_TOWER + ev.from * H_TOK;
                const cz = (TOWER_TOP + 4) - ((TOWER_TOP + 4) - targetZ) * glide(dropU);
                inflow = { x: 0, y: 0, z: cz, alpha: 1, accent: dropU > 0.8 };
              }
              tag = 'REFILLED';
              tagIn = smooth(0.35, 0.6, u);
            } else {
              // overflow deflection
              overflowFlash = hump(u);
              if (u < 0.38) {
                const chuteU = u / 0.38;
                const cx = -44 + 32 * glide(chuteU);
                const cy = 12 - 7 * glide(chuteU);
                const cz = (TOWER_TOP + 28) - 24 * glide(chuteU);
                inflow = { x: cx, y: cy, z: cz, alpha: 1, accent: false };
              } else {
                // rolls down overflow weir into cup
                const spillU = (u - 0.38) / 0.62;
                const sx = 14 + 30 * glide(spillU);
                const sy = 4 + 12 * glide(spillU);
                const sz = (TOWER_TOP - 2) - 28 * glide(spillU);
                inflow = { x: sx, y: sy, z: sz, alpha: 1 - 0.6 * smooth(0.85, 1.0, spillU), accent: true };
              }
              tag = 'OVERFLOW';
              tagIn = smooth(0.3, 0.5, u);
            }
          }
        }

        // build array of tokens currently resting inside the column
        const stack = [];
        for (let i = 0; i < count; i++) {
          const zPos = Z_TOWER + i * H_TOK;
          stack.push({ x: 0, y: 0, z: zPos, alpha: 1, accent: false });
        }

        return {
          dx,
          denied,
          overflowFlash,
          stack,
          discharged,
          inflow,
          count,
          tag,
          tagIn: clamp01(tagIn),
        };
      },
      readout(st) {
        return {
          label: p.readout,
          value: `${st.count} / ${CAP}`,
          tag: st.tag,
          tagIn: st.tagIn,
        };
      },
    };
  }

  M_.register('token-bucket', { normalize, build });
})(typeof window !== 'undefined' ? window : globalThis);
```

```json
{
  "scenes": [
    {
      "headline": "Bursts consume stored tokens.",
      "subhead": "three requests served instantly",
      "params": {
        "capacity": 5,
        "label": "token bucket",
        "readout": "tokens"
      },
      "state": {
        "initial": 4,
        "behaviour": "burst"
      }
    },
    {
      "headline": "Empty bucket throttles traffic.",
      "subhead": "zero tokens left to grant",
      "params": {
        "capacity": 5,
        "label": "token bucket",
        "readout": "tokens"
      },
      "state": {
        "initial": 1,
        "behaviour": "throttle"
      }
    },
    {
      "headline": "Steady refill restores capacity.",
      "subhead": "trickle tokens replenish stack",
      "params": {
        "capacity": 5,
        "label": "token bucket",
        "readout": "tokens"
      },
      "state": {
        "initial": 1,
        "behaviour": "refill"
      }
    },
    {
      "headline": "Overflow discards excess tokens.",
      "subhead": "capacity capped at five",
      "params": {
        "capacity": 5,
        "label": "token bucket",
        "readout": "tokens"
      },
      "state": {
        "initial": 5,
        "behaviour": "overflow"
      }
    }
  ]
}
```
**VISUAL DEFECTS IN IMAGE 1 VS THE BENCHMARK (IMAGE 2)**

1. **The subject is nearly invisible**: The tokens were thin wire discs tucked inside a spindly skeleton, occupying under 10% of the visual mass. On a mobile reel, viewers cannot tell how many tokens are in the column.
2. **The cage reads as floating hollow wire loops**: The guide rods and collar looked like a see-through chemistry stand rather than an engineered machine. The lack of solid cast cheeks or back walls created confusing negative space.
3. **Excessive empty floor space**: The camera framing was blown out by distant chute points, leaving an enormous flat base plate with 70% dead margin around a tiny central mechanism.
4. **Floating disconnected solids**: During refill, tokens hovered high in mid-air above the machine with no chute guide or physical track.
5. **Lack of tactile mechanical substance**: Image 2 features massive cheeks, thick rails, knurled knobs, and stamped numerals. Image 1 lacked structural heft, engraved index scales, and clear mechanical linkage.

---

MAPPING: A benchtop brass token-metering column with a spring-loaded bottom escapement slide; incoming requests advance the slide to dispense tokens into an exit tray, while an overhead funnel replenishes the column up to a fixed weir that spills excess into an overflow hopper.
PARTS: Base: stepped isolation feet, primary beveled cast baseplate, perimeter oil groove, corner mounting bolts. Structure: twin arched cast-iron upright cheeks with rear stiffening ribs, tie rods with knurled end-nuts, slotted brass magazine column with front inspection window, engraved level gauge plate (1 to 5), overhead feed funnel with mounting bracket, and brass overflow spillway leading to a side catchment bin. Mechanism: milled sliding dispenser drawer with token aperture, guide gib rails, hardened push-rod with knurled button cap, split helical return spring (rear and front coils), and front catch basin. Subject: heavy precision brass token pucks with recessed face rims and central pips, resting in the stack, dropping through the escapement slide, or spilling across the overflow weir.
KIND: token-bucket

```javascript
(function (root) {
  'use strict';
  const M_ = root.MM_MACHINES;
  if (!M_) return;
  const { glide, hump, smooth, clamp01 } = M_.util;

  const AZIMUTH = 68;
  const ELEVATION = 22;
  const VW = 1000;
  const VH = 580;
  const PAD = 16;
  const HEADROOM = 44;

  // ---------------------------------------------------------------- params
  function normalize(params, state) {
    params = params || {};
    state = state || {};

    let cap = Math.round(Number(params.capacity));
    if (!Number.isFinite(cap) || cap < 4) cap = 5;
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
      events.push({ type: 'req', t: 0.85, dur: 0.8 });
      events.push({ type: 'req', t: 1.95, dur: 0.8 });
      events.push({ type: 'req', t: 3.05, dur: 0.8 });
    } else if (beh === 'throttle') {
      events.push({ type: 'req', t: 0.95, dur: 0.85 });
      events.push({ type: 'req', t: 2.35, dur: 0.85 });
    } else if (beh === 'refill') {
      events.push({ type: 'refill', t: 0.85, dur: 0.9 });
      events.push({ type: 'refill', t: 1.95, dur: 0.9 });
      events.push({ type: 'refill', t: 3.05, dur: 0.9 });
    } else if (beh === 'overflow') {
      events.push({ type: 'refill', t: 1.35, dur: 1.2 });
    }

    const sim = [];
    let cur = s.initial;
    for (const ev of events) {
      if (ev.type === 'req') {
        const granted = cur > 0;
        const from = cur;
        const to = granted ? cur - 1 : 0;
        sim.push({ ...ev, granted, from, to, tCommit: ev.t + 0.45 * ev.dur });
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

    // Dimensions: tokens are chunky and dominant
    const R_TOK = 28;
    const H_TOK = 11;
    const Z_SLIDE_BED = 12;
    const Z_SLIDE_TOP = Z_SLIDE_BED + 13;
    const TOWER_Z0 = Z_SLIDE_TOP;
    const TOWER_H = CAP * H_TOK + 6;
    const TOWER_TOP = TOWER_Z0 + TOWER_H;

    // Compact base plate to maximize machine scale
    const BASE = { x: -74, y: -48, w: 148, d: 96, r: 6 };
    const BASE_H = 7;
    const FOOT_H = 3.5;

    // Cheek dimensions
    const CHEEK_THICK = 6;
    const X_CHEEK_L = -42;
    const X_CHEEK_R = 42;

    const EXTREMES = [
      ...k.boxCorners(BASE, -BASE_H - FOOT_H, 0),
      [X_CHEEK_L - 6, -32, TOWER_TOP + 18],
      [X_CHEEK_R + 6, 32, TOWER_TOP + 18],
      [-72, 0, Z_SLIDE_BED + 8],
      [58, -24, 0],
    ];

    const P = k.fitProjection(EXTREMES, VW, VH, { pad: PAD, headroom: HEADROOM, azimuth: AZIMUTH, elevation: ELEVATION });

    const at = (pt) => k.iso(pt, P);
    const S = (paths, style) => k.solidSvg(paths, style);
    const L = (d, style) => k.lineSvg(d, style);
    const D = (pts, style) => k.dotsSvg(pts, style);
    const byDepth = (pts) => [...pts].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));

    // ---------------- Base
    const base = [];
    base.push(`<path class="iso-halo" style="filter:blur(10px);transform:translateY(4px)" d="${k.haloOf(BASE, -BASE_H - FOOT_H, BASE_H, P)}"/>`);
    for (const [fx, fy] of byDepth(k.corners(BASE, 8))) {
      base.push(S(k.cylinder(fx, fy, 5.5, -BASE_H - FOOT_H, 1, P, 20), { tone: 'lo' }));
      base.push(S(k.cylinder(fx, fy, 4.2, -BASE_H - FOOT_H + 1, FOOT_H - 1, P, 20), { tone: 'mid' }));
    }
    base.push(S(k.slabOf(BASE, -BASE_H, BASE_H, P, 6, 1.2), { tone: 'lo' }));
    base.push(L(k.planOutline(k.insetPlan(BASE, 3.8), 0, P), { tone: 'faint' }));
    const screws = k.corners(BASE, 6.2);
    base.push(L(screws.map(([sx, sy]) => k.ring(sx, sy, 1.8, 0, P, 16)).join(''), { tone: 'lo' }));
    base.push(D(screws.map(([sx, sy]) => at([sx, sy, 0])), { size: 0.9 }));

    // Cast plinth under mechanism
    const PLINTH = { x: -50, y: -36, w: 100, d: 72, r: 4 };
    base.push(S(k.slabOf(PLINTH, 0, 5.5, P, 4, 0.8), { tone: 'mid' }));

    // ---------------- Structural Uprights & Cheeks
    const backStruct = [];
    // Slide bed table (z = 5.5 to 12)
    const SLIDE_BED = { x: -44, y: -24, w: 88, d: 48, r: 3 };
    backStruct.push(S(k.slabOf(SLIDE_BED, 5.5, Z_SLIDE_BED - 5.5, P, 3, 0.6), { tone: 'mid' }));

    // Rear guide rail for the sliding drawer
    const RAIL_REAR = { x: -44, y: 15, w: 88, d: 9, r: 2 };
    backStruct.push(S(k.slabOf(RAIL_REAR, Z_SLIDE_BED, 13, P, 2, 0.5), { tone: 'mid' }));

    // Arched Left & Right Cheeks
    const cheekProfile = (cx) => {
      const slab = k.slabOf({ x: cx - CHEEK_THICK / 2, y: -26, w: CHEEK_THICK, d: 52, r: 3 }, Z_SLIDE_BED, TOWER_TOP - Z_SLIDE_BED + 8, P, 3, 0.8);
      return S(slab, { tone: 'mid' });
    };
    backStruct.push(cheekProfile(X_CHEEK_L));
    backStruct.push(cheekProfile(X_CHEEK_R));

    // Heavy tie-rods between cheeks with knurled nuts
    const TIE_Z1 = TOWER_TOP + 4;
    const TIE_Z2 = Z_SLIDE_BED + 24;
    for (const [ty, tz] of [[-18, TIE_Z1], [18, TIE_Z1], [18, TIE_Z2]]) {
      const rod = G.disc(X_CHEEK_L, X_CHEEK_R, 2.4, G.frameAlong([0, ty, tz], [1, 0, 0]), P);
      const nutL = G.disc(X_CHEEK_L - 3.5, X_CHEEK_L, 4.0, G.frameAlong([0, ty, tz], [1, 0, 0]), P);
      const nutR = G.disc(X_CHEEK_R, X_CHEEK_R + 3.5, 4.0, G.frameAlong([0, ty, tz], [1, 0, 0]), P);
      backStruct.push(S(rod, { tone: 'mid', crease: 'none' }));
      backStruct.push(S(nutL, { tone: 'hi', crease: 'lo' }));
      backStruct.push(S(nutR, { tone: 'hi', crease: 'lo' }));
    }

    // Rear Solid Shell of the Token Magazine
    // (A solid brass half-cylinder wrapping tokens from behind: from -pi/6 to 7pi/6)
    const TOWER_WALL = 3.5;
    const magSteps = 24;
    const magRearArc = [];
    for (let i = 0; i <= magSteps; i++) {
      const a = -0.15 * Math.PI + (1.3 * Math.PI * i) / magSteps;
      magRearArc.push([Math.cos(a) * (R_TOK + TOWER_WALL), Math.sin(a) * (R_TOK + TOWER_WALL)]);
    }
    for (let i = magSteps; i >= 0; i--) {
      const a = -0.15 * Math.PI + (1.3 * Math.PI * i) / magSteps;
      magRearArc.push([Math.cos(a) * R_TOK, Math.sin(a) * R_TOK]);
    }
    const magRearPaths = k.extrude(magRearArc, TOWER_Z0, TOWER_H, P, { convex: false });
    backStruct.push(S(magRearPaths, { tone: 'mid', crease: 'lo' }));

    // Top Funnel / Refill Hopper
    const FUNNEL_Z = TOWER_TOP;
    const FUNNEL = G.solidOf([
      [0, R_TOK + 4],
      [4, R_TOK + 6],
      [14, R_TOK + 14],
      [16, R_TOK + 13],
      [16, R_TOK + 1],
    ], G.frameAlong([0, 0, FUNNEL_Z], [0, 0, 1]), P);
    backStruct.push(S(FUNNEL, { tone: 'hi', crease: 'lo' }));

    // Overflow spillway chute (sloping rightward into overflow cup)
    const OVERFLOW_CHUTE = { x: 26, y: -8, w: 22, d: 16, r: 2 };
    backStruct.push(S(k.slabOf(OVERFLOW_CHUTE, TOWER_TOP - 7, 3, P, 2, 0.4), { tone: 'hi' }));
    // Overflow collection bin on the right plinth
    const CUP = { cx: 40, cy: 18, r: 10, z: 5.5, h: 26 };
    backStruct.push(S(k.cylinder(CUP.cx, CUP.cy, CUP.r, CUP.z, CUP.h, P, 24, 0.6), { tone: 'mid' }));
    backStruct.push(L(k.ring(CUP.cx, CUP.cy, CUP.r - 1.2, CUP.z + CUP.h, P, 24), { tone: 'faint' }));

    // Front Exit Catch Tray (front-right, where discharged tokens slide into)
    const TRAY = { x: 18, y: -38, w: 32, d: 18, r: 3 };
    backStruct.push(S(k.slabOf(TRAY, 2.5, 4.5, P, 3, 0.5), { tone: 'mid' }));
    backStruct.push(L(k.planOutline(k.insetPlan(TRAY, 2), 7.0, P), { tone: 'faint' }));

    // ---------------- Slotted Brass Front Column Bars & Gauge
    const frontStruct = [];
    // Front guide rail for the sliding drawer
    const RAIL_FRONT = { x: -44, y: -24, w: 88, d: 9, r: 2 };
    frontStruct.push(S(k.slabOf(RAIL_FRONT, Z_SLIDE_BED, 13, P, 2, 0.5), { tone: 'mid' }));

    // Twin vertical brass front retaining pillars (framing the inspection window)
    const P1_X = -R_TOK * 0.88;
    const P1_Y = -R_TOK * 0.52;
    const P2_X = R_TOK * 0.88;
    const P2_Y = -R_TOK * 0.52;
    frontStruct.push(S(k.cylinder(P1_X, P1_Y, 2.8, TOWER_Z0, TOWER_H, P, 18, 0.3), { tone: 'hi' }));
    frontStruct.push(S(k.cylinder(P2_X, P2_Y, 2.8, TOWER_Z0, TOWER_H, P, 18, 0.3), { tone: 'hi' }));

    // Engraved Scale Index Bar attached to Left Pillar
    const GAUGE = { x: P1_X - 6.5, y: P1_Y - 3, w: 5, d: 6, r: 1 };
    frontStruct.push(S(k.slabOf(GAUGE, TOWER_Z0, CAP * H_TOK, P, 2, 0.2), { tone: 'hi' }));
    const gaugeTicks = [];
    for (let i = 1; i <= CAP; i++) {
      const zt = TOWER_Z0 + i * H_TOK;
      gaugeTicks.push(k.segment([GAUGE.x, GAUGE.y, zt], [GAUGE.x + 5, GAUGE.y, zt], P));
      gaugeTicks.push(k.segment([GAUGE.x + 2, GAUGE.y, zt - H_TOK * 0.5], [GAUGE.x + 5, GAUGE.y, zt - H_TOK * 0.5], P));
    }
    frontStruct.push(L(gaugeTicks.join(''), { tone: 'hi' }));

    // Exit guide bevel lip
    frontStruct.push(L(k.ring(0, 0, R_TOK + 1, Z_SLIDE_BED, P, 32), { tone: 'faint' }));

    // ---------------- Moving Escapement Shuttle & Plunger
    // The drawer is at z = Z_SLIDE_BED (height 12.5), sliding along x
    const SHUTTLE_W = 60;
    const SHUTTLE_D = 38;
    const SHUTTLE = { x: -SHUTTLE_W / 2, y: -SHUTTLE_D / 2, w: SHUTTLE_W, d: SHUTTLE_D, r: 4 };
    const shuttlePaths = k.slabOf(SHUTTLE, Z_SLIDE_BED + 0.5, 11.5, P, 4, 0.6);
    const shuttleTopRing = L(k.ring(0, 0, R_TOK + 0.8, Z_SLIDE_BED + 12, P, 32), { tone: 'hi' });

    // Actuator push-rod on left: connects to shuttle, passes through left cheek bushing
    const PUSHROD_R = 3.0;
    const rodShape = G.disc(-78, -SHUTTLE_W / 2, PUSHROD_R, G.frameAlong([0, 0, Z_SLIDE_BED + 6.2], [1, 0, 0]), P);
    const KNOB = G.disc(-86, -78, 6.8, G.frameAlong([0, 0, Z_SLIDE_BED + 6.2], [1, 0, 0]), P, {
      inner: L(G.circleOf(G.frameAlong([-78, 0, Z_SLIDE_BED + 6.2], [1, 0, 0]), 0, 4.5, P, 24), { tone: 'faint' }),
    });
    const shuttleStaticSvg = S(shuttlePaths, { tone: 'hi' }) + shuttleTopRing + S(rodShape, { tone: 'hi', crease: 'lo' }) + S(KNOB, { tone: 'hi', crease: 'lo' });

    // Helper: heavy brass token puck
    const tokenPaths = (cx, cy, cz, bevel = 0.5) => {
      const puck = k.cylinder(cx, cy, R_TOK, cz, H_TOK, P, 36, bevel);
      const faceGroove = L(k.ring(cx, cy, R_TOK * 0.72, cz + H_TOK, P, 32), { tone: 'faint' });
      const pip = D([at([cx, cy, cz + H_TOK])], { size: 1.1, tone: 'hi' });
      return { puck, inner: faceGroove + pip };
    };

    const drawToken = (cx, cy, cz, alpha = 1, accent = false) => {
      const t = tokenPaths(cx, cy, cz);
      const glow = accent ? `<path class="mm-accent" d="${t.puck.outline}"/>` : '';
      const svg = S(t.puck, { tone: 'hi', crease: 'lo', inner: t.inner }) + glow;
      if (alpha < 0.99) {
        return `<g opacity="${Math.max(0, alpha).toFixed(2)}">${svg}</g>`;
      }
      return svg;
    };

    // Helical spring around actuator rod
    const springSvg = (dx) => {
      const xGland = X_CHEEK_L - CHEEK_THICK / 2;
      const xKnob = -78 + dx;
      const turns = 6;
      const r = 4.8;
      const sp = k.coil(xKnob, xGland, [0, Z_SLIDE_BED + 6.2], r, turns, 'x', P);
      return {
        back: L(sp.back, { tone: 'hi' }),
        front: L(sp.front, { tone: 'hi' }),
      };
    };

    // Assemble static layers
    const staticBase = base.join('');
    const staticBack = backStruct.join('');
    const staticFront = frontStruct.join('');
    const tl = timeline(p, s, 5);

    return {
      viewBox: [VW, VH],
      layers: [
        { s: staticBase + staticBack },
        {
          // Dynamic spring rear coils
          d(st) {
            return springSvg(st.dx).back;
          },
        },
        {
          // Dynamic shuttle moving group
          d(st) {
            return `<g transform="${k.translateAlong(P, [st.dx, 0, 0])}">${shuttleStaticSvg}</g>`;
          },
        },
        {
          // Dynamic spring front coils
          d(st) {
            return springSvg(st.dx).front;
          },
        },
        {
          // Dynamic tokens: inside stack, falling down chute, or arriving
          d(st) {
            const out = [];

            // 1. Stacked tokens inside the column (painted bottom to top)
            for (let i = 0; i < st.stack.length; i++) {
              const item = st.stack[i];
              out.push(drawToken(item.x, item.y, item.z, item.alpha, item.accent));
            }

            // 2. Token currently being ejected by shuttle
            if (st.discharged) {
              out.push(drawToken(st.discharged.x, st.discharged.y, st.discharged.z, st.discharged.alpha, st.discharged.accent));
            }

            // 3. Inflow token (trickle refill or overflow roll)
            if (st.inflow) {
              out.push(drawToken(st.inflow.x, st.inflow.y, st.inflow.z, st.inflow.alpha, st.inflow.accent));
            }

            return out.join('');
          },
        },
        { s: staticFront },
        {
          // Accent indicators (denied gate flash or overflow weir outline)
          d(st) {
            const out = [];
            if (st.denied > 0.05) {
              const ring = k.ring(st.dx, 0, R_TOK + 1.2, Z_SLIDE_BED + 12.5, P, 32);
              out.push(`<path class="mm-accent" opacity="${st.denied.toFixed(2)}" d="${ring}"/>`);
            }
            if (st.overflowFlash > 0.05) {
              const weir = k.slabOf(OVERFLOW_CHUTE, TOWER_TOP - 7, 3, P, 2);
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

        // Current committed count
        for (const ev of tl.events) {
          if (t >= ev.tCommit) count = ev.to;
        }

        // Active animated event
        for (const ev of tl.events) {
          const u = (t - ev.t) / ev.dur;
          if (u < 0 || u > 1) continue;

          if (ev.type === 'req') {
            const travel = 28;
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
              tag = 'BURST 1';
              tagIn = hump(u);
              if (u <= 0.46) {
                // Token travels rightward inside the shuttle
                discharged = { x: push * travel, y: 0, z: TOWER_Z0, alpha: 1, accent: u > 0.28 };
              } else {
                // Drops forward-right into catch tray
                const dropU = (u - 0.46) / 0.54;
                const tx = travel + 6 * glide(dropU);
                const ty = -24 * glide(dropU);
                const tz = TOWER_Z0 - 10 * glide(dropU);
                discharged = { x: tx, y: ty, z: tz, alpha: 1 - 0.6 * smooth(0.85, 1.0, dropU), accent: false };
              }
            } else {
              denied = hump((u - 0.15) / 0.7);
              tag = 'DENIED';
              tagIn = smooth(0.18, 0.42, u);
            }
          } else if (ev.type === 'refill') {
            if (!ev.overflow) {
              tag = 'REFILLED';
              tagIn = smooth(0.3, 0.55, u);
              // Token arrives into top funnel and drops cleanly down column
              if (u < 0.4) {
                const enterU = u / 0.4;
                const zPos = (TOWER_TOP + 18) - 14 * glide(enterU);
                inflow = { x: 0, y: 0, z: zPos, alpha: smooth(0.0, 0.3, enterU), accent: false };
              } else {
                const dropU = (u - 0.4) / 0.6;
                const zTarget = TOWER_Z0 + ev.from * H_TOK;
                const zStart = TOWER_TOP + 4;
                const zPos = zStart - (zStart - zTarget) * glide(dropU);
                inflow = { x: 0, y: 0, z: zPos, alpha: 1, accent: dropU > 0.85 };
              }
            } else {
              overflowFlash = hump(u);
              tag = 'OVERFLOW';
              tagIn = smooth(0.25, 0.5, u);
              // Token reaches top of full column and spills down overflow chute
              if (u < 0.35) {
                const enterU = u / 0.35;
                const zPos = (TOWER_TOP + 16) - 12 * glide(enterU);
                inflow = { x: 0, y: 0, z: zPos, alpha: 1, accent: false };
              } else {
                const spillU = (u - 0.35) / 0.65;
                const sx = 20 * glide(spillU);
                const sy = 16 * glide(spillU);
                const sz = (TOWER_TOP + 4) - 26 * glide(spillU);
                inflow = { x: sx, y: sy, z: sz, alpha: 1 - 0.7 * smooth(0.85, 1.0, spillU), accent: true };
              }
            }
          }
        }

        // Populate visible stack
        const stack = [];
        for (let i = 0; i < count; i++) {
          const zPos = TOWER_Z0 + i * H_TOK;
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
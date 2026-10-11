(function (root) {
  'use strict';
  const M_ = root.MM_MACHINES;
  if (!M_) return;
  const { glide, hump, smooth, clamp01 } = M_.util;

  const AZIMUTH = 62;
  const ELEVATION = 22;
  const VW = 1000;
  const VH = 580;
  const PAD = 10;
  const HEADROOM = 44;

  function normalize(params, state) {
    const lanes = 3;
    const holder = Math.max(0, Math.min(lanes - 1, Math.round(Number(state.holder ?? 0))));
    const contending = Math.max(0, Math.min(lanes, Math.round(Number(state.contending ?? 1))));
    const action = ['acquire', 'contend', 'handover', 'idle'].includes(state.action)
      ? state.action
      : 'contend';

    const clip = (s, n) => (typeof s === 'string' ? s.trim().slice(0, n) : '');
    return {
      p: {
        lanes,
        label: clip(params.label, 26) || 'MUTEX INTERLOCK',
        readout: clip(params.readout, 20) || 'LOCK STATE',
      },
      s: {
        holder,
        contending,
        action,
        nextHolder: Math.max(0, Math.min(lanes - 1, Math.round(Number(state.nextHolder ?? (holder + 1) % lanes)))),
      },
    };
  }

  function build(p, s) {
    const { k, G } = root.ANATOMY;

    // --- Geometry Layout (world units) ---
    // 3 parallel lanes along X, separated in Y at -26, 0, +26
    const LANES_Y = [-26, 0, 26];
    const N = LANES_Y.length;

    const BASE_PLAN = { x: -74, y: -46, w: 114, d: 92, r: 6 };
    const BASE_H = 6;
    const FOOT_H = 3;

    // Structural datum positions along X
    const REAR_X = -64;
    const CAR_REST_X = -36;
    const CAR_W = 18;
    const CAR_D = 16;
    const CAR_H = 7.5;
    const TONGUE_W = 24;
    const ROD_Z = 12;
    const GATE_X = 16;
    const ANVIL_X = 26;

    const EXTREMES = [
      ...k.boxCorners(BASE_PLAN, -BASE_H - FOOT_H, 0),
      [BASE_PLAN.x, BASE_PLAN.y, 24],
      [BASE_PLAN.x + BASE_PLAN.w, BASE_PLAN.y + BASE_PLAN.d, 24],
      [GATE_X, 36, 22],
      [ANVIL_X, -36, 22],
    ];

    const P = k.fitProjection(EXTREMES, VW, VH, { pad: PAD, headroom: HEADROOM, azimuth: AZIMUTH, elevation: ELEVATION });
    const at = (pt) => k.iso(pt, P);
    const S = (paths, style) => k.solidSvg(paths, style);
    const L = (d, style) => k.lineSvg(d, style);
    const D = (pts, style) => k.dotsSvg(pts, style);

    // Coordinate frames
    const FX = G.frameOf([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);

    // --- Static Base and Structure ---
    const baseList = [];

    // Base shadow
    baseList.push(`<path class="iso-halo" style="filter:blur(8px);transform:translateY(3px)" d="${k.haloOf(BASE_PLAN, -BASE_H - FOOT_H, BASE_H, P)}"/>`);

    // Four corner levelling riser feet
    const feetLocs = k.corners(BASE_PLAN, 8);
    for (const [fx, fy] of feetLocs) {
      baseList.push(S(k.cylinder(fx, fy, 5, -BASE_H - FOOT_H, 1.2, P, 20), { tone: 'lo' }));
      baseList.push(S(k.cylinder(fx, fy, 3.8, -BASE_H - FOOT_H + 1.2, FOOT_H - 1.2, P, 20), { tone: 'mid' }));
    }

    // Main cast base plate
    baseList.push(S(k.slabOf(BASE_PLAN, -BASE_H, BASE_H, P, 8, 1.2), { tone: 'lo' }));

    // Inset perimeter oil gutter
    baseList.push(L(k.planOutline(k.insetPlan(BASE_PLAN, 4), 0, P), { tone: 'faint' }));

    // Corner fastener rings and dots
    const cornerScrews = k.corners(BASE_PLAN, 5.5);
    baseList.push(L(cornerScrews.map(([sx, sy]) => k.ring(sx, sy, 1.5, 0, P, 16)).join(''), { tone: 'lo' }));
    baseList.push(D(cornerScrews.map(([sx, sy]) => at([sx, sy, 0])), { size: 0.85, tone: 'mid' }));

    // Structure: Rear headstock bridge
    const REAR_BAR = { x: REAR_X - 4, y: -36, w: 6, d: 72, r: 2 };
    baseList.push(S(k.slabOf(REAR_BAR, 0, 16, P, 4, 0.8), { tone: 'mid' }));

    // Structure: Mid guide plate (supports rod ends just before gate)
    const MID_BAR = { x: GATE_X - 8, y: -36, w: 4, d: 72, r: 2 };
    baseList.push(S(k.slabOf(MID_BAR, 0, 15, P, 4, 0.8), { tone: 'mid' }));

    // Structure: Transverse Way Bed for sliding lock gate
    const WAY_BED = { x: GATE_X - 4, y: -40, w: 8, d: 80, r: 2 };
    baseList.push(S(k.slabOf(WAY_BED, 0, 4.5, P, 4, 0.6), { tone: 'mid' }));
    baseList.push(S(k.slabOf({ x: GATE_X - 4, y: -40, w: 1.6, d: 80, r: 1 }, 4.5, 2.2, P, 2), { tone: 'lo' }));
    baseList.push(S(k.slabOf({ x: GATE_X + 2.4, y: -40, w: 1.6, d: 80, r: 1 }, 4.5, 2.2, P, 2), { tone: 'lo' }));

    // Structure: Work Anvil Bridge at far right
    const ANVIL_BRIDGE = { x: ANVIL_X - 2.5, y: -34, w: 6.5, d: 68, r: 2 };
    baseList.push(S(k.slabOf(ANVIL_BRIDGE, 0, 18, P, 4, 0.8), { tone: 'mid' }));

    // Three contact anvils (the critical section target)
    for (let i = 0; i < N; i++) {
      const ly = LANES_Y[i];
      const strikePad = k.cylinder(ANVIL_X, ly, 3, 7.5, 6, P, 16);
      baseList.push(S(strikePad, { tone: 'hi', crease: 'lo' }));
    }

    // Guide Rods: Each lane has two parallel rods (Z=ROD_Z, Y offset +/- 5)
    for (let i = 0; i < N; i++) {
      const ly = LANES_Y[i];
      const F_UP = G.frameAlong([0, ly + 5, ROD_Z], [1, 0, 0]);
      const F_LO = G.frameAlong([0, ly - 5, ROD_Z], [1, 0, 0]);
      baseList.push(S(G.disc(REAR_X - 2, GATE_X - 4, 1.3, F_UP, P, { steps: 16 }), { tone: 'mid', crease: 'none' }));
      baseList.push(S(G.disc(REAR_X - 2, GATE_X - 4, 1.3, F_LO, P, { steps: 16 }), { tone: 'mid', crease: 'none' }));
    }

    // --- Dynamic Geometry Helpers ---
    const carGlyphMatrix = (cx, cy, cz) => {
      const o = at([cx, cy, cz]);
      const ex = at([cx + 1, cy, cz]);
      const ey = at([cx, cy + 1, cz]);
      const dx = [ex[0] - o[0], ex[1] - o[1]];
      const dy = [ey[0] - o[0], ey[1] - o[1]];
      return `matrix(${dx[0].toFixed(4)} ${dx[1].toFixed(4)} ${dy[0].toFixed(4)} ${dy[1].toFixed(4)} ${o[0].toFixed(1)} ${o[1].toFixed(1)})`;
    };

    function carriageSvg(laneIdx, strokeX, isHolding, isContending) {
      const curX = CAR_REST_X + strokeX;
      const ly = LANES_Y[laneIdx];
      const out = [];

      // Helical compression spring behind carriage
      // Note: coil takes scalar numeric start and end along the axis
      const springX0 = REAR_X + 2;
      const springX1 = curX;
      if (springX1 > springX0 + 3) {
        const coils = k.coil(springX0, springX1, [ly, ROD_Z], 3.6, 5, 'x', P);
        if (coils && coils.back) out.push(L(coils.back, { tone: 'lo' }));
        if (coils && coils.front) out.push(L(coils.front, { tone: 'mid' }));
      }

      // Carriage block
      const CAR_PLAN = { x: curX, y: ly - CAR_D / 2, w: CAR_W, d: CAR_D, r: 2.2 };
      const carSlab = k.slabOf(CAR_PLAN, 4, CAR_H, P, 4, 0.6);
      out.push(S(carSlab, { tone: isHolding ? 'hi' : 'mid', lit: isHolding }));

      // Engraved thread identifier glyph on carriage top face
      const txtX = curX + CAR_W / 2;
      const txtM = carGlyphMatrix(txtX, ly, 4 + CAR_H + 0.1);
      const glyphTag = isHolding ? 'sign' : isContending ? '' : 'off';
      out.push(`<text class="mm-glyph"${glyphTag ? ` data-g="${glyphTag}"` : ''} transform="${txtM}" font-size="6" y="2.2">T${laneIdx}</text>`);

      // Front latch tongue
      const tonguePlan = { x: curX + CAR_W, y: ly - 2.5, w: TONGUE_W, d: 5, r: 1 };
      const tongueSolid = k.slabOf(tonguePlan, 7, 4.5, P, 2, 0.4);
      out.push(S(tongueSolid, { tone: isHolding ? 'hi' : 'mid', lit: isHolding }));

      // Accent highlight stroke if holding mutex
      if (isHolding) {
        out.push(`<path class="mm-accent" d="${carSlab.outline}"/>`);
      }

      return out.join('');
    }

    function gateSvg(gateY, activeHolder) {
      const out = [];
      const CHEEK_D = 22;
      const SLOT_D = 8.2;
      const GATE_H = 13;

      // Lower cheek
      const c1Plan = { x: GATE_X - 2.8, y: gateY - SLOT_D / 2 - CHEEK_D, w: 5.6, d: CHEEK_D, r: 1.4 };
      out.push(S(k.slabOf(c1Plan, 4, GATE_H, P, 3, 0.5), { tone: 'mid' }));

      // Upper cheek
      const c2Plan = { x: GATE_X - 2.8, y: gateY + SLOT_D / 2, w: 5.6, d: CHEEK_D, r: 1.4 };
      out.push(S(k.slabOf(c2Plan, 4, GATE_H, P, 3, 0.5), { tone: 'mid' }));

      // Top tie bridge joining both cheeks into a rigid shuttle
      const bridgePlan = { x: GATE_X + 1, y: gateY - SLOT_D / 2 - 3, w: 2.4, d: SLOT_D + 6, r: 1 };
      out.push(S(k.slabOf(bridgePlan, 13.5, 3.5, P, 2, 0.4), { tone: 'lo' }));

      // Gate position indicator needle
      const ptrPlan = { x: GATE_X - 4, y: gateY - 1.2, w: 1.4, d: 2.4, r: 0.5 };
      out.push(S(k.slabOf(ptrPlan, 9, 1.8, P, 2), { tone: 'hi' }));

      // Transverse rack drive rod
      const FRack = G.frameAlong([GATE_X - 0.2, gateY - 30, 2], [0, 1, 0]);
      out.push(S(G.disc(0, 60, 1.2, FRack, P, { steps: 12 }), { tone: 'lo', crease: 'none' }));

      // Hardened interlock detent pin
      if (activeHolder >= 0) {
        const lockPin = k.cylinder(GATE_X, gateY - 6.5, 1.6, 17, 3, P, 16);
        out.push(S(lockPin, { tone: 'hi' }));
      }

      return out.join('');
    }

    const staticBg = baseList.join('');

    return {
      viewBox: [VW, VH],
      layers: [
        { s: staticBg },
        {
          d: (st) => {
            const out = [];
            // Paint carriages ordered from back lane to front lane
            for (let i = 0; i < N; i++) {
              out.push(carriageSvg(i, st.carX[i], st.holding[i], st.contending[i]));
            }
            // Gate shuttle drawn in place
            out.push(gateSvg(st.gateY, st.activeHolder));
            return out.join('');
          },
        },
      ],
      meta: {
        corner: `${N} THREADS · 1 LOCK`,
        label: p.label,
        accent: null,
      },
      at(t, span = 5) {
        const T0 = 0.7;
        const T1 = 2.4;
        const T2 = 3.6;
        const T3 = Math.max(T2 + 0.4, span - 0.7);

        const carX = [0, 0, 0];
        const holding = [false, false, false];
        const contending = [false, false, false];
        let activeHolder = s.holder;
        let gateY = LANES_Y[s.holder];

        if (s.action === 'acquire') {
          // Holder advances through the gate slot to strike the anvil
          const uAcq = glide((t - T0) / (T1 - T0));
          carX[s.holder] = uAcq * 18;
          holding[s.holder] = uAcq > 0.8;
          activeHolder = s.holder;
          gateY = LANES_Y[s.holder];
        } else if (s.action === 'contend') {
          // Current holder holds the lock in critical section
          carX[s.holder] = 18;
          holding[s.holder] = true;
          activeHolder = s.holder;
          gateY = LANES_Y[s.holder];

          // Competing thread 1 attempts to enter but is blocked by gate cheek
          const waitLane = (s.holder + 1) % N;
          const uContend = glide((t - T0) / (T1 - T0));
          carX[waitLane] = uContend * 7;
          contending[waitLane] = uContend > 0.3;

          // Competing thread 2 also contends if requested
          if (s.contending > 1) {
            const waitLane2 = (s.holder + 2) % N;
            const uContend2 = glide((t - (T0 + 0.3)) / (T1 - T0));
            carX[waitLane2] = uContend2 * 7;
            contending[waitLane2] = uContend2 > 0.3;
          }
        } else if (s.action === 'handover') {
          // Current holder releases; gate shuttles to next holder; waiter acquires
          const next = s.nextHolder;
          const uRetract = glide((t - T0) / (1.4 - T0));
          const uShift = glide((t - 1.4) / (2.5 - 1.4));
          const uAcquire = glide((t - 2.5) / (T3 - 2.5));

          carX[s.holder] = (1 - uRetract) * 18;
          holding[s.holder] = uRetract < 0.9;

          const fromY = LANES_Y[s.holder];
          const toY = LANES_Y[next];
          gateY = fromY + (toY - fromY) * uShift;

          const initialWaitX = 7;
          carX[next] = initialWaitX + (18 - initialWaitX) * uAcquire;
          contending[next] = uAcquire < 0.2;
          holding[next] = uAcquire > 0.8;
          activeHolder = uShift > 0.5 ? next : s.holder;
        } else {
          carX[s.holder] = 18;
          holding[s.holder] = true;
          activeHolder = s.holder;
          gateY = LANES_Y[s.holder];
        }

        return {
          carX,
          holding,
          contending,
          activeHolder,
          gateY,
          t,
        };
      },
      readout(st) {
        if (s.action === 'contend') {
          const contCount = st.contending.filter(Boolean).length;
          return {
            label: p.readout,
            value: contCount > 0 ? `BLOCKED (${contCount})` : 'HELD',
            tag: contCount > 0 ? 'CONTENTION' : '',
            tagIn: contCount > 0 ? 1 : 0,
          };
        } else if (s.action === 'handover') {
          const handed = st.holding[s.nextHolder];
          return {
            label: p.readout,
            value: handed ? `ACQUIRED T${s.nextHolder}` : 'HANDOVER',
            tag: handed ? 'GRANTED' : '',
            tagIn: handed ? 1 : 0,
          };
        } else if (s.action === 'acquire') {
          const acquired = st.holding[s.holder];
          return {
            label: p.readout,
            value: acquired ? `HELD BY T${s.holder}` : 'ACQUIRING',
            tag: acquired ? 'LOCKED' : '',
            tagIn: acquired ? 1 : 0,
          };
        }
        return {
          label: p.readout,
          value: `HELD BY T${s.holder}`,
          tag: '',
          tagIn: 0,
        };
      },
    };
  }

  M_.register('mutex-gate', { normalize, build });
})(typeof window !== 'undefined' ? window : globalThis);
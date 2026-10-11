MAPPING: Three spring-loaded follower carriages queue along parallel guide rails against a transverse sliding lock gate whose single slot admits only one carriage at a time to the work anvil, holding the others compressed and blocked in contention.
PARTS: Base plate, four corner riser feet, four knurled levelling thumbscrews, perimeter oil groove, two bridge headstocks, three twin guide-rod pairs, six bronze rod bushings, three follower carriages, three carriage index plates, three compression springs, three drive pins, three latch tongues, transverse slide way, transverse locking gate block with hardened entry slot, two transverse way clamps, gate drive link, gate bellcrank, bellcrank pivot pin, gate detent rack, work anvil bridge, critical-section strike anvil, two tie bars, and six guide rod end stops.
KIND: mutex-gate

```javascript
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
    // Lanes run along X (from X = -70 to X = 50).
    // Lane separation in Y: 3 lanes at Y = -28, Y = 0, Y = +28.
    // Transverse lock gate slides in Y at X = 20.
    // Critical work anvil sits at X = 48.
    const LANES_Y = [-28, 0, 28];
    const N = LANES_Y.length;

    const BASE_PLAN = { x: -84, y: -48, w: 146, d: 96, r: 6 };
    const BASE_H = 6;
    const FOOT_H = 3;

    // Headstocks
    const REAR_X = -72;
    const FRONT_X = 14;
    const GATE_X = 22;
    const ANVIL_X = 48;
    const ROD_Z = 12;
    const BUSH_W = 10;
    const BUSH_R = 3.6;
    const CAR_W = 22;
    const CAR_D = 18;
    const CAR_H = 7.5;

    const EXTREMES = [
      ...k.boxCorners(BASE_PLAN, -BASE_H - FOOT_H, 0),
      [BASE_PLAN.x, BASE_PLAN.y, 28],
      [BASE_PLAN.x + BASE_PLAN.w, BASE_PLAN.y + BASE_PLAN.d, 28],
    ];

    const P = k.fitProjection(EXTREMES, VW, VH, { pad: PAD, headroom: HEADROOM, azimuth: AZIMUTH, elevation: ELEVATION });
    const at = (pt) => k.iso(pt, P);
    const S = (paths, style) => k.solidSvg(paths, style);
    const L = (d, style) => k.lineSvg(d, style);
    const D = (pts, style) => k.dotsSvg(pts, style);

    // Coordinate frames
    const FX = G.frameOf([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]); // prism in YZ extruded along X
    const FY = G.frameOf([0, 0, 0], [0, 1, 0], [1, 0, 0], [0, 0, 1]); // prism in XZ extruded along Y

    // --- Static Layer Elements ---
    const baseList = [];

    // Base halo shadow
    baseList.push(`<path class="iso-halo" style="filter:blur(8px);transform:translateY(3px)" d="${k.haloOf(BASE_PLAN, -BASE_H - FOOT_H, BASE_H, P)}"/>`);

    // Four corner levelling feet
    const feetLocs = k.corners(BASE_PLAN, 8);
    for (const [fx, fy] of feetLocs) {
      baseList.push(S(k.cylinder(fx, fy, 5.2, -BASE_H - FOOT_H, 1.2, P, 20), { tone: 'lo' }));
      baseList.push(S(k.cylinder(fx, fy, 3.8, -BASE_H - FOOT_H + 1.2, FOOT_H - 1.2, P, 20), { tone: 'mid' }));
    }

    // Main base slab
    baseList.push(S(k.slabOf(BASE_PLAN, -BASE_H, BASE_H, P, 8, 1.2), { tone: 'lo' }));

    // Inset perimeter oil groove
    baseList.push(L(k.planOutline(k.insetPlan(BASE_PLAN, 4.2), 0, P), { tone: 'faint' }));

    // Corner screw rings and rivets
    const cornerScrews = k.corners(BASE_PLAN, 5.5);
    baseList.push(L(cornerScrews.map(([sx, sy]) => k.ring(sx, sy, 1.5, 0, P, 16)).join(''), { tone: 'lo' }));
    baseList.push(D(cornerScrews.map(([sx, sy]) => at([sx, sy, 0])), { size: 0.85, tone: 'mid' }));

    // Structure: Rear Headstock Bar across all lanes
    const REAR_BAR = { x: REAR_X - 4, y: -38, w: 7, d: 76, r: 2 };
    baseList.push(S(k.slabOf(REAR_BAR, 0, 16, P, 4, 0.8), { tone: 'mid' }));

    // Structure: Mid Headstock Bar (guides front ends of ram rods)
    const MID_BAR = { x: FRONT_X, y: -38, w: 6, d: 76, r: 2 };
    baseList.push(S(k.slabOf(MID_BAR, 0, 16, P, 4, 0.8), { tone: 'mid' }));

    // Structure: Transverse Way Bed for the sliding lock gate
    const WAY_BED = { x: GATE_X - 4.5, y: -42, w: 9, d: 84, r: 2 };
    baseList.push(S(k.slabOf(WAY_BED, 0, 5, P, 4, 0.6), { tone: 'mid' }));
    // Transverse way guide rails (front and back stops)
    baseList.push(S(k.slabOf({ x: GATE_X - 4.5, y: -42, w: 1.8, d: 84, r: 1 }, 5, 2.5, P, 2), { tone: 'lo' }));
    baseList.push(S(k.slabOf({ x: GATE_X + 2.7, y: -42, w: 1.8, d: 84, r: 1 }, 5, 2.5, P, 2), { tone: 'lo' }));

    // Structure: Work Anvil Bridge at far right
    const ANVIL_BRIDGE = { x: ANVIL_X - 3, y: -36, w: 8, d: 72, r: 2 };
    baseList.push(S(k.slabOf(ANVIL_BRIDGE, 0, 18, P, 4, 0.8), { tone: 'mid' }));

    // Three hardened contact strike anvils mounted on the bridge
    for (let i = 0; i < N; i++) {
      const ly = LANES_Y[i];
      const strikePad = k.cylinder(ANVIL_X, ly, 3.2, 8, 8, P, 16);
      baseList.push(S(strikePad, { tone: 'hi', crease: 'lo' }));
    }

    // Guide Rods: Each lane has two solid stainless rods (upper Z=12, offset Y +/- 5.5)
    for (let i = 0; i < N; i++) {
      const ly = LANES_Y[i];
      const rodUpperY = ly + 5.5;
      const rodLowerY = ly - 5.5;
      const F_UP = G.frameAlong([0, rodUpperY, ROD_Z], [1, 0, 0]);
      const F_LO = G.frameAlong([0, rodLowerY, ROD_Z], [1, 0, 0]);
      baseList.push(S(G.disc(REAR_X - 2, FRONT_X + 4, 1.4, F_UP, P, { steps: 16 }), { tone: 'mid', crease: 'none' }));
      baseList.push(S(G.disc(REAR_X - 2, FRONT_X + 4, 1.4, F_LO, P, { steps: 16 }), { tone: 'mid', crease: 'none' }));
    }

    // --- Dynamic Mechanism Builders ---
    // 1. Sliding Carriages (Threads)
    // Travel: at rest X_car = -40; when holding lock X_car = -14 (enters slot and touches anvil);
    // when blocked in contention X_car = -23 (strikes lock block, spring compressed).

    const carGlyphMatrix = (cx, cy, cz) => {
      const o = at([cx, cy, cz]);
      const ex = at([cx + 1, cy, cz]);
      const ey = at([cx, cy + 1, cz]);
      const dx = [ex[0] - o[0], ex[1] - o[1]];
      const dy = [ey[0] - o[0], ey[1] - o[1]];
      return `matrix(${dx[0].toFixed(4)} ${dx[1].toFixed(4)} ${dy[0].toFixed(4)} ${dy[1].toFixed(4)} ${o[0].toFixed(1)} ${o[1].toFixed(1)})`;
    };

    function carriageSvg(laneIdx, strokeX, isHolding, isContending) {
      // Base resting X is -42. strokeX in [0, 28].
      const curX = -42 + strokeX;
      const ly = LANES_Y[laneIdx];
      const out = [];

      // Buffer coil spring behind carriage
      const coilLength = Math.max(8, (curX - (REAR_X + 3)));
      const F_SP = G.frameAlong([REAR_X + 3, ly, ROD_Z], [1, 0, 0]);
      const coils = k.coil([REAR_X + 3, ly, ROD_Z], [curX, ly, ROD_Z], [ly, ROD_Z], 4.2, 5, 'x', P);
      if (coils && coils.back) out.push(L(coils.back, { tone: 'lo' }));

      // Carriage solid body
      const CAR_PLAN = { x: curX, y: ly - CAR_D / 2, w: CAR_W, d: CAR_D, r: 2.5 };
      const carSlab = k.slabOf(CAR_PLAN, 4, CAR_H, P, 4, 0.6);
      out.push(S(carSlab, { tone: isHolding ? 'hi' : 'mid', lit: isHolding }));

      // Engraved Thread Label on Carriage Top
      const txtX = curX + CAR_W / 2;
      const txtM = carGlyphMatrix(txtX, ly, 4 + CAR_H + 0.1);
      const glyphTag = isHolding ? 'sign' : isContending ? '' : 'off';
      out.push(`<text class="mm-glyph"${glyphTag ? ` data-g="${glyphTag}"` : ''} transform="${txtM}" font-size="6.5" y="2.4">T${laneIdx}</text>`);

      // Front extension tongue / probe (extends forward into the lock gate)
      const tonguePlan = { x: curX + CAR_W, y: ly - 2.8, w: 22, d: 5.6, r: 1.2 };
      const tongueSolid = k.slabOf(tonguePlan, 7, 5, P, 2, 0.4);
      out.push(S(tongueSolid, { tone: isHolding ? 'hi' : 'mid', lit: isHolding }));

      // Front spring coil half
      if (coils && coils.front) out.push(L(coils.front, { tone: 'hi' }));

      // Outline accent if holding lock
      if (isHolding) {
        out.push(`<path class="mm-accent" d="${carSlab.outline}"/>`);
      }

      return out.join('');
    }

    // 2. Transverse Lock Gate (The Mutex)
    // The gate has a block of length 48, with a central keyway slot (width 8.4) aligned to gateY.
    // When holding or acquired, gateY aligns with the active lane.
    function gateSvg(gateY, lockedByLane) {
      const out = [];
      // Gate consists of two hardened shuttle cheeks leaving a slot of 8.6 in the middle
      const CHEEK_D = 24;
      const SLOT_D = 8.6;
      const GATE_H = 14;

      // Lower Cheek
      const c1Plan = { x: GATE_X - 3.2, y: gateY - SLOT_D / 2 - CHEEK_D, w: 6.4, d: CHEEK_D, r: 1.5 };
      out.push(S(k.slabOf(c1Plan, 4, GATE_H, P, 3, 0.5), { tone: 'mid' }));

      // Upper Cheek
      const c2Plan = { x: GATE_X - 3.2, y: gateY + SLOT_D / 2, w: 6.4, d: CHEEK_D, r: 1.5 };
      out.push(S(k.slabOf(c2Plan, 4, GATE_H, P, 3, 0.5), { tone: 'mid' }));

      // Connecting bridge on the far side so both cheeks slide together as one piece
      const bridgePlan = { x: GATE_X + 1.2, y: gateY - SLOT_D / 2 - 4, w: 2.8, d: SLOT_D + 8, r: 1 };
      out.push(S(k.slabOf(bridgePlan, 14, 4, P, 2, 0.4), { tone: 'lo' }));

      // Sliding gate index pointer / dial marker
      const ptrPlan = { x: GATE_X - 4.5, y: gateY - 1.4, w: 1.5, d: 2.8, r: 0.5 };
      out.push(S(k.slabOf(ptrPlan, 10, 2, P, 2), { tone: 'hi' }));

      // Transverse rack drive rod linked to the gate
      const rackY0 = gateY - 32;
      const FRack = G.frameAlong([GATE_X - 0.2, rackY0, 2], [0, 1, 0]);
      out.push(S(G.disc(0, 64, 1.2, FRack, P, { steps: 12 }), { tone: 'lo', crease: 'none' }));

      if (lockedByLane >= 0) {
        // Subtle lock indicator pin locked down
        const lockPin = k.cylinder(GATE_X, gateY - 7, 1.8, 18, 3.2, P, 16);
        out.push(S(lockPin, { tone: 'hi' }));
      }

      return out.join('');
    }

    // Merge static background elements
    const staticBg = baseList.join('');

    return {
      viewBox: [VW, VH],
      layers: [
        { s: staticBg },
        // Dynamic layer: Gate and Carriages sorted back-to-front
        {
          d: (st) => {
            const out = [];
            // Draw carriages and gate in world Y order (Y goes negative to positive, sorted)
            // Back lane (0: Y=-28), Mid lane (1: Y=0), Front lane (2: Y=+28)
            for (let i = 0; i < N; i++) {
              out.push(carriageSvg(i, st.carX[i], st.holding[i], st.contending[i]));
            }
            // Transverse gate sits at GATE_X, overlaying the lanes
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
        // Timeline breakdown:
        // 0.0 - 0.7s : Rest / cut in
        // 0.7 - 2.6s : Primary action (contention, acquisition, handover)
        // 2.6 - 4.2s : Critical section work / wait stall
        // 4.2 - span : Settle
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
          // Holder advances from rest to lock, entering gate and striking anvil
          const uAcq = glide((t - T0) / (T1 - T0));
          carX[s.holder] = uAcq * 28; // reaches anvil
          holding[s.holder] = uAcq > 0.8;
          activeHolder = s.holder;
          gateY = LANES_Y[s.holder];
        } else if (s.action === 'contend') {
          // Holder is already holding the lock in critical section
          carX[s.holder] = 28;
          holding[s.holder] = true;
          activeHolder = s.holder;
          gateY = LANES_Y[s.holder];

          // Competing thread (or threads) attempt to advance
          const waitLane = (s.holder + 1) % N;
          const uContend = glide((t - T0) / (T1 - T0));
          // Blocked ram stops at the gate face (stroke ~ 17 instead of 28)
          carX[waitLane] = uContend * 17;
          contending[waitLane] = uContend > 0.3;

          if (s.contending > 1) {
            const waitLane2 = (s.holder + 2) % N;
            const uContend2 = glide((t - (T0 + 0.3)) / (T1 - T0));
            carX[waitLane2] = uContend2 * 17;
            contending[waitLane2] = uContend2 > 0.3;
          }
        } else if (s.action === 'handover') {
          // Holder retracts (releases lock), gate shuttles to nextHolder, nextHolder fires in!
          const next = s.nextHolder;
          const uRetract = glide((t - T0) / (1.4 - T0));
          const uShift = glide((t - 1.4) / (2.5 - 1.4));
          const uAcquire = glide((t - 2.5) / (T3 - 2.5));

          // Retract current holder
          carX[s.holder] = (1 - uRetract) * 28;
          holding[s.holder] = uRetract < 0.9;

          // Gate shifts from holder Y to nextHolder Y
          const fromY = LANES_Y[s.holder];
          const toY = LANES_Y[next];
          gateY = fromY + (toY - fromY) * uShift;

          // Next holder was waiting at the gate, then snaps forward into the slot
          const initialWaitX = 17;
          carX[next] = initialWaitX + (28 - initialWaitX) * uAcquire;
          contending[next] = uAcquire < 0.2;
          holding[next] = uAcquire > 0.8;
          activeHolder = uShift > 0.5 ? next : s.holder;
        } else {
          // Idle state
          carX[s.holder] = 28;
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
```

```json
{
  "scenes": [
    {
      "headline": "Thread zero takes the lock.",
      "subhead": "ram engages the single slot",
      "params": {
        "label": "MUTEX INTERLOCK",
        "readout": "LOCK STATUS"
      },
      "state": {
        "holder": 0,
        "action": "acquire",
        "contending": 0
      }
    },
    {
      "headline": "Thread one hits the wall.",
      "subhead": "gate pinned, ram stalled",
      "params": {
        "label": "MUTEX INTERLOCK",
        "readout": "LOCK STATUS"
      },
      "state": {
        "holder": 0,
        "action": "contend",
        "contending": 1
      }
    },
    {
      "headline": "Contention stalls every queue.",
      "subhead": "two threads wait on one",
      "params": {
        "label": "MUTEX INTERLOCK",
        "readout": "LOCK STATUS"
      },
      "state": {
        "holder": 0,
        "action": "contend",
        "contending": 2
      }
    },
    {
      "headline": "Release unlocks the next waiter.",
      "subhead": "gate shifts, thread one enters",
      "params": {
        "label": "MUTEX INTERLOCK",
        "readout": "LOCK STATUS"
      },
      "state": {
        "holder": 0,
        "nextHolder": 1,
        "action": "handover",
        "contending": 1
      }
    }
  ]
}
```
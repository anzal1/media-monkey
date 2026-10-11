(function (root) {
  'use strict';
  const M_ = root.MM_MACHINES;
  if (!M_) return;
  const { glide, hump, smooth, clamp01 } = M_.util;

  const AZIMUTH = 58;
  const ELEVATION = 24;
  const VW = 1000;
  const VH_MIN = 480;
  const VH_MAX = 660;
  const PAD = 14;
  const HEADROOM = 44;

  const ARRAY_VALUES = [14, 28, 35, 49, 62, 73, 85, 96];
  const N_ITEMS = ARRAY_VALUES.length; // 8

  function normalize(params, state) {
    const target = Number.isFinite(Number(params.target))
      ? Math.round(Number(params.target))
      : 73;

    const step = Math.max(0, Math.min(3, Math.round(Number(state.step || 0))));
    const label = typeof params.label === 'string' && params.label.trim()
      ? params.label.trim().slice(0, 26)
      : 'BINARY COMPARATOR';
    const readout = typeof params.readout === 'string' && params.readout.trim()
      ? params.readout.trim().slice(0, 24)
      : 'INDEX PROBE';

    return {
      p: { target, label, readout },
      s: { step },
    };
  }

  // Pre-computed search steps for the canonical target 73:
  // Step 0: [0, 7] -> Mid = 3 (val 49, low)
  // Step 1: [4, 7] -> Mid = 5 (val 73, hit!)
  // Step 2: Final lock / verify on 5
  function getPlan(target) {
    let low = 0;
    let high = N_ITEMS - 1;
    const history = [];
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const val = ARRAY_VALUES[mid];
      history.push({ low, high, mid, val, hit: val === target });
      if (val === target) break;
      if (val < target) {
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return history;
  }

  function build(p, s) {
    const { k, G } = root.ANATOMY;

    // Coordinate layout:
    // Array along world X.
    // Slots i = 0..7.
    const PITCH = 38;
    const BLOCK_W = 24;
    const BLOCK_D = 36;
    const BED_X0 = 36;
    const slotX = (i) => BED_X0 + i * PITCH + BLOCK_W / 2;

    const ARRAY_SPAN = (N_ITEMS - 1) * PITCH + BLOCK_W;
    const BED_W = ARRAY_SPAN + 48;
    const BED_D = 72;
    const BED_H = 14;

    const BASE_PLAN = {
      x: BED_X0 - 34,
      y: -BED_D / 2 - 16,
      w: BED_W + 56,
      d: BED_D + 32,
      r: 6,
    };
    const BASE_H = 7;
    const FOOT_H = 3;

    // Rail axes: front rail y = -24, rear rail y = 24, z = BED_H + 10
    const RAIL_Z = BED_H + 11;
    const RAIL_Y_FRONT = -24;
    const RAIL_Y_REAR = 24;
    const RAIL_R = 3.2;
    const RAIL_X0 = BASE_PLAN.x + 8;
    const RAIL_X1 = BASE_PLAN.x + BASE_PLAN.w - 8;

    const EXTREMES = [
      ...k.boxCorners(BASE_PLAN, -BASE_H - FOOT_H, 0),
      [RAIL_X0 - 6, -BED_D / 2, BED_H + 48],
      [RAIL_X1 + 14, BED_D / 2, BED_H + 48],
      [slotX(4), 0, BED_H + 68], // dial indicator top
    ];

    const VH = (() => {
      const flat = EXTREMES.map((pt) =>
        k.iso(pt, { origin: [0, 0], scale: 1, azimuth: AZIMUTH, elevation: ELEVATION })
      );
      const h = Math.max(...flat.map((q) => q[1])) - Math.min(...flat.map((q) => q[1]));
      const w = Math.max(...flat.map((q) => q[0])) - Math.min(...flat.map((q) => q[0]));
      return Math.round(
        Math.max(VH_MIN, Math.min(VH_MAX, (h * (VW - 2 * PAD)) / w + 2 * PAD + HEADROOM))
      );
    })();

    const P = k.fitProjection(EXTREMES, VW, VH, {
      pad: PAD,
      headroom: HEADROOM,
      azimuth: AZIMUTH,
      elevation: ELEVATION,
    });

    const at = (pt) => k.iso(pt, P);
    const S = (paths, style) => k.solidSvg(paths, style);
    const L = (d, style) => k.lineSvg(d, style);
    const D = (pts, style) => k.dotsSvg(pts, style);
    const byDepth = (pts) =>
      [...pts].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));

    // ---------------------------------------------------- Base plate & feet
    const baseLayers = [];
    baseLayers.push(
      `<path class="iso-halo" style="filter:blur(8px);transform:translateY(4px)" d="${k.haloOf(
        BASE_PLAN,
        -BASE_H - FOOT_H,
        BASE_H,
        P
      )}"/>`
    );

    for (const [fx, fy] of byDepth(k.corners(BASE_PLAN, 8))) {
      baseLayers.push(S(k.cylinder(fx, fy, 5.5, -BASE_H - FOOT_H, 1.2, P, 20), { tone: 'lo' }));
      baseLayers.push(S(k.cylinder(fx, fy, 4.2, -BASE_H - FOOT_H + 1.2, FOOT_H - 1.2, P, 20), { tone: 'mid' }));
    }

    baseLayers.push(S(k.slabOf(BASE_PLAN, -BASE_H, BASE_H, P, 8, 1.2), { tone: 'mid' }));
    baseLayers.push(L(k.planOutline(k.insetPlan(BASE_PLAN, 4.5), 0, P), { tone: 'faint' }));

    const baseScrews = k.corners(BASE_PLAN, 7);
    baseLayers.push(L(baseScrews.map(([sx, sy]) => k.ring(sx, sy, 1.8, 0, P, 14)).join(''), { tone: 'lo' }));
    baseLayers.push(D(baseScrews.map(([sx, sy]) => at([sx, sy, 0])), { size: 0.85, tone: 'mid' }));

    // ---------------------------------------------------- Slotted bed
    const BED_PLAN = {
      x: BED_X0 - 10,
      y: -BED_D / 2,
      w: BED_W,
      d: BED_D,
      r: 4,
    };
    baseLayers.push(S(k.slabOf(BED_PLAN, 0, BED_H, P, 6, 1.0), { tone: 'hi' }));

    // Array pockets and ruler ticks along the bed
    for (let i = 0; i < N_ITEMS; i++) {
      const cx = slotX(i);
      const slotPlan = {
        x: cx - BLOCK_W / 2 - 1,
        y: -BLOCK_D / 2 - 1,
        w: BLOCK_W + 2,
        d: BLOCK_D + 2,
        r: 1.5,
      };
      baseLayers.push(L(k.planOutline(slotPlan, BED_H, P), { tone: 'lo' }));
    }
    // Index ticks along front edge of bed
    baseLayers.push(
      L(
        k.topTicks(
          BED_X0,
          BED_X0 + (N_ITEMS - 1) * PITCH,
          PITCH,
          1,
          -BED_D / 2 + 1.5,
          BED_H,
          [2.2, 4.0],
          P,
          'x'
        ).major,
        { tone: 'mid' }
      )
    );

    // ---------------------------------------------------- Uprights & rails
    // Left end upright cheek
    const LEFT_CHEEK = {
      x: BASE_PLAN.x + 8,
      y: -BED_D / 2 - 2,
      w: 8,
      d: BED_D + 4,
      r: 3,
    };
    baseLayers.push(S(k.slabOf(LEFT_CHEEK, BED_H, 24, P, 4, 0.8), { tone: 'mid' }));

    // Right end upright cheek
    const RIGHT_CHEEK = {
      x: BASE_PLAN.x + BASE_PLAN.w - 18,
      y: -BED_D / 2 - 2,
      w: 8,
      d: BED_D + 4,
      r: 3,
    };
    baseLayers.push(S(k.slabOf(RIGHT_CHEEK, BED_H, 24, P, 4, 0.8), { tone: 'mid' }));

    // Guide rails
    const FRONT_RAIL_FRAME = G.frameAlong([RAIL_X0, RAIL_Y_FRONT, RAIL_Z], [1, 0, 0]);
    const REAR_RAIL_FRAME = G.frameAlong([RAIL_X0, RAIL_Y_REAR, RAIL_Z], [1, 0, 0]);
    baseLayers.push(S(G.disc(0, RAIL_X1 - RAIL_X0, RAIL_R, REAR_RAIL_FRAME, P), { tone: 'mid', crease: 'none' }));
    baseLayers.push(S(G.disc(0, RAIL_X1 - RAIL_X0, RAIL_R, FRONT_RAIL_FRAME, P), { tone: 'hi', crease: 'none' }));

    // Lead thumbwheel at right cheek
    const WHEEL_FRAME = G.frameAlong([RIGHT_CHEEK.x + 8, 0, RAIL_Z], [1, 0, 0]);
    baseLayers.push(S(G.disc(0, 7, 10, WHEEL_FRAME, P), {
      tone: 'mid',
      crease: 'lo',
      inner: k.fadedSvg(G.ribsOf(WHEEL_FRAME, 1, 6, 10, 16, P, { fade: [0.1, 0.5] }), { tone: 'lo' }),
    }));

    // ---------------------------------------------------- Stepped gauge blocks
    // Values: ARRAY_VALUES = [14, 28, 35, 49, 62, 73, 85, 96]
    // Height scaled between 9 and 22 units
    const blockSolids = [];
    for (let i = 0; i < N_ITEMS; i++) {
      const val = ARRAY_VALUES[i];
      const bh = 8 + (val / 100) * 15;
      const cx = slotX(i);
      const bPlan = {
        x: cx - BLOCK_W / 2 + 0.5,
        y: -BLOCK_D / 2 + 1,
        w: BLOCK_W - 1,
        d: BLOCK_D - 2,
        r: 1.5,
      };
      const solid = S(k.slabOf(bPlan, BED_H, bh, P, 3, 0.6), { tone: 'hi' });
      // Engraved numeral on top face
      const tMat = k.topMatrix([cx, 0], BED_H + bh, P, 'x');
      const textSvg = `<text class="mm-glyph" transform="${tMat}" font-size="7.5" y="2.6">${val}</text>`;
      // Fine index line on front face of block
      const faceLine = L(k.lineOnTop([cx - BLOCK_W / 2 + 2, -BLOCK_D / 2 + 1], [cx + BLOCK_W / 2 - 2, -BLOCK_D / 2 + 1], BED_H + bh, P), { tone: 'lo' });
      blockSolids.push(solid + textSvg + faceLine);
    }

    // ---------------------------------------------------- Shutter flaps (exclusion masks)
    // When a block is eliminated, an opaque protective shutter plate drops down over it
    const shutterSvg = (i, dropped) => {
      if (dropped <= 0.005) return '';
      const cx = slotX(i);
      const angle = (1 - dropped) * (Math.PI * 0.45); // pivots from 80 deg upright to 0 flat
      const cosA = Math.cos(angle);
      const sinA = Math.sin(angle);
      const hingeY = BLOCK_D / 2 + 2;
      const hingeZ = BED_H + 4;
      const pLen = BLOCK_D + 2;
      const farY = hingeY - pLen * cosA;
      const farZ = hingeZ + pLen * sinA;

      const poly = [
        [cx - BLOCK_W / 2 + 1, hingeY, hingeZ],
        [cx + BLOCK_W / 2 - 1, hingeY, hingeZ],
        [cx + BLOCK_W / 2 - 1, farY, farZ],
        [cx - BLOCK_W / 2 + 1, farY, farZ],
      ];
      const pts = poly.map((pt) => at(pt));
      const fill = `<polygon points="${pts.map((pt) => pt.map((v) => v.toFixed(1)).join(',')).join(' ')}" fill="var(--anatomy-shade-1)" stroke="var(--anatomy-mid)" stroke-width="1.2" stroke-linejoin="round" opacity="${Math.min(1, dropped * 1.2).toFixed(2)}"/>`;
      const hatch = L(k.pathOf([at([cx - 5, (hingeY + farY) / 2, (hingeZ + farZ) / 2]), at([cx + 5, (hingeY + farY) / 2, (hingeZ + farZ) / 2])]), { tone: 'lo' });
      return fill + hatch;
    };

    // ---------------------------------------------------- Low / High cursor jaws
    // Cursor jaws slide on the rails to pinch/bound the current search interval
    const jawSvg = (xPos, isLow) => {
      const jw = 7;
      const jd = BED_D + 8;
      const plan = { x: xPos - jw / 2, y: -jd / 2, w: jw, d: jd, r: 2 };
      const slab = S(k.slabOf(plan, BED_H + 3, 16, P, 3, 0.6), { tone: 'mid' });
      // Indicator chevron line pointing into active interval
      const arrowDir = isLow ? 1 : -1;
      const arrow = L(
        k.pathOf([
          at([xPos, -jd / 2 + 4, BED_H + 19]),
          at([xPos + arrowDir * 3, -jd / 2 + 4, BED_H + 15]),
          at([xPos, -jd / 2 + 4, BED_H + 11]),
        ]),
        { tone: 'hi' }
      );
      // Bushing holes over the two rails
      const bFront = L(G.circleOf(G.frameAlong([xPos + jw / 2, RAIL_Y_FRONT, RAIL_Z], [1, 0, 0]), 0, RAIL_R + 0.8, P, 14), { tone: 'lo' });
      const bRear = L(G.circleOf(G.frameAlong([xPos + jw / 2, RAIL_Y_REAR, RAIL_Z], [1, 0, 0]), 0, RAIL_R + 0.8, P, 14), { tone: 'lo' });
      return slab + arrow + bFront + bRear;
    };

    // ---------------------------------------------------- Center probe carriage
    // Midpoint measurement carriage: rides rails, drops vertical dial probe into slot
    const probeCarriageAt = (cx, probeDrop, dialAngle, matched) => {
      const cw = 16;
      const cd = 32;
      const cPlan = { x: cx - cw / 2, y: -cd / 2, w: cw, d: cd, r: 2.5 };
      const carriageBase = S(k.slabOf(cPlan, BED_H + 7, 8, P, 3, 0.6), { tone: 'mid' });

      // Spindle & dial column
      const colZ0 = BED_H + 15;
      const colZ1 = colZ0 + 18;
      const col = S(k.cylinder(cx, 0, 3.8, colZ0, 18, P, 20), { tone: 'hi' });

      // Dial housing
      const dialZ = colZ1;
      const dialH = 14;
      const dialR = 12;
      const dialHead = S(k.cylinder(cx, 0, dialR, dialZ, dialH, P, 36, 0.8), { tone: 'hi' });
      const bezelTicks = L(k.radialTicks(cx, 0, dialR - 1.5, 16, 4, dialZ + dialH, [1.2, 2.4], P).minor, { tone: 'lo' });
      const bezelMajor = L(k.radialTicks(cx, 0, dialR - 1.5, 16, 4, dialZ + dialH, [1.2, 2.4], P).major, { tone: 'mid' });

      // Dial pointer needle on face
      const needleLen = dialR - 3.2;
      const tipX = cx + needleLen * Math.sin(dialAngle);
      const tipY = -needleLen * Math.cos(dialAngle);
      const needle = L(k.pathOf([at([cx, 0, dialZ + dialH + 0.4]), at([tipX, tipY, dialZ + dialH + 0.4])]), { tone: matched ? 'lit' : 'hi' });
      const needleHub = D([at([cx, 0, dialZ + dialH + 0.4])], { size: 1.2, tone: 'hi' });

      // Vertical contact plunger dropping down to gauge block
      // Retracted z = BED_H + 8, dropped z = BED_H + 2 (contacts block top)
      const plungerBottom = BED_H + 8 - probeDrop * 6;
      const plunger = S(k.cylinder(cx, 0, 1.8, plungerBottom, colZ0 - plungerBottom, P, 14), { tone: 'hi' });
      const contactFoot = S(k.cylinder(cx, 0, 2.8, plungerBottom, 1.2, P, 14), { tone: 'mid' });

      const accentOutline = matched
        ? `<circle cx="${at([cx, 0, dialZ + dialH])[0].toFixed(1)}" cy="${at([cx, 0, dialZ + dialH])[1].toFixed(1)}" r="16" class="mm-accent" opacity="${Math.min(1, matched * 1.5).toFixed(2)}" />`
        : '';

      return carriageBase + plunger + contactFoot + col + dialHead + bezelTicks + bezelMajor + needle + needleHub + accentOutline;
    };

    // ---------------------------------------------------- Timeline planning
    const plan = getPlan(p.target);
    const planStep = Math.min(s.step, plan.length - 1);
    const curr = plan[planStep];
    const prev = planStep > 0 ? plan[planStep - 1] : { low: 0, high: N_ITEMS - 1, mid: 3, val: ARRAY_VALUES[3], hit: false };

    // Timeline breakdown over span:
    // 0.0 .. 0.7s: rest at prev bounds
    // 0.7 .. 2.0s: jaws glide to new [low, high], mid carriage tracks midpoint
    // 2.0 .. 2.8s: probe plunger descends to block
    // 2.8 .. 3.6s: dial needle deflects (left for LOW, right for HIGH, zero/accent for MATCH)
    // 3.6 .. 4.4s: shutter flaps drop over excluded slots
    // 4.4 .. span: hold steady

    const staticBaseSvg = baseLayers.join('');
    const staticBlocksSvg = blockSolids.join('');

    return {
      viewBox: [VW, VH],
      layers: [
        { s: staticBaseSvg },
        { s: staticBlocksSvg },
        {
          d: (st) => {
            // Dynamic shutters
            let out = '';
            for (let i = 0; i < N_ITEMS; i++) {
              out += shutterSvg(i, st.shutters[i]);
            }
            return out;
          },
        },
        {
          d: (st) => {
            // Dynamic bounds cursors & probe carriage
            const lowX = slotX(st.lowIdx) - BLOCK_W / 2 - 4;
            const highX = slotX(st.highIdx) + BLOCK_W / 2 + 4;
            const midX = slotX(st.midIdx);

            const lowSvg = jawSvg(lowX, true);
            const highSvg = jawSvg(highX, false);
            const probeSvg = probeCarriageAt(midX, st.probeDrop, st.dialAngle, st.matched);

            return lowSvg + highSvg + probeSvg;
          },
        },
      ],
      meta: {
        corner: `N = ${N_ITEMS} SORTED`,
        label: p.label,
        accent: null,
      },
      at(t, span = 5) {
        const T0 = 0.7;
        const T1 = Math.min(span - 2.8, T0 + 1.2);
        const T2 = T1 + 0.7;
        const T3 = T2 + 0.7;
        const T4 = T3 + 0.6;

        // 1. Cursor interval glide
        const uMove = glide(clamp01((t - T0) / (T1 - T0)));
        const lowIdx = prev.low + (curr.low - prev.low) * uMove;
        const highIdx = prev.high + (curr.high - prev.high) * uMove;
        const midIdx = prev.mid + (curr.mid - prev.mid) * uMove;

        // 2. Probe plunge
        const uPlunge = glide(clamp01((t - T1) / (T2 - T1)));
        const probeDrop = uPlunge;

        // 3. Dial deflection
        const uDial = glide(clamp01((t - T2) / (T3 - T2)));
        let targetAngle = 0;
        if (curr.val < p.target) targetAngle = -0.78; // deflection left = LESS
        else if (curr.val > p.target) targetAngle = 0.78; // deflection right = GREATER
        else targetAngle = 0; // zero = EXACT MATCH
        const dialAngle = targetAngle * uDial;

        // 4. Shutters drop over eliminated items
        const uShutter = glide(clamp01((t - T3) / (T4 - T3)));
        const shutters = new Array(N_ITEMS).fill(0);
        for (let i = 0; i < N_ITEMS; i++) {
          const eliminatedPrev = i < prev.low || i > prev.high;
          const eliminatedCurr = i < curr.low || i > curr.high;
          if (eliminatedCurr && !eliminatedPrev) {
            shutters[i] = uShutter;
          } else if (eliminatedPrev) {
            shutters[i] = 1;
          }
        }

        // 5. Match status
        const matched = curr.hit && t >= T2 + 0.2 ? clamp01((t - (T2 + 0.2)) / 0.5) : 0;
        const settled = t >= T3;

        return {
          lowIdx,
          highIdx,
          midIdx,
          probeDrop,
          dialAngle,
          shutters,
          matched,
          settled,
          val: curr.val,
          hit: curr.hit,
        };
      },
      readout(st) {
        if (!st.settled) {
          return {
            label: p.readout,
            value: `INDEX ${Math.round(st.midIdx)}`,
            tag: 'SEEKING',
            tagIn: 0.6,
          };
        }
        if (st.hit) {
          return {
            label: p.readout,
            value: `${st.val} == ${p.target}`,
            tag: 'FOUND',
            tagIn: 1.0,
          };
        }
        const relation = st.val < p.target ? '<' : '>';
        const tag = st.val < p.target ? 'TOO LOW' : 'TOO HIGH';
        return {
          label: p.readout,
          value: `${st.val} ${relation} ${p.target}`,
          tag,
          tagIn: 0.85,
        };
      },
    };
  }

  M_.register('bisection-caliper', { normalize, build });
})(typeof window !== 'undefined' ? window : globalThis);
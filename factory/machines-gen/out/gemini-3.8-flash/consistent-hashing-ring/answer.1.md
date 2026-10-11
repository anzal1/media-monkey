MAPPING: A circular bronze indexing ring with clamped collector chutes at server angles routes key-tokens dropped at hash positions clockwise into the first chute they meet, demonstrating that inserting a new node chute only intercepts tokens in its own sector.

PARTS: Cast rectangular baseplate, four milled leveling feet, four corner hex screws with washers, central pedestal riser, three perimeter deck pillars, graduated annular index ring, outer circular retaining fence, inner circular curb, center bearing spindle, knurled axle cap, rotating radial key-hopper arm with brass counterweight, token drop spout, four clamped node cassettes (each comprising a saddle clamp block, knurled clamping thumbscrew, angled funnel chute, and token receiver bin), rolling brass key token, and token guide rail.

KIND: annular-sorter

```javascript
(function (root) {
  'use strict';
  const M_ = root.MM_MACHINES;
  if (!M_) return;
  const { glide, smooth, clamp01 } = M_.util;

  const AZIMUTH = 65;
  const ELEVATION = 32;
  const VW = 1000;
  const VH = 620;
  const PAD = 16;
  const HEADROOM = 48;

  function normalize(params, state) {
    const nodes = Array.isArray(params.nodes) && params.nodes.length >= 2
      ? params.nodes.map((n, i) => ({
          id: String(n.id || String.fromCharCode(65 + i)),
          angle: Number(n.angle != null ? n.angle : (i * 360) / params.nodes.length) % 360,
        }))
      : [
          { id: 'A', angle: 30 },
          { id: 'B', angle: 150 },
          { id: 'C', angle: 270 },
        ];

    const newNode = state.newNode
      ? {
          id: String(state.newNode.id || 'D'),
          angle: Number(state.newNode.angle != null ? state.newNode.angle : 90) % 360,
        }
      : null;

    const keyAngle = state.keyAngle != null ? Number(state.keyAngle) % 360 : 70;
    const action = ['route', 'insert', 'reroute'].includes(state.action) ? state.action : 'route';

    return {
      p: {
        nodes,
        label: typeof params.label === 'string' ? params.label.slice(0, 24) : 'HASH RING',
        readout: typeof params.readout === 'string' ? params.readout.slice(0, 24) : 'ASSIGNED NODE',
      },
      s: {
        keyAngle,
        newNode,
        action,
      },
    };
  }

  function findSuccessor(angle, nodeList) {
    const sorted = [...nodeList].sort((a, b) => a.angle - b.angle);
    for (const node of sorted) {
      if (node.angle >= angle) return node;
    }
    return sorted[0];
  }

  function build(p, s) {
    const { k, G } = root.ANATOMY;

    // Geometric constants in world units
    const RING_R_IN = 72;
    const RING_R_MID = 88;
    const RING_R_OUT = 104;
    const RING_Z = 24;
    const RING_H = 6;
    const BASE_W = 270;
    const BASE_D = 270;
    const BASE_H = 10;
    const FOOT_H = 4;

    const BASE_PLAN = { x: -BASE_W / 2, y: -BASE_D / 2, w: BASE_W, d: BASE_D, r: 12 };
    const EXTREMES = [
      ...k.boxCorners(BASE_PLAN, -BASE_H - FOOT_H, 0),
      [-RING_R_OUT - 24, -RING_R_OUT - 24, RING_Z + 36],
      [RING_R_OUT + 24, RING_R_OUT + 24, RING_Z + 36],
    ];

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

    // Frame on central Z axis
    const FZ = G.frameAlong([0, 0, 0], [0, 0, 1]);

    // ---------------- BASE & FEET ----------------
    const baseSvg = [];
    baseSvg.push(`<path class="iso-halo" style="filter:blur(10px);transform:translateY(6px)" d="${k.haloOf(BASE_PLAN, -BASE_H - FOOT_H, BASE_H, P)}"/>`);

    const footCorners = k.corners(BASE_PLAN, 16);
    const sortedFootCorners = [...footCorners].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
    for (const [fx, fy] of sortedFootCorners) {
      baseSvg.push(S(k.cylinder(fx, fy, 11, -BASE_H - FOOT_H, 2, P, 24), { tone: 'lo' }));
      baseSvg.push(S(k.cylinder(fx, fy, 8, -BASE_H - FOOT_H + 2, FOOT_H - 2, P, 24), { tone: 'mid' }));
    }

    baseSvg.push(S(k.slabOf(BASE_PLAN, -BASE_H, BASE_H, P, 8, 1.2), { tone: 'lo' }));
    baseSvg.push(L(k.planOutline(k.insetPlan(BASE_PLAN, 5), 0, P), { tone: 'faint' }));

    const screws = k.corners(BASE_PLAN, 8);
    baseSvg.push(L(screws.map(([sx, sy]) => k.ring(sx, sy, 2.4, 0, P, 16)).join(''), { tone: 'lo' }));
    baseSvg.push(D(screws.map(([sx, sy]) => at([sx, sy, 0])), { size: 1.2, tone: 'mid' }));

    // Center Pedestal & Stanchions
    baseSvg.push(S(G.disc(0, RING_Z - 4, 38, FZ, P), { tone: 'mid' }));
    baseSvg.push(S(G.disc(RING_Z - 4, RING_Z, 42, FZ, P), { tone: 'mid' }));

    // 3 perimeter pillars supporting the annular track
    const pillarAngles = [45, 165, 285];
    for (const pa of pillarAngles) {
      const rad = (pa * Math.PI) / 180;
      const px = Math.cos(rad) * RING_R_MID;
      const py = Math.sin(rad) * RING_R_MID;
      baseSvg.push(S(k.cylinder(px, py, 6, 0, RING_Z - 2, P, 20), { tone: 'mid' }));
      baseSvg.push(S(k.cylinder(px, py, 8, RING_Z - 2, 2, P, 20), { tone: 'hi' }));
    }

    // ---------------- ANNULAR TRACK ----------------
    const trackSvg = [];
    const ringBandPaths = G.ringBand(RING_Z, RING_Z + RING_H, RING_R_IN, RING_R_OUT, FZ, P);
    trackSvg.push(S(ringBandPaths, { tone: 'hi', crease: 'lo' }));

    // Inner and outer retaining lips
    trackSvg.push(S(G.ringBand(RING_Z + RING_H, RING_Z + RING_H + 2.5, RING_R_IN - 1.5, RING_R_IN + 1.5, FZ, P), { tone: 'mid' }));
    trackSvg.push(S(G.ringBand(RING_Z + RING_H, RING_Z + RING_H + 3.5, RING_R_OUT - 1.5, RING_R_OUT + 1.5, FZ, P), { tone: 'mid' }));

    // Radial degree ticks on the dial face
    const tickMarks = [];
    for (let deg = 0; deg < 360; deg += 15) {
      const rad = (deg * Math.PI) / 180;
      const r1 = deg % 45 === 0 ? RING_R_IN + 2 : RING_R_IN + 5;
      const r2 = RING_R_OUT - 3;
      const ptA = [Math.cos(rad) * r1, Math.sin(rad) * r1, RING_Z + RING_H + 0.1];
      const ptB = [Math.cos(rad) * r2, Math.sin(rad) * r2, RING_Z + RING_H + 0.1];
      tickMarks.push(k.segment(ptA, ptB, P));
    }
    trackSvg.push(L(tickMarks.join(''), { tone: 'faint' }));

    // ---------------- NODE CASSETTES (Solids) ----------------
    function makeCassetteSolid(angleDeg, label, isNew) {
      const rad = (angleDeg * Math.PI) / 180;
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);
      const u = [-sinA, cosA];

      const cx = cosA * RING_R_MID;
      const cy = sinA * RING_R_MID;
      const cz = RING_Z + RING_H;

      // Saddle block clamped over track
      const plan = { x: cx - 9, y: cy - 9, w: 18, d: 18, r: 2.5 };
      const block = S(k.slabOf(plan, cz, 8, P, 4, 0.8), { tone: isNew ? 'hi' : 'mid' });

      // Knurled thumbscrew on outer rim of clamp
      const screwX = cosA * (RING_R_OUT + 6);
      const screwY = sinA * (RING_R_OUT + 6);
      const screw = S(k.cylinder(screwX, screwY, 4, cz + 2, 4, P, 16), { tone: 'hi' }) +
        L(k.ring(screwX, screwY, 2.5, cz + 6, P, 16), { tone: 'mid' });

      // Funnel / hopper pocket into which token falls
      const hopX = cx + u[0] * 3;
      const hopY = cy + u[1] * 3;
      const hopper = S(k.cylinder(hopX, hopY, 5.5, cz + 8, 5, P, 16), { tone: 'hi' }) +
        L(k.ring(hopX, hopY, 4.2, cz + 13, P, 16), { tone: 'faint' });

      // Engraved label plate
      const labelPt = at([cx, cy, cz + 8.1]);
      const glyph = `<text class="mm-glyph" x="${labelPt[0].toFixed(1)}" y="${(labelPt[1] + 3.5).toFixed(1)}" font-size="9">${label}</text>`;

      return {
        angle: angleDeg,
        depth: k.depthOf([cx, cy, cz], P),
        svg: block + screw + hopper + glyph,
      };
    }

    // Pre-build active node cassettes
    const initialCassettes = p.nodes.map((n) => makeCassetteSolid(n.angle, n.id, false));
    const newCassette = s.newNode ? makeCassetteSolid(s.newNode.angle, s.newNode.id, true) : null;

    // ---------------- CENTRAL HASH ARM & BEARING ----------------
    const centerSvg = [];
    centerSvg.push(S(G.disc(RING_Z, RING_Z + 12, 18, FZ, P), { tone: 'mid' }));
    centerSvg.push(S(G.disc(RING_Z + 12, RING_Z + 18, 12, FZ, P), { tone: 'hi' }));
    centerSvg.push(D([at([0, 0, RING_Z + 18])], { size: 2.2, tone: 'hi' }));

    // Arm builder at given angle
    function makeArmSvg(angleDeg) {
      const rad = (angleDeg * Math.PI) / 180;
      const cosA = Math.cos(rad);
      const sinA = Math.sin(rad);

      const rTail = 24;
      const rHead = RING_R_MID;

      const pts = [
        [-cosA * rTail + sinA * 5, -sinA * rTail - cosA * 5],
        [cosA * rHead + sinA * 3.5, sinA * rHead - cosA * 3.5],
        [cosA * rHead - sinA * 3.5, sinA * rHead + cosA * 3.5],
        [-cosA * rTail - sinA * 5, -sinA * rTail + cosA * 5],
      ];
      const armSolid = S(k.extrude(pts, RING_Z + 10, 4, P, { convex: true }), { tone: 'hi' });

      // Counterweight puck on the tail
      const cwX = -cosA * (rTail - 6);
      const cwY = -sinA * (rTail - 6);
      const counterWeight = S(k.cylinder(cwX, cwY, 6.5, RING_Z + 14, 5, P, 18), { tone: 'mid' });

      // Drop nozzle on the head (above the ring race)
      const nzX = cosA * rHead;
      const nzY = sinA * rHead;
      const nozzle = S(k.cylinder(nzX, nzY, 5, RING_Z + 14, 8, P, 18), { tone: 'hi' }) +
        L(k.ring(nzX, nzY, 3.5, RING_Z + 22, P, 18), { tone: 'faint' });

      return armSolid + counterWeight + nozzle;
    }

    // ---------------- TOKEN SOLID ----------------
    function makeTokenSvg(angleDeg, zDrop, isLit) {
      const rad = (angleDeg * Math.PI) / 180;
      const tx = Math.cos(rad) * RING_R_MID;
      const ty = Math.sin(rad) * RING_R_MID;
      const tz = RING_Z + RING_H + 1.2 + zDrop;
      const sphere = G.sphereOf([tx, ty, tz], 4.2, P, { steps: 32 });
      const accentRing = isLit ? `<circle cx="${at([tx, ty, tz])[0].toFixed(1)}" cy="${at([tx, ty, tz])[1].toFixed(1)}" r="7" class="mm-accent" opacity="0.85"/>` : '';
      return S(sphere, { tone: 'hi' }) + accentRing;
    }

    // ---------------- TIMELINE & ANIMATION ----------------
    const initialTarget = findSuccessor(s.keyAngle, p.nodes);
    const activeNodesWithNew = s.newNode ? [...p.nodes, s.newNode] : p.nodes;
    const finalTarget = findSuccessor(s.keyAngle, activeNodesWithNew);

    function getAngleDist(fromDeg, toDeg) {
      let d = toDeg - fromDeg;
      while (d < 0) d += 360;
      return d;
    }

    // Merge static background elements
    const backgroundSvg = baseSvg.join('') + trackSvg.join('') + centerSvg.join('');

    return {
      viewBox: [VW, VH],
      layers: [
        { s: backgroundSvg },
        {
          d: (st) => {
            const list = [...initialCassettes];
            if (newCassette && st.insertProgress > 0) {
              list.push({
                ...newCassette,
                depth: newCassette.depth,
                svg: `<g transform="translate(0, ${(-(1 - st.insertProgress) * 45).toFixed(1)})" opacity="${smooth(0, 0.4, st.insertProgress).toFixed(2)}">${newCassette.svg}</g>`,
              });
            }
            list.sort((a, b) => a.depth - b.depth);
            return list.map((item) => item.svg).join('');
          },
        },
        {
          d: (st) => makeArmSvg(st.armAngle),
        },
        {
          d: (st) => (st.tokenVisible ? makeTokenSvg(st.tokenAngle, st.tokenZ, st.tokenArrived) : ''),
        },
      ],
      meta: {
        corner: `${p.nodes.length + (s.newNode && s.action !== 'route' ? 1 : 0)} NODES`,
        label: p.label,
        accent: null,
      },
      at(t, span = 5) {
        const T_START = 0.7;
        const T_END = span - 0.8;
        const totalDuration = T_END - T_START;

        let armAngle = s.keyAngle;
        let tokenAngle = s.keyAngle;
        let tokenZ = 0;
        let tokenVisible = false;
        let tokenArrived = false;
        let insertProgress = s.action === 'insert' ? 0 : s.newNode ? 1 : 0;
        let currentNode = initialTarget;

        if (s.action === 'route') {
          tokenVisible = t >= T_START;
          const dropSpan = 0.6;
          const rollSpan = totalDuration - dropSpan;

          if (t < T_START) {
            tokenVisible = false;
            tokenZ = 12;
          } else if (t < T_START + dropSpan) {
            const u = (t - T_START) / dropSpan;
            tokenZ = 12 * (1 - glide(u));
            tokenAngle = s.keyAngle;
          } else {
            const u = clamp01((t - (T_START + dropSpan)) / rollSpan);
            const rollU = glide(u);
            const dist = getAngleDist(s.keyAngle, initialTarget.angle);
            tokenAngle = (s.keyAngle + dist * rollU) % 360;
            tokenZ = 0;
            tokenArrived = u >= 0.95;
          }
        } else if (s.action === 'insert') {
          tokenVisible = false;
          const u = clamp01((t - T_START) / (totalDuration * 0.7));
          insertProgress = glide(u);
          currentNode = s.newNode;
        } else if (s.action === 'reroute') {
          insertProgress = 1;
          tokenVisible = t >= T_START;
          currentNode = finalTarget;

          const dropSpan = 0.5;
          const rollSpan = totalDuration - dropSpan;

          if (t < T_START) {
            tokenVisible = false;
            tokenZ = 12;
          } else if (t < T_START + dropSpan) {
            const u = (t - T_START) / dropSpan;
            tokenZ = 12 * (1 - glide(u));
            tokenAngle = s.keyAngle;
          } else {
            const u = clamp01((t - (T_START + dropSpan)) / rollSpan);
            const rollU = glide(u);
            const dist = getAngleDist(s.keyAngle, finalTarget.angle);
            tokenAngle = (s.keyAngle + dist * rollU) % 360;
            tokenZ = 0;
            tokenArrived = u >= 0.95;
          }
        }

        return {
          armAngle,
          tokenAngle,
          tokenZ,
          tokenVisible,
          tokenArrived,
          insertProgress,
          currentNode,
        };
      },
      readout(st) {
        return {
          label: p.readout,
          value: `NODE ${st.currentNode.id}`,
          tag: st.tokenArrived ? 'BOUND' : s.action === 'insert' ? 'ADDED' : '',
          tagIn: st.tokenArrived || s.action === 'insert' ? 1 : 0,
        };
      },
    };
  }

  M_.register('annular-sorter', { normalize, build });
})(typeof window !== 'undefined' ? window : globalThis);
```

```json
{
  "scenes": [
    {
      "headline": "Keys route to their successor.",
      "subhead": "clockwise walk along the ring",
      "params": {
        "label": "HASH RING",
        "readout": "ASSIGNED NODE",
        "nodes": [
          { "id": "A", "angle": 30 },
          { "id": "B", "angle": 150 },
          { "id": "C", "angle": 270 }
        ]
      },
      "state": {
        "keyAngle": 70,
        "action": "route"
      }
    },
    {
      "headline": "Add a node at 100°.",
      "subhead": "clamped between nodes A and B",
      "params": {
        "label": "HASH RING",
        "readout": "NEW NODE",
        "nodes": [
          { "id": "A", "angle": 30 },
          { "id": "B", "angle": 150 },
          { "id": "C", "angle": 270 }
        ]
      },
      "state": {
        "keyAngle": 70,
        "newNode": { "id": "D", "angle": 100 },
        "action": "insert"
      }
    },
    {
      "headline": "Only local keys re-route.",
      "subhead": "tokens pass A to reach D",
      "params": {
        "label": "HASH RING",
        "readout": "ASSIGNED NODE",
        "nodes": [
          { "id": "A", "angle": 30 },
          { "id": "B", "angle": 150 },
          { "id": "C", "angle": 270 }
        ]
      },
      "state": {
        "keyAngle": 70,
        "newNode": { "id": "D", "angle": 100 },
        "action": "reroute"
      }
    }
  ]
}
```
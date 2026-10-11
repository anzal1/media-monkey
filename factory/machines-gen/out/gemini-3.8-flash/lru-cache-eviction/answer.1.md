MAPPING: A four-slot linear cartridge magazine where accessed records shuttle back to the head (MRU) and push the stack rightward, so the least recently used record at the tail (LRU) is pushed through a spring-loaded trapdoor into an eviction chute.

PARTS: The machine comprises a heavy cast base plate with perimeter groove, four knurled leveling feet with elastomer pads, and four hex-socket corner screws; a left headstock upright, feed barrel, plunger guide, and twin rail clamps; a right tailstock upright with hinge brackets; front and rear hardened guide rails with a central saddle support post; an overhead gantry bridge with twin riser posts and dual slide rods; an eviction slide chute leading to a discard receiver bin with pull knob; a spring-biased trapdoor flap with pivot hinge pin; a feed ram with sliding plunger rod and knurled knob; a front index apron engraved with slot calibrations and MRU/LRU glyphs; and four machined cartridge sleds, each with a solid core block, dual side guide bushings, front faceplate engraved with a key glyph, and top knurled grip pin.

KIND: cartridge-magazine

```javascript
(function (root) {
  'use strict';
  const M_ = root.MM_MACHINES;
  if (!M_) return;
  const { glide, hump, smooth, clamp01 } = M_.util;

  const AZIMUTH = 54;
  const ELEVATION = 24;
  const VW = 1000;
  const PAD = 24;
  const HEADROOM = 48;

  // ---------------------------------------------------------------- normalize
  function normalize(params, state) {
    const pIn = params || {};
    const sIn = state || {};
    const capacity = Math.max(3, Math.min(4, Math.round(Number(pIn.capacity) || 4)));
    const rawItems = Array.isArray(sIn.items) ? sIn.items.map((x) => String(x).trim().slice(0, 2).toUpperCase()) : ['A', 'B', 'C', 'D'];
    const items = rawItems.slice(0, capacity);
    while (items.length < capacity) {
      items.push(String.fromCharCode(65 + items.length));
    }

    const key = (sIn.key != null ? String(sIn.key).trim().slice(0, 2).toUpperCase() : '') || 'B';
    let op = String(sIn.op || sIn.operation || sIn.behaviour || sIn.behavior || '').toLowerCase();
    if (op !== 'hit' && op !== 'miss') {
      op = items.includes(key) ? 'hit' : 'miss';
    }

    let evicted = sIn.evicted != null ? String(sIn.evicted).trim().slice(0, 2).toUpperCase() : null;
    if (op === 'miss' && !evicted) {
      evicted = items[capacity - 1];
    }

    const label = typeof pIn.label === 'string' ? pIn.label.trim().slice(0, 24) : 'LRU CACHE';
    const readout = typeof pIn.readout === 'string' ? pIn.readout.trim().slice(0, 20) : 'STATUS';

    return {
      p: { capacity, label, readout },
      s: { op, key, items, evicted },
    };
  }

  // ---------------------------------------------------------------- build
  function build(p, s) {
    const { k, G } = root.ANATOMY;
    const N = p.capacity;

    // Track geometry (world coordinates)
    const X_SLOT0 = 38;
    const SLOT_DX = 32;
    const slotX = (idx) => X_SLOT0 + idx * SLOT_DX;

    const X_HEAD = 14;
    const X_TAIL = X_SLOT0 + N * SLOT_DX + 10;
    const X_TRAP = slotX(N - 1) + 20;
    const TRAP_W = 26;
    const CHUTE_END_X = X_TAIL + 42;

    const RAIL_Y_F = -14;
    const RAIL_Y_R = 14;
    const RAIL_Z = 16;
    const RAIL_R = 2.2;
    const GANTRY_Z = 48;

    const CART_W = 22;
    const CART_D = 24;
    const CART_H = 16;

    // Base plate footprint
    const BASE = {
      x: X_HEAD - 22,
      y: -44,
      w: CHUTE_END_X - X_HEAD + 38,
      d: 88,
      r: 6,
    };
    const BASE_H = 6;
    const FOOT_H = 2.6;

    // Comprehensive 3D envelope bounds including all moving part travels
    const EXTREMES = [
      // Base plate envelope and halo margins
      ...k.boxCorners({ x: BASE.x - 12, y: BASE.y - 12, w: BASE.w + 24, d: BASE.d + 24, r: 8 }, -BASE_H - FOOT_H - 6, 0),
      // Left plunger knob travel
      [X_HEAD - 28, -16, RAIL_Z - 6],
      [X_HEAD - 28, 16, RAIL_Z - 6],
      // Right collection bin & chute end
      [CHUTE_END_X + 28, -26, 0],
      [CHUTE_END_X + 28, 26, 0],
      [CHUTE_END_X + 28, 0, 18],
      // Gantry top structure
      [X_HEAD, -22, GANTRY_Z + 8],
      [X_TAIL, 22, GANTRY_Z + 8],
      // Maximum cartridge lift height envelope (in hit operations)
      [slotX(0) - CART_W, -CART_D, 82],
      [slotX(0) + CART_W, CART_D, 82],
      [slotX(N - 1) + CART_W, -CART_D, 82],
      [slotX(N - 1) + CART_W, CART_D, 82],
    ];

    const VH = (() => {
      const flat = EXTREMES.map((pt) => k.iso(pt, { origin: [0, 0], scale: 1, azimuth: AZIMUTH, elevation: ELEVATION }));
      const minX = Math.min(...flat.map((q) => q[0]));
      const maxX = Math.max(...flat.map((q) => q[0]));
      const minY = Math.min(...flat.map((q) => q[1]));
      const maxY = Math.max(...flat.map((q) => q[1]));
      const w = maxX - minX;
      const h = maxY - minY;
      const targetH = (h * (VW - 2 * PAD)) / w + 2 * PAD + HEADROOM;
      return Math.round(Math.max(500, Math.min(660, targetH)));
    })();

    const P = k.fitProjection(EXTREMES, VW, VH, { pad: PAD, headroom: HEADROOM, azimuth: AZIMUTH, elevation: ELEVATION });
    const at = (pt) => k.iso(pt, P);
    const S = (paths, style) => k.solidSvg(paths, style);
    const L = (d, style) => k.lineSvg(d, style);
    const D = (pts, style) => k.dotsSvg(pts, style);

    const FX = G.frameOf([0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1]);
    const byDepth = (pts) => [...pts].sort((a, b2) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b2[0], b2[1], 0], P));

    // ---------------- static: base & feet
    const staticBase = [];
    staticBase.push(`<path class="iso-halo" style="filter:blur(8px);transform:translateY(3px)" d="${k.haloOf(BASE, -BASE_H - FOOT_H, BASE_H, P)}"/>`);
    for (const [fx, fy] of byDepth(k.corners(BASE, 9))) {
      staticBase.push(S(k.cylinder(fx, fy, 5.2, -BASE_H - FOOT_H, 1, P, 24), { tone: 'lo' }));
      staticBase.push(S(k.cylinder(fx, fy, 4, -BASE_H - FOOT_H + 1, FOOT_H - 1, P, 24), { tone: 'mid' }));
    }
    staticBase.push(S(k.slabOf(BASE, -BASE_H, BASE_H, P, 8, 1.4), { tone: 'lo' }));
    staticBase.push(L(k.planOutline(k.insetPlan(BASE, 4), 0, P), { tone: 'faint' }));
    const screws = k.corners(BASE, 6.5);
    staticBase.push(L(screws.map(([sx, sy]) => k.ring(sx, sy, 1.6, 0, P, 16)).join(''), { tone: 'lo' }));
    staticBase.push(D(screws.map(([sx, sy]) => at([sx, sy, 0])), { size: 0.9 }));

    // ---------------- static: structure (rear & foundation)
    const staticStructureBack = [];

    // Bed tray along center
    const BED = { x: X_HEAD + 6, y: -16, w: X_TAIL - X_HEAD - 2, d: 32, r: 2 };
    staticStructureBack.push(S(k.slabOf(BED, 0, 4, P, 4), { tone: 'mid' }));
    staticStructureBack.push(L(k.planOutline(k.insetPlan(BED, 1.8), 4, P), { tone: 'faint' }));

    // Eviction chute slanting into collection bin
    const CHUTE = { x: X_TRAP, y: -14, w: CHUTE_END_X - X_TRAP, d: 28, r: 2 };
    staticStructureBack.push(S(k.slabOf(CHUTE, 0, 3, P, 4), { tone: 'mid' }));
    const BIN = { x: CHUTE_END_X - 4, y: -18, w: 28, d: 36, r: 3 };
    staticStructureBack.push(S(k.slabOf(BIN, 0, 9, P, 6, 1), { tone: 'mid' }));
    staticStructureBack.push(S(k.slabOf(k.insetPlan(BIN, 2.2), 2, 7.2, P, 4), { tone: 'lo' }));
    staticStructureBack.push(S(k.cylinder(BIN.x + BIN.w, BIN.y + BIN.d / 2, 2.2, 3, 3.5, P, 16), { tone: 'hi' }));

    // Left headstock pillar
    const HEAD_POST = { x: X_HEAD - 6, y: -20, w: 12, d: 40, r: 3 };
    staticStructureBack.push(S(k.slabOf(HEAD_POST, 0, 28, P, 6, 1), { tone: 'mid' }));
    staticStructureBack.push(S(k.slabOf(HEAD_POST, 28, 3, P, 6), { tone: 'hi' }));

    // Right tailstock pillar
    const TAIL_POST = { x: X_TAIL - 4, y: -20, w: 10, d: 40, r: 3 };
    staticStructureBack.push(S(k.slabOf(TAIL_POST, 0, 28, P, 6, 1), { tone: 'mid' }));
    staticStructureBack.push(S(k.slabOf(TAIL_POST, 28, 3, P, 6), { tone: 'hi' }));

    // Rear guide rail
    const AX_REAR = G.frameAlong([X_HEAD, RAIL_Y_R, RAIL_Z], [1, 0, 0]);
    staticStructureBack.push(S(G.disc(0, X_TAIL - X_HEAD + 4, RAIL_R, AX_REAR, P), { tone: 'hi', crease: 'none' }));

    // Overhead gantry risers & rear overhead rail
    staticStructureBack.push(S(k.cylinder(X_HEAD, RAIL_Y_R, 2.6, 31, GANTRY_Z - 31 + 4, P, 20), { tone: 'mid' }));
    staticStructureBack.push(S(k.cylinder(X_TAIL, RAIL_Y_R, 2.6, 31, GANTRY_Z - 31 + 4, P, 20), { tone: 'mid' }));
    const AX_G_REAR = G.frameAlong([X_HEAD, RAIL_Y_R, GANTRY_Z], [1, 0, 0]);
    staticStructureBack.push(S(G.disc(0, X_TAIL - X_HEAD, 1.8, AX_G_REAR, P), { tone: 'mid' }));

    // ---------------- cartridge pre-builder
    const exv = (() => { const o = at([0, 0, 0]); const e = at([1, 0, 0]); return [e[0] - o[0], e[1] - o[1]]; })();
    const ezv = (() => { const o = at([0, 0, 0]); const e = at([0, 0, 1]); return [e[0] - o[0], e[1] - o[1]]; })();
    const glyphMatrix = (gx, gy, gz) => {
      const o = at([gx, gy, gz]);
      return `matrix(${exv[0].toFixed(4)} ${exv[1].toFixed(4)} ${(-ezv[0]).toFixed(4)} ${(-ezv[1]).toFixed(4)} ${o[0].toFixed(1)} ${o[1].toFixed(1)})`;
    };

    function buildCartridge(tag, isHot) {
      const parts = [];
      const CPLAN = { x: -CART_W / 2, y: -CART_D / 2, w: CART_W, d: CART_D, r: 2.5 };
      parts.push(S(k.slabOf(CPLAN, 0, CART_H, P, 4, 0.8), { tone: 'hi' }));

      // Guide bushings along side rails
      const BUSH_F = G.frameAlong([-CART_W / 2, RAIL_Y_F, RAIL_Z - 10], [1, 0, 0]);
      const BUSH_R = G.frameAlong([-CART_W / 2, RAIL_Y_R, RAIL_Z - 10], [1, 0, 0]);
      parts.push(S(G.disc(0, CART_W, 3.2, BUSH_F, P), { tone: 'mid' }));
      parts.push(S(G.disc(0, CART_W, 3.2, BUSH_R, P), { tone: 'mid' }));

      // Top knurled grab-pin
      parts.push(S(k.cylinder(0, 0, 2.8, CART_H, 4, P, 20), { tone: 'hi' }));
      parts.push(D([at([0, 0, CART_H + 4])], { size: 1.1, tone: 'hi' }));

      // Engraved face plate & tag on front vertical face (y = -CART_D/2)
      const mat = glyphMatrix(0, -CART_D / 2, 7.2);
      const tagG = isHot ? 'sign' : '';
      parts.push(`<text class="mm-glyph"${tagG ? ` data-g="${tagG}"` : ''} transform="${mat}" font-size="11.5" y="4.2">${tag}</text>`);

      const outline = k.slabOf(CPLAN, 0, CART_H, P, 4).outline;
      return { svg: parts.join(''), outline };
    }

    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const cartModels = {};
    for (let i = 0; i < alphabet.length; i++) {
      const ch = alphabet[i];
      cartModels[ch] = {
        normal: buildCartridge(ch, false),
        hot: buildCartridge(ch, true),
      };
    }

    // ---------------- static: front structure & apron
    const staticStructureFront = [];

    // Front guide rail
    const AX_FRONT = G.frameAlong([X_HEAD, RAIL_Y_F, RAIL_Z], [1, 0, 0]);
    staticStructureFront.push(S(G.disc(0, X_TAIL - X_HEAD + 4, RAIL_R, AX_FRONT, P), { tone: 'hi', crease: 'none' }));

    // Front overhead gantry risers & rail
    staticStructureFront.push(S(k.cylinder(X_HEAD, RAIL_Y_F, 2.6, 31, GANTRY_Z - 31 + 4, P, 20), { tone: 'mid' }));
    staticStructureFront.push(S(k.cylinder(X_TAIL, RAIL_Y_F, 2.6, 31, GANTRY_Z - 31 + 4, P, 20), { tone: 'mid' }));
    const AX_G_FRONT = G.frameAlong([X_HEAD, RAIL_Y_F, GANTRY_Z], [1, 0, 0]);
    staticStructureFront.push(S(G.disc(0, X_TAIL - X_HEAD, 1.8, AX_G_FRONT, P), { tone: 'mid' }));

    // Center rail support bracket
    const SADDLE_X = slotX(Math.floor(N / 2)) - 16;
    const SADDLE = { x: SADDLE_X - 2, y: -18, w: 4, d: 36, r: 1.5 };
    staticStructureFront.push(S(k.slabOf(SADDLE, 0, 14, P, 4), { tone: 'mid' }));

    // Front scale apron (with slot index engravings)
    const APRON = { x: X_HEAD + 12, y: -30, w: X_TAIL - X_HEAD - 14, d: 8, r: 2 };
    staticStructureFront.push(S(k.slabOf(APRON, 0, 8, P, 4, 0.8), { tone: 'mid' }));
    for (let j = 0; j < N; j++) {
      const sx = slotX(j);
      staticStructureFront.push(L(k.pathOf([at([sx, -30, 8]), at([sx, -22, 8])]), { tone: 'lo' }));
      const txt = j === 0 ? 'MRU' : j === N - 1 ? 'LRU' : `${j}`;
      const mat = glyphMatrix(sx, -30, 4);
      staticStructureFront.push(`<text class="mm-glyph" transform="${mat}" font-size="6.5" y="2.2" opacity="0.85">${txt}</text>`);
    }

    // ---------------- dynamic: trapdoor, feed plunger, cartridges
    function trapdoorSvg(openAngle) {
      const rad = openAngle * 0.75;
      const x0 = X_TRAP - 2;
      const c = Math.cos(rad);
      const sAng = Math.sin(rad);
      const y0 = -13;
      const y1 = 13;
      const z0 = 4;
      const ptsTop = [
        [x0, y0, z0],
        [x0 + TRAP_W * c, y0, z0 - TRAP_W * sAng],
        [x0 + TRAP_W * c, y1, z0 - TRAP_W * sAng],
        [x0, y1, z0],
      ];
      const paths = G.prismOf(FX, ptsTop.map((p3) => [p3[1], p3[2]]), x0, x0 + 2.5, P);
      const hinge = S(G.disc(x0 - 1.5, x0 + 1.5, 1.8, G.frameAlong([x0, 0, z0], [0, 1, 0]), P), { tone: 'mid' });
      return hinge + S(paths, { tone: 'mid' });
    }

    function plungerSvg(pushDist) {
      const px0 = X_HEAD - 18 + pushDist;
      const px1 = px0 + 26;
      const rod = S(G.disc(px0, px1, 2.4, G.frameAlong([0, 0, RAIL_Z - 6], [1, 0, 0]), P), { tone: 'hi' });
      const knob = S(G.disc(px0 - 3, px0, 4.2, G.frameAlong([0, 0, RAIL_Z - 6], [1, 0, 0]), P), { tone: 'mid' });
      return rod + knob;
    }

    // ---------------- timeline solver
    function solveAt(t, span) {
      const T0 = 0.75;
      const T_DUR = Math.max(2.4, span - 1.6);
      const isHit = s.op === 'hit';

      const activeKeys = s.items.slice(0, N);
      const hitIdx = activeKeys.indexOf(s.key);

      const carts = [];
      let plungerPush = 0;
      let trapOpen = 0;
      let tagIn = 0;

      if (isHit && hitIdx >= 0) {
        // HIT OPERATION: record lifts, shuttles to Slot 0 (MRU), descends
        const u = clamp01((t - T0) / (T_DUR * 0.9));
        const uLift = smooth(0.0, 0.28, u);
        const uGlide = glide(clamp01((u - 0.22) / 0.5));
        const uDrop = smooth(0.68, 0.96, u);
        tagIn = smooth(0.4, 0.7, u);

        const liftZ = (1 - (1 - uLift) * (1 - uDrop)) * (GANTRY_Z - RAIL_Z + 10) * (u < 0.7 ? uLift : 1 - uDrop);

        for (let j = 0; j < N; j++) {
          const key = activeKeys[j];
          if (j === hitIdx) {
            const startX = slotX(j);
            const endX = slotX(0);
            const cx = startX + (endX - startX) * uGlide;
            const cz = 10 + liftZ;
            carts.push({ key, x: cx, y: 0, z: cz, hot: true, act: hump(u) });
          } else if (j < hitIdx) {
            const startX = slotX(j);
            const endX = slotX(j + 1);
            const cx = startX + (endX - startX) * uGlide;
            carts.push({ key, x: cx, y: 0, z: 10, hot: false, act: 0 });
          } else {
            carts.push({ key, x: slotX(j), y: 0, z: 10, hot: false, act: 0 });
          }
        }
      } else {
        // MISS OPERATION: new record injected at Slot 0, tail pushed through trapdoor
        const u = clamp01((t - T0) / (T_DUR * 0.92));
        const uPush = glide(clamp01(u / 0.52));
        const uDrop = glide(clamp01((u - 0.44) / 0.46));
        tagIn = smooth(0.48, 0.78, u);

        plungerPush = hump(clamp01(u / 0.7)) * 18;
        trapOpen = hump(clamp01((u - 0.38) / 0.56));

        const newKey = s.key;
        const enterStartX = X_HEAD - 2;
        const enterEndX = slotX(0);
        const enterX = enterStartX + (enterEndX - enterStartX) * uPush;
        carts.push({ key: newKey, x: enterX, y: 0, z: 10, hot: true, act: hump(uPush) });

        for (let j = 0; j < N; j++) {
          const key = activeKeys[j];
          if (j < N - 1) {
            const startX = slotX(j);
            const endX = slotX(j + 1);
            const cx = startX + (endX - startX) * uPush;
            carts.push({ key, x: cx, y: 0, z: 10, hot: false, act: 0 });
          } else {
            const startX = slotX(j);
            const trapX = X_TRAP + 6;
            const binX = CHUTE_END_X + 6;
            let cx = startX + (trapX - startX) * uPush;
            let cz = 10;
            if (u > 0.44) {
              cx = trapX + (binX - trapX) * uDrop;
              cz = 10 - uDrop * 8;
            }
            carts.push({ key, x: cx, y: 0, z: cz, hot: true, act: hump(uDrop) });
          }
        }
      }

      return { carts, plungerPush, trapOpen, tagIn };
    }

    // ---------------- dynamic layer renderer
    function renderDynamic(st) {
      const out = [];

      out.push(plungerSvg(st.plungerPush));
      out.push(trapdoorSvg(st.trapOpen));

      const sorted = [...st.carts].sort((a, b2) => {
        return k.depthOf([a.x, a.y, a.z], P) - k.depthOf([b2.x, b2.y, b2.z], P);
      });

      for (const c of sorted) {
        const model = cartModels[c.key] ? (c.hot ? cartModels[c.key].hot : cartModels[c.key].normal) : cartModels['A'].normal;
        const tr = k.translateAlong(P, [c.x, c.y, c.z]);
        const glow = c.act > 0.05 ? `<path class="mm-accent" opacity="${Math.min(1, c.act * 1.5).toFixed(2)}" d="${model.outline}"/>` : '';
        out.push(`<g transform="${tr}">${model.svg}${glow}</g>`);
      }

      return out.join('');
    }

    // ---------------- package layers
    const layers = [
      { s: staticBase.join('') },
      { s: staticStructureBack.join('') },
      { d: (st) => renderDynamic(st) },
      { s: staticStructureFront.join('') },
    ];

    return {
      viewBox: [VW, VH],
      layers,
      meta: {
        corner: `${N} SLOTS`,
        label: p.label,
        accent: null,
      },
      at(t, span = 5) {
        return solveAt(t, span);
      },
      readout(st) {
        const isHit = s.op === 'hit';
        return {
          label: p.readout,
          value: isHit ? `HIT "${s.key}"` : `MISS "${s.key}"`,
          tag: isHit ? 'PROMOTED' : 'EVICTED',
          tagIn: st.tagIn,
        };
      },
    };
  }

  M_.register('cartridge-magazine', { normalize, build });
})(typeof window !== 'undefined' ? window : globalThis);
```

```json
{
  "scenes": [
    {
      "headline": "Accessed items jump to front.",
      "subhead": "record B promoted to MRU",
      "params": {
        "capacity": 4,
        "label": "LRU CACHE",
        "readout": "STATUS"
      },
      "state": {
        "op": "hit",
        "key": "B",
        "items": ["A", "B", "C", "D"]
      }
    },
    {
      "headline": "Coldest record drops off.",
      "subhead": "capacity full, D is evicted",
      "params": {
        "capacity": 4,
        "label": "LRU CACHE",
        "readout": "STATUS"
      },
      "state": {
        "op": "miss",
        "key": "E",
        "items": ["B", "A", "C", "D"],
        "evicted": "D"
      }
    },
    {
      "headline": "Frequent hits stay warm.",
      "subhead": "A returns to head slot",
      "params": {
        "capacity": 4,
        "label": "LRU CACHE",
        "readout": "STATUS"
      },
      "state": {
        "op": "hit",
        "key": "A",
        "items": ["E", "B", "A", "C"]
      }
    },
    {
      "headline": "The least recent expires.",
      "subhead": "C drops into discard tray",
      "params": {
        "capacity": 4,
        "label": "LRU CACHE",
        "readout": "STATUS"
      },
      "state": {
        "op": "miss",
        "key": "F",
        "items": ["A", "E", "B", "C"],
        "evicted": "C"
      }
    }
  ]
}
```
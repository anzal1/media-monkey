MAPPING: A vertical gravity chute where incoming metal blocks push the stack down to evict the bottom one, and a lateral carriage plucks accessed blocks to lift them back to the top, showing exactly how a Least Recently Used cache reorders and drops items.
PARTS: A solid cast base with a collection tray for evicted items; a vertical structure of four rails forming a storage chute, backed by a plate; an input hopper rail at the top left; a solenoid manifold on the left cheek housing four lateral plungers; a vertical lift mast on the right holding a sliding carriage bracket; a carriage-mounted plunger; and up to five engraved metal cache blocks sliding between these channels.
KIND: lru-chute

```javascript
(function (root) {
  'use strict';
  const M_ = root.MM_MACHINES;
  if (!M_) return;
  const { glide, smooth, clamp01 } = M_.util;

  function normalize(params, state) {
    const capacity = Math.max(2, Math.min(6, params.capacity || 4));
    const cache = Array.isArray(state.cache) ? state.cache.map(String).slice(0, capacity) : [];
    const next = state.next != null ? String(state.next) : '?';
    return {
      p: { capacity },
      s: { cache, next }
    };
  }

  function timeline(p, s, span) {
    const cache = s.cache;
    const next = s.next;
    const hitIdx = cache.indexOf(next);
    const isHit = hitIdx >= 0;
    const N = p.capacity;
    
    const Z0 = 65;
    const DZ = 11;
    const T0 = 0.7;
    const D = 2.8;

    const seq = (t, start, end) => glide(clamp01(((t - T0) / D - start) / (end - start)));

    return (t) => {
      let blocks = [];
      let carZ = Z0;
      let actPlunger = -1;
      let px = 0;
      let cpx = 0;
      let tagIn = clamp01((t - (T0 + 0.4)) / 0.3);

      if (isHit) {
        actPlunger = hitIdx;
        px = seq(t, 0.0, 0.15) - seq(t, 0.25, 0.4);
        cpx = seq(t, 0.65, 0.8) - seq(t, 0.85, 1.0);

        const zk = Z0 - hitIdx * DZ;
        carZ = Z0 + (zk - Z0) * seq(t, 0.0, 0.1) + (Z0 - zk) * seq(t, 0.4, 0.65);

        for (let i = 0; i < cache.length; i++) {
          const b = { id: cache[i], x: 0, z: Z0 - i * DZ, tone: 'mid', accent: false };
          if (i === hitIdx) {
            b.tone = 'hi';
            b.accent = true;
            b.x = 22 * seq(t, 0.15, 0.3) - 22 * seq(t, 0.65, 0.8);
            b.z = carZ;
          } else if (i < hitIdx) {
            b.z -= DZ * seq(t, 0.4, 0.65);
          }
          blocks.push(b);
        }
      } else {
        carZ = Z0;
        blocks.push({
          id: next,
          x: -25 + 25 * seq(t, 0.1, 0.4),
          z: Z0,
          tone: 'hi',
          accent: true
        });
        for (let i = 0; i < cache.length; i++) {
          const b = { id: cache[i], x: 0, z: Z0 - i * DZ, tone: 'mid', accent: false };
          b.z -= DZ * seq(t, 0.1, 0.4);
          if (i === N - 1) {
            const zN = Z0 - N * DZ;
            b.x += 20 * seq(t, 0.45, 0.8);
            b.z -= (zN - 4) * seq(t, 0.45, 0.8);
          }
          blocks.push(b);
        }
      }

      return { blocks, carZ, actPlunger, px, cpx, tagIn, isHit, next };
    };
  }

  function build(p, s) {
    const { k, G } = root.ANATOMY;
    const N = p.capacity;
    
    const W = 13, D = 11, H = 7;
    const DZ = 11;
    const Z0 = 65;

    const VW = 1000;
    const VH = 640;
    const EXTREMES = [
      ...k.boxCorners({x: 2, y: 0, w: 66, d: 34, r: 0}, -9, 80),
      [-25, -10, 65], [35, 10, 5]
    ];
    const P = k.fitProjection(EXTREMES, VW, VH, { pad: 16, headroom: 44, azimuth: 45, elevation: 25 });
    const at = (pt) => k.iso(pt, P);
    const S = (paths, style) => k.solidSvg(paths, style);

    const frontMatrix = (cx, cy, cz) => {
      const o = at([cx, cy, cz]);
      const ex = at([cx + 1, cy, cz]);
      const ez = at([cx, cy, cz - 1]);
      const dx = [ex[0] - o[0], ex[1] - o[1]];
      const dy = [ez[0] - o[0], ez[1] - o[1]];
      return `matrix(${dx[0].toFixed(4)} ${dx[1].toFixed(4)} ${dy[0].toFixed(4)} ${dy[1].toFixed(4)} ${o[0].toFixed(1)} ${o[1].toFixed(1)})`;
    };

    const L0 = [];
    const basePlan = { x: 2, y: 0, w: 64, d: 32, r: 4 };
    L0.push(`<path class="iso-halo" style="filter:blur(8px);transform:translateY(4px)" d="${k.haloOf(basePlan, -6, 6, P)}"/>`);
    L0.push(S(k.slabOf(basePlan, -6, 6, P), { tone: 'mid' }));
    k.corners(basePlan, 4).forEach(([fx, fy]) => {
      L0.push(S(k.cylinder(fx, fy, 3, -9, 3, P, 16), { tone: 'lo' }));
    });
    const binPlan = { x: 20, y: 0, w: 16, d: 14, r: 2 };
    L0.push(S(k.slabOf(binPlan, 0, 4, P), { tone: 'mid' }));
    L0.push(S(k.slabOf(k.insetPlan(binPlan, 1.5), 4, 1, P), { tone: 'lo' }));

    const L1 = [];
    L1.push(S(G.disc(0, 80, 2, G.frameAlong([30, 0, 0], [0, 0, 1]), P), { tone: 'mid' })); // Mast Rod
    L1.push(S(k.slabOf({ x: 0, y: -7.5, w: 15, d: 1.5, r: 0.5 }, 5, 75, P), { tone: 'lo' })); // Back plate
    L1.push(S(G.disc(5, 80, 1.5, G.frameAlong([-7.5, -6.5, 0], [0, 0, 1]), P), { tone: 'mid' })); // Back-L
    L1.push(S(G.disc(5, 80, 1.5, G.frameAlong([7.5, -6.5, 0], [0, 0, 1]), P), { tone: 'mid' })); // Back-R
    L1.push(S(k.slabOf({ x: -18, y: -6.5, w: 12, d: 1.5, r: 0.5 }, Z0 - 2, 4, P), { tone: 'mid' })); // Hopper Back

    const L2 = [];
    L2.push(S(k.slabOf({ x: -16, y: 0, w: 4, d: 8, r: 1 }, Z0 - (N-1)*DZ - 5, (N-1)*DZ + 15, P), { tone: 'mid' })); // Solenoid Base

    const L5 = [];
    L5.push(S(G.disc(5, 80, 1.5, G.frameAlong([-7.5, 6.5, 0], [0, 0, 1]), P), { tone: 'mid' })); // Front-L
    L5.push(S(G.disc(5, 80, 1.5, G.frameAlong([7.5, 6.5, 0], [0, 0, 1]), P), { tone: 'mid' })); // Front-R
    L5.push(S(k.slabOf({ x: -18, y: 6.5, w: 12, d: 1.5, r: 0.5 }, Z0 - 2, 4, P), { tone: 'mid' })); // Hopper Front
    L5.push(S(k.slabOf({ x: 0, y: 0, w: 18, d: 16, r: 1 }, 80, 2, P), { tone: 'hi', crease: 'lo' })); // Top Cap

    const leftPlungersSvg = (st) => {
      let out = '';
      for (let i = 0; i < N; i++) {
        const z = Z0 - i * DZ;
        const F = G.frameAlong([-15, 0, z + H/2], [1, 0, 0]);
        out += S(G.disc(0, 2, 2.5, F, P), { tone: 'mid' });
        const ext = (st.actPlunger === i) ? st.px : 0;
        out += S(G.disc(2, 2 + 2 + ext * 6.5, 0.9, F, P), { tone: 'hi' });
      }
      return out;
    };

    const carriageSvg = (st) => {
      const cz = st.carZ;
      let out = '';
      out += S(k.slabOf({ x: 22, y: 0, w: 10, d: 8, r: 1 }, cz - 2, 2, P), { tone: 'mid' });
      out += S(k.slabOf({ x: 30, y: 0, w: 6, d: 6, r: 1.5 }, cz - 2, 9, P), { tone: 'mid' });
      const F = G.frameAlong([33, 0, cz + H/2], [-1, 0, 0]);
      out += S(G.disc(0, 4, 2.5, F, P), { tone: 'hi', crease: 'lo' });
      out += S(G.disc(4, 4 + 0.5 + st.cpx * 22, 0.9, F, P), { tone: 'hi' });
      return out;
    };

    const blocksSvg = (st) => {
      const sorted = [...st.blocks].sort((a, b) => k.depthOf([a.x, 0, a.z], P) - k.depthOf([b.x, 0, b.z], P));
      return sorted.map(b => {
        const solid = k.slabOf({ x: b.x, y: 0, w: W, d: D, r: 1 }, b.z, H, P, 4, 0.8);
        const paths = S(solid, { tone: b.tone, lit: b.accent });
        const text = `<text class="mm-glyph" data-g="${b.accent ? 'sign' : ''}" transform="${frontMatrix(b.x, 5.6, b.z + 4.5)}" font-size="4.5">${b.id}</text>`;
        return paths + text;
      }).join('');
    };

    const cacheTl = new Map();
    const tlFor = (span) => {
      const key = Math.round(span * 1000);
      if (!cacheTl.has(key)) cacheTl.set(key, timeline(p, s, span));
      return cacheTl.get(key);
    };

    return {
      viewBox: [VW, VH],
      layers: [
        { s: L0.join('') + L1.join('') + L2.join('') },
        { d: (st) => leftPlungersSvg(st) + carriageSvg(st) },
        { d: blocksSvg },
        { s: L5.join('') }
      ],
      meta: { corner: `CAPACITY ${N}`, label: 'LRU CHUTE', accent: null },
      at(t, span = 5) {
        return tlFor(span)(t);
      },
      readout(st) {
        return {
          label: 'LRU CACHE',
          value: 'TOKEN ' + st.next,
          tag: st.isHit ? 'FOUND' : 'EVICTED',
          tagIn: st.tagIn
        };
      }
    };
  }

  M_.register('lru-chute', { normalize, build });
})(typeof window !== 'undefined' ? window : globalThis);
```

```json
{
  "scenes": [
    {
      "headline": "New item evicts the oldest.",
      "subhead": "chute is full, capacity 4",
      "params": {
        "capacity": 4
      },
      "state": {
        "cache": ["A", "B", "C", "D"],
        "next": "E"
      }
    },
    {
      "headline": "Requested item is a hit.",
      "subhead": "carriage plucks it out",
      "params": {
        "capacity": 4
      },
      "state": {
        "cache": ["E", "A", "B", "C"],
        "next": "B"
      }
    },
    {
      "headline": "Hit moves to the top.",
      "subhead": "recently used, safe from eviction",
      "params": {
        "capacity": 4
      },
      "state": {
        "cache": ["B", "E", "A", "C"],
        "next": "C"
      }
    }
  ]
}
```
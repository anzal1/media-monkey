MAPPING: Four spring-loaded thread plungers compete to drop into a single socket on a sliding mutex block; only one can fully enter, while the others strike the surface and must wait.
PARTS: The base consists of a heavy floor plate on four cylindrical feet, corner screws, two end brackets, and two polished horizontal guide rails. The static structure adds a massive overhead gantry beam supported by two rear pillars, housing four vertical actuator bodies with bezel rings and top caps. The dynamic mechanism includes the sliding carriage (built from a lower base, a tall back wall, and two front retaining lips that form a single central notch) and four plunging threads, each featuring a polished shaft, a thick collar, and a solid tip that drops into the notch or strikes the carriage roof.
KIND: mutex-interlock

```javascript
(function (root) {
  'use strict';
  const M_ = root.MM_MACHINES;
  if (!M_) return;
  const { glide, smooth, clamp01, prismX } = M_.util;

  function normalize(params, state) {
    const threads = Math.max(2, Math.min(4, params.threads || 4));
    const fromQueue = Array.isArray(state.from) ? state.from : [];
    const toQueue = Array.isArray(state.to) ? state.to : [1];
    return {
      p: {
        threads,
        label: params.label || 'MUTEX LOCK',
      },
      s: {
        from: fromQueue,
        to: toQueue,
      },
    };
  }

  function build(p, s) {
    const { k, G } = root.ANATOMY;
    const N = p.threads;

    const VW = 1000;
    const PAD = 8;
    const HEADROOM = 44;
    const AZIMUTH = 45;
    const ELEVATION = 30;

    // Dimensions
    const PITCH = 24;
    const START_X = -((N - 1) * PITCH) / 2;
    const X_POS = Array.from({ length: N }, (_, i) => START_X + i * PITCH);
    
    const Z_ACQ = 10;
    const Z_BLK = 21;
    const Z_IDLE = 31;

    const EXTREMES = [
      [-65, -20, -5],
      [65, 20, 50]
    ];
    
    const PROJ = k.fitProjection(EXTREMES, VW, 560, { pad: PAD, headroom: HEADROOM, azimuth: AZIMUTH, elevation: ELEVATION });
    const at = (pt) => k.iso(pt, PROJ);
    const S = (paths, style) => k.solidSvg(paths, style);
    const L = (d, style) => k.lineSvg(d, style);
    const D = (pts, style) => k.dotsSvg(pts, style);

    // Static parts
    const staticBase = [];
    const basePlan = { x: 0, y: -2, w: 110, d: 36, r: 4 };
    staticBase.push(`<path class="iso-halo" style="filter:blur(10px);transform:translateY(4px)" d="${k.haloOf(basePlan, -5, 5, PROJ)}"/>`);
    
    // Feet and Screws
    for (const [fx, fy] of k.corners(basePlan, 6)) {
      staticBase.push(S(k.cylinder(fx, fy, 4, -10, 5, PROJ, 24), { tone: 'lo' }));
      staticBase.push(S(k.cylinder(fx, fy, 3, -5, 1, PROJ, 24), { tone: 'mid' }));
    }
    staticBase.push(S(k.slabOf(basePlan, -5, 5, PROJ, 8, 1), { tone: 'lo' }));
    const screws = k.corners(basePlan, 4);
    staticBase.push(D(screws.map(([sx, sy]) => at([sx, sy, 0])), { size: 1.2, tone: 'mid' }));

    // Rail brackets and Rails
    const bracketPlanL = { x: -50, y: -2, w: 6, d: 20, r: 2 };
    const bracketPlanR = { x: 50, y: -2, w: 6, d: 20, r: 2 };
    staticBase.push(S(k.slabOf(bracketPlanL, 0, 9, PROJ), { tone: 'mid' }));
    staticBase.push(S(k.slabOf(bracketPlanR, 0, 9, PROJ), { tone: 'mid' }));

    const F_rail1 = G.frameAlong([-50, -7, 4], [1, 0, 0]);
    const F_rail2 = G.frameAlong([-50, 3, 4], [1, 0, 0]);
    staticBase.push(S(G.disc(0, 100, 1.5, F_rail1, PROJ), { tone: 'hi', crease: 'lo' }));
    staticBase.push(S(G.disc(0, 100, 1.5, F_rail2, PROJ), { tone: 'hi', crease: 'lo' }));
    staticBase.push(D([at([-50, -7, 4]), at([50, -7, 4]), at([-50, 3, 4]), at([50, 3, 4])], { size: 1.2, tone: 'hi' }));

    // Gantry
    const pillarL = { x: -50, y: 0, w: 6, d: 10, r: 1.5 };
    const pillarR = { x: 50, y: 0, w: 6, d: 10, r: 1.5 };
    staticBase.push(S(k.slabOf(pillarL, 9, 36, PROJ), { tone: 'mid' }));
    staticBase.push(S(k.slabOf(pillarR, 9, 36, PROJ), { tone: 'mid' }));
    const beamPlan = { x: 0, y: 0, w: 106, d: 10, r: 2 };
    staticBase.push(S(k.slabOf(beamPlan, 45, 5, PROJ, 8, 1), { tone: 'hi' }));

    // Actuator bodies
    for (let i = 0; i < N; i++) {
      const xi = X_POS[i];
      const F_act = G.frameAlong([xi, 0, 0], [0, 0, 1]);
      staticBase.push(S(G.disc(35, 45, 4.5, F_act, PROJ), { tone: 'mid' }));
      staticBase.push(S(G.disc(33, 35, 5.5, F_act, PROJ), { tone: 'lo' }));
      // Indicator bezel
      const F_bez = G.frameAlong([xi, -4.5, 40], [0, -1, 0]);
      staticBase.push(S(G.disc(0, 1, 2, F_bez, PROJ), { tone: 'hi' }));
    }

    const merged = [{ s: staticBase.join('') }];

    // Carriage Polygons (Y-Z plane)
    const polyBase = [[-12, 6], [10, 6], [10, 9], [-12, 9]];
    const polyBack = [[-12, 9], [-4, 9], [-4, 21], [-12, 21]];
    const polyLip = [[4, 17], [10, 17], [10, 21], [4, 21]];

    return {
      viewBox: [VW, 560],
      layers: [
        ...merged,
        {
          d: (st) => {
            const parts = [];
            const pushCarriage = (cy, cz, x0, x1, poly, tone) => {
              const cx = (x0 + x1) / 2;
              parts.push({ depth: k.depthOf([cx, cy, cz], PROJ), svg: S(prismX(poly, x0, x1, PROJ), { tone }) });
            };
            
            const xc = st.x_block;
            pushCarriage(-1, 7.5, xc - 14, xc + 14, polyBase, 'mid');
            pushCarriage(-8, 15, xc - 14, xc + 14, polyBack, 'hi');
            pushCarriage(7, 19, xc - 14, xc - 4.5, polyLip, 'mid');
            pushCarriage(7, 19, xc + 4.5, xc + 14, polyLip, 'mid');

            for (let i = 0; i < N; i++) {
              const xi = X_POS[i];
              const zt = st.threads[i].z;
              const isAcq = st.threads[i].acq;
              
              const F = G.frameAlong([xi, 0, 0], [0, 0, 1]);
              
              const pTip = G.disc(zt, zt + 4, 3, F, PROJ);
              let svgTip = S(pTip, { tone: isAcq ? 'hi' : 'mid' });
              if (isAcq) svgTip += `<path class="mm-accent" d="${pTip.outline}"/>`;
              parts.push({ depth: k.depthOf([xi, 0, zt + 2], PROJ), svg: svgTip });

              const pShaft = G.disc(zt + 4, 33, 1.5, F, PROJ);
              parts.push({ depth: k.depthOf([xi, 0, 20], PROJ), svg: S(pShaft, { tone: 'faint' }) });

              const pCollar = G.disc(zt + 12, zt + 16, 3.5, F, PROJ);
              parts.push({ depth: k.depthOf([xi, 0, zt + 14], PROJ), svg: S(pCollar, { tone: 'mid' }) });
              
              // Status indicator light mapping (glows if thread has lock)
              if (isAcq) {
                const lp = at([xi, -5.5, 40]);
                parts.push({ depth: k.depthOf([xi, -6, 40], PROJ) + 10, svg: `<circle cx="${lp[0]}" cy="${lp[1]}" r="1.4" class="iso-halo" fill="var(--anatomy-lit)" opacity="0.9"/>` });
              }
            }

            return parts.sort((a, b) => a.depth - b.depth).map((p) => p.svg).join('');
          }
        }
      ],
      meta: {
        corner: 'INTERLOCK',
        label: p.label,
        accent: null,
      },
      at(t, span = 5) {
        const u = clamp01((t - 0.7) / (span - 1.5));
        const pLift = smooth(0.0, 0.25, u);
        const pSlide = glide(smooth(0.25, 0.75, u));
        const pDrop = smooth(0.75, 1.0, u);

        const fromQ = s.from;
        const toQ = s.to;
        const B_from = fromQ.length ? fromQ[0] : (toQ.length ? toQ[0] : 0);
        const B_to = toQ.length ? toQ[0] : B_from;
        
        const x_block = X_POS[B_from] + (X_POS[B_to] - X_POS[B_from]) * pSlide;
        
        const threads = [];
        for (let i = 0; i < N; i++) {
          const O_f = fromQ[0] === i;
          const W_f = fromQ.includes(i) && !O_f;
          const O_t = toQ[0] === i;
          const W_t = toQ.includes(i) && !O_t;
          
          const z_f = O_f ? Z_ACQ : (W_f ? Z_BLK : Z_IDLE);
          const z_t = O_t ? Z_ACQ : (W_t ? Z_BLK : Z_IDLE);
          
          let z_mid;
          if (z_f === Z_ACQ && z_t === Z_ACQ) z_mid = Z_ACQ;
          else if (z_f === Z_ACQ) z_mid = z_t;
          else if (z_t === Z_ACQ) z_mid = Z_BLK;
          else z_mid = (z_f === Z_BLK || z_t === Z_BLK) ? Z_BLK : Z_IDLE;
          
          const z1 = z_f + (z_mid - z_f) * pLift;
          const z_curr = z1 + (z_t - z_mid) * pDrop;
          
          threads.push({
            z: z_curr,
            acq: z_curr < Z_ACQ + 0.1
          });
        }
        
        return { x_block, threads, tagIn: smooth(0, 0.3, u) };
      },
      readout(st) {
        const owner = s.to.length ? s.to[0] : null;
        return {
          label: 'MUTEX LOCK',
          value: owner !== null ? `THREAD ${owner}` : 'FREE',
          tag: s.to.length > 1 ? 'CONTENTION' : '',
          tagIn: st.tagIn,
        };
      },
    };
  }

  M_.register('mutex-interlock', { normalize, build });
})(typeof window !== 'undefined' ? window : globalThis);
```

```json
{
  "scenes": [
    {
      "headline": "The lock is free.",
      "subhead": "thread 1 claims the block",
      "params": {
        "threads": 4,
        "label": "CRITICAL SECTION"
      },
      "state": {
        "from": [],
        "to": [1]
      }
    },
    {
      "headline": "Mutual exclusion in action.",
      "subhead": "others strike the surface and wait",
      "params": {
        "threads": 4,
        "label": "CRITICAL SECTION"
      },
      "state": {
        "from": [1],
        "to": [1, 2, 0]
      }
    },
    {
      "headline": "The lock is handed over.",
      "subhead": "thread 1 yields to thread 2",
      "params": {
        "threads": 4,
        "label": "CRITICAL SECTION"
      },
      "state": {
        "from": [1, 2, 0],
        "to": [2, 0]
      }
    },
    {
      "headline": "The queue advances.",
      "subhead": "thread 0 takes its turn",
      "params": {
        "threads": 4,
        "label": "CRITICAL SECTION"
      },
      "state": {
        "from": [2, 0],
        "to": [0]
      }
    }
  ]
}
```
MAPPING: Four spring-loaded thread plungers compete to drop into a single socket on a sliding mutex block; only one can fully enter, while the others strike the surface and must wait.
PARTS: The base consists of a heavy floor plate on four cylindrical feet, corner screws, two end brackets, and two polished horizontal guide rails. The static structure adds a massive overhead gantry beam supported by two rear pillars, housing four vertical actuator bodies with bezel rings and lower flanges. The dynamic mechanism includes the sliding carriage (built from a solid base, a continuous tall back wall, and two front roof segments that form a central open notch) and four plunging threads, each featuring a polished shaft and a solid tip that either drops into the notch or strikes the carriage roof.
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
    const PAD = 24;
    const HEADROOM = 44;
    const AZIMUTH = 45;
    const ELEVATION = 30;

    // Dimensions
    const PITCH = 18;
    const START_X = -((N - 1) * PITCH) / 2;
    const X_POS = Array.from({ length: N }, (_, i) => START_X + i * PITCH);
    
    const Z_ACQ = 7;
    const Z_BLK = 13;
    const Z_IDLE = 20;

    // Absolute maximum safe bounding box covering the entire machine travel and structure
    // This strictly encompasses all coordinates (X: -100 to 100, Y: -30 to 30, Z: -15 to 60)
    const EXTREMES = k.boxCorners({ x: 0, y: 0, w: 200, d: 60 }, -15, 60);
    
    // Exact fitting viewport calculation
    const flat = EXTREMES.map((pt) => k.iso(pt, { origin: [0, 0], scale: 1, azimuth: AZIMUTH, elevation: ELEVATION }));
    const w = Math.max(...flat.map((q) => q[0])) - Math.min(...flat.map((q) => q[0]));
    const h = Math.max(...flat.map((q) => q[1])) - Math.min(...flat.map((q) => q[1]));
    const VH = Math.round(Math.max(420, Math.min(700, (h * (VW - 2 * PAD)) / w + 2 * PAD + HEADROOM)));
    
    const PROJ = k.fitProjection(EXTREMES, VW, VH, { pad: PAD, headroom: HEADROOM, azimuth: AZIMUTH, elevation: ELEVATION });
    const at = (pt) => k.iso(pt, PROJ);
    const S = (paths, style) => k.solidSvg(paths, style);
    const L = (d, style) => k.lineSvg(d, style);
    const D = (pts, style) => k.dotsSvg(pts, style);

    // Static parts
    const staticBase = [];
    const basePlan = { x: 0, y: 0, w: 180, d: 40, r: 4 };
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
    const bracketPlanL = { x: -80, y: -1, w: 6, d: 24, r: 2 };
    const bracketPlanR = { x: 80, y: -1, w: 6, d: 24, r: 2 };
    staticBase.push(S(k.slabOf(bracketPlanL, 0, 9, PROJ), { tone: 'mid' }));
    staticBase.push(S(k.slabOf(bracketPlanR, 0, 9, PROJ), { tone: 'mid' }));

    const F_rail1 = G.frameAlong([-80, -7, 4], [1, 0, 0]);
    const F_rail2 = G.frameAlong([-80, 5, 4], [1, 0, 0]);
    staticBase.push(S(G.disc(0, 160, 1.5, F_rail1, PROJ), { tone: 'hi', crease: 'lo' }));
    staticBase.push(S(G.disc(0, 160, 1.5, F_rail2, PROJ), { tone: 'hi', crease: 'lo' }));

    // Gantry Pillars and Beam
    const pillarL = { x: -75, y: -2, w: 8, d: 10, r: 1.5 };
    const pillarR = { x: 75, y: -2, w: 8, d: 10, r: 1.5 };
    staticBase.push(S(k.slabOf(pillarL, 0, 38, PROJ), { tone: 'mid' }));
    staticBase.push(S(k.slabOf(pillarR, 0, 38, PROJ), { tone: 'mid' }));
    const beamPlan = { x: 0, y: -2, w: 166, d: 14, r: 2 };
    staticBase.push(S(k.slabOf(beamPlan, 38, 5, PROJ, 8, 1), { tone: 'hi' }));

    // Actuator bodies
    for (let i = 0; i < N; i++) {
      const xi = X_POS[i];
      const F_act = G.frameAlong([xi, 0, 0], [0, 0, 1]);
      staticBase.push(S(G.disc(25, 38, 4.5, F_act, PROJ), { tone: 'mid' }));
      staticBase.push(S(G.disc(23.1, 25, 5.5, F_act, PROJ), { tone: 'lo' }));
      
      // Indicator bezel on front
      const F_bez = G.frameAlong([xi, -4.5, 40], [0, -1, 0]);
      staticBase.push(S(G.disc(0, 1, 2.5, F_bez, PROJ), { tone: 'hi' }));
      staticBase.push(S(G.disc(1, 1.5, 3, F_bez, PROJ), { tone: 'mid' }));
    }

    const merged = [{ s: staticBase.join('') }];

    // Carriage Polygons (Y-Z plane, Y grows away from viewer)
    const pBase = [[-8, 4], [8, 4], [8, 7], [-8, 7]];
    const pBack = [[2, 7], [8, 7], [8, 17], [2, 17]];
    const pRoof = [[-8, 7], [2, 7], [2, 13], [-8, 13]];

    return {
      viewBox: [VW, VH],
      layers: [
        ...merged,
        {
          d: (st) => {
            const parts = [];
            const pushCarriage = (cy, cz, x0, x1, poly, tone) => {
              if (x1 <= x0) return;
              const cx = (x0 + x1) / 2;
              let depth = k.depthOf([cx, cy, cz], PROJ);
              // Nudge base depth slightly so threads sitting on it draw after it
              if (poly === pBase) depth -= 0.1;
              parts.push({ depth, svg: S(prismX(poly, x0, x1, PROJ), { tone, crease: 'faint' }) });
            };
            
            const xc = st.x_block;
            
            // Continuous parts (carriage covers all waiting threads)
            pushCarriage(0, 5.5, xc - 56, xc + 56, pBase, 'mid');
            pushCarriage(5, 12, xc - 56, xc + 56, pBack, 'hi');
            // Split front roof creates the open notch in the center
            pushCarriage(-3, 10, xc - 56, xc - 4.5, pRoof, 'mid');
            pushCarriage(-3, 10, xc + 4.5, xc + 56, pRoof, 'mid');

            // Plunging threads
            for (let i = 0; i < N; i++) {
              const xi = X_POS[i];
              const zt = st.threads[i].z;
              const isAcq = st.threads[i].acq;
              
              const F = G.frameAlong([xi, 0, 0], [0, 0, 1]);
              
              const pTip = G.disc(zt, zt + 3, 2.5, F, PROJ);
              let svgTip = S(pTip, { tone: isAcq ? 'hi' : 'mid', crease: 'lo' });
              if (isAcq) svgTip += `<path class="mm-accent" d="${pTip.outline}"/>`;
              parts.push({ depth: k.depthOf([xi, 0, zt + 1.5], PROJ), svg: svgTip });

              // Polished shaft extends up to actuator flange
              if (zt + 3 < 23) {
                const pShaft = G.disc(zt + 3, 23.1, 1.5, F, PROJ);
                parts.push({ depth: k.depthOf([xi, 0, 15], PROJ), svg: S(pShaft, { tone: 'faint' }) });
              }
              
              // Status indicator light mapping (glows if thread has lock)
              if (isAcq) {
                const lp = at([xi, -6, 40]);
                const cr = PROJ.scale * 1.5;
                parts.push({ depth: k.depthOf([xi, -6, 40], PROJ) + 10, svg: `<circle cx="${lp[0].toFixed(2)}" cy="${lp[1].toFixed(2)}" r="${cr.toFixed(2)}" fill="var(--anatomy-lit)" opacity="0.95"/>` });
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
          const O_f = fromQ.length && fromQ[0] === i;
          const W_f = fromQ.includes(i) && !O_f;
          const O_t = toQ.length && toQ[0] === i;
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
          label: p.label,
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
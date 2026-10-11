MAPPING: A mechanical comparator spans a row of gauge blocks, dropping a balancing beam to weigh the middle block against a target reference, sliding its boundary markers inward to discard half the array based on the tilt.

PARTS: 
Base: A heavy steel base plate with four screw-in feet, featuring two long inset grooves for the block tray and target track.
Structure: Left and right vertical cheeks supporting three spanning rails: a front carriage rail, a back carriage rail, and a lower boundary rail.
Subject: An array of sorted brass gauge blocks, each engraved with its value on top, representing the sorted elements. A separate target gauge block rides in the target track.
Mechanism: Two sliding boundary brackets (left and right) on the lower rail that frame the active search space. A bridging carriage assembly rolling on the top rails. A central head block that slides vertically inside the carriage. A pivoting balancing beam mounted on the head. Two plunger pins suspended from the beam: one drops onto the target block, the other onto the active array block, tilting the beam to physically compare their heights.

KIND: comparator-rack

```javascript
(function (root) {
  'use strict';
  const M_ = root.MM_MACHINES;
  if (!M_) return;
  const { glide, hump, smooth, prismX, turnYZ, clamp01 } = M_.util;
  
  const AZIMUTH = 45;
  const ELEVATION = 30;
  const VW = 1000;
  const VH = 700;
  const PAD = 16;
  const HEADROOM = 44;

  function normalize(params, state) {
    const array = (params.array || "11, 22, 33, 44, 55, 66, 77").split(',').map(s => Number(s.trim()));
    const target = Number(params.target || 22);
    const L = Math.max(0, Math.min(array.length - 1, Number(state.L || 0)));
    const R = Math.max(0, Math.min(array.length - 1, Number(state.R || array.length - 1)));
    const prevMid = state.prevMid != null ? Number(state.prevMid) : Math.floor((L + R) / 2);
    return { p: { array, target }, s: { L, R, prevMid } };
  }

  function build(p, s) {
    const { k, G } = root.ANATOMY;
    const N = p.array.length;
    const PITCH = 32;
    const X0 = 40;
    
    const minVal = Math.min(...p.array, p.target);
    const maxVal = Math.max(...p.array, p.target);
    const heightOf = (v) => 15 + (maxVal > minVal ? ((v - minVal) / (maxVal - minVal)) * 30 : 15);
    const Ht = heightOf(p.target);

    const x_of = (i) => X0 + i * PITCH;
    const max_X = x_of(N - 1) + 40;
    
    const EXTREMES = [
      [-20, -25, 0], [max_X + 20, 65, 0],
      [max_X + 10, -20, 95], [0, -20, 95],
      [max_X / 2, 40, 105]
    ];
    const P = k.fitProjection(EXTREMES, VW, VH, { pad: PAD, headroom: HEADROOM, azimuth: AZIMUTH, elevation: ELEVATION });
    
    const at = (pt) => k.iso(pt, P);
    const S = (paths, style) => k.solidSvg(paths, style);
    const L_line = (d, style) => k.lineSvg(d, style);
    
    // --- Pre-build Static Layers ---
    const basePlan = { x: -10, y: -25, w: max_X + 20, d: 90, r: 4 };
    let staticBase = '';
    staticBase += `<path class="iso-halo" style="filter:blur(8px);transform:translateY(6px)" d="${k.haloOf(basePlan, -5, 5, P)}"/>`;
    for (const [fx, fy] of k.corners(basePlan, 6)) {
      staticBase += S(k.cylinder(fx, fy, 4, -5, 5, P, 16), { tone: 'lo' });
    }
    staticBase += S(k.slabOf(basePlan, 0, 5, P, 8, 1), { tone: 'mid' });
    staticBase += L_line(k.planOutline({x: 30, y: -10, w: max_X - 60, d: 20, r: 2}, 5, P), { tone: 'faint' }); // array groove
    staticBase += L_line(k.planOutline({x: 20, y: 32, w: max_X - 40, d: 20, r: 2}, 5, P), { tone: 'faint' }); // target groove

    const rightCheek = S(k.slabOf({x: max_X, y: -20, w: 10, d: 80, r: 2}, 5, 80, P), { tone: 'mid' });
    const leftCheek = S(k.slabOf({x: -10, y: -20, w: 10, d: 80, r: 2}, 5, 80, P), { tone: 'mid' });
    
    const backRail = S(k.cylinder(0, 55, 3, -10, max_X + 20, P, 12), { tone: 'lo' });
    const frontRail = S(k.cylinder(0, -15, 3, -10, max_X + 20, P, 12), { tone: 'mid' });
    const bracketRail = S(k.cylinder(0, 20, 2.5, -10, max_X + 20, P, 12), { tone: 'lo' });

    // --- Pre-build Discrete Parts for Dynamic Sorting ---
    const staticBlocks = p.array.map((val, i) => {
      const h = heightOf(val);
      const cx = x_of(i);
      const solid = S(k.slabOf({x: cx - 10, y: -8, w: 20, d: 16, r: 1.5}, 5, h, P), { tone: 'hi' });
      const text = k.faceTextSvg(k.topMatrix([cx, 0], 5 + h, P), val, { size: 6, tone: 'mid' });
      return { id: `b${i}`, html: solid + text, pt: [cx, 0, 5 + h / 2], val, h, cx };
    });

    const buildBracket = (isLeft) => {
      return S(k.slabOf({x: -6, y: -14, w: 12, d: 40, r: 2}, 8, 14, P), { tone: 'mid' }) +
             L_line(k.lineOnTop([0, -12], [0, 24], 22, P), { tone: isLeft ? 'lit' : 'hi', weight: 2 });
    };
    const lBracketPre = buildBracket(true);
    const rBracketPre = buildBracket(false);

    // Carriage pieces built at origin
    const c_backRider = S(k.slabOf({x: -14, y: 45, w: 28, d: 13, r: 2}, 78, 12, P), { tone: 'mid' });
    const c_frontRider = S(k.slabOf({x: -14, y: -18, w: 28, d: 13, r: 2}, 78, 12, P), { tone: 'mid' });
    const c_sideArm = S(k.slabOf({x: -14, y: -5, w: 8, d: 50, r: 1}, 80, 8, P), { tone: 'mid' });
    const c_targetCol = S(k.slabOf({x: -12, y: 34, w: 8, d: 12, r: 1}, 5, 75, P), { tone: 'lo' });
    const c_targetShelf = S(k.slabOf({x: -14, y: 32, w: 24, d: 16, r: 1.5}, 5, 2, P), { tone: 'mid' });
    const c_targetBlock = S(k.slabOf({x: -8, y: 34, w: 16, d: 12, r: 1}, 7, Ht, P), { tone: 'hi' });
    const c_targetText = k.faceTextSvg(k.topMatrix([0, 40], 7 + Ht, P), p.target, { size: 5, tone: 'mid' });

    return {
      viewBox: [VW, VH],
      layers: [
        { s: staticBase },
        { s: rightCheek },
        { s: backRail },
        { s: bracketRail },
        { d: (st) => {
            const parts = [];
            
            // Array Blocks
            for (const b of staticBlocks) {
              let html = b.html;
              if (b.val === st.val && st.tagIn > 0) {
                const outline = k.slabOf({x: b.cx - 10, y: -8, w: 20, d: 16, r: 1.5}, 5, b.h, P).outline;
                html += `<path class="mm-accent" opacity="${st.tagIn.toFixed(2)}" d="${outline}"/>`;
              }
              parts.push({ html, pt: b.pt });
            }

            // Brackets
            const lx = x_of(st.L_curr) - 16;
            parts.push({ html: `<g transform="${k.translateAlong(P, [lx, 0, 0])}">${lBracketPre}</g>`, pt: [lx, 6, 15] });
            const rx = x_of(st.R_curr) + 16;
            parts.push({ html: `<g transform="${k.translateAlong(P, [rx, 0, 0])}">${rBracketPre}</g>`, pt: [rx, 6, 15] });

            // Carriage parts
            const X = st.X;
            const t_wrap = (html) => `<g transform="${k.translateAlong(P, [X, 0, 0])}">${html}</g>`;
            parts.push({ html: t_wrap(c_backRider), pt: [X, 51, 84] });
            parts.push({ html: t_wrap(c_sideArm), pt: [X - 10, 20, 84] });
            parts.push({ html: t_wrap(c_targetCol), pt: [X - 8, 40, 42] });
            parts.push({ html: t_wrap(c_targetShelf), pt: [X - 2, 40, 6] });
            parts.push({ html: t_wrap(c_targetBlock + c_targetText), pt: [X, 40, 7 + Ht / 2] });

            // Dynamic Head & Plungers
            const head = S(k.slabOf({x: X - 5, y: 14, w: 10, d: 12, r: 1}, st.Z_head - 6, 12, P), { tone: 'lo' });
            parts.push({ html: head, pt: [X, 20, st.Z_head] });

            const tilt = st.tilt;
            const profile = [[-20, -3], [20, -3], [20, 3], [-20, 3]];
            const rot = turnYZ(profile, 0, 0, tilt);
            const beam = S(prismX(rot, X - 2, X + 2, P), { tone: 'hi' });
            parts.push({ html: `<g transform="${k.translateAlong(P, [0, 20, st.Z_head])}">${beam}</g>`, pt: [X, 20, st.Z_head] });

            const pinTY = 20 + 20 * Math.cos(tilt);
            const pinAY = 20 - 20 * Math.cos(tilt);
            
            const tPinZ = st.Z_head + 20 * Math.sin(tilt);
            const tTipZ = tPinZ - 35;
            const tPlunger = S(k.cylinder(X, pinTY, 1.5, tTipZ, 35, P, 12), { tone: 'lo' });
            parts.push({ html: tPlunger, pt: [X, pinTY, tPinZ - 17] });

            const aPinZ = st.Z_head - 20 * Math.sin(tilt);
            const aTipZ = aPinZ - 35;
            const aPlunger = S(k.cylinder(X, pinAY, 1.5, aTipZ, 35, P, 12), { tone: 'lo' });
            parts.push({ html: aPlunger, pt: [X, pinAY, aPinZ - 17] });

            // Sort and draw
            parts.sort((a, b) => k.depthOf(a.pt, P) - k.depthOf(b.pt, P));
            return parts.map(p => p.html).join('');
          }
        },
        { s: frontRail },
        { d: (st) => `<g transform="${k.translateAlong(P, [st.X, 0, 0])}">${c_frontRider}</g>` },
        { s: leftCheek }
      ],
      meta: { corner: 'COMPARATOR RACK', label: 'BINARY SEARCH', accent: null },
      at(t, span = 5) {
        const mid = Math.floor((s.L + s.R) / 2);
        const val = p.array[mid];
        
        let newL = s.L; let newR = s.R;
        if (val < p.target) newL = mid + 1;
        else if (val > p.target) newR = mid - 1;

        const u_bridge = smooth(0.5, 1.2, t);
        const u_head = glide(smooth(1.4, 2.0, t)) - smooth(3.8, 4.4, t);
        const u_bounds = glide(smooth(2.4, 3.2, t));
        
        const X = x_of(s.prevMid) + (x_of(mid) - x_of(s.prevMid)) * u_bridge;
        
        const Ha = heightOf(val);
        const Z_head_up = 95;
        const Z_head_down = (Ht + Ha) / 2 + 41;
        const Z_head = Z_head_up + (Z_head_down - Z_head_up) * u_head;
        
        const tilt_final = Math.atan2(Ht - Ha + 2, 40);
        const tilt = tilt_final * u_head;

        const L_curr = s.L + (newL - s.L) * u_bounds;
        const R_curr = s.R + (newR - s.R) * u_bounds;

        const tagIn = (val === p.target && t > 2.4) ? smooth(2.4, 2.8, t) : 0;
        
        return { X, Z_head, tilt, L_curr, R_curr, val, tagIn };
      },
      readout(st) {
        const mid = Math.floor((s.L + s.R) / 2);
        let tag = '';
        if (st.val < p.target) tag = 'TOO SMALL';
        else if (st.val > p.target) tag = 'TOO BIG';
        else tag = 'FOUND';
        if (s.L > s.R) tag = 'NOT FOUND';

        return {
          label: `TARGET: ${p.target}`,
          value: `MID: ${st.val}`,
          tag,
          tagIn: (st.tagIn > 0) ? st.tagIn : (st.tilt !== 0 ? 1 : 0)
        };
      },
    };
  }
  M_.register('comparator-rack', { normalize, build });
})(typeof window !== 'undefined' ? window : globalThis);
```

```json
{
  "scenes": [
    {
      "headline": "Search the middle.",
      "subhead": "44 is greater than 22",
      "params": {
        "array": "11, 22, 33, 44, 55, 66, 77",
        "target": 22
      },
      "state": {
        "L": 0,
        "R": 6,
        "prevMid": 0
      }
    },
    {
      "headline": "Discard the right half.",
      "subhead": "the new range is 0 to 2",
      "params": {
        "array": "11, 22, 33, 44, 55, 66, 77",
        "target": 22
      },
      "state": {
        "L": 0,
        "R": 2,
        "prevMid": 3
      }
    },
    {
      "headline": "Target matched.",
      "subhead": "22 equals 22",
      "params": {
        "array": "11, 22, 33, 44, 55, 66, 77",
        "target": 22
      },
      "state": {
        "L": 0,
        "R": 0,
        "prevMid": 1
      }
    }
  ]
}
```
(function (root) {
  'use strict';
  const M_ = root.MM_MACHINES;
  if (!M_) return;
  const { glide, smooth, prismX, turnYZ, clamp01 } = M_.util;
  
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
    
    const rearRail = S(k.slabOf({x: -10, y: -16, w: max_X + 30, d: 4, r: 2}, 78, 4, P), { tone: 'mid' });
    const bracketRail = S(k.slabOf({x: -10, y: 19, w: max_X + 30, d: 4, r: 2}, 10, 4, P), { tone: 'lo' });
    const frontRail = S(k.slabOf({x: -10, y: 54, w: max_X + 30, d: 4, r: 2}, 78, 4, P), { tone: 'mid' });

    // --- Pre-build Discrete Parts for Dynamic Sorting ---
    const staticBlocks = p.array.map((val, i) => {
      const h = heightOf(val);
      const cx = x_of(i);
      const blockSlab = k.slabOf({x: cx - 10, y: -8, w: 20, d: 16, r: 1.5}, 5, h, P);
      const solid = S(blockSlab, { tone: 'hi' });
      const text = k.faceTextSvg(k.topMatrix([cx, 0], 5 + h, P), String(val), { size: 6, tone: 'mid' });
      return { html: solid + text, outline: blockSlab.outline, pt: [cx, 0, 5 + h / 2], val };
    });

    const buildBracket = () => {
      return S(k.slabOf({x: -6, y: -14, w: 12, d: 40, r: 2}, 8, 14, P), { tone: 'mid' }) +
             L_line(k.lineOnTop([0, -12], [0, 24], 22, P), { tone: 'hi' });
    };
    const bracketPre = buildBracket();

    // Carriage pieces built at origin
    const riderRear = S(k.slabOf({x: -14, y: -18, w: 28, d: 13, r: 2}, 78, 12, P), { tone: 'mid' });
    const riderFront = S(k.slabOf({x: -14, y: 45, w: 28, d: 13, r: 2}, 78, 12, P), { tone: 'mid' });
    const c_sideArm = S(k.slabOf({x: -14, y: -5, w: 8, d: 50, r: 1}, 80, 8, P), { tone: 'mid' });
    const c_targetCol = S(k.slabOf({x: -14, y: 34, w: 8, d: 12, r: 1}, 5, 75, P), { tone: 'lo' });
    const c_targetShelf = S(k.slabOf({x: -14, y: 32, w: 24, d: 16, r: 1.5}, 5, 2, P), { tone: 'mid' });
    const c_targetBlock = S(k.slabOf({x: -4, y: 34, w: 14, d: 12, r: 1}, 7, Ht, P), { tone: 'hi' });
    const c_targetText = k.faceTextSvg(k.topMatrix([3, 40], 7 + Ht, P), String(p.target), { size: 5, tone: 'mid' });

    // Plunger & Head render functions per frame
    const aPlunger = (X, tilt, Z_head) => {
      const pinAY = 20 - 20 * Math.cos(tilt);
      const aPinZ = Z_head - 20 * Math.sin(tilt);
      return S(k.cylinder(X, pinAY, 1.5, aPinZ - 35, 35, P, 12), { tone: 'lo' });
    };
    const tPlunger = (X, tilt, Z_head) => {
      const pinTY = 20 + 20 * Math.cos(tilt);
      const tPinZ = Z_head + 20 * Math.sin(tilt);
      return S(k.cylinder(X, pinTY, 1.5, tPinZ - 35, 35, P, 12), { tone: 'lo' });
    };
    const headFn = (X, Z_head) => S(k.slabOf({x: X - 5, y: 14, w: 10, d: 12, r: 1}, Z_head - 6, 12, P), { tone: 'lo' });
    const beamFn = (X, Z_head, tilt) => {
      const profile = [[-20, -3], [20, -3], [20, 3], [-20, 3]];
      const rot = turnYZ(profile, 0, 0, tilt);
      const beamStr = S(prismX(rot, X - 2, X + 2, P), { tone: 'hi' });
      return `<g transform="${k.translateAlong(P, [0, 20, Z_head])}">${beamStr}</g>`;
    };

    const sortAndDraw = (parts) => {
      return parts.sort((a, b) => k.depthOf(a.pt, P) - k.depthOf(b.pt, P)).map(pt => pt.html).join('');
    };

    return {
      viewBox: [VW, VH],
      layers: [
        { s: staticBase },
        { s: leftCheek },
        { s: rearRail },
        { d: (st) => sortAndDraw([
            { html: `<g transform="${k.translateAlong(P, [st.X, 0, 0])}">${riderRear}</g>`, pt: [st.X, -11, 84] },
            ...staticBlocks.map(b => {
              let html = b.html;
              if (b.val === st.val && st.hlIn > 0) {
                html += `<path class="mm-accent" opacity="${st.hlIn.toFixed(2)}" d="${b.outline}"/>`;
              }
              return { html, pt: b.pt };
            }),
            { html: aPlunger(st.X, st.tilt, st.Z_head), pt: [st.X, 0, st.Z_head - 17] }
          ])
        },
        { s: bracketRail },
        { d: (st) => sortAndDraw([
            { html: `<g transform="${k.translateAlong(P, [x_of(st.L_curr) - 16, 0, 0])}">${bracketPre}</g>`, pt: [x_of(st.L_curr) - 16, 6, 15] },
            { html: `<g transform="${k.translateAlong(P, [x_of(st.R_curr) + 16, 0, 0])}">${bracketPre}</g>`, pt: [x_of(st.R_curr) + 16, 6, 15] }
          ])
        },
        { d: (st) => sortAndDraw([
            { html: `<g transform="${k.translateAlong(P, [st.X, 0, 0])}">${c_targetShelf}</g>`, pt: [st.X, 36, 6] },
            { html: `<g transform="${k.translateAlong(P, [st.X, 0, 0])}">${c_targetBlock + c_targetText}</g>`, pt: [st.X, 40, 7 + Ht / 2] },
            { html: `<g transform="${k.translateAlong(P, [st.X, 0, 0])}">${c_targetCol}</g>`, pt: [st.X, 40, 42] },
            { html: tPlunger(st.X, st.tilt, st.Z_head), pt: [st.X, 40, st.Z_head - 17] }
          ])
        },
        { s: frontRail },
        { d: (st) => sortAndDraw([
            { html: `<g transform="${k.translateAlong(P, [st.X, 0, 0])}">${riderFront}</g>`, pt: [st.X, 51, 84] },
            { html: `<g transform="${k.translateAlong(P, [st.X, 0, 0])}">${c_sideArm}</g>`, pt: [st.X - 10, 20, 84] },
            { html: headFn(st.X, st.Z_head), pt: [st.X, 20, st.Z_head] },
            { html: beamFn(st.X, st.Z_head, st.tilt), pt: [st.X, 20, st.Z_head + 5] }
          ])
        },
        { s: rightCheek }
      ],
      meta: { corner: 'COMPARATOR RACK', label: 'BINARY SEARCH', accent: null },
      at(t, span = 5) {
        const mid = Math.floor((s.L + s.R) / 2);
        const val = p.array[mid];
        
        let newL = s.L; let newR = s.R;
        if (val < p.target) newL = mid + 1;
        else if (val > p.target) newR = mid - 1;

        const u_bridge = smooth(0.7, 1.3, t);
        const u_head_down = smooth(1.5, 2.0, t);
        const u_head_up = smooth(3.4, 3.9, t);
        const u_head = u_head_down - u_head_up;
        const u_bounds = smooth(2.6, 3.2, t);
        
        const X = x_of(s.prevMid) + (x_of(mid) - x_of(s.prevMid)) * u_bridge;
        
        const Ha = heightOf(val);
        const Z_head_up = 95;
        const Z_head_down = 41 + (Ht + Ha) / 2;
        const Z_head = Z_head_up + (Z_head_down - Z_head_up) * u_head;
        
        const tilt_final = Math.asin(Math.max(-1, Math.min(1, (Ht - Ha + 2) / 40)));
        const tilt = tilt_final * u_head;

        const L_curr = s.L + (newL - s.L) * u_bounds;
        const R_curr = s.R + (newR - s.R) * u_bounds;

        const tagIn = smooth(1.6, 2.0, t);
        const hlIn = (val === p.target) ? tagIn : 0;
        
        return { X, Z_head, tilt, L_curr, R_curr, val, tagIn, hlIn };
      },
      readout(st) {
        let tag = '';
        if (st.val < p.target) tag = 'TOO SMALL';
        else if (st.val > p.target) tag = 'TOO BIG';
        else tag = 'FOUND';
        if (s.L > s.R) tag = 'NOT FOUND';

        return {
          label: `TARGET: ${p.target}`,
          value: `MID: ${st.val}`,
          tag,
          tagIn: st.tagIn
        };
      },
    };
  }
  M_.register('comparator-rack', { normalize, build });
})(typeof window !== 'undefined' ? window : globalThis);
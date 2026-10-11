(function (root) {
  'use strict';
  const M_ = root.MM_MACHINES;
  if (!M_) return;
  const { smooth } = M_.util;

  function normalize(params, state) {
    let item = String(state.item || "KEY").substring(0, 5).toUpperCase();
    let bits = String(state.bits || "0".repeat(16)).padEnd(16, "0").substring(0, 16);
    let op = ["add", "check"].includes(state.op) ? state.op : "check";
    
    let hashes = state.hashes;
    if (!Array.isArray(hashes) || hashes.length !== 3) {
      hashes = [];
      let seed = 0;
      for (let i = 0; i < item.length; i++) seed += item.charCodeAt(i);
      for (let i = 0; i < 3; i++) {
        seed = (seed * 9301 + 49297) % 233280;
        let val = Math.floor((seed / 233280) * 16);
        while (hashes.includes(val)) val = (val + 1) % 16;
        hashes.push(val);
      }
    }
    return { p: {}, s: { item, bits, op, hashes } };
  }

  function build(p, s) {
    const { k } = root.ANATOMY;
    const VW = 1000;
    const VH = 640;
    const AZIMUTH = 76;
    const ELEVATION = 22;

    const Z_REST = 130;
    const Z_BOTTOM = 58;
    const Z_HIT = 90;
    const PIN_UP = 66;
    const PIN_DOWN = 34;
    const PEG_LEN = 24;

    const match = s.hashes.every(h => s.bits[h] === '1');
    const zTarget = s.op === 'add' ? Z_BOTTOM : (match ? Z_BOTTOM : Z_HIT);

    // Plans are defined with x,y as the minimum bounds, not the center.
    // Setting x = -w/2 and y = -d/2 ensures the parts are perfectly centered around [0, 0].
    const BASE_PLAN = { x: -310, y: -50, w: 620, d: 100, r: 8 };
    const ANVIL_PLAN = { x: -265, y: -30, w: 530, d: 60, r: 4 };
    const BAR_PLAN = { x: -310, y: -18, w: 620, d: 36, r: 4 };
    const CAR_PLAN = { x: -284, y: -23, w: 568, d: 46, r: 4 };
    const PLACARD = { x: -45, y: 5, w: 90, d: 16, r: 2 };

    const EXTREMES = [
      ...k.boxCorners({ x: -320, y: -70, w: 640, d: 140, r: 0 }, -10, 200)
    ];
    
    const P = k.fitProjection(EXTREMES, VW, VH, { pad: 24, headroom: 44, azimuth: AZIMUTH, elevation: ELEVATION });
    const at = (pt) => k.iso(pt, P);
    const S = (paths, style) => k.solidSvg(paths, style);
    const L = (d, style) => k.lineSvg(d, style);
    const D = (pts, style) => k.dotsSvg(pts, style);

    const baseStatic = [];
    baseStatic.push(`<path class="iso-halo" style="filter:blur(8px);transform:translateY(4px)" d="${k.haloOf(BASE_PLAN, 0, 12, P)}"/>`);
    
    for (let [fx, fy] of [...k.corners(BASE_PLAN, 12)].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P))) {
      baseStatic.push(S(k.cylinder(fx, fy, 8, -8, 8, P, 16), { tone: 'lo' }));
      baseStatic.push(S(k.cylinder(fx, fy, 6, 0, 12, P, 16), { tone: 'mid' }));
    }
    
    baseStatic.push(S(k.slabOf(BASE_PLAN, 0, 12, P, 8, 1), { tone: 'mid' }));
    baseStatic.push(L(k.planOutline(k.insetPlan(BASE_PLAN, 4), 12, P), { tone: 'faint' }));
    baseStatic.push(D(k.corners(BASE_PLAN, 6).map(pt => at([pt[0], pt[1], 12])), { size: 1.2, tone: 'lo' }));
    
    baseStatic.push(S(k.slabOf(ANVIL_PLAN, 12, 18, P, 4, 0.8), { tone: 'mid' }));

    const collarIndices = Array.from({length: 16}, (_, i) => i).sort((a, b) => k.depthOf([(a - 7.5) * 32, 0, 0], P) - k.depthOf([(b - 7.5) * 32, 0, 0], P));
    for (let i of collarIndices) {
      let cx = (i - 7.5) * 32;
      baseStatic.push(S(k.cylinder(cx, 0, 11, 30, 2, P, 16), { tone: 'lo' }));
      baseStatic.push(L(k.ring(cx, 0, 7, 32, P, 16), { tone: 'hi' }));
    }

    const railsStatic = [];
    const railX = [-284, 284].sort((a, b) => k.depthOf([a, 0, 0], P) - k.depthOf([b, 0, 0], P));
    for (let rx of railX) {
      railsStatic.push(S(k.cylinder(rx, 0, 14, 12, 162, P, 20), { tone: 'lo' }));
    }

    const topBarStatic = [];
    topBarStatic.push(S(k.slabOf(BAR_PLAN, 174, 16, P, 4, 1.5), { tone: 'mid' }));

    const layers = [
      { s: baseStatic.join('') },
      { s: railsStatic.join('') },
      {
        d: (st) => {
          let out = [];
          const indices = Array.from({length: 16}, (_, i) => i).sort((a, b) => k.depthOf([(a - 7.5) * 32, 0, 0], P) - k.depthOf([(b - 7.5) * 32, 0, 0], P));
          for (let i of indices) {
            let cx = (i - 7.5) * 32;
            out.push(S(k.cylinder(cx, 0, 7, 32, st.pinZ[i] - 32, P, 16), { tone: 'hi', lit: st.pinLit[i] }));
          }
          return out.join('');
        }
      },
      {
        d: (st) => {
          let out = [];
          const pegIndices = s.hashes.slice().sort((a, b) => k.depthOf([(a - 7.5) * 32, 0, 0], P) - k.depthOf([(b - 7.5) * 32, 0, 0], P));
          for (let h of pegIndices) {
            let cx = (h - 7.5) * 32;
            out.push(S(k.cylinder(cx, 0, 4.5, st.carZ - PEG_LEN, PEG_LEN, P, 12), { tone: 'lo' }));
          }
          return out.join('');
        }
      },
      {
        d: (st) => {
          let out = [];
          
          // Painter's order for carriage block vs sleeves
          const carParts = [];
          carParts.push({ d: k.depthOf([0, 0, 0], P), svg: S(k.slabOf(CAR_PLAN, st.carZ, 26, P, 4, 1), { tone: 'mid' }) });
          carParts.push({ d: k.depthOf([-284, 0, 0], P), svg: S(k.cylinder(-284, 0, 22, st.carZ - 4, 34, P, 24), { tone: 'mid' }) });
          carParts.push({ d: k.depthOf([284, 0, 0], P), svg: S(k.cylinder(284, 0, 22, st.carZ - 4, 34, P, 24), { tone: 'mid' }) });
          carParts.sort((a, b) => a.d - b.d);
          out.push(...carParts.map(p => p.svg));
          
          const screwIndices = Array.from({length: 16}, (_, i) => i).sort((a, b) => k.depthOf([(a - 7.5) * 32, 0, 0], P) - k.depthOf([(b - 7.5) * 32, 0, 0], P));
          for (let i of screwIndices) {
            let cx = (i - 7.5) * 32;
            if (s.hashes.includes(i)) {
              out.push(S(k.cylinder(cx, 0, 4, st.carZ + 26, 4, P, 12), { tone: 'hi' }));
              out.push(L(k.segment([cx - 2.5, 0, st.carZ + 30], [cx + 2.5, 0, st.carZ + 30], P), { tone: 'lo' }));
            } else {
              out.push(L(k.ring(cx, 0, 3, st.carZ + 26, P, 12), { tone: 'lo' }));
            }
          }
          
          // Placard sits near the front (+y direction) of the carriage
          out.push(S(k.slabOf(PLACARD, st.carZ + 26, 2, P, 4, 0.5), { tone: 'hi' }));
          const tm = k.topMatrix([0, 13], st.carZ + 28, P, "x");
          out.push(k.faceTextSvg(tm, s.item, { size: 9 }));
          
          return out.join('');
        }
      },
      { s: topBarStatic.join('') }
    ];

    return {
      viewBox: [VW, VH],
      layers,
      meta: {
        corner: "16 BITS, K=3",
        label: "BLOOM FILTER",
      },
      at(t, span = 5) {
        const u = smooth(0.7, 1.5, t);
        const v = smooth(span - 1.5, span - 0.7, t);
        const carZ = Z_REST + (zTarget - Z_REST) * (u - v);
        
        const pinZ = new Array(16);
        const pinLit = new Array(16);
        
        for (let i = 0; i < 16; i++) {
          if (s.bits[i] === '1') {
            pinZ[i] = PIN_DOWN;
            pinLit[i] = true;
          } else {
            let naturalZ = PIN_UP;
            let pushedZ = naturalZ;
            
            if (s.op === 'add' && s.hashes.includes(i)) {
              let lowestCarZReached = Z_REST + (zTarget - Z_REST) * u;
              let minPegBottom = lowestCarZReached - PEG_LEN;
              pushedZ = Math.min(naturalZ, minPegBottom);
            }
            
            pinZ[i] = pushedZ;
            pinLit[i] = (pushedZ < PIN_DOWN + 1);
          }
        }
        
        return { carZ, pinZ, pinLit, t };
      },
      readout(st) {
        let tag = '';
        if (s.op === 'add') tag = 'ADDED';
        else tag = match ? 'FOUND' : 'DENIED';
        
        return {
          label: "TESTING",
          value: s.item,
          tag,
          tagIn: smooth(1.4, 1.7, st.t),
        };
      },
    };
  }

  M_.register('bloom-filter', { normalize, build });
})(typeof window !== 'undefined' ? window : globalThis);
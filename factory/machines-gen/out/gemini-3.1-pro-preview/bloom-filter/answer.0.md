MAPPING: A mechanical punch gauge tests a metal tag: its three pegs push bit-pins down to add the item, but when checking, any un-pushed pin physically blocks the gauge from closing.

PARTS: The base is a heavy bevelled slab on four round feet, featuring a faint inset groove and four corner screws. The mechanism rests on a raised anvil block with sixteen bore collars along its top. Sixteen cylindrical pins sit in the collars, their tips standing proud when zero and flush when one. Above them, a sliding carriage block rides on two tall cylindrical guide rails that are tied together by a top bar. The carriage holds a placard reading the current item, and features sixteen set-screws on its top, three of which hold long steel pegs pointing down to strike the pins below.

KIND: bloom-filter

```javascript
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
    const { k, G } = root.ANATOMY;
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

    const EXTREMES = [
      [-320, -70, 0], [320, 70, 0],
      [-300, 0, 190], [300, 0, 190],
      [0, 50, Z_REST + 30],
    ];
    
    const P = k.fitProjection(EXTREMES, VW, VH, { pad: 24, headroom: 44, azimuth: AZIMUTH, elevation: ELEVATION });
    const at = (pt) => k.iso(pt, P);
    const S = (paths, style) => k.solidSvg(paths, style);
    const L = (d, style) => k.lineSvg(d, style);
    const D = (pts, style) => k.dotsSvg(pts, style);

    const baseStatic = [];
    const BASE_PLAN = { x: 0, y: 0, w: 620, d: 100, r: 8 };
    baseStatic.push(`<path class="iso-halo" style="filter:blur(8px);transform:translateY(4px)" d="${k.haloOf(BASE_PLAN, 0, 12, P)}"/>`);
    
    for (let [fx, fy] of [...k.corners(BASE_PLAN, 12)].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P))) {
      baseStatic.push(S(k.cylinder(fx, fy, 8, -8, 8, P, 16), { tone: 'lo' }));
      baseStatic.push(S(k.cylinder(fx, fy, 6, 0, 12, P, 16), { tone: 'mid' }));
    }
    
    baseStatic.push(S(k.slabOf(BASE_PLAN, 0, 12, P, 8, 1), { tone: 'mid' }));
    baseStatic.push(L(k.planOutline(k.insetPlan(BASE_PLAN, 4), 12, P), { tone: 'faint' }));
    baseStatic.push(D(k.corners(BASE_PLAN, 6).map(pt => at([pt[0], pt[1], 12])), { size: 1.2, tone: 'lo' }));

    const ANVIL_PLAN = { x: 0, y: 0, w: 530, d: 60, r: 4 };
    baseStatic.push(S(k.slabOf(ANVIL_PLAN, 12, 18, P, 4, 0.8), { tone: 'mid' }));

    for (let i = 0; i < 16; i++) {
      let cx = (i - 7.5) * 32;
      baseStatic.push(S(k.cylinder(cx, 0, 11, 30, 2, P, 16), { tone: 'lo' }));
      baseStatic.push(L(k.ring(cx, 0, 7, 32, P, 16), { tone: 'hi' }));
    }

    const railsStatic = [];
    railsStatic.push(S(k.cylinder(-284, 0, 14, 12, 162, P, 20), { tone: 'lo' }));
    railsStatic.push(S(k.cylinder(284, 0, 14, 12, 162, P, 20), { tone: 'lo' }));

    const topBarStatic = [];
    const BAR_PLAN = { x: 0, y: 0, w: 620, d: 36, r: 4 };
    topBarStatic.push(S(k.slabOf(BAR_PLAN, 174, 16, P, 4, 1.5), { tone: 'mid' }));

    const layers = [
      { s: baseStatic.join('') },
      { s: railsStatic.join('') },
      {
        d: (st) => {
          let out = [];
          for (let i = 0; i < 16; i++) {
            let cx = (i - 7.5) * 32;
            out.push(S(k.cylinder(cx, 0, 7, 32, st.pinZ[i] - 32, P, 16), { tone: 'hi', lit: st.pinLit[i] }));
          }
          return out.join('');
        }
      },
      {
        d: (st) => {
          let out = [];
          for (let h of s.hashes) {
            let cx = (h - 7.5) * 32;
            out.push(S(k.cylinder(cx, 0, 4.5, st.carZ - PEG_LEN, PEG_LEN, P, 12), { tone: 'lo' }));
          }
          return out.join('');
        }
      },
      {
        d: (st) => {
          let out = [];
          const CAR_PLAN = { x: 0, y: 0, w: 530, d: 46, r: 4 };
          out.push(S(k.slabOf(CAR_PLAN, st.carZ, 26, P, 4, 1), { tone: 'mid' }));
          
          out.push(S(k.cylinder(-284, 0, 22, st.carZ - 4, 34, P, 24), { tone: 'mid' }));
          out.push(S(k.cylinder(284, 0, 22, st.carZ - 4, 34, P, 24), { tone: 'mid' }));
          
          const screws = [];
          for (let i = 0; i < 16; i++) {
            let cx = (i - 7.5) * 32;
            if (s.hashes.includes(i)) {
              out.push(S(k.cylinder(cx, 0, 4, st.carZ + 26, 4, P, 12), { tone: 'hi' }));
            } else {
              screws.push(at([cx, 0, st.carZ + 26]));
            }
          }
          out.push(D(screws, { size: 1.5, tone: 'lo' }));
          
          const PLACARD = { x: 0, y: 0, w: 90, d: 24, r: 2 };
          out.push(S(k.slabOf(PLACARD, st.carZ + 26, 2, P, 2), { tone: 'hi' }));
          
          const tm = k.topMatrix(at([0, 0, st.carZ + 28]), 0, P, "x");
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
        const v = smooth(3.5, 4.3, t);
        const carZ = Z_REST + (zTarget - Z_REST) * (u - v);
        
        const pinZ = new Array(16);
        const pinLit = new Array(16);
        
        for (let i = 0; i < 16; i++) {
          if (s.bits[i] === '1') {
            pinZ[i] = PIN_DOWN;
            pinLit[i] = true;
          } else {
            if (s.op === 'add' && s.hashes.includes(i)) {
              let drop = PIN_UP + (PIN_DOWN - PIN_UP) * u;
              pinZ[i] = drop;
              pinLit[i] = (drop < PIN_DOWN + 1);
            } else {
              pinZ[i] = PIN_UP;
              pinLit[i] = false;
            }
          }
        }
        
        return { carZ, pinZ, pinLit, t };
      },
      readout(st) {
        let tag = '';
        if (s.op === 'add') tag = 'ADDED';
        else tag = match ? 'FOUND' : 'MISSING';
        
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
```

```json
{
  "scenes": [
    {
      "headline": "Adding pushes pins down.",
      "subhead": "hashes to three locations",
      "params": {},
      "state": {
        "item": "USER",
        "bits": "0000000000000000",
        "hashes": [4, 9, 12],
        "op": "add"
      }
    },
    {
      "headline": "Bits overlap harmlessly.",
      "subhead": "one bit was already set",
      "params": {},
      "state": {
        "item": "ADMIN",
        "bits": "0000100001001000",
        "hashes": [2, 9, 15],
        "op": "add"
      }
    },
    {
      "headline": "Missing bits block the check.",
      "subhead": "definitively not in set",
      "params": {},
      "state": {
        "item": "GUEST",
        "bits": "0010100001001001",
        "hashes": [1, 9, 12],
        "op": "check"
      }
    },
    {
      "headline": "False positives can slip in.",
      "subhead": "other items pushed these",
      "params": {},
      "state": {
        "item": "ROOT",
        "bits": "0010100001001001",
        "hashes": [2, 4, 15],
        "op": "check"
      }
    }
  ]
}
```
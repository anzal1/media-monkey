(function (root) {
  'use strict';
  const M_ = root.MM_MACHINES;
  if (!M_) return;
  const { glide, smooth, clamp01 } = M_.util;

  function normalize(params, state) {
    const activeNodes = Array.isArray(state.nodes) ? state.nodes.map(Number) : [0, 120, 240];
    const addedNode = state.addedNode != null ? Number(state.addedNode) : null;
    const removedNode = state.removedNode != null ? Number(state.removedNode) : null;
    const dropAngle = state.drop != null ? Number(state.drop) : 100;
    const action = ['route', 'add', 'remove'].includes(state.action) ? state.action : 'route';

    return {
      p: { label: params.label || 'HASH RING' },
      s: { activeNodes, addedNode, removedNode, dropAngle, action }
    };
  }

  function build(p, s) {
    const { k, G } = root.ANATOMY;

    const FZ = G.frameAlong([0, 0, 0], [0, 0, 1]);
    const BASE = { x: -320, y: -320, w: 640, d: 640, r: 40 };

    const EXTREMES = [
      ...k.boxCorners(BASE, -20, 15),
      [0, 0, 100],
      [350, 350, 40], [-350, -350, 40]
    ];
    const P = k.fitProjection(EXTREMES, 1000, 640, { pad: 16, headroom: 44, azimuth: 45, elevation: 30 });
    const at = (pt) => k.iso(pt, P);
    const S = (paths, style) => k.solidSvg(paths, style);
    const V = G.viewOf(P);

    // Static Background (Base, Rail, Platter floor)
    const bg = [];
    bg.push(`<path class="iso-halo" style="filter:blur(10px);transform:translateY(4px)" d="${k.haloOf(BASE, -20, 15, P)}"/>`);
    
    const feet = k.corners(BASE, 24).sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
    for (const [fx, fy] of feet) {
      bg.push(S(k.cylinder(fx, fy, 16, -20, 5, P, 24), { tone: 'lo' }));
    }
    
    bg.push(S(k.slabOf(BASE, -15, 15, P, 10, 1), { tone: 'lo' }));
    bg.push(S(G.ringBand(0, 8, 242, 280, FZ, P), { tone: 'mid' }));
    bg.push(S(G.disc(0, 8, 240, FZ, P), { tone: 'hi' }));
    bg.push(S(G.disc(8, 12, 30, FZ, P), { tone: 'mid' }));
    bg.push(S(G.disc(12, 14, 15, FZ, P), { tone: 'lo' }));

    // Pre-build dynamic items (Nodes, Chute, Arm, Spindle)
    const items = [];

    const buildNode = (a_deg, type) => {
      const a = a_deg * Math.PI / 180;
      const ca = Math.cos(a), sa = Math.sin(a);
      const rot = (pts) => pts.map(([x, y]) => [x * ca - y * sa, x * sa + y * ca]);

      const diverter = k.extrude(rot([[150, 10], [242, 10], [242, 18], [150, 18]]), 8, 16, P, { convex: true, bevel: 0.5 });
      const clampLeft = k.extrude(rot([[242, 10], [280, 10], [280, 22], [242, 22]]), 8, 16, P, { convex: true, bevel: 0.5 });
      const clampRight = k.extrude(rot([[242, -22], [280, -22], [280, -11], [242, -11]]), 8, 16, P, { convex: true, bevel: 0.5 });
      const clampTop = k.extrude(rot([[242, -22], [280, -22], [280, 22], [242, 22]]), 24, 4, P, { convex: true, bevel: 0.5 });
      const binBase = k.extrude(rot([[285, 22], [330, 22], [330, -22], [285, -22]]), 0, 5, P, { convex: true });
      const binWall = k.extrude(rot([[285, 22], [330, 22], [330, -22], [285, -22]]), 5, 20, P, { convex: true, bevel: 0.5 });
      const binHole = rot([[290, 16], [325, 16], [325, -16], [290, -16]]).map(pt => at([pt[0], pt[1], 25]));

      let svg = S(binBase, { tone: 'lo' })
              + S(binWall, { tone: 'mid' })
              + `<path d="${k.pathOf(binHole, true)}" fill="#1a1815" opacity="0.85"/>`
              + S(diverter, { tone: 'hi' })
              + S(clampLeft, { tone: 'hi' })
              + S(clampRight, { tone: 'hi' })
              + S(clampTop, { tone: 'hi' });

      const center = [285 * ca, 285 * sa, 0];
      items.push({
        kind: 'node',
        svg,
        baseDepth: k.depthOf(center, P),
        z: 12,
        isAdd: type === 'add',
        isRemove: type === 'remove'
      });
    };

    s.activeNodes.forEach(n => buildNode(n, 'active'));
    if (s.addedNode != null) buildNode(s.addedNode, 'add');
    if (s.removedNode != null) buildNode(s.removedNode, 'remove');

    const dr = s.dropAngle * Math.PI / 180;
    const cx = 190 * Math.cos(dr), cy = 190 * Math.sin(dr);
    
    const chuteSvg = S(k.cylinder(cx, cy, 14, 55, 40, P, 24), { tone: 'mid' })
                   + S(k.cylinder(cx, cy, 17, 55, 4, P, 24), { tone: 'hi' });
    items.push({ kind: 'chute', svg: chuteSvg, baseDepth: k.depthOf([cx, cy, 0], P), z: 75 });

    const armPlan = [[0, -5], [190, -5], [190, 5], [0, 5]].map(([x, y]) => [x * Math.cos(dr) - y * Math.sin(dr), x * Math.sin(dr) + y * Math.cos(dr)]);
    const armSvg = S(k.extrude(armPlan, 85, 6, P, { convex: true, bevel: 0.5 }), { tone: 'mid' });
    items.push({ kind: 'arm', svg: armSvg, baseDepth: k.depthOf([cx/2, cy/2, 0], P), z: 85 });
    
    const spindleSvg = S(k.cylinder(0, 0, 8, 14, 77, P, 24), { tone: 'mid' });
    items.push({ kind: 'spindle', svg: spindleSvg, baseDepth: k.depthOf([0,0,0], P), z: 50 });

    // Precalculate Routing Target
    let N = [...s.activeNodes].sort((a, b) => a - b);
    let targetNode = N.find(x => x >= s.dropAngle);
    if (targetNode == null) targetNode = N[0];
    let delta = (targetNode - s.dropAngle + 360) % 360;

    const layers = [
      { s: bg.join('') },
      { d: (st) => {
          const a = st.platterAngle * Math.PI / 180;
          const minor = [], major = [];
          for (let i = 0; i < 72; i++) {
            const angle = a + (i / 72) * Math.PI * 2;
            const isMajor = i % 6 === 0;
            const len = isMajor ? 8 : 4;
            const p1 = at([235 * Math.cos(angle), 235 * Math.sin(angle), 8]);
            const p2 = at([(235 - len) * Math.cos(angle), (235 - len) * Math.sin(angle), 8]);
            if (isMajor) major.push(k.pathOf([p1, p2]));
            else minor.push(k.pathOf([p1, p2]));
          }
          return `<g>${k.lineSvg(minor.join(''), { tone: 'lo' })}${k.lineSvg(major.join(''), { tone: 'mid' })}</g>`;
        }
      },
      { d: (st) => {
          const frameItems = [];
          
          if (st.op > 0.01) {
            let puck = S(k.cylinder(st.px, st.py, 10, st.pz, 6, P, 16), { tone: 'lit' });
            if (st.op < 1) puck = `<g opacity="${st.op.toFixed(2)}">${puck}</g>`;
            frameItems.push({ depth: k.depthOf([st.px, st.py, 0], P) + st.pz * V[2], svg: puck });
          }
          
          for (let it of items) {
            let zOff = 0, op = 1;
            if (it.isAdd) {
              let u = clamp01((st.t - 0.2) / 0.6);
              zOff = 80 * (1 - glide(u));
              op = smooth(0, 1, u);
            }
            if (it.isRemove) {
              let u = clamp01((st.t - 0.2) / 0.6);
              zOff = 80 * glide(u);
              op = 1 - smooth(0, 1, u);
            }
            if (op > 0.01) {
              let svg = it.svg;
              if (zOff > 0 || op < 1) {
                svg = `<g transform="${k.translateAlong(P, [0, 0, zOff])}" opacity="${op.toFixed(2)}">${svg}</g>`;
              }
              frameItems.push({ depth: it.baseDepth + (it.z + zOff) * V[2], svg });
            }
          }
          
          frameItems.sort((a, b) => a.depth - b.depth);
          return frameItems.map(i => i.svg).join('');
        }
      }
    ];

    return {
      viewBox: [1000, 640],
      layers,
      meta: { corner: p.label, label: 'HASH RING ROUTER', accent: null },
      at(t, span = 5) {
        let T_start = 0.7;
        let T_land = 1.1;
        let T_hit = T_land + delta / 120;
        let T_bin = T_hit + 0.4;

        let px = 0, py = 0, pz = 0, op = 0;
        let stateName = "READY";
        let val = "";

        if (t >= T_start && t < T_land) {
          let u = (t - T_start) / (T_land - T_start);
          pz = 54 - 46 * glide(u);
          let a = s.dropAngle * Math.PI / 180;
          px = 190 * Math.cos(a);
          py = 190 * Math.sin(a);
          op = Math.min(1, u * 4);
          stateName = "HASHING";
        } else if (t >= T_land && t < T_hit) {
          let a = (s.dropAngle + (t - T_land) * 120) * Math.PI / 180;
          px = 190 * Math.cos(a);
          py = 190 * Math.sin(a);
          pz = 8;
          op = 1;
          stateName = "SEEKING";
        } else if (t >= T_hit && t < T_bin) {
          let u = (t - T_hit) / (T_bin - T_hit);
          let r = 190 + 115 * glide(u);
          let a = targetNode * Math.PI / 180;
          px = r * Math.cos(a);
          py = r * Math.sin(a);
          pz = 8;
          op = 1;
          stateName = "ROUTING";
          val = targetNode.toString();
        } else if (t >= T_bin) {
          let u = Math.min(1, (t - T_bin) / 0.3);
          let a = targetNode * Math.PI / 180;
          px = 305 * Math.cos(a);
          py = 305 * Math.sin(a);
          pz = 8 - 4 * glide(u);
          op = 1 - glide(u);
          stateName = "STORED";
          val = targetNode.toString();
        }

        let platterAngle = t * 120;
        let tagIn = (s.action === 'add' || s.action === 'remove') ? smooth(0.2, 0.5, t) : 0;
        let tag = s.action === 'add' ? 'NODE ADDED' : s.action === 'remove' ? 'NODE REMOVED' : '';

        return { t, px, py, pz, op, platterAngle, stateName, val, tag, tagIn };
      },
      readout(st) {
        return {
          label: st.stateName,
          value: st.val ? 'NODE ' + st.val : '',
          tag: st.tag,
          tagIn: Math.max(0, st.tagIn)
        };
      },
    };
  }

  M_.register('hash-ring', { normalize, build });
})(typeof window !== 'undefined' ? window : globalThis);
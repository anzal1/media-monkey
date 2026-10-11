/*
 * machines.js: shared runtime for parametric machine figures.
 *
 * A machine is drawn once per scene with the vendored Anatomy kit
 * (window.ANATOMY, see factory/explainer/anatomy) and then driven by time
 * alone. The planner only ever picks a machine kind and fills its params and
 * state; every pixel comes from here.
 *
 * Contract for a machine definition registered with MM_MACHINES.register:
 *   normalize(params, state) -> { p, s }   throws on anything it cannot draw
 *   build(p, s) -> {
 *     viewBox: [w, h],
 *     layers: [{ s: staticSvg } | { d: (frameState) => svg }],   painter's order
 *     at(t, span) -> frameState                                  pure in t
 *     readout(frameState) -> { label, value, tag }
 *     meta: { corner }
 *   }
 * Static layers are written once; a dynamic layer is rewritten only when its
 * string changes, so a machine at rest costs nothing per frame.
 *
 * Everything is a pure function of (params, state, t, span): no clock, no
 * requestAnimationFrame, no randomness. The page steps it frame by frame.
 */
(function (root) {
  'use strict';
  const REG = {};
  const A = () => root.ANATOMY;

  // warm paper tokens for the kit's light theme, tuned for a phone screen:
  // heavier lines and a little more shade contrast than the web figures,
  // because Instagram's encoder eats hairlines and 3% tone steps
  const CSS = `
.mm-mach{
  --anatomy-paper:#ffffff;--anatomy-face:#ffffff;--anatomy-top:#fcfbf8;
  --anatomy-shade-0:#d9d2c5;--anatomy-shade-1:#e4ded3;--anatomy-shade-2:#eeeae2;--anatomy-shade-3:#f6f3ed;
  --anatomy-lit-top:#ffffff;--anatomy-lit-shade:#f4efe6;
  --anatomy-hi:#22201c;--anatomy-mid:#8a8378;--anatomy-lo:#b8b0a3;--anatomy-faint:#dcd6cb;--anatomy-lit:var(--accent);
  --anatomy-halo:#6f6450;--anatomy-halo-opacity:.22;--anatomy-dot:#4a453d;
  --anatomy-weight:1.5px;
  display:block;width:100%;height:auto;overflow:visible}
.mm-mach .iso-fill{fill:var(--anatomy-paper);stroke:none}
.mm-mach .iso-solid[data-lit]>.iso-fill{fill:var(--anatomy-face)}
.mm-mach .iso-shade,.mm-mach .iso-top{stroke:none}
.mm-mach .iso-shade[data-shade="0"]{fill:var(--anatomy-shade-0)}
.mm-mach .iso-shade[data-shade="1"]{fill:var(--anatomy-shade-1)}
.mm-mach .iso-shade[data-shade="2"]{fill:var(--anatomy-shade-2)}
.mm-mach .iso-shade[data-shade="3"]{fill:var(--anatomy-shade-3)}
.mm-mach .iso-top{fill:var(--anatomy-top)}
.mm-mach .iso-solid[data-lit]>.iso-top{fill:var(--anatomy-lit-top)}
.mm-mach .iso-solid[data-lit]>.iso-shade{fill:var(--anatomy-lit-shade)}
.mm-mach .iso-solid[data-seamless]>.iso-shade,.mm-mach .iso-solid[data-seamless]>.iso-top{stroke-width:.6;stroke-linejoin:round}
.mm-mach .iso-solid[data-seamless]>.iso-shade[data-shade="0"]{stroke:var(--anatomy-shade-0)}
.mm-mach .iso-solid[data-seamless]>.iso-shade[data-shade="1"]{stroke:var(--anatomy-shade-1)}
.mm-mach .iso-solid[data-seamless]>.iso-shade[data-shade="2"]{stroke:var(--anatomy-shade-2)}
.mm-mach .iso-solid[data-seamless]>.iso-shade[data-shade="3"]{stroke:var(--anatomy-shade-3)}
.mm-mach .iso-solid[data-seamless]>.iso-top{stroke:var(--anatomy-top)}
.mm-mach .iso-solid[data-lit]>.iso-edge{stroke:var(--anatomy-lit)}
.mm-mach .iso-halo{fill:var(--anatomy-halo);stroke:none;opacity:var(--anatomy-halo-opacity)}
.mm-mach path,.mm-mach circle{vector-effect:non-scaling-stroke}
.mm-mach .iso-line{fill:none;stroke:var(--anatomy-lo);stroke-width:var(--anatomy-weight);stroke-linecap:round;stroke-linejoin:round}
.mm-mach .iso-line[data-tone="hi"]{stroke:var(--anatomy-hi)}
.mm-mach .iso-line[data-tone="mid"]{stroke:var(--anatomy-mid)}
.mm-mach .iso-line[data-tone="lo"]{stroke:var(--anatomy-lo)}
.mm-mach .iso-line[data-tone="faint"]{stroke:var(--anatomy-faint)}
.mm-mach .iso-line[data-tone="lit"]{stroke:var(--anatomy-lit)}
.mm-mach .iso-edge[data-tone="hi"]{stroke-width:2px}
.mm-mach .iso-solid[data-lit]>.iso-edge{stroke-width:2.2px}
.mm-mach .iso-dots circle{fill:var(--anatomy-dot);stroke:none;opacity:.5}
.mm-mach .iso-dots[data-tone="hi"] circle{opacity:.85}
.mm-mach .iso-dots[data-tone="lo"] circle{opacity:.32}
.mm-mach .mm-glyph{font-family:'JetBrains Mono',ui-monospace,Menlo,monospace;font-weight:700;fill:var(--anatomy-hi);text-anchor:middle}
.mm-mach .mm-glyph[data-g="off"]{fill:#9c9588}
.mm-mach .mm-glyph[data-g="sign"]{fill:var(--accent)}
.mm-mach .mm-accent{fill:none;stroke:var(--accent);stroke-width:2.4px;stroke-linejoin:round}
`;

  let styled = false;
  function ensureStyle() {
    if (styled || typeof document === 'undefined') return;
    styled = true;
    const el = document.createElement('style');
    el.textContent = CSS;
    document.head.appendChild(el);
  }

  // ---- calm easing: zero velocity at both ends, no overshoot, ever
  const clamp01 = (u) => (u < 0 ? 0 : u > 1 ? 1 : u);
  const glide = (u) => { u = clamp01(u); return u * u * u * (u * (u * 6 - 15) + 10); };
  const hump = (u) => (u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u) ** 2);
  const smooth = (e0, e1, x) => { const u = clamp01((x - e0) / (e1 - e0)); return u * u * (3 - 2 * u); };

  /**
   * A prism along world x of any (also concave) outline in the y-z plane.
   * The kit extrudes along z and lathe's prismOf wants a convex polygon; a
   * gear is neither. Same shading and silhouette rules as kit.extrude, with
   * the axes turned: the cap at x1 plays the part of the top.
   */
  function prismX(ring, x0, x1, P) {
    const { k, G } = A();
    const V = G.viewOf(P);
    const L = G.lightOf(P);
    let area = 0;
    for (let i = 0; i < ring.length; i++) {
      const [ay, az] = ring[i]; const [by, bz] = ring[(i + 1) % ring.length];
      area += ay * bz - by * az;
    }
    const ccw = area > 0;
    const n = ring.length;
    const near = ring.map(([y, z]) => k.iso([x1, y, z], P));
    const far = ring.map(([y, z]) => k.iso([x0, y, z], P));
    const normals = ring.map(([ay, az], i) => {
      const [by, bz] = ring[(i + 1) % n];
      const dy = by - ay; const dz = bz - az; const len = Math.hypot(dy, dz) || 1;
      return ccw ? [0, dz / len, -dy / len] : [0, -dz / len, dy / len];
    });
    const facing = normals.map((nv) => G.dot3(nv, V) > 1e-9);
    const capSeen = V[0] > 0;
    const top = capSeen ? near : far;
    const back = capSeen ? far : near;
    const path = k.pathOf;
    const runs = (want) => {
      const out = []; const start = facing.findIndex((f, i) => f !== facing[(i + n - 1) % n]);
      if (start < 0) return facing[0] === want ? [Array.from({ length: n + 1 }, (_, i) => i % n)] : [];
      let run = null;
      for (let s = 0; s < n; s++) {
        const i = (start + s) % n;
        if (facing[i] === want) { if (!run) run = [i]; run.push((i + 1) % n); } else if (run) { out.push(run); run = null; }
      }
      if (run) out.push(run);
      return out;
    };
    const outline = []; const crease = [];
    for (const run of runs(false)) outline.push(path(run.map((i) => top[i])));
    for (const run of runs(true)) { crease.push(path(run.map((i) => top[i]))); outline.push(path(run.map((i) => back[i]))); }
    for (let i = 0; i < n; i++) if (facing[(i + n - 1) % n] !== facing[i]) outline.push(path([top[i], back[i]]));
    const orient = (pts) => {
      let s = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i]; const b = pts[(i + 1) % pts.length]; s += a[0] * b[1] - b[0] * a[1]; }
      return s < 0 ? [...pts].reverse() : pts;
    };
    const buckets = [[], [], [], []];
    const parts = [path(orient(top), true), path(orient(back), true)];
    for (let i = 0; i < n; i++) {
      if (!facing[i]) continue;
      const j = (i + 1) % n;
      const quad = path(orient([top[i], top[j], back[j], back[i]]), true);
      parts.push(quad);
      buckets[Math.min(3, G.bandOf(G.dot3(normals[i], L)))].push(quad);
    }
    const capTone = G.bandOf(G.dot3([capSeen ? 1 : -1, 0, 0], L));
    const capPath = path(orient(top), true);
    return {
      fill: parts.join(''),
      outline: outline.join(''),
      crease: crease.join(''),
      top: capTone >= 4 ? capPath : '',
      shades: buckets.map((b, i) => b.join('') + (capTone === i ? capPath : '')),
    };
  }

  /** Rotate a y-z outline about (cy, cz) by angle (radians, +y toward +z). */
  const turnYZ = (pts, cy, cz, a) => {
    const c = Math.cos(a); const s = Math.sin(a);
    return pts.map(([y, z]) => [cy + (y - cy) * c - (z - cz) * s, cz + (y - cy) * s + (z - cz) * c]);
  };

  function build(kind, params, state) {
    const def = REG[kind];
    if (!def) throw new Error(`unknown machine kind "${kind}"`);
    if (!root.ANATOMY) throw new Error('Anatomy kit not loaded');
    const n = def.normalize(params || {}, state || {});
    return def.build(n.p, n.s);
  }

  /** The whole figure as one SVG string at scene time t. Pure. */
  function render(kind, params, state, t, span = 5) {
    const inst = build(kind, params, state);
    const st = inst.at(t, span);
    const [w, h] = inst.viewBox;
    return `<svg xmlns="http://www.w3.org/2000/svg" class="mm-mach" viewBox="0 0 ${w} ${h}">` +
      inst.layers.map((L) => (L.d ? L.d(st) : L.s)).join('') + '</svg>';
  }

  /**
   * Put a machine into `el` and return a frame driver. Throws (before touching
   * the DOM) when the kind or params are unusable, so the caller can fall back.
   */
  function mount(el, kind, params, state) {
    ensureStyle();
    const inst = build(kind, params, state);
    const [w, h] = inst.viewBox;
    el.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" class="mm-mach" viewBox="0 0 ${w} ${h}" role="img">` +
      inst.layers.map((L, i) => (L.d ? `<g data-l="${i}"></g>` : L.s)).join('') + '</svg>';
    const slots = inst.layers.map((L, i) => (L.d ? el.querySelector(`[data-l="${i}"]`) : null));
    const last = [];
    return {
      meta: inst.meta,
      frame(t, span) {
        const st = inst.at(t, span);
        inst.layers.forEach((L, i) => {
          if (!L.d) return;
          const s = L.d(st);
          if (s !== last[i]) { slots[i].innerHTML = s; last[i] = s; }
        });
        return inst.readout(st);
      },
    };
  }

  root.MM_MACHINES = {
    register(kind, def) { REG[kind] = def; },
    has: (kind) => !!REG[kind],
    kinds: () => Object.keys(REG),
    normalize(kind, params, state) {
      if (!REG[kind]) throw new Error(`unknown machine kind "${kind}"`);
      return REG[kind].normalize(params || {}, state || {});
    },
    render,
    mount,
    util: { clamp01, glide, hump, smooth, prismX, turnYZ },
  };
})(typeof window !== 'undefined' ? window : globalThis);

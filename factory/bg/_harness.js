// Shared harness for the procedural background loops.
//
// Every bg page defines `window.MM = { frame(i) }` where frame(i) draws frame
// index i deterministically (given that frames are drawn in order from 0).
// The page then either free-runs at 60fps for eyeballing in a browser, or waits
// to be driven frame by frame by factory/record-bg.mjs (?manual=1).
//
// Determinism matters: the recorder steps frames itself, so nothing may depend
// on wall-clock time or Math.random.

window.FPS = 60;
window.LOOP_SECONDS = 60;

// ?seed=N picks a variant. record-bg.mjs --seed passes it, which is how the
// factory renders a never-repeating background per reel.
window.MM_SEED = (() => {
  const m = /[?&]seed=(-?\d+)/.exec(location.search);
  return m ? (Number(m[1]) >>> 0) : 1;
})();

// mulberry32: tiny, seeded, good enough for scatter and jitter.
window.rng = function rng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

window.mmBoot = function mmBoot(MM) {
  window.MM = MM;
  window.MM_READY = true;
  const manual = /[?&]manual=1/.test(location.search);
  if (manual) return;
  let i = 0;
  const tick = () => { MM.frame(i++); requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
};

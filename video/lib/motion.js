// motion.js — closed-form motion helpers. Every function is a pure function of time, so a frame
// can be rendered at any t without simulating the frames before it.
//
// Classic script: <script src="lib/motion.js"></script> defines window.M and the bare names
// (spring, track, ...). Module scripts are blocked over file://, which is how render.mjs opens the page.
// In Node (tests, Remotion) it is also require()-able.
(function (root) {
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };   // when you want a plain ease

  // Damped spring step response, 0 -> 1. k = stiffness, d = damping.
  // Underdamped overshoots, critical / overdamped settle without crossing 1.
  function spring(t, k = 170, d = 26) {
    if (t <= 0) return 0;
    const w0 = Math.sqrt(k), z = d / (2 * w0);
    if (z < 1) {
      const wd = w0 * Math.sqrt(1 - z * z);
      return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t));
    }
    if (z === 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
    const q = Math.sqrt(z * z - 1), s1 = -w0 * (z - q), s2 = -w0 * (z + q);
    return 1 - (s2 * Math.exp(s1 * t) - s1 * Math.exp(s2 * t)) / (s2 - s1);
  }

  // [k, d] pairs. Pick by what is moving, not by taste: type never overshoots, mascots may.
  const PRESETS = {
    snappy:  [320, 30],   // buttons, toggles, the leading edge of an indicator
    default: [170, 26],   // cards, containers, camera
    heavy:   [90, 20],    // big type, 3D objects, logo lockups
    playful: [220, 14],   // mascots, stickers: visible overshoot
  };
  const preset = (name) => PRESETS[name] || PRESETS.default;

  // A value with many targets: sum one spring per change, each starting at its own time.
  // keys: [[time, value], ...] sorted by time. Continuous, and still a pure function of t.
  function track(t, keys, k = 170, d = 26) {
    let v = keys[0][1];
    for (let i = 1; i < keys.length; i++) v += (keys[i][1] - keys[i - 1][1]) * spring(t - keys[i][0], k, d);
    return v;
  }

  // Tab indicator / toggle knob that stretches: the leading edge is stiffer than the trailing edge.
  // stops: [[time, x], ...]. Returns { left, right } for a block `width` wide.
  function indicator(t, stops, width = 120) {
    const lead = track(t, stops, 320, 30), trail = track(t, stops, 140, 22);
    return { left: Math.min(lead, trail), right: Math.max(lead, trail) + width };
  }

  // Alpha for content inside a morphing container: in after the morph starts, out before the next.
  // Without this, old and new text overlap during the swap.
  function swapAlpha(t, tIn, tOut, fadeIn = 0.12, fadeOut = 0.1, delay = 0.08) {
    return Math.min(clamp((t - tIn - delay) / fadeIn), clamp((tOut - fadeOut - t) / fadeOut));
  }

  // Seamless loop: map any t into [0, dur). Make draw(0) and draw(dur) identical, velocity included.
  const loopT = (t, dur) => ((t % dur) + dur) % dur;

  // Seeded noise (mulberry32). Never Math.random: the render must be identical every run.
  function rng(seed) {
    return () => {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let x = Math.imul(seed ^ seed >>> 15, 1 | seed);
      x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x;
      return ((x ^ x >>> 14) >>> 0) / 4294967296;
    };
  }

  // Overshoot is set by zeta = d / (2 * sqrt(k)): zeta >= 1 none; 0.78 about 2%; 0.6 about 9%.

  // Stagger helper: the spring value for item i of a group, `step` seconds apart. ~3% overshoot:
  // meant for shapes and cards, not type.
  const stagger = (t, i, step = 0.03, k = 260, d = 24) => spring(t - i * step, k, d);

  const M = { clamp, lerp, smooth, spring, PRESETS, preset, track, indicator, swapAlpha, loopT, rng, stagger };
  if (typeof module !== 'undefined' && module.exports) module.exports = M;
  else Object.assign(root, { M }, M);
})(typeof window !== 'undefined' ? window : globalThis);
